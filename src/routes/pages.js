const express = require('express');
const router = express.Router();

// تحديد المسار الأساسي
module.exports = ({ db }) => {
    // صفحة سياسة الخصوصية
    router.get('/privacy', (req, res) => {
        res.render('pages/privacy');
    });

    // صفحة شروط الخدمة
    router.get('/terms', (req, res) => {
        res.render('pages/terms');
    });

    // صفحة التواصل
    router.get('/contact', (req, res) => {
        res.render('pages/contact');
    });

    return router;
};

// تحديد المسار الأساسي كـ /
module.exports.path = '/';
