const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const AdmZip = require('adm-zip');
const compressing = require('compressing');

// Configure multer with proper encoding for Arabic filenames
const storage = multer.diskStorage({
    destination: 'temp/',
    filename: (req, file, cb) => {
        // Decode the filename properly for UTF-8
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        file.originalname = originalName;
        cb(null, Date.now() + '-' + Math.random().toString(36).substr(2, 9));
    }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// دالة لحساب حجم مجلد السيرفر بالميجابايت (مع استثناء node_modules و .venv من إبطاء الفحص لو لزم، أو حساب الكل)
function getDirectorySizeBytes(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const full = path.join(dirPath, item);
        try {
            const stat = fs.lstatSync(full);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) {
                total += getDirectorySizeBytes(full);
            } else {
                total += stat.size;
            }
        } catch (e) {}
    }
    return total;
}

// دالة لحساب المسار الكامل للسيرفر
function getServerPath(serverId, relPath = '') {
    const base = path.join(__dirname, '../../../instances', serverId.toString());
    const full = path.join(base, relPath);
    if (!full.startsWith(base)) throw new Error('Invalid path');
    return full;
}

// دالة لتطهير المسار النسبي
function getRelativePath(p = '') {
    return p.replace(/^\/+|\/+$/g, '');
}

// دالة لعرض الملفات
function listFiles(baseDir, relPath = '') {
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const dir = path.join(baseDir, safePath);
    if (!fs.existsSync(dir)) throw new Error('Directory not found');

    return fs.readdirSync(dir).map(f => {
        const fullPath = path.join(dir, f);
        try {
            return {
                name: f,
                isDir: fs.statSync(fullPath).isDirectory(),
                size: fs.statSync(fullPath).size
            };
        } catch (e) { return null; }
    }).filter(Boolean);
}

