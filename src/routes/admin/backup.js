const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');

module.exports = ({ db, isAdmin }) => {
    const backupDir = path.join(__dirname, '../../../backups');
    const instancesDir = path.join(__dirname, '../../../instances');
    const dbPath = path.join(__dirname, '../../../data/system.db');

    // التأكد من وجود مجلد الباك اب
    fs.ensureDirSync(backupDir);

    // صفحة الباك اب
    router.get('/backup', isAdmin, (req, res) => {
        let backups = [];
        try {
            backups = fs.readdirSync(backupDir)
                .filter(f => f.endsWith('.zip'))
                .map(f => {
                    const stats = fs.statSync(path.join(backupDir, f));
                    return {
                        name: f,
                        size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                        date: stats.mtime.toISOString().split('T')[0],
                        time: stats.mtime.toTimeString().split(' ')[0]
                    };
                })
                .sort((a, b) => new Date(b.date + ' ' + b.time) - new Date(a.date + ' ' + a.time));
        } catch (e) {
            console.error('[BACKUP] Error reading backups:', e.message);
        }

        res.render('admin/backup', {
            backups,
            page: 'backup'
        });
    });

    // إنشاء باك اب جديد
    router.post('/backup/create', isAdmin, async (req, res) => {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const backupName = `backup_${timestamp}.zip`;
            const backupPath = path.join(backupDir, backupName);

            const zip = new AdmZip();

            // إضافة قاعدة البيانات
            if (fs.existsSync(dbPath)) {
                zip.addLocalFile(dbPath, 'database');
            }

            // إضافة مجلد instances
            if (fs.existsSync(instancesDir)) {
                zip.addLocalFolder(instancesDir, 'instances');
            }

            // إضافة ملف .env إذا موجود
            const envPath = path.join(__dirname, '../../../.env');
            if (fs.existsSync(envPath)) {
                zip.addLocalFile(envPath, 'config');
            }

            // حفظ الباك اب
            zip.writeZip(backupPath);

            res.redirect('/admin/backup?success=created');
        } catch (err) {
            console.error('[BACKUP] Create error:', err);
            res.redirect('/admin/backup?error=create_failed');
        }
    });

    // تحميل باك اب
    router.get('/backup/download/:name', isAdmin, (req, res) => {
        const backupPath = path.join(backupDir, req.params.name);
        
        // حماية من path traversal
        if (!backupPath.startsWith(backupDir) || !req.params.name.endsWith('.zip')) {
            return res.status(403).send('Access Denied');
        }

        if (fs.existsSync(backupPath)) {
            res.download(backupPath);
        } else {
            res.redirect('/admin/backup?error=not_found');
        }
    });

    // حذف باك اب
    router.post('/backup/delete', isAdmin, (req, res) => {
        try {
            const backupPath = path.join(backupDir, req.body.name);
            
            // حماية من path traversal
            if (!backupPath.startsWith(backupDir) || !req.body.name.endsWith('.zip')) {
                return res.status(403).send('Access Denied');
            }

            if (fs.existsSync(backupPath)) {
                fs.unlinkSync(backupPath);
            }
            res.redirect('/admin/backup?success=deleted');
        } catch (err) {
            console.error('[BACKUP] Delete error:', err);
            res.redirect('/admin/backup?error=delete_failed');
        }
    });

    // استعادة باك اب
    router.post('/backup/restore', isAdmin, async (req, res) => {
        try {
            const backupPath = path.join(backupDir, req.body.name);
            
            // حماية من path traversal
            if (!backupPath.startsWith(backupDir) || !req.body.name.endsWith('.zip')) {
                return res.status(403).send('Access Denied');
            }

            if (!fs.existsSync(backupPath)) {
                return res.redirect('/admin/backup?error=not_found');
            }

            const zip = new AdmZip(backupPath);
            const tempDir = path.join(backupDir, 'temp_restore');
            
            // فك الضغط في مجلد مؤقت
            zip.extractAllTo(tempDir, true);

            // استعادة قاعدة البيانات
            const restoredDb = path.join(tempDir, 'database', 'system.db');
            if (fs.existsSync(restoredDb)) {
                fs.copySync(restoredDb, dbPath, { overwrite: true });
            }

            // استعادة instances
            const restoredInstances = path.join(tempDir, 'instances');
            if (fs.existsSync(restoredInstances)) {
                fs.copySync(restoredInstances, instancesDir, { overwrite: true });
            }

            // حذف المجلد المؤقت
            fs.removeSync(tempDir);

            res.redirect('/admin/backup?success=restored');
        } catch (err) {
            console.error('[BACKUP] Restore error:', err);
            res.redirect('/admin/backup?error=restore_failed');
        }
    });

    return router;
};

module.exports.path = '/admin';
