const express = require('express');
const router = express.Router({ mergeParams: true });

module.exports = ({ db, io, procMgr, isAuth }) => {
    // Middleware للتحقق من صلاحيات الوصول للسيرفر
    router.use('/:id', isAuth, (req, res, next) => {
        const s = db.getServer(req.params.id);
        if (!s)
            return res.render('errors/error', { code: 404, msg: 'Not Found' });

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
        
        // تمرير إعداد شكل التنقل
        req.serverNavStyle = db.getConfig('server_nav_style') || 'tabs';

        next();
    });

    // صفحة Console الرئيسية
    router.get('/:id', (req, res) => {
        const consoleConfig = db.getConfig('console_commands');
        const consoleCommandsEnabled = consoleConfig === 'true' || consoleConfig === true;
        res.render('server/console', { 
            s: req.server, 
            isOwner: req.isOwner, 
            serverNavStyle: req.serverNavStyle,
            consoleCommandsEnabled
        });
    });

    // التحكم بالطاقة (start/stop/restart)
    router.post('/:id/power', (req, res) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // منع تشغيل السيرفر إذا كان معلق
        if (req.server.isSuspended && (req.body.action === 'start' || req.body.action === 'restart')) {
            return res.json({ ok: false, error: 'Server is suspended' });
        }
        
        if (req.body.action === 'start') {
            procMgr.start(req.server, io);
            db.addActivityLog(req.user.id, 'server_start', req.server.id, `Started server "${req.server.name}"`, ip);
        }
        if (req.body.action === 'stop') {
            procMgr.stop(req.server.id, io);
            db.addActivityLog(req.user.id, 'server_stop', req.server.id, `Stopped server "${req.server.name}"`, ip);
        }
        if (req.body.action === 'restart') {
            procMgr.restart(req.server, io);
            db.addActivityLog(req.user.id, 'server_restart', req.server.id, `Restarted server "${req.server.name}"`, ip);
        }
        res.json({ ok: true });
    });

    return router;
};

module.exports.path = '/server';
