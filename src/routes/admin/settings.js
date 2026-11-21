const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');

// Helper function to get all super admin IDs
const getAdminIds = () => (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(id => id);

// إعداد رفع الصور
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../../data/uploads');
        fs.ensureDirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, 'site_logo' + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم. يرجى رفع صورة (PNG, JPG, GIF, WebP, SVG)'));
        }
    }
});

module.exports = ({ db, isAdmin }) => {
    // صفحة الإعدادات
    router.get('/settings', isAdmin, (req, res) => {
        res.render('admin/settings', {
            config: {
                price: db.getConfig('price'),
                sitename: db.getConfig('sitename'),
                payment_id: db.getConfig('payment_id'),
                credit_rate: db.getConfig('credit_rate'),
                payment_channel: db.getConfig('payment_channel'),
                min_deposit: db.getConfig('min_deposit'),
                maintenance: db.getConfig('maintenance'),
                debug_mode: db.getConfig('debug_mode'),
                server_nav_style: db.getConfig('server_nav_style'),
                site_logo: db.getConfig('site_logo')
            },
            page: 'settings'
        });
    });

    // حفظ الإعدادات
    router.post('/config', isAdmin, (req, res) => {
        const { price, sitename, payment_id, credit_rate, payment_channel, min_deposit, server_nav_style, console_commands, _console_settings } = req.body;
        if (price) db.setConfig('price', price);
        if (sitename) db.setConfig('sitename', sitename);
        if (payment_id !== undefined) db.setConfig('payment_id', payment_id);
        if (credit_rate !== undefined) db.setConfig('credit_rate', credit_rate);
        if (payment_channel !== undefined) db.setConfig('payment_channel', payment_channel);
        if (min_deposit !== undefined) db.setConfig('min_deposit', min_deposit);
        if (server_nav_style) db.setConfig('server_nav_style', server_nav_style);
        
        // Console settings
        if (_console_settings) {
            db.setConfig('console_commands', console_commands === 'true' ? 'true' : 'false');
        }
        
        res.redirect('/admin/settings');
    });

    // رفع صورة الموقع (Logo)
    router.post('/logo/upload', isAdmin, upload.single('logo'), (req, res) => {
        try {
            if (!req.file) {
                return res.redirect('/admin/settings?error=no_file');
            }
            // حفظ مسار الصورة في قاعدة البيانات
            const logoPath = '/uploads/' + req.file.filename;
            db.setConfig('site_logo', logoPath);
            res.redirect('/admin/settings?success=logo_uploaded');
        } catch (err) {
            console.error('[LOGO UPLOAD] Error:', err);
            res.redirect('/admin/settings?error=upload_failed');
        }
    });

    // حذف صورة الموقع
    router.post('/logo/delete', isAdmin, (req, res) => {
        try {
            const currentLogo = db.getConfig('site_logo');
            if (currentLogo) {
                const logoPath = path.join(__dirname, '../../../data', currentLogo);
                if (fs.existsSync(logoPath)) {
                    fs.unlinkSync(logoPath);
                }
                db.setConfig('site_logo', '');
            }
            res.redirect('/admin/settings?success=logo_deleted');
        } catch (err) {
            console.error('[LOGO DELETE] Error:', err);
            res.redirect('/admin/settings?error=delete_failed');
        }
    });

    // أدوات المطور
    router.post('/dev', isAdmin, (req, res) => {
        if (req.body.action === 'toggle_maint') {
            const current = db.getConfig('maintenance') === 'true';
            db.setConfig('maintenance', (!current).toString());
        }
        if (req.body.action === 'reset_all') {
            // حذف جميع المستخدمين ما عدا السوبر أدمنز
            const adminIds = getAdminIds();
            const placeholders = adminIds.map(() => '?').join(',');
            if (adminIds.length > 0) {
                db.db.prepare(`DELETE FROM users WHERE id NOT IN (${placeholders})`).run(...adminIds);
            } else {
                db.db.prepare('DELETE FROM users').run();
            }
            db.db.prepare('DELETE FROM servers').run();
            try { fs.emptyDirSync(path.join(__dirname, '../../../instances')); } catch (e) { }
        }
        res.redirect('/admin/settings');
    });

    return router;
};

module.exports.path = '/admin';
