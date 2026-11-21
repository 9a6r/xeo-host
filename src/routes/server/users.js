const express = require('express');
const router = express.Router({ mergeParams: true });

module.exports = ({ db, isAuth }) => {
    // Middleware للتحقق من صلاحيات الوصول
    router.use('/:id/users', isAuth, (req, res, next) => {
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

    // صفحة Users
    router.get('/:id/users', (req, res) => {
        const s = req.server;
        const allUsers = db.getAllUsers().map(u => ({ id: u.id, username: u.username, avatar: u.avatar }));
        const users = allUsers.filter(u => 
            u.id === s.ownerId || (JSON.parse(s.collaborators || '[]').includes(u.id))
        );
        res.render('server/users', { s, users, allUsers, user: req.user, isOwner: req.isOwner, serverNavStyle: req.serverNavStyle });
    });

    // إضافة مستخدم كـ Collaborator
    router.post('/:id/users/add', (req, res) => {
        if (!req.isOwner && !req.user.isAdmin)
            return res.sendStatus(403);

        const s = req.server;
        const userId = req.body.userId;

        if (!userId)
            return res.redirect(`/server/${s.id}/users`);

        if (userId === s.ownerId)
            return res.redirect(`/server/${s.id}/users`);

        const user = db.getUser(userId);
        if (!user)
            return res.redirect(`/server/${s.id}/users`);

        let collabs = JSON.parse(s.collaborators || '[]');

        if (!collabs.includes(userId)) {
            collabs.push(userId);
            db.updateServerCollabs(s.id, collabs);
        }

        res.redirect(`/server/${s.id}/users`);
    });

    // إزالة مستخدم
    router.post('/:id/users/remove', (req, res) => {
        if (!req.isOwner && !req.user.isAdmin)
            return res.sendStatus(403);

        const s = req.server;
        const userId = req.body.userId;

        if (userId === s.ownerId)
            return res.sendStatus(403);

        let collabs = JSON.parse(s.collaborators || '[]');
        collabs = collabs.filter(id => id !== userId);

        db.updateServerCollabs(s.id, collabs);
        res.redirect(`/server/${s.id}/users`);
    });

    // تبديل حالة Collaborator
    router.post('/:id/users/toggle-collab', (req, res) => {
        if (!req.isOwner && !req.user.isAdmin)
            return res.sendStatus(403);

        const s = req.server;
        const userId = req.body.userId;

        if (userId === s.ownerId)
            return res.sendStatus(403);

        let collabs = JSON.parse(s.collaborators || '[]');

        if (collabs.includes(userId))
            collabs = collabs.filter(id => id !== userId);
        else
            collabs.push(userId);

        db.updateServerCollabs(s.id, collabs);
        res.redirect(`/server/${s.id}/users`);
    });

    return router;
};

module.exports.path = '/server';

