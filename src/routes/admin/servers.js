const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');

module.exports = ({ db, io, procMgr, isAdmin }) => {
    // صفحة إدارة السيرفرات
    router.get('/servers', isAdmin, (req, res) => {
        res.render('admin/servers', {
            servers: db.getAllServers(),
            users: db.getAllUsers(),
            page: 'servers'
        });
    });

    // إدارة السيرفرات (Actions)
    router.post('/server', isAdmin, (req, res) => {
        const { id, action } = req.body;
        
        if (action === 'delete') {
            const server = db.getServer(id);
            procMgr.stop(id, io);
            if (server) {
                try { 
                    fs.removeSync(path.join(__dirname, '../../../instances', server.id.toString())); 
                } catch (e) { }
            }
            db.deleteServer(id);
        }
        if (action === 'suspend') {
            procMgr.stop(id, io);
            db.suspendServer(id, 1);
        }
        if (action === 'unsuspend') {
            db.suspendServer(id, 0);
        }
        
        res.redirect('/admin/servers');
    });

    // تعليق جميع السيرفرات
    router.post('/servers/suspend-all', isAdmin, (req, res) => {
        const servers = db.getAllServers();
        servers.forEach(server => {
            procMgr.stop(server.id, io);
            db.suspendServer(server.id, 1);
        });
        res.redirect('/admin/servers');
    });

    // إلغاء تعليق جميع السيرفرات
    router.post('/servers/unsuspend-all', isAdmin, (req, res) => {
        const servers = db.getAllServers();
        servers.forEach(server => {
            db.suspendServer(server.id, 0);
        });
        res.redirect('/admin/servers');
    });

    return router;
};

module.exports.path = '/admin';
