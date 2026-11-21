/**
 * Plugin Handler - نظام إدارة الإضافات
 * يدعم تحميل الإضافات والثيمات بشكل ديناميكي
 * 
 * هيكل البلقن:
 * my-plugin/
 * ├── plugin.json      - إعدادات البلقن (مطلوب)
 * ├── index.js         - الكود الرئيسي (مطلوب)
 * ├── views/           - ملفات العرض EJS (اختياري)
 * │   └── my-view.ejs
 * └── public/          - الملفات العامة CSS/JS/Images (اختياري)
 *     └── style.css
 */

const fs = require('fs-extra');
const path = require('path');
const express = require('express');

class PluginHandler {
    constructor() {
        this.plugins = new Map();
        this.themes = new Map();
        this.hooks = new Map();
        this.activeTheme = null;
        this.pluginsDir = path.join(__dirname, '../../plugins');
        this.app = null;
        this.db = null;
        this.io = null;
        this.middlewares = {};
    }

    /**
     * تهيئة نظام الإضافات
     */
    async init(app, { db, io, middlewares }) {
        this.app = app;
        this.db = db;
        this.io = io;
        this.middlewares = middlewares;

        // إنشاء مجلد الإضافات إذا لم يكن موجوداً
        await fs.ensureDir(this.pluginsDir);

        // تهيئة جدول الإضافات في قاعدة البيانات
        this.initDatabase();

        // إعداد الملفات العامة للبلقنات
        this.setupPluginStatics();

        // تحميل جميع الإضافات
        await this.loadAllPlugins();

        // تطبيق الثيم النشط
        this.applyActiveTheme();

        console.log(`\x1b[35m[PLUGINS] Loaded ${this.plugins.size} plugins, ${this.themes.size} themes\x1b[0m`);
    }

    /**
     * إعداد الملفات العامة للبلقنات
     * يمكن الوصول للملفات عبر: /plugins/{plugin-id}/public/file.css
     */
    setupPluginStatics() {
        this.app.use('/plugins', express.static(this.pluginsDir));
    }

