const express = require('express');
const router = express.Router();

module.exports = ({ passport, db }) => {
    // بدء عملية المصادقة مع Discord
    router.get('/', passport.authenticate('discord'));

    // Callback بعد المصادقة
    router.get('/callback', (req, res, next) => {
        passport.authenticate('discord', (err, user) => {
            if (err || !user) return res.redirect('/login');
            req.logIn(user, (e) => {
                if (e) return next(e);
                
                // تسجيل نشاط تسجيل الدخول
                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                if (db.addActivityLog) {
                    db.addActivityLog(user.id, 'user_login', null, 'Logged in via Discord', ip);
                }
                
                res.redirect('/dashboard');
            });
        })(req, res, next);
    });

    // تسجيل الخروج
    router.get('/logout', (req, res) => {
        if (req.user && db.addActivityLog) {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'user_logout', null, 'Logged out', ip);
        }
        req.logout(() => res.redirect('/'));
    });

    return router;
};

module.exports.path = '/auth/discord';
