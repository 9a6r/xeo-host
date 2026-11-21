const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');

module.exports = ({ db, isAuth }) => {
    // دالة للحصول على مسار مجلد الباك اب للسيرفر
    function getBackupDir(serverId) {
        const dir = path.join(__dirname, '../../../backups/servers', serverId.toString());
        fs.ensureDirSync(dir);
        return dir;
    }

    // دالة للحصول على مسار السيرفر
    function getServerPath(serverId) {
        return path.join(__dirname, '../../../instances', serverId.toString());
    }

    // Middleware للتحقق من صلاحيات الوصول
    router.use('/:id/backup', isAuth, (req, res, next) => {
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
        req.serverNavStyle = db.getConfig('server_nav_style') || 'tabs';
        next();
    });

    // صفحة الباك اب
    router.get('/:id/backup', (req, res) => {
        const backupDir = getBackupDir(req.server.id);
        let backups = [];

        try {
            backups = fs.readdirSync(backupDir)
                .filter(f => f.endsWith('.zip'))
                .map(f => {
                    const stats = fs.statSync(path.join(backupDir, f));
                    // استخراج الاسم بدون timestamp
                    const nameParts = f.replace('.zip', '').split('_');
                    const displayName = nameParts.length > 2 ? nameParts.slice(0, -2).join('_') : nameParts[0];
                    
                    return {
                        filename: f,
                        name: displayName,
                        size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                        sizeBytes: stats.size,
                        date: stats.mtime.toISOString().split('T')[0],
                        time: stats.mtime.toTimeString().split(' ')[0],
                        timestamp: stats.mtime.getTime()
                    };
                })
                .sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.error('[BACKUP] Error reading backups:', e.message);
        }

        // حساب الحجم الكلي
        const totalSize = backups.reduce((acc, b) => acc + b.sizeBytes, 0);
        const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

        res.render('server/backup', {
            s: req.server,
            serverNavStyle: req.serverNavStyle,
            backups,
            totalSize: totalSizeMB,
            isOwner: req.isOwner,
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // إنشاء باك اب جديد
    router.post('/:id/backup/create', (req, res) => {
        try {
            const backupDir = getBackupDir(req.server.id);
            const serverPath = getServerPath(req.server.id);
            
            // اسم الباك اب
            const backupName = req.body.name ? 
                req.body.name.replace(/[^a-zA-Z0-9_-]/g, '') : 
                'backup';
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `${backupName}_${timestamp}.zip`;
            const backupPath = path.join(backupDir, filename);

            // التحقق من وجود مجلد السيرفر
            if (!fs.existsSync(serverPath)) {
                return res.redirect(`/server/${req.server.id}/backup?error=Server files not found`);
            }

            const zip = new AdmZip();
            zip.addLocalFolder(serverPath);
            zip.writeZip(backupPath);

            res.redirect(`/server/${req.server.id}/backup?success=Backup created successfully`);
        } catch (err) {
            console.error('[BACKUP] Create error:', err);
            res.redirect(`/server/${req.server.id}/backup?error=Failed to create backup`);
        }
    });

    // تحميل باك اب
    router.get('/:id/backup/download/:filename', (req, res) => {
        const backupDir = getBackupDir(req.server.id);
        const backupPath = path.join(backupDir, req.params.filename);

        // حماية من path traversal
        if (!backupPath.startsWith(backupDir) || !req.params.filename.endsWith('.zip')) {
            return res.status(403).send('Access Denied');
        }

        if (fs.existsSync(backupPath)) {
            res.download(backupPath);
        } else {
            res.redirect(`/server/${req.server.id}/backup?error=Backup not found`);
        }
    });

    // حذف باك اب
    router.post('/:id/backup/delete', (req, res) => {
        try {
            const backupDir = getBackupDir(req.server.id);
            const backupPath = path.join(backupDir, req.body.filename);

            // حماية من path traversal
            if (!backupPath.startsWith(backupDir) || !req.body.filename.endsWith('.zip')) {
                return res.status(403).send('Access Denied');
            }

            if (fs.existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
            }
            res.redirect(`/server/${req.server.id}/backup?success=Backup deleted`);
        } catch (err) {
            console.error('[BACKUP] Delete error:', err);
            res.redirect(`/server/${req.server.id}/backup?error=Failed to delete backup`);
        }
    });

    // إعادة تسمية باك اب
    router.post('/:id/backup/rename', (req, res) => {
        try {
            const backupDir = getBackupDir(req.server.id);
            const oldPath = path.join(backupDir, req.body.filename);
            
            // حماية من path traversal
            if (!oldPath.startsWith(backupDir) || !req.body.filename.endsWith('.zip')) {
                return res.status(403).send('Access Denied');
            }

            if (!fs.existsSync(oldPath)) {
                return res.redirect(`/server/${req.server.id}/backup?error=Backup not found`);
            }

            // استخراج timestamp من الاسم القديم
            const oldName = req.body.filename.replace('.zip', '');
            const parts = oldName.split('_');
            const timestamp = parts.slice(-2).join('_'); // آخر جزئين هما التاريخ والوقت
            
            // الاسم الجديد
            const newName = req.body.newName.replace(/[^a-zA-Z0-9_-]/g, '') || 'backup';
            const newFilename = `${newName}_${timestamp}.zip`;
            const newPath = path.join(backupDir, newFilename);

            fs.renameSync(oldPath, newPath);
            res.redirect(`/server/${req.server.id}/backup?success=Backup renamed`);
        } catch (err) {
            console.error('[BACKUP] Rename error:', err);
            res.redirect(`/server/${req.server.id}/backup?error=Failed to rename backup`);
        }
    });

    // استعادة باك اب
    router.post('/:id/backup/restore', (req, res) => {
        try {
            const backupDir = getBackupDir(req.server.id);
            const serverPath = getServerPath(req.server.id);
            const backupPath = path.join(backupDir, req.body.filename);

            // حماية من path traversal
            if (!backupPath.startsWith(backupDir) || !req.body.filename.endsWith('.zip')) {
                return res.status(403).send('Access Denied');
            }

            if (!fs.existsSync(backupPath)) {
                return res.redirect(`/server/${req.server.id}/backup?error=Backup not found`);
            }

            // حذف الملفات الحالية
            fs.emptyDirSync(serverPath);

            // فك الضغط
            const zip = new AdmZip(backupPath);
            zip.extractAllTo(serverPath, true);

            res.redirect(`/server/${req.server.id}/backup?success=Backup restored successfully`);
        } catch (err) {
            console.error('[BACKUP] Restore error:', err);
            res.redirect(`/server/${req.server.id}/backup?error=Failed to restore backup`);
        }
    });

    return router;
};

module.exports.path = '/server';