module.exports = ({ db, isAuth }) => {
    // Middleware للتحقق من صلاحيات الوصول - يعمل على /files و /file
    const checkServerAccess = (req, res, next) => {
        const s = db.getServer(req.params.id);
        if (!s) return res.render('errors/error', { code: 404, msg: 'Not Found' });

        if (s.isSuspended && !req.user.isAdmin)
            return res.render('errors/error', { code: 'SUSPENDED', msg: 'Suspended' });

        const collaborators = JSON.parse(s.collaborators || '[]');
        const isOwner = s.ownerId === req.user.id;
        const isCollaborator = collaborators.includes(req.user.id);
        const isAdmin = req.user.isAdmin;

        if (!isOwner && !isCollaborator && !isAdmin)
            return res.render('errors/error', { code: 403, msg: 'Denied' });

        req.server = s;
        req.isOwner = isOwner;
        req.isCollaborator = isCollaborator;
        req.isAdmin = isAdmin;
        req.serverNavStyle = db.getConfig('server_nav_style') || 'tabs';
        next();
    };
    
    router.use('/:id/files', isAuth, checkServerAccess);
    router.use('/:id/file', isAuth, checkServerAccess);

    // API JSON للملفات
    router.get('/:id/api/files/*?', isAuth, (req, res) => {
        const s = db.getServer(req.params.id);
        if (!s) return res.status(404).json({ error: 'Not Found' });
        try {
            const files = listFiles(getServerPath(s.id), req.params[0]);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.json({ files, currentPath: req.params[0] || '' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // صفحة الملفات مع مسار
    router.get('/:id/files/*?', (req, res) => {
        try {
            const relPath = req.params[0] || '';
            const files = listFiles(getServerPath(req.server.id), relPath);
            res.render('server/files', {
                s: req.server,
                files,
                isOwner: req.isOwner,
                currentPath: relPath.split(path.sep).filter(Boolean),
                serverNavStyle: req.serverNavStyle
            });
        } catch (e) {
            res.render('errors/error', { code: 500, msg: e.message });
        }
    });

    // صفحة الملفات الرئيسية
    router.get('/:id/files', (req, res) => {
        const serverDir = getServerPath(req.server.id);
        try {
            if (!fs.existsSync(serverDir)) {
                return res.render('errors/error', { code: 404, msg: 'Server directory not found' });
            }

            const files = fs.readdirSync(serverDir).map(f => ({
                name: f,
                isDir: fs.statSync(path.join(serverDir, f)).isDirectory(),
                size: fs.statSync(path.join(serverDir, f)).size
            }));

            res.render('server/files', {
                s: req.server,
                files,
                isOwner: req.isOwner,
                currentPath: [],
                serverNavStyle: req.serverNavStyle
            });
        } catch (e) {
            res.render('errors/error', { code: 500, msg: e.message });
        }
    });

    // قراءة ملف
    router.post('/:id/file/read', (req, res) => {
        try {
            const filePath = req.body.path ? path.join(req.body.path, req.body.file) : req.body.file;
            const fullPath = getServerPath(req.server.id, filePath);

            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                const content = fs.readFileSync(fullPath, 'utf-8');
                res.type('text/plain').send(content);
            } else {
                res.status(404).type('text/plain').send('File not found: ' + req.body.file);
            }
        } catch (err) {
            console.error('[READ] Error:', err);
            res.status(500).type('text/plain').send('Error reading file');
        }
    });

    // حفظ ملف
    router.post('/:id/file/save', (req, res) => {
        try {
            const relDir = getRelativePath(req.body.path);
            const filePath = relDir ? path.join(relDir, req.body.file) : req.body.file;
            const fullPath = getServerPath(req.server.id, filePath);

            const serverRoot = getServerPath(req.server.id);
            const currentBytes = getDirectorySizeBytes(serverRoot);
            const limitBytes = (req.server.disk || 1024) * 1024 * 1024;
            const contentBytes = Buffer.byteLength(req.body.content || '', 'utf8');
            if (currentBytes + contentBytes > limitBytes) {
                return res.status(400).json({ error: 'Disk quota exceeded!' });
            }
            fs.ensureDirSync(path.dirname(fullPath));
            fs.writeFileSync(fullPath, req.body.content);
            
            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'file_edit', req.server.id, `Edited file: ${req.body.file}`, ip);
            
            res.json({ ok: true });
        } catch (err) {
            console.error('[SAVE] Error:', err);
            res.status(500).json({ error: 'Failed to save file' });
        }
    });

    // حذف ملف أو مجلد
    router.post('/:id/file/delete', (req, res) => {
        try {
            const relDir = getRelativePath(req.body.path);
            const filePath = relDir ? path.join(relDir, req.body.file) : req.body.file;
            const fullPath = getServerPath(req.server.id, filePath);

            fs.removeSync(fullPath);
            
            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'file_delete', req.server.id, `Deleted: ${req.body.file}`, ip);
            
            res.json({ ok: true });
        } catch (err) {
            console.error('[DELETE] Error:', err);
            res.status(500).json({ error: 'Failed to delete' });
        }
    });

    // إعادة تسمية ملف أو مجلد
    router.post('/:id/file/rename', (req, res) => {
        try {
            const relDir = getRelativePath(req.body.path);
            const oldFilePath = relDir ? path.join(relDir, req.body.oldName) : req.body.oldName;
            const newFilePath = relDir ? path.join(relDir, req.body.newName) : req.body.newName;
            const oldPath = getServerPath(req.server.id, oldFilePath);
            const newPath = getServerPath(req.server.id, newFilePath);

            if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
            
            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'file_rename', req.server.id, `Renamed: ${req.body.oldName} → ${req.body.newName}`, ip);
            
            res.json({ ok: true });
        } catch (err) {
            console.error('[RENAME] Error:', err);
            res.status(500).json({ error: 'Failed to rename' });
        }
    });

    // إنشاء ملف أو مجلد
    router.post('/:id/file/create', (req, res) => {
        try {
            const { name, type, path: relPath } = req.body;
            if (!name) return res.status(400).json({ error: 'Name required' });

            const cleanName = name.replace(/[^a-zA-Z0-9_.-]/g, '').trim();
            if (!cleanName) return res.status(400).json({ error: 'Invalid name' });

            const base = path.join(__dirname, '../../../instances', req.server.id.toString());
            const targetDir = relPath ? path.join(base, relPath) : base;
            const targetPath = path.join(targetDir, cleanName);

            fs.ensureDirSync(targetDir);

            if (fs.existsSync(targetPath)) return res.status(400).json({ error: 'Already exists' });

            if (type === 'folder') {
                fs.mkdirSync(targetPath, { recursive: true });
            } else {
                fs.writeFileSync(targetPath, '');
            }

            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, type === 'folder' ? 'folder_create' : 'file_create', req.server.id, `Created ${type}: ${cleanName}`, ip);

            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // رفع الملفات
    router.post('/:id/file/upload', upload.single('file'), (req, res) => {
        try {
            // التأكد من أن المسار string وليس array
            let relPath = req.body.path || '';
            if (Array.isArray(relPath)) {
                relPath = relPath.join('/');
            }
            relPath = getRelativePath(relPath);
            
            const serverRoot = getServerPath(req.server.id);
            const currentBytes = getDirectorySizeBytes(serverRoot);
            const limitBytes = (req.server.disk || 1024) * 1024 * 1024;
            if (currentBytes + req.file.size > limitBytes) {
                try { fs.removeSync(req.file.path); } catch (e) {}
                return res.status(400).send('Disk limit exceeded! Upgrade your server disk in Store.');
            }
            const dest = getServerPath(req.server.id, relPath ? path.join(relPath, req.file.originalname) : req.file.originalname);
            fs.ensureDirSync(path.dirname(dest));
            fs.moveSync(req.file.path, dest, { overwrite: true });

            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'file_upload', req.server.id, `Uploaded: ${req.file.originalname}`, ip);

            // إعادة التوجيه للمسار الحالي
            const redirectPath = relPath ? `/server/${req.server.id}/files/${relPath}` : `/server/${req.server.id}/files`;
            res.redirect(redirectPath);
        } catch (err) {
            console.error('[UPLOAD] Error:', err);
            res.status(500).json({ error: 'Upload failed' });
        }
    });

    // فك ضغط الملفات - يدعم ZIP, TAR, TAR.GZ, TGZ, GZ
    // يعمل على جميع الأنظمة: Windows, macOS, Linux, Docker
    router.post('/:id/file/unarchive', async (req, res) => {
        try {
            const relDir = getRelativePath(req.body.path);
            const filePath = relDir ? path.join(relDir, req.body.file) : req.body.file;
            const fullPath = getServerPath(req.server.id, filePath);
            const extractDir = path.dirname(fullPath);

            if (!fs.existsSync(fullPath)) {
                return res.status(404).json({ error: 'File not found' });
            }

            const serverRoot = getServerPath(req.server.id);
            const currentBytes = getDirectorySizeBytes(serverRoot);
            const limitBytes = (req.server.disk || 1024) * 1024 * 1024;
            if (currentBytes >= limitBytes) {
                return res.status(400).json({ error: 'Disk quota exceeded (' + (req.server.disk || 1024) + ' MB). Delete files or buy more Disk from Store.' });
            }
            const fileName = req.body.file.toLowerCase();
            
            // ZIP files
            if (fileName.endsWith('.zip')) {
                const zip = new AdmZip(fullPath);
                const entries = zip.getEntries();
                let uncompressedTotal = 0;
                for (const entry of entries) {
                    uncompressedTotal += entry.header.size || 0;
                    const entryTarget = path.resolve(extractDir, entry.entryName);
                    if (!entryTarget.startsWith(path.resolve(serverRoot))) {
                        return res.status(400).json({ error: 'Security Error: Invalid path inside archive' });
                    }
                }
                if (currentBytes + uncompressedTotal > limitBytes) {
                    return res.status(400).json({ error: 'Archive uncompressed size exceeds your server disk limit!' });
                }
                zip.extractAllTo(extractDir, true);
            }
            // TAR.GZ or TGZ files
            else if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
                await compressing.tgz.uncompress(fullPath, extractDir);
            }
            // TAR files
            else if (fileName.endsWith('.tar')) {
                await compressing.tar.uncompress(fullPath, extractDir);
            }
            // GZ files (single file - not tar.gz)
            else if (fileName.endsWith('.gz') && !fileName.endsWith('.tar.gz')) {
                const outputPath = fullPath.slice(0, -3);
                await compressing.gzip.uncompress(fullPath, outputPath);
            }
            else {
                return res.status(400).json({ 
                    error: 'Unsupported archive format. Supported: .zip, .tar, .tar.gz, .tgz, .gz' 
                });
            }

            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'file_unarchive', req.server.id, `Extracted: ${req.body.file}`, ip);

            res.json({ ok: true });
        } catch (err) {
            console.error('[UNARCHIVE] Error:', err);
            res.status(500).json({ error: 'Failed to extract: ' + err.message });
        }
    });

    // ضغط الملفات المحددة - يدعم ZIP, TAR, TAR.GZ
    // يعمل على جميع الأنظمة: Windows, macOS, Linux, Docker
    router.post('/:id/file/compress', async (req, res) => {
        try {
            const { files, path: currentPath, archiveName } = req.body;
            
            if (!files || !Array.isArray(files) || files.length === 0) {
                return res.status(400).json({ error: 'No files selected' });
            }
            
            if (!archiveName) {
                return res.status(400).json({ error: 'Archive name is required' });
            }

            const relDir = getRelativePath(currentPath);
            const baseDir = getServerPath(req.server.id, relDir);
            const archivePath = path.join(baseDir, archiveName);
            const lowerName = archiveName.toLowerCase();

            // إنشاء مجلد مؤقت لجمع الملفات
            const tempDir = path.join(baseDir, '.temp_archive_' + Date.now());
            fs.ensureDirSync(tempDir);

            try {
                // نسخ الملفات للمجلد المؤقت
                for (const fileName of files) {
                    const srcPath = path.join(baseDir, fileName);
                    const destPath = path.join(tempDir, fileName);
                    if (fs.existsSync(srcPath)) {
                        fs.copySync(srcPath, destPath);
                    }
                }

                // تحديد نوع الأرشيف
                if (lowerName.endsWith('.zip')) {
                    // ZIP format using AdmZip
                    const zip = new AdmZip();
                    for (const fileName of files) {
                        const filePath = path.join(tempDir, fileName);
                        if (!fs.existsSync(filePath)) continue;
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            zip.addLocalFolder(filePath, fileName);
                        } else {
                            zip.addLocalFile(filePath, '', fileName);
                        }
                    }
                    zip.writeZip(archivePath);
                }
                else if (lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tgz')) {
                    // TAR.GZ format
                    await compressing.tgz.compressDir(tempDir, archivePath);
                }
                else if (lowerName.endsWith('.tar')) {
                    // TAR format
                    await compressing.tar.compressDir(tempDir, archivePath);
                }
                else {
                    // Default to ZIP
                    const finalPath = archivePath + '.zip';
                    const zip = new AdmZip();
                    for (const fileName of files) {
                        const filePath = path.join(tempDir, fileName);
                        if (!fs.existsSync(filePath)) continue;
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                            zip.addLocalFolder(filePath, fileName);
                        } else {
                            zip.addLocalFile(filePath, '', fileName);
                        }
                    }
                    zip.writeZip(finalPath);
                }
            } finally {
                // حذف المجلد المؤقت
                fs.removeSync(tempDir);
            }

            // تسجيل النشاط
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'file_compress', req.server.id, `Created archive: ${archiveName} with ${files.length} file(s)`, ip);

            res.json({ ok: true, archiveName });
        } catch (err) {
            console.error('[COMPRESS] Error:', err);
            res.status(500).json({ error: 'Failed to create archive: ' + err.message });
        }
    });

    return router;
};

module.exports.path = '/server';

