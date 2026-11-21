const express = require('express');
const router = express.Router();

const getAdminIds = () => (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(id => id);
const isSuperAdmin = (userId) => getAdminIds().includes(userId);

module.exports = ({ db }) => {
    // الصفحة الرئيسية
    router.get('/', (req, res) => {
        res.render('landing', { 
            stats: { 
                users: db.getAllUsers().length, 
                servers: db.getAllServers().length 
            } 
        });
    });

    // صفحة تسجيل الدخول وإنشاء الحساب
    router.get('/login', (req, res) => {
        if (req.isAuthenticated && req.isAuthenticated()) {
            return res.redirect('/dashboard');
        }
        res.render('login', {
            error: req.query.error || null,
            mode: req.query.mode === 'register' ? 'register' : 'login'
        });
    });

    // تسجيل دخول باسم المستخدم وكلمة المرور
    router.post('/auth/local/login', (req, res, next) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.render('login', { error: 'يرجى إدخال اسم المستخدم وكلمة المرور', mode: 'login' });
        }

        const result = db.authenticateLocalUser(username, password);
        if (!result.success) {
            return res.render('login', { error: result.error, mode: 'login' });
        }

        const user = result.user;
        if (isSuperAdmin(user.id) || isSuperAdmin(user.username)) {
            db.setAdmin(user.id, 1);
            user.isAdmin = 1;
        }

        req.logIn(user, (err) => {
            if (err) return next(err);
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (db.addActivityLog) {
                db.addActivityLog(user.id, 'user_login', null, 'Logged in via Username/Password', ip);
            }
            return res.redirect('/dashboard');
        });
    });

    // إنشاء حساب جديد باسم مستخدم وكلمة مرور فقط
    router.post('/auth/local/register', (req, res, next) => {
        const { username, password, confirm_password } = req.body;
        const cleanUser = (username || '').trim();

        if (!cleanUser || cleanUser.length < 3 || cleanUser.length > 24) {
            return res.render('login', { error: 'اسم المستخدم يجب أن يكون بين 3 و 24 حرفاً أو رقماً', mode: 'register' });
        }
        if (!/^[a-zA-Z0-9_\u0600-\u06FF.-]+$/.test(cleanUser)) {
            return res.render('login', { error: 'اسم المستخدم يحتوي على رموز غير مسموحة', mode: 'register' });
        }
        if (!password || password.length < 4) {
            return res.render('login', { error: 'كلمة المرور يجب أن تكون 4 أحرف أو أرقام على الأقل', mode: 'register' });
        }
        if (password !== confirm_password) {
            return res.render('login', { error: 'كلمتا المرور غير متطابقتين', mode: 'register' });
        }

        const result = db.registerLocalUser(cleanUser, password);
        if (!result.success) {
            return res.render('login', { error: result.error, mode: 'register' });
        }

        const user = result.user;
        if (isSuperAdmin(user.id) || isSuperAdmin(user.username)) {
            db.setAdmin(user.id, 1);
            user.isAdmin = 1;
        }

        req.logIn(user, (err) => {
            if (err) return next(err);
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (db.addActivityLog) {
                db.addActivityLog(user.id, 'user_register', null, 'Registered new account via Username/Password', ip);
            }
            return res.redirect('/dashboard');
        });
    });

    // تسجيل الخروج
    router.get('/logout', (req, res, next) => req.logout(e => res.redirect('/')));

    return router;
};

