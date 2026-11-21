const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');

function getServerPath(serverId, relPath = '') {
    const base = path.join(__dirname, '../../instances', serverId.toString());
    const full = path.join(base, relPath);
    if (!full.startsWith(base)) throw new Error('Invalid path');
    return full;
}

function canAccessServer(server, user) {
    if (!server || !user) return false;
    if (user.isAdmin) return true;
    const collaborators = JSON.parse(server.collaborators || '[]');
    return server.ownerId === user.id || collaborators.includes(user.id);
}

module.exports = ({ db, io, isAuth, procMgr }) => {
    router.get('/user', isAuth, (req, res) => {
        const { password_hash, ...safeUser } = req.user;
        res.json({ user: safeUser });
    });

    router.get('/servers', isAuth, (req, res) => {
        try {
            const servers = db.getUserServers(req.user.id);
            const serversWithStatus = servers.map(s => ({
                ...s,
                status: procMgr.isRunning(s.id) ? 'online' : 'offline'
            }));
            res.json({ servers: serversWithStatus });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get servers' });
        }
    });

    router.get('/servers/:id', isAuth, (req, res) => {
        try {
            const server = db.getServer(req.params.id);
            if (!server) return res.status(404).json({ error: 'Server not found' });
            if (!canAccessServer(server, req.user)) return res.status(403).json({ error: 'Access denied' });
            res.json({
                server: {
                    ...server,
                    status: procMgr.isRunning(server.id) ? 'online' : 'offline'
                }
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get server' });
        }
    });

    return router;
};

module.exports.path = '/api';

