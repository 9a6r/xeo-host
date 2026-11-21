const express = require('express');
const router = express.Router();
const crypto = require('crypto');

module.exports = ({ db, isAdmin }) => {
    // صفحة API Keys
    router.get('/api', isAdmin, (req, res) => {
        const apiKeys = db.getApiKeys ? db.getApiKeys() : [];
        res.render('admin/api', {
            page: 'api',
            apiKeys,
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // إنشاء API Key جديد
    router.post('/api/create', isAdmin, (req, res) => {
        try {
            const { name, permissions } = req.body;
            
            if (!name || name.trim().length < 3) {
                return res.redirect('/admin/api?error=Name must be at least 3 characters');
            }

            // إنشاء API Key عشوائي
            const apiKey = 'xeo_' + crypto.randomBytes(32).toString('hex');
            
            // حفظ في قاعدة البيانات
            const perms = Array.isArray(permissions) ? permissions : [permissions].filter(Boolean);
            db.createApiKey(apiKey, name.trim(), perms.join(','));
            
            res.redirect('/admin/api?success=API Key created successfully');
        } catch (err) {
            console.error('[API] Create error:', err);
            res.redirect('/admin/api?error=Failed to create API Key');
        }
    });

    // حذف API Key
    router.post('/api/delete', isAdmin, (req, res) => {
        try {
            const { keyId } = req.body;
            db.deleteApiKey(keyId);
            res.redirect('/admin/api?success=API Key deleted');
        } catch (err) {
            console.error('[API] Delete error:', err);
            res.redirect('/admin/api?error=Failed to delete API Key');
        }
    });

    // تجديد API Key
    router.post('/api/regenerate', isAdmin, (req, res) => {
        try {
            const { keyId } = req.body;
            const newKey = 'xeo_' + crypto.randomBytes(32).toString('hex');
            db.regenerateApiKey(keyId, newKey);
            res.redirect('/admin/api?success=API Key regenerated');
        } catch (err) {
            console.error('[API] Regenerate error:', err);
            res.redirect('/admin/api?error=Failed to regenerate API Key');
        }
    });

    // ===== API Endpoints =====
    
    // Middleware للتحقق من API Key
    const apiAuth = (req, res, next) => {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        
        if (!apiKey) {
            return res.status(401).json({ error: 'API Key required' });
        }

        const keyData = db.getApiKeyByKey ? db.getApiKeyByKey(apiKey) : null;
        if (!keyData) {
            return res.status(401).json({ error: 'Invalid API Key' });
        }

        req.apiKey = keyData;
        req.apiPermissions = keyData.permissions ? keyData.permissions.split(',') : [];
        next();
    };

    // التحقق من صلاحية معينة
    const hasPermission = (permission) => (req, res, next) => {
        if (req.apiPermissions.includes('all') || req.apiPermissions.includes(permission)) {
            return next();
        }
        res.status(403).json({ error: 'Permission denied: ' + permission });
    };

    // API: الحصول على جميع المستخدمين
    router.get('/api/v1/users', apiAuth, hasPermission('users:read'), (req, res) => {
        const users = db.getAllUsers().map(u => ({
            id: u.id,
            username: u.username,
            coins: u.coins,
            isAdmin: u.isAdmin,
            isBanned: u.isBanned
        }));
        res.json({ success: true, data: users });
    });

    // API: الحصول على مستخدم معين
    router.get('/api/v1/users/:id', apiAuth, hasPermission('users:read'), (req, res) => {
        const user = db.getUser(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, data: {
            id: user.id,
            username: user.username,
            coins: user.coins,
            isAdmin: user.isAdmin,
            isBanned: user.isBanned
        }});
    });

    // API: تعديل كوينز مستخدم
    router.post('/api/v1/users/:id/coins', apiAuth, hasPermission('users:write'), (req, res) => {
        const { amount, action } = req.body;
        const user = db.getUser(req.params.id);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (action === 'set') {
            db.setCoins(req.params.id, parseInt(amount) || 0);
        } else if (action === 'add') {
            db.updateCoins(req.params.id, parseInt(amount) || 0);
        } else if (action === 'subtract') {
            db.updateCoins(req.params.id, -(parseInt(amount) || 0));
        }

        const updatedUser = db.getUser(req.params.id);
        res.json({ success: true, data: { coins: updatedUser.coins } });
    });

    // API: الحصول على جميع السيرفرات
    router.get('/api/v1/servers', apiAuth, hasPermission('servers:read'), (req, res) => {
        const servers = db.getAllServers().map(s => ({
            id: s.id,
            name: s.name,
            ownerId: s.ownerId,
            status: s.status,
            isSuspended: s.isSuspended
        }));
        res.json({ success: true, data: servers });
    });

    // API: الحصول على سيرفر معين
    router.get('/api/v1/servers/:id', apiAuth, hasPermission('servers:read'), (req, res) => {
        const server = db.getServer(req.params.id);
        if (!server) {
            return res.status(404).json({ error: 'Server not found' });
        }
        res.json({ success: true, data: server });
    });

    // API: إحصائيات عامة
    router.get('/api/v1/stats', apiAuth, hasPermission('stats:read'), (req, res) => {
        const users = db.getAllUsers();
        const servers = db.getAllServers();
        
        res.json({
            success: true,
            data: {
                totalUsers: users.length,
                totalServers: servers.length,
                totalCoins: users.reduce((sum, u) => sum + (u.coins || 0), 0),
                activeServers: servers.filter(s => s.status === 'online').length
            }
        });
    });

    // API: إنشاء سيرفر جديد
    router.post('/api/v1/servers', apiAuth, hasPermission('servers:write'), (req, res) => {
        try {
            const { ownerId, name } = req.body;
            
            if (!ownerId || !name) {
                return res.status(400).json({ error: 'ownerId and name are required' });
            }

            const user = db.getUser(ownerId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const result = db.createServer(ownerId, name);
            const server = db.getServer(result.lastInsertRowid);
            
            res.json({ success: true, data: server });
        } catch (err) {
            console.error('[API] Create server error:', err);
            res.status(500).json({ error: 'Failed to create server' });
        }
    });

    // API: حذف سيرفر
    router.delete('/api/v1/servers/:id', apiAuth, hasPermission('servers:write'), (req, res) => {
        try {
            const server = db.getServer(req.params.id);
            if (!server) {
                return res.status(404).json({ error: 'Server not found' });
            }

            db.deleteServer(req.params.id);
            res.json({ success: true, message: 'Server deleted' });
        } catch (err) {
            console.error('[API] Delete server error:', err);
            res.status(500).json({ error: 'Failed to delete server' });
        }
    });

    // API: تعليق/إلغاء تعليق سيرفر
    router.post('/api/v1/servers/:id/suspend', apiAuth, hasPermission('servers:write'), (req, res) => {
        try {
            const { suspended } = req.body;
            const server = db.getServer(req.params.id);
            
            if (!server) {
                return res.status(404).json({ error: 'Server not found' });
            }

            db.suspendServer(req.params.id, suspended ? 1 : 0);
            res.json({ success: true, data: { isSuspended: suspended } });
        } catch (err) {
            console.error('[API] Suspend server error:', err);
            res.status(500).json({ error: 'Failed to update server' });
        }
    });

    // API: إنشاء مستخدم جديد
    router.post('/api/v1/users', apiAuth, hasPermission('users:write'), (req, res) => {
        try {
            const { id, username, avatar, coins } = req.body;
            
            if (!id || !username) {
                return res.status(400).json({ error: 'id and username are required' });
            }

            const user = db.createUser({ id, username, avatar: avatar || '' });
            if (coins) {
                db.setCoins(id, parseInt(coins) || 0);
            }
            
            const updatedUser = db.getUser(id);
            res.json({ success: true, data: {
                id: updatedUser.id,
                username: updatedUser.username,
                coins: updatedUser.coins,
                isAdmin: updatedUser.isAdmin,
                isBanned: updatedUser.isBanned
            }});
        } catch (err) {
            console.error('[API] Create user error:', err);
            res.status(500).json({ error: 'Failed to create user' });
        }
    });

    // API: حظر/إلغاء حظر مستخدم
    router.post('/api/v1/users/:id/ban', apiAuth, hasPermission('users:write'), (req, res) => {
        try {
            const { banned, reason } = req.body;
            const user = db.getUser(req.params.id);
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            db.setBan(req.params.id, banned ? 1 : 0, reason || null);
            res.json({ success: true, data: { isBanned: banned, banReason: reason } });
        } catch (err) {
            console.error('[API] Ban user error:', err);
            res.status(500).json({ error: 'Failed to update user' });
        }
    });

    // API: تعيين/إزالة أدمن
    router.post('/api/v1/users/:id/admin', apiAuth, hasPermission('users:write'), (req, res) => {
        try {
            const { isAdmin } = req.body;
            const user = db.getUser(req.params.id);
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            db.setAdmin(req.params.id, isAdmin ? 1 : 0);
            res.json({ success: true, data: { isAdmin } });
        } catch (err) {
            console.error('[API] Set admin error:', err);
            res.status(500).json({ error: 'Failed to update user' });
        }
    });

    // API: الحصول على الإعدادات
    router.get('/api/v1/config', apiAuth, hasPermission('config:read'), (req, res) => {
        res.json({
            success: true,
            data: {
                sitename: db.getConfig('sitename'),
                price: db.getConfig('price'),
                credit_rate: db.getConfig('credit_rate'),
                maintenance: db.getConfig('maintenance')
            }
        });
    });

    // API: تعديل الإعدادات
    router.post('/api/v1/config', apiAuth, hasPermission('config:write'), (req, res) => {
        try {
            const allowedKeys = ['sitename', 'price', 'credit_rate', 'maintenance'];
            const updates = {};
            
            for (const key of allowedKeys) {
                if (req.body[key] !== undefined) {
                    db.setConfig(key, req.body[key]);
                    updates[key] = req.body[key];
                }
            }
            
            res.json({ success: true, data: updates });
        } catch (err) {
            console.error('[API] Update config error:', err);
            res.status(500).json({ error: 'Failed to update config' });
        }
    });

    // API: سيرفرات مستخدم معين
    router.get('/api/v1/users/:id/servers', apiAuth, hasPermission('servers:read'), (req, res) => {
        const user = db.getUser(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const servers = db.getUserServers(req.params.id).map(s => ({
            id: s.id,
            name: s.name,
            status: s.status,
            isSuspended: s.isSuspended
        }));
        
        res.json({ success: true, data: servers });
    });

    return router;
};

module.exports.path = '/admin';
