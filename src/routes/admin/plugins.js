const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const AdmZip = require('adm-zip');

// إعداد multer لرفع الملفات
const upload = multer({
    dest: path.join(__dirname, '../../temp'),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

module.exports = ({ db, isAdmin }) => {
    const pluginHandler = require('../../handlers/pluginHandler');

    // صفحة الإضافات الرئيسية
    router.get('/', isAdmin, (req, res) => {
        const plugins = pluginHandler.getAllPlugins();
        const themes = pluginHandler.getAllThemes();
        const activeTheme = pluginHandler.activeTheme;

        res.render('admin/plugins', {
            plugins,
            themes,
            activeTheme,
            tab: req.query.tab || 'plugins',
            page: 'plugins'
        });
    });

    // تبديل حالة الإضافة
    router.post('/toggle/:id', isAdmin, async (req, res) => {
        const { id } = req.params;
        const success = await pluginHandler.togglePlugin(id);

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({ success });
        }
        res.redirect('/admin/plugins');
    });

    // تعيين الثيم النشط
    router.post('/theme/set', isAdmin, async (req, res) => {
        const { themeId } = req.body;
        const success = await pluginHandler.setActiveTheme(themeId || null);

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({ success });
        }
        res.redirect('/admin/plugins?tab=themes');
    });

    // حفظ إعدادات إضافة
    router.post('/settings/:id', isAdmin, (req, res) => {
        const { id } = req.params;
        const settings = req.body;

        // إزالة الحقول الخاصة
        delete settings._method;

        const success = pluginHandler.savePluginSettings(id, settings);

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({ success });
        }
        res.redirect('/admin/plugins');
    });

    // صفحة إعدادات إضافة
    router.get('/settings/:id', isAdmin, (req, res) => {
        const { id } = req.params;
        const plugin = pluginHandler.getPlugin(id);

        if (!plugin) {
            return res.redirect('/admin/plugins');
        }

        res.render('admin/plugin-settings', { plugin, page: 'plugins' });
    });

    // رفع إضافة جديدة
    router.post('/upload', isAdmin, upload.single('plugin'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'No file uploaded' });
            }

            const zipPath = req.file.path;
            const zip = new AdmZip(zipPath);
            const zipEntries = zip.getEntries();

            // البحث عن plugin.json
            let manifestEntry = zipEntries.find(e => e.entryName.endsWith('plugin.json'));
            if (!manifestEntry) {
                await fs.remove(zipPath);
                return res.status(400).json({ success: false, error: 'Invalid plugin: missing plugin.json' });
            }

            // قراءة manifest
            const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
            if (!manifest.id || !manifest.name) {
                await fs.remove(zipPath);
                return res.status(400).json({ success: false, error: 'Invalid plugin.json: missing id or name' });
            }

            // تحديد مسار الاستخراج
            const pluginDir = path.join(pluginHandler.pluginsDir, manifest.id);

            // التحقق من عدم وجود الإضافة
            if (await fs.pathExists(pluginDir)) {
                await fs.remove(zipPath);
                return res.status(400).json({ success: false, error: 'Plugin already exists' });
            }

            // استخراج الملفات
            const rootDir = path.dirname(manifestEntry.entryName);
            await fs.ensureDir(pluginDir);

            for (const entry of zipEntries) {
                if (entry.isDirectory) continue;

                let targetPath = entry.entryName;
                if (rootDir && targetPath.startsWith(rootDir)) {
                    targetPath = targetPath.substring(rootDir.length + 1);
                }

                const fullPath = path.join(pluginDir, targetPath);
                await fs.ensureDir(path.dirname(fullPath));
                await fs.writeFile(fullPath, entry.getData());
            }

            // حذف الملف المؤقت
            await fs.remove(zipPath);

            // تحميل الإضافة
            await pluginHandler.loadPlugin(manifest.id);

            res.json({ success: true, plugin: manifest });
        } catch (err) {
            console.error('[PLUGINS] Upload error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // حذف إضافة
    router.post('/delete/:id', isAdmin, async (req, res) => {
        const { id } = req.params;
        const success = await pluginHandler.deletePlugin(id);

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.json({ success });
        }
        res.redirect('/admin/plugins');
    });

    // إعادة تحميل الإضافات
    router.post('/reload', isAdmin, async (req, res) => {
        try {
            await pluginHandler.loadAllPlugins();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // API للحصول على معلومات إضافة
    router.get('/api/:id', isAdmin, (req, res) => {
        const plugin = pluginHandler.getPlugin(req.params.id);
        if (!plugin) {
            return res.status(404).json({ error: 'Plugin not found' });
        }
        res.json(plugin);
    });

    return router;
};

module.exports.path = '/admin/plugins';
