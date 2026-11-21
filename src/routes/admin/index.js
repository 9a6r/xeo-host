const express = require('express');
const router = express.Router();
const os = require('os');

module.exports = ({ db, isAdmin }) => {
    // صفحة Admin الرئيسية - Dashboard
    router.get('/', isAdmin, (req, res) => {
        const stats = {
            load: os.loadavg()[0].toFixed(2) + '%',
            mem: (100 - (os.freemem() / os.totalmem() * 100)).toFixed(1) + '%',
            uptime: (process.uptime() / 3600).toFixed(2) + 'h'
        };
        res.render('admin/dashboard', {
            users: db.getAllUsers(),
            servers: db.getAllServers(),
            config: {
                price: db.getConfig('price'),
                sitename: db.getConfig('sitename'),
                payment_id: db.getConfig('payment_id'),
                credit_rate: db.getConfig('credit_rate'),
                payment_channel: db.getConfig('payment_channel'),
                maintenance: db.getConfig('maintenance'),
                debug_mode: db.getConfig('debug_mode')
            },
            stats,
            page: 'dashboard'
        });
    });

    return router;
};

module.exports.path = '/admin';
