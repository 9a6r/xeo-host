const express = require('express');
const router = express.Router();

module.exports = ({ db, isAuth }) => {
    // صفحة سجل النشاطات
    router.get('/', isAuth, (req, res) => {
        const logs = db.getUserActivityLogs(req.user.id, 100);
        const stats = db.getActivityStats(req.user.id);
        
        res.render('activity', { 
            logs,
            stats,
            page: 'activity'
        });
    });

    // API لجلب النشاطات (للتحديث الديناميكي)
    router.get('/api/logs', isAuth, (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        const logs = db.getUserActivityLogs(req.user.id, limit);
        res.json(logs);
    });

    // API لجلب الإحصائيات
    router.get('/api/stats', isAuth, (req, res) => {
        const stats = db.getActivityStats(req.user.id);
        res.json(stats);
    });

    return router;
};

module.exports.path = '/activity';
