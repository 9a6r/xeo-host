const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');

module.exports = ({ db, isAuth }) => {
    // إنشاء سيرفر جديد
    router.post('/', isAuth, (req, res) => {
        const displayName = req.body.name.replace(/[^a-zA-Z0-9_-]/g, "");
        const price = parseInt(db.getConfig('price'));

        if (req.user.coins < price) 
            return res.render('errors/error', { code: 'COINS', msg: 'Insufficient Funds' });

        db.updateCoins(req.user.id, -price);

        // إنشاء السيرفر وإرجاع الكائن كامل
        const server = db.createServer(req.user.id, displayName);

        // إنشاء مجلد السيرفر
        const dir = path.join(__dirname, '../../instances', server.id.toString());
        fs.ensureDirSync(dir);

        // إنشاء ملف البداية
        fs.writeFileSync(
            path.join(dir, server.startup_file || 'index.js'),
            "console.log('✅ Server Online');\nsetInterval(()=>console.log('🟢 Alive...'), 3000);"
        );

        res.redirect('/dashboard');
    });

    return router;
};

module.exports.path = '/create';