    /**
     * دالة مساعدة لعرض view من بلقن
     * @param {string} pluginId - معرف البلقن
     * @param {string} viewName - اسم ملف العرض (بدون .ejs)
     * @param {object} res - كائن الاستجابة
     * @param {object} data - البيانات المراد تمريرها للعرض
     */
    renderPluginView(pluginId, viewName, res, data = {}) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).send('Plugin not found');
        }

        const viewPath = path.join(plugin.path, 'views', `${viewName}.ejs`);
        
        if (!fs.existsSync(viewPath)) {
            return res.status(404).send(`View "${viewName}" not found in plugin "${pluginId}"`);
        }

        // إضافة بيانات مفيدة للعرض
        const viewData = {
            ...data,
            plugin,
            pluginHandler: this,
            db: this.db,
            user: res.locals.user,
            sitename: res.locals.sitename
        };

        res.render(viewPath, viewData);
    }

    /**
     * الحصول على مسار views لبلقن معين
     */
    getPluginViewsPath(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) return null;
        return path.join(plugin.path, 'views');
    }

    /**
     * الحصول على مسار public لبلقن معين
     */
    getPluginPublicPath(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) return null;
        return path.join(plugin.path, 'public');
    }

    /**
     * تهيئة جدول الإضافات
     */
    initDatabase() {
        this.db.db.exec(`
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT,
                type TEXT DEFAULT 'plugin',
                enabled INTEGER DEFAULT 0,
                settings TEXT DEFAULT '{}',
                installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS plugin_settings (
                plugin_id TEXT,
                key TEXT,
                value TEXT,
                PRIMARY KEY (plugin_id, key)
            );
        `);
    }

    /**
     * تحميل جميع الإضافات من المجلد
     */
    async loadAllPlugins() {
        const items = await fs.readdir(this.pluginsDir);

        for (const item of items) {
            const pluginPath = path.join(this.pluginsDir, item);
            const stat = await fs.stat(pluginPath);

            if (stat.isDirectory()) {
                await this.loadPlugin(item);
            }
        }
    }

    /**
     * تحميل إضافة واحدة
     */
    async loadPlugin(pluginId) {
        const pluginPath = path.join(this.pluginsDir, pluginId);
        const manifestPath = path.join(pluginPath, 'plugin.json');

        try {
            // التحقق من وجود ملف manifest
            if (!await fs.pathExists(manifestPath)) {
                console.log(`\x1b[33m[PLUGINS] No manifest found for ${pluginId}\x1b[0m`);
                return null;
            }

            // قراءة manifest
            const manifest = await fs.readJson(manifestPath);
            manifest.id = pluginId;
            manifest.path = pluginPath;

            // الحصول على حالة الإضافة من قاعدة البيانات
            let dbPlugin = this.db.db.prepare('SELECT * FROM plugins WHERE id = ?').get(pluginId);

            if (!dbPlugin) {
                // إضافة الإضافة لقاعدة البيانات
                this.db.db.prepare(`
                    INSERT INTO plugins (id, name, version, type, enabled) 
                    VALUES (?, ?, ?, ?, ?)
                `).run(pluginId, manifest.name, manifest.version, manifest.type || 'plugin', 0);
                dbPlugin = { enabled: 0, settings: '{}' };
            }

            manifest.enabled = dbPlugin.enabled === 1;
            manifest.settings = JSON.parse(dbPlugin.settings || '{}');

            // تخزين الإضافة
            if (manifest.type === 'theme') {
                this.themes.set(pluginId, manifest);
            } else {
                this.plugins.set(pluginId, manifest);
            }

            // تحميل الإضافة إذا كانت مفعلة
            if (manifest.enabled) {
                await this.activatePlugin(pluginId);
            }

            return manifest;
        } catch (err) {
            console.error(`\x1b[31m[PLUGINS] Error loading ${pluginId}:\x1b[0m`, err.message);
            return null;
        }
    }

    /**
     * تفعيل إضافة
     */
    async activatePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId) || this.themes.get(pluginId);
        if (!plugin) return false;

        try {
            const mainFile = path.join(plugin.path, plugin.main || 'index.js');

            if (await fs.pathExists(mainFile)) {
                // مسح الكاش لإعادة التحميل
                delete require.cache[require.resolve(mainFile)];

                const pluginModule = require(mainFile);

                // تهيئة الإضافة
                if (typeof pluginModule.init === 'function') {
                    await pluginModule.init({
                        app: this.app,
                        db: this.db,
                        io: this.io,
                        plugin: plugin,
                        pluginHandler: this,
                        hooks: this,
                        ...this.middlewares
                    });
                }

                // تسجيل المسارات
                if (typeof pluginModule.routes === 'function') {
                    const router = pluginModule.routes({
                        app: this.app,
                        db: this.db,
                        io: this.io,
                        plugin: plugin,
                        pluginHandler: this,
                        ...this.middlewares
                    });
                    if (router) {
                        const basePath = plugin.routePrefix || `/plugins/${pluginId}`;
                        this.app.use(basePath, router);
                    }
                }

                // تسجيل الـ hooks
                if (pluginModule.hooks) {
                    for (const [hookName, handler] of Object.entries(pluginModule.hooks)) {
                        this.registerHook(hookName, handler, pluginId);
                    }
                }

                plugin.module = pluginModule;
                plugin.activated = true;
            }

            // تحديث قاعدة البيانات
            this.db.db.prepare('UPDATE plugins SET enabled = 1 WHERE id = ?').run(pluginId);
            plugin.enabled = true;

            console.log(`\x1b[32m[PLUGINS] Activated: ${plugin.name}\x1b[0m`);
            return true;
        } catch (err) {
            console.error(`\x1b[31m[PLUGINS] Error activating ${pluginId}:\x1b[0m`, err.message);
            return false;
        }
    }

    /**
     * إلغاء تفعيل إضافة
     */
    async deactivatePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId) || this.themes.get(pluginId);
        if (!plugin) return false;

        try {
            // استدعاء دالة الإيقاف إذا وجدت
            if (plugin.module && typeof plugin.module.destroy === 'function') {
                await plugin.module.destroy();
            }

            // إزالة الـ hooks
            this.unregisterPluginHooks(pluginId);

            plugin.activated = false;
            plugin.enabled = false;

            // تحديث قاعدة البيانات
            this.db.db.prepare('UPDATE plugins SET enabled = 0 WHERE id = ?').run(pluginId);

            console.log(`\x1b[33m[PLUGINS] Deactivated: ${plugin.name}\x1b[0m`);
            return true;
        } catch (err) {
            console.error(`\x1b[31m[PLUGINS] Error deactivating ${pluginId}:\x1b[0m`, err.message);
            return false;
        }
    }

    /**
     * تبديل حالة الإضافة
     */
    async togglePlugin(pluginId) {
        const plugin = this.plugins.get(pluginId) || this.themes.get(pluginId);
        if (!plugin) return false;

        if (plugin.enabled) {
            return await this.deactivatePlugin(pluginId);
        } else {
            return await this.activatePlugin(pluginId);
        }
    }

    /**
     * تسجيل hook
     */
    registerHook(hookName, handler, pluginId) {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }
        this.hooks.get(hookName).push({ handler, pluginId });
    }

    /**
     * إزالة hooks الخاصة بإضافة
     */
    unregisterPluginHooks(pluginId) {
        for (const [hookName, handlers] of this.hooks) {
            this.hooks.set(hookName, handlers.filter(h => h.pluginId !== pluginId));
        }
    }

    /**
     * تنفيذ hook
     */
    async executeHook(hookName, data = {}) {
        const handlers = this.hooks.get(hookName) || [];
        let result = data;

        for (const { handler } of handlers) {
            try {
                const hookResult = await handler(result);
                if (hookResult !== undefined) {
                    result = hookResult;
                }
            } catch (err) {
                console.error(`\x1b[31m[HOOKS] Error in ${hookName}:\x1b[0m`, err.message);
            }
        }

        return result;
    }

    /**
     * تطبيق الثيم النشط
     */
    applyActiveTheme() {
        const activeThemeId = this.db.getConfig('active_theme');
        if (activeThemeId && this.themes.has(activeThemeId)) {
            this.activeTheme = this.themes.get(activeThemeId);
        }
    }

    /**
     * تعيين الثيم النشط
     */
    async setActiveTheme(themeId) {
        if (themeId && !this.themes.has(themeId)) {
            return false;
        }

        // إلغاء تفعيل الثيم الحالي
        if (this.activeTheme) {
            await this.deactivatePlugin(this.activeTheme.id);
        }

        if (themeId) {
            // تفعيل الثيم الجديد
            await this.activatePlugin(themeId);
            this.activeTheme = this.themes.get(themeId);
            this.db.setConfig('active_theme', themeId);
        } else {
            this.activeTheme = null;
            this.db.setConfig('active_theme', '');
        }

        return true;
    }

    /**
     * الحصول على CSS الثيم
     */
    getThemeCSS() {
        if (!this.activeTheme) return '';

        const cssPath = path.join(this.activeTheme.path, this.activeTheme.css || 'theme.css');
        if (fs.existsSync(cssPath)) {
            return fs.readFileSync(cssPath, 'utf8');
        }
        return '';
    }

    /**
     * الحصول على جميع الإضافات
     */
    getAllPlugins() {
        return Array.from(this.plugins.values());
    }

    /**
     * الحصول على جميع الثيمات
     */
    getAllThemes() {
        return Array.from(this.themes.values());
    }

    /**
     * الحصول على إضافة بالـ ID
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId) || this.themes.get(pluginId);
    }

    /**
     * حفظ إعدادات إضافة
     */
    savePluginSettings(pluginId, settings) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) return false;

        plugin.settings = settings;
        this.db.db.prepare('UPDATE plugins SET settings = ? WHERE id = ?')
            .run(JSON.stringify(settings), pluginId);

        return true;
    }

    /**
     * الحصول على إعدادات إضافة
     */
    getPluginSettings(pluginId) {
        const plugin = this.getPlugin(pluginId);
        return plugin ? plugin.settings : {};
    }

    /**
     * حذف إضافة
     */
    async deletePlugin(pluginId) {
        const plugin = this.getPlugin(pluginId);
        if (!plugin) return false;

        try {
            // إلغاء التفعيل أولاً
            if (plugin.enabled) {
                await this.deactivatePlugin(pluginId);
            }

            // حذف من قاعدة البيانات
            this.db.db.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
            this.db.db.prepare('DELETE FROM plugin_settings WHERE plugin_id = ?').run(pluginId);

            // حذف الملفات
            await fs.remove(plugin.path);

            // إزالة من الذاكرة
            this.plugins.delete(pluginId);
            this.themes.delete(pluginId);

            console.log(`\x1b[31m[PLUGINS] Deleted: ${plugin.name}\x1b[0m`);
            return true;
        } catch (err) {
            console.error(`\x1b[31m[PLUGINS] Error deleting ${pluginId}:\x1b[0m`, err.message);
            return false;
        }
    }

    /**
     * الحصول على عناصر القائمة من الإضافات
     */
    getAdminMenuItems() {
        const items = [];
        for (const plugin of this.plugins.values()) {
            if (plugin.enabled && plugin.adminMenu) {
                items.push(...plugin.adminMenu.map(item => ({
                    ...item,
                    pluginId: plugin.id
                })));
            }
        }
        return items;
    }

    /**
     * الحصول على widgets من الإضافات
     */
    getDashboardWidgets() {
        const widgets = [];
        for (const plugin of this.plugins.values()) {
            if (plugin.enabled && plugin.module && plugin.module.widgets) {
                widgets.push(...plugin.module.widgets);
            }
        }
        return widgets;
    }
}

// Singleton instance
const pluginHandler = new PluginHandler();

module.exports = pluginHandler;
