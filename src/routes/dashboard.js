const express = require('express');
const router = express.Router();

module.exports = ({ db, isAuth, procMgr }) => {
    // صفحة لوحة التحكم
    router.get('/', isAuth, (req, res) => {
        const target = req.user.isAdmin ? 'admins' : 'users';
        const announcements = db.getUnreadAnnouncements ? db.getUnreadAnnouncements(req.user.id, target) : [];
        
        res.render('dashboard', { 
            servers: db.getUserServers(req.user.id), 
            price: db.getConfig('price'),
            announcements
        });
    });
    
    // تحديد الإعلان كمقروء
    router.post('/announcement/:id/read', isAuth, (req, res) => {
        try {
            if (db.markAnnouncementRead) {
                db.markAnnouncementRead(req.params.id, req.user.id);
            }
            res.json({ success: true });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    });

    // API لجلب stats جميع سيرفرات المستخدم
    router.get('/api/stats', isAuth, (req, res) => {
        const servers = db.getUserServers(req.user.id);
        const serverIds = servers.map(s => s.id);
        const stats = procMgr.getMultipleStats(serverIds);
        
        // إضافة حالة التشغيل لكل سيرفر
        const result = {};
        for (const id of serverIds) {
            result[id] = {
                running: procMgr.isRunning(id),
                stats: stats[id]
            };
        }
        
        res.json(result);
    });

    // API لجلب جميع السيرفرات (للأدمن فقط)
    router.get('/api/all-servers', isAuth, (req, res) => {
        if (!req.user.isAdmin) {
            return res.status(403).json({ error: 'Admin only' });
        }
        
        try {
            const allServers = db.getAllServers();
            
            // إضافة معلومات المالك لكل سيرفر
            const serversWithOwner = allServers.map(s => {
                const owner = db.getUser(s.ownerId);
                return {
                    ...s,
                    ownerName: owner ? owner.username : 'Unknown',
                    ownerAvatar: owner ? owner.avatar : null
                };
            });
            
            res.json({ servers: serversWithOwner });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};

module.exports.path = '/dashboard';
