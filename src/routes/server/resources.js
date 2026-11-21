const express = require('express');
const router = express.Router({ mergeParams: true });

module.exports = ({ db }) => {
    // Resources Page
    router.get('/:id/resources', (req, res) => {
        const server = req.server;
        const userResources = db.getUserResources(req.user.id);
        const usedResources = db.getUserUsedResources(req.user.id);
        
        // Available = Total owned - Used by other servers
        // For this server, we can use: available + current server resources
        const available = {
            ram: Math.max(0, userResources.ram - usedResources.ram + (server.ram || 0)),
            cpu: Math.max(0, userResources.cpu - usedResources.cpu + (server.cpu || 0)),
            disk: Math.max(0, userResources.disk - usedResources.disk + (server.disk || 0))
        };

        const isOwner = server.ownerId === req.user.id;

        res.render('server/resources', {
            s: server,
            available,
            isOwner,
            page: 'resources',
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // Update Resources
    router.post('/:id/resources/update', (req, res) => {
        try {
            const server = req.server;
            const { ram, cpu, disk } = req.body;
            
            const newRam = parseInt(ram) || 512;
            const newCpu = parseInt(cpu) || 50;
            const newDisk = parseInt(disk) || 1024;
            
            // Get user's total and used resources
            const userResources = db.getUserResources(req.user.id);
            const usedResources = db.getUserUsedResources(req.user.id);
            
            // Current server resources
            const currentServerRam = server.ram || 512;
            const currentServerCpu = server.cpu || 50;
            const currentServerDisk = server.disk || 1024;
            
            // Calculate how much EXTRA the user wants (beyond current)
            const extraRamNeeded = newRam - currentServerRam;
            const extraCpuNeeded = newCpu - currentServerCpu;
            const extraDiskNeeded = newDisk - currentServerDisk;
            
            // Available extra resources = owned - used by OTHER servers
            const usedByOthers = {
                ram: usedResources.ram - currentServerRam,
                cpu: usedResources.cpu - currentServerCpu,
                disk: usedResources.disk - currentServerDisk
            };
            
            const availableExtra = {
                ram: userResources.ram - Math.max(0, usedByOthers.ram),
                cpu: userResources.cpu - Math.max(0, usedByOthers.cpu),
                disk: userResources.disk - Math.max(0, usedByOthers.disk)
            };
            
            // Only check if user wants MORE than current
            if (extraRamNeeded > 0 && extraRamNeeded > availableExtra.ram) {
                return res.redirect(`/server/${server.id}/resources?error=Not enough RAM available. You need ${extraRamNeeded} MB but only have ${availableExtra.ram} MB`);
            }
            if (extraCpuNeeded > 0 && extraCpuNeeded > availableExtra.cpu) {
                return res.redirect(`/server/${server.id}/resources?error=Not enough CPU available. You need ${extraCpuNeeded}% but only have ${availableExtra.cpu}%`);
            }
            if (extraDiskNeeded > 0 && extraDiskNeeded > availableExtra.disk) {
                return res.redirect(`/server/${server.id}/resources?error=Not enough Disk available. You need ${extraDiskNeeded} MB but only have ${availableExtra.disk} MB`);
            }
            
            // Minimum values
            if (newRam < 128 || newCpu < 10 || newDisk < 256) {
                return res.redirect(`/server/${server.id}/resources?error=Resources below minimum allowed`);
            }
            
            // Update server resources
            db.updateServerResources(server.id, newRam, newCpu, newDisk);
            
            // Log activity
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'server_resources', server.id, 
                `Updated resources: RAM=${newRam}MB, CPU=${newCpu}%, Disk=${newDisk}MB`, ip);
            
            res.redirect(`/server/${server.id}/resources?success=Resources updated successfully!`);
        } catch (err) {
            console.error('[RESOURCES] Update error:', err);
            res.redirect(`/server/${req.server.id}/resources?error=Failed to update resources`);
        }
    });

    return router;
};

module.exports.path = '/server';
