const fg = require('fast-glob');
const path = require('path');

/**
 * Route Handler - يقوم بتحميل جميع ملفات المسارات تلقائياً
 * يدعم المجلدات الفرعية ويحدد المسار بناءً على هيكل المجلدات
 * 
 * @param {Express} app - تطبيق Express
 * @param {Object} options - خيارات إضافية
 * @param {string} options.routesDir - مسار مجلد المسارات
 * @param {Object} options.middlewares - الـ middlewares المشتركة
 * @param {Object} options.dependencies - الـ dependencies المشتركة (db, io, etc.)
 */
async function loadRoutes(app, options = {}) {
    const {
        routesDir = path.join(__dirname, '../routes'),
        middlewares = {},
        dependencies = {}
    } = options;

    // البحث عن جميع ملفات .js في مجلد routes والمجلدات الفرعية
    const allFiles = await fg(['**/*.js'], {
        cwd: routesDir,
        absolute: true
    });

    // ترتيب الملفات: index.js أولاً، ثم الملفات الأخرى
    allFiles.sort((a, b) => {
        const aIsIndex = a.endsWith('index.js');
        const bIsIndex = b.endsWith('index.js');
        if (aIsIndex && !bIsIndex) return -1;
        if (!aIsIndex && bIsIndex) return 1;
        return a.localeCompare(b);
    });

    const loadedRoutes = [];

    for (const file of allFiles) {
        try {
            const routeModule = require(file);
            
            // حساب المسار النسبي من مجلد routes
            const relativePath = path.relative(routesDir, file);
            
            // استخدام المسار المحدد في الملف أو حسابه تلقائياً
            let routePath = routeModule.path || getRoutePath(relativePath);

            // إذا كان الملف يصدّر دالة، نمررها الـ dependencies
            if (typeof routeModule === 'function') {
                const router = routeModule({ app, ...middlewares, ...dependencies });
                if (router) {
                    app.use(routePath, router);
                    loadedRoutes.push({ path: routePath, file: relativePath });
                }
            } 
            // إذا كان يصدّر router مباشرة
            else if (routeModule.router) {
                const basePath = routeModule.path || routePath;
                const middleware = routeModule.middleware || [];
                
                if (Array.isArray(middleware) && middleware.length > 0) {
                    app.use(basePath, ...middleware, routeModule.router);
                } else {
                    app.use(basePath, routeModule.router);
                }
                loadedRoutes.push({ path: basePath, file: relativePath });
            }
            // إذا كان يصدّر كائن مع setup function
            else if (routeModule.setup) {
                routeModule.setup(app, { ...middlewares, ...dependencies });
                loadedRoutes.push({ path: routePath, file: relativePath, type: 'setup' });
            }

        } catch (err) {
            console.error(`\x1b[31m[ROUTES] Error loading ${file}:\x1b[0m`, err.message);
        }
    }

    console.log(`\x1b[32m[ROUTES] Loaded ${loadedRoutes.length} route files\x1b[0m`);
    loadedRoutes.forEach(r => console.log(`  \x1b[90m→ ${r.path} (${r.file})\x1b[0m`));
    return loadedRoutes;
}

/**
 * تحويل مسار الملف إلى مسار URL
 * مثال: auth/discord.js -> /auth/discord
 *       server/files.js -> /server/files
 *       index.js -> /
 */
function getRoutePath(relativePath) {
    // إزالة .js من النهاية
    let routePath = relativePath.replace(/\.js$/, '');
    
    // تحويل الـ backslashes إلى forward slashes (لـ Windows)
    routePath = routePath.replace(/\\/g, '/');
    
    // إذا كان index، نستخدم مسار المجلد الأب
    if (routePath.endsWith('/index')) {
        routePath = routePath.replace(/\/index$/, '');
    }
    if (routePath === 'index') {
        routePath = '';
    }
    
    // إضافة / في البداية
    return '/' + routePath;
}

/**
 * إنشاء route file جديد
 */
function createRouteTemplate(type = 'router') {
    if (type === 'setup') {
        return `const express = require('express');

module.exports = {
    setup(app, { db, io, isAuth, isAdmin }) {
        // أضف المسارات هنا
        app.get('/example', (req, res) => {
            res.json({ message: 'Hello!' });
        });
    }
};
`;
    }

    return `const express = require('express');
const router = express.Router();

module.exports = ({ db, io, isAuth, isAdmin }) => {
    
    router.get('/', (req, res) => {
        res.json({ message: 'Hello!' });
    });

    return router;
};
`;
}

module.exports = {
    loadRoutes,
    getRoutePath,
    createRouteTemplate
};
