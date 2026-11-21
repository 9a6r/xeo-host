const express = require('express');
const router = express.Router();

module.exports = ({ db, isAdmin }) => {
    // صفحة الإعلانات
    router.get('/announcements', isAdmin, (req, res) => {
        const announcements = db.getAnnouncements ? db.getAnnouncements() : [];
        res.render('admin/announcements', {
            page: 'announcements',
            announcements,
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // إنشاء إعلان جديد
    router.post('/announcements/create', isAdmin, (req, res) => {
        try {
            const { title, content, type, target, priority, expires_at } = req.body;
            
            if (!title || !content) {
                return res.redirect('/admin/announcements?error=Title and content are required');
            }

            db.createAnnouncement({
                title: title.trim(),
                content: content.trim(),
                type: type || 'info',
                target: target || 'all',
                priority: parseInt(priority) || 0,
                expires_at: expires_at || null,
                created_by: req.user.id
            });
            
            res.redirect('/admin/announcements?success=Announcement created successfully');
        } catch (err) {
            console.error('[ANNOUNCEMENTS] Create error:', err);
            res.redirect('/admin/announcements?error=Failed to create announcement');
        }
    });

    // تعديل إعلان
    router.post('/announcements/edit/:id', isAdmin, (req, res) => {
        try {
            const { id } = req.params;
            const { title, content, type, target, priority, expires_at, is_active } = req.body;
            
            db.updateAnnouncement(id, {
                title: title.trim(),
                content: content.trim(),
                type: type || 'info',
                target: target || 'all',
                priority: parseInt(priority) || 0,
                expires_at: expires_at || null,
                is_active: is_active === 'on' ? 1 : 0
            });
            
            res.redirect('/admin/announcements?success=Announcement updated');
        } catch (err) {
            console.error('[ANNOUNCEMENTS] Update error:', err);
            res.redirect('/admin/announcements?error=Failed to update announcement');
        }
    });

    // حذف إعلان
    router.post('/announcements/delete/:id', isAdmin, (req, res) => {
        try {
            const { id } = req.params;
            db.deleteAnnouncement(id);
            res.redirect('/admin/announcements?success=Announcement deleted');
        } catch (err) {
            console.error('[ANNOUNCEMENTS] Delete error:', err);
            res.redirect('/admin/announcements?error=Failed to delete announcement');
        }
    });

    // تفعيل/تعطيل إعلان
    router.post('/announcements/toggle/:id', isAdmin, (req, res) => {
        try {
            const { id } = req.params;
            db.toggleAnnouncement(id);
            
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.json({ success: true });
            }
            res.redirect('/admin/announcements');
        } catch (err) {
            console.error('[ANNOUNCEMENTS] Toggle error:', err);
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.json({ success: false, error: err.message });
            }
            res.redirect('/admin/announcements?error=Failed to toggle announcement');
        }
    });

    return router;
};

module.exports.path = '/admin';
