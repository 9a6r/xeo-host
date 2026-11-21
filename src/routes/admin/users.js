const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');

const getAdminIds = () => (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(id => id);
const isSuperAdmin = (userId) => getAdminIds().includes(userId);

module.exports = ({ db, io, procMgr, isAdmin }) => {
    router.get('/users', isAdmin, (req, res) => {
        res.render('admin/users', {
            users: db.getAllUsers(),
            page: 'users',
            isOwner: isSuperAdmin(req.user.id)
        });
    });

    router.post('/user', isAdmin, (req, res) => {
        const { id, action, val, reason } = req.body;
        let amount = parseInt(val);
        if (isNaN(amount)) amount = 0;

        if (isSuperAdmin(id) && (action.startsWith('ban') || action === 'demote' || action === 'delete'))
            return res.render('errors/error', { code: 'PROTECTED', msg: 'Super Admin Protected' });

        if ((action === 'promote' || action === 'demote') && !isSuperAdmin(req.user.id))
            return res.render('errors/error', { code: 'FORBIDDEN', msg: 'Only super admins can manage admin roles' });

        if (action === 'add') db.updateCoins(id, amount);
        if (action === 'remove') db.updateCoins(id, -amount);
        if (action === 'set') db.setCoins(id, amount);

        if (action === 'ban' || action === 'ban_account' || action === 'ban_ip') {
            const banType = action === 'ban_ip' ? 'ip' : 'account';
            db.setBan(id, 1, reason, banType);
            const userServers = db.db.prepare('SELECT * FROM servers WHERE ownerId = ?').all(id);
            for (const s of userServers) {
                try { if (procMgr) procMgr.stop(s.id, io); } catch (e) {}
            }
        }

        if (action === 'unban') db.setBan(id, 0, null);
        if (action === 'promote') db.setAdmin(id, 1);
        if (action === 'demote') db.setAdmin(id, 0);

        if (action === 'delete') {
            const targetUser = db.getUser(id);
            if (targetUser && targetUser.isAdmin && !isSuperAdmin(req.user.id)) {
                return res.render('errors/error', { code: 'FORBIDDEN', msg: 'Only super admins can delete admin accounts' });
            }

            const userServers = db.db.prepare('SELECT * FROM servers WHERE ownerId = ?').all(id);
            for (const s of userServers) {
                try { if (procMgr) procMgr.stop(s.id, io); } catch (e) {}
                try { fs.removeSync(path.join(__dirname, '../../../instances', s.id.toString())); } catch (e) {}
            }

            db.db.prepare('DELETE FROM servers WHERE ownerId = ?').run(id);
            try { db.db.prepare('DELETE FROM banned_targets WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM user_resources WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM transactions WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM code_redemptions WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM activity_logs WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM announcement_reads WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM ticket_messages WHERE ticket_id IN (SELECT id FROM tickets WHERE user_id = ?)').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM ticket_messages WHERE user_id = ?').run(id); } catch (e) {}
            try { db.db.prepare('DELETE FROM tickets WHERE user_id = ?').run(id); } catch (e) {}
            db.db.prepare('DELETE FROM users WHERE id = ?').run(id);
        }

        res.redirect('/admin/users');
    });

    return router;
};

module.exports.path = '/admin';

