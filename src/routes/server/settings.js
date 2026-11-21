const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs-extra');

function getServerPath(serverId, relPath = '') {
    const base = path.join(__dirname, '../../../instances', serverId.toString());
    const full = path.join(base, relPath);
    if (!full.startsWith(base)) throw new Error('Invalid path');
    return full;
}

module.exports = ({ db, io, procMgr, isAuth }) => {
    // Middleware للتحقق من صلاحيات الوصول
    router.use('/:id/settings', isAuth, (req, res, next) => {
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

    // صفحة Settings
    router.get('/:id/settings', (req, res) => {
        res.render('server/settings', { s: req.server, serverNavStyle: req.serverNavStyle, user: req.user, isOwner: req.isOwner });
    });

    // حذف السيرفر
    router.post('/:id/settings/delete', (req, res) => {
        const s = req.server;
        try {
            procMgr.stop(s.id, io);
            db.deleteServer(s.id);
            const serverDir = getServerPath(s.id);
            if (fs.existsSync(serverDir)) fs.removeSync(serverDir);
            res.redirect('/dashboard');
        } catch (err) {
            console.error('[DELETE SERVER] Error:', err);
            res.render('errors/error', { code: 'DELETE_FAILED', msg: 'Failed to delete server' });
        }
    });

    // إعادة تسمية السيرفر
    router.post('/:id/settings/rename', (req, res) => {
        const newName = req.body.newName
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .trim();

        if (!newName)
            return res.render('errors/error', { code: 'INVALID', msg: 'Invalid server name' });

        const exists = db.getAllServers().find(s => s.name === newName);
        if (exists)
            return res.render('errors/error', { code: 'TAKEN', msg: 'Server name already exists' });

        try {
            db.updateServerName(req.server.id, newName);
            res.redirect('/server/' + req.server.id);
        } catch (e) {
            console.error(e);
            res.render('errors/error', {
                code: 'RENAME_FAILED',
                msg: 'Failed to rename server'
            });
        }
    });

    // إعادة تثبيت السيرفر
    router.post('/:id/settings/reinstall', (req, res) => {
        const s = req.server;
        const serverDir = path.join(__dirname, '../../../instances', s.id.toString());

        try {
            procMgr.stop(s.id, io);
            fs.emptyDirSync(serverDir);

            const startupFile = s.startup_file || 'index.js';
            fs.writeFileSync(
                path.join(serverDir, startupFile),
                `console.log('✅ Server Online');\nsetInterval(()=>console.log('🟢 Alive...'), 3000);`
            );

            res.redirect('/server/' + s.id);
        } catch (err) {
            console.error(err);
            res.render('errors/error', {
                code: 'REINSTALL_FAILED',
                msg: 'Failed to reinstall server'
            });
        }
    });

    return router;
};

module.exports.path = '/server';
