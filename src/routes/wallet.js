const express = require('express');
const router = express.Router();

module.exports = ({ db, isAuth }) => {
    // صفحة المحفظة
    router.get('/', isAuth, (req, res) => {
        const transactions = db.getUserTransactions(req.user.id, 20);
        
        res.render('wallet', {
            transactions,
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // استخدام كود الشحن
    router.post('/redeem', isAuth, (req, res) => {
        const code = req.body.code?.trim().toUpperCase();
        
        if (!code) {
            return res.redirect('/wallet?error=Please enter a code');
        }

        const result = db.redeemCode(code, req.user.id);
        
        if (result.success) {
            res.redirect(`/wallet?success=Successfully redeemed ${result.coins} coins!`);
        } else {
            res.redirect(`/wallet?error=${result.error}`);
        }
    });

    return router;
};

module.exports.path = '/wallet';
