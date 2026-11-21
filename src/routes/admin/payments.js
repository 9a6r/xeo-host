const express = require('express');
const router = express.Router();

module.exports = ({ db, isAdmin }) => {
    // Helper function to get AFK settings
    function getAfkSettings() {
        return {
            enabled: db.getConfig('afk_enabled') !== 'false',
            coins: parseInt(db.getConfig('afk_coins')) || 1,
            interval: parseInt(db.getConfig('afk_interval')) || 60,
            maxDaily: parseInt(db.getConfig('afk_max_daily')) || 0
        };
    }

    // Helper function to get store prices
    function getStorePrices() {
        return {
            ram: parseFloat(db.getConfig('store_price_ram')) || 0.1,
            cpu: parseFloat(db.getConfig('store_price_cpu')) || 1,
            disk: parseFloat(db.getConfig('store_price_disk')) || 0.05
        };
    }

    // صفحة إدارة المدفوعات والأكواد
    router.get('/payments', isAdmin, (req, res) => {
        const codes = db.getAllRedeemCodes();
        const transactions = db.getAllTransactions(50);
        const stats = db.getPaymentStats();
        const afkSettings = getAfkSettings();
        const storePrices = getStorePrices();
        
        res.render('admin/payments', {
            codes,
            transactions,
            stats,
            afkSettings,
            storePrices,
            page: 'payments',
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // حفظ إعدادات AFK
    router.post('/payments/afk-settings', isAdmin, (req, res) => {
        try {
            const { afk_enabled, afk_coins, afk_interval, afk_max_daily } = req.body;
            
            db.setConfig('afk_enabled', afk_enabled);
            db.setConfig('afk_coins', afk_coins || '1');
            db.setConfig('afk_interval', afk_interval || '60');
            db.setConfig('afk_max_daily', afk_max_daily || '0');
            
            res.redirect('/admin/payments?success=AFK settings saved');
        } catch (err) {
            console.error('[PAYMENTS] AFK settings error:', err);
            res.redirect('/admin/payments?error=Failed to save AFK settings');
        }
    });

    // حفظ إعدادات المتجر
    router.post('/payments/store-settings', isAdmin, (req, res) => {
        try {
            const { store_price_ram, store_price_cpu, store_price_disk } = req.body;
            
            db.setConfig('store_price_ram', store_price_ram || '0.1');
            db.setConfig('store_price_cpu', store_price_cpu || '1');
            db.setConfig('store_price_disk', store_price_disk || '0.05');
            
            res.redirect('/admin/payments?success=Store prices saved');
        } catch (err) {
            console.error('[PAYMENTS] Store settings error:', err);
            res.redirect('/admin/payments?error=Failed to save store prices');
        }
    });

    // إنشاء كود جديد
    router.post('/payments/create-code', isAdmin, (req, res) => {
        try {
            const { coins, max_uses, expires_days, custom_code } = req.body;
            
            if (!coins || coins < 1) {
                return res.redirect('/admin/payments?error=Invalid coins amount');
            }

            const expiresAt = expires_days ? 
                new Date(Date.now() + parseInt(expires_days) * 24 * 60 * 60 * 1000).toISOString() : 
                null;

            const code = db.createRedeemCode(
                parseInt(coins),
                parseInt(max_uses) || 1,
                req.user.id,
                expiresAt,
                custom_code || null
            );

            res.redirect(`/admin/payments?success=Code created: ${code.code}`);
        } catch (err) {
            console.error('[PAYMENTS] Create code error:', err);
            if (err.message.includes('UNIQUE constraint')) {
                res.redirect('/admin/payments?error=Code already exists');
            } else {
                res.redirect('/admin/payments?error=Failed to create code');
            }
        }
    });

    // إنشاء أكواد متعددة
    router.post('/payments/bulk-create', isAdmin, (req, res) => {
        try {
            const { coins, count, max_uses, expires_days } = req.body;
            
            if (!coins || coins < 1 || !count || count < 1) {
                return res.redirect('/admin/payments?error=Invalid parameters');
            }

            const expiresAt = expires_days ? 
                new Date(Date.now() + parseInt(expires_days) * 24 * 60 * 60 * 1000).toISOString() : 
                null;

            const createdCodes = [];
            for (let i = 0; i < Math.min(parseInt(count), 100); i++) {
                const code = db.createRedeemCode(
                    parseInt(coins),
                    parseInt(max_uses) || 1,
                    req.user.id,
                    expiresAt
                );
                createdCodes.push(code.code);
            }

            res.redirect(`/admin/payments?success=Created ${createdCodes.length} codes`);
        } catch (err) {
            console.error('[PAYMENTS] Bulk create error:', err);
            res.redirect('/admin/payments?error=Failed to create codes');
        }
    });

    // تفعيل/تعطيل كود
    router.post('/payments/toggle-code', isAdmin, (req, res) => {
        try {
            db.toggleRedeemCode(req.body.id);
            res.redirect('/admin/payments?success=Code status updated');
        } catch (err) {
            console.error('[PAYMENTS] Toggle code error:', err);
            res.redirect('/admin/payments?error=Failed to update code');
        }
    });

    // حذف كود
    router.post('/payments/delete-code', isAdmin, (req, res) => {
        try {
            db.deleteRedeemCode(req.body.id);
            res.redirect('/admin/payments?success=Code deleted');
        } catch (err) {
            console.error('[PAYMENTS] Delete code error:', err);
            res.redirect('/admin/payments?error=Failed to delete code');
        }
    });

    return router;
};

module.exports.path = '/admin';
