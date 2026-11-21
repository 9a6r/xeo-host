const express = require('express');
const router = express.Router();

module.exports = ({ db, isAdmin }) => {
    // Admin Tickets Page
    router.get('/tickets', isAdmin, (req, res) => {
        const filter = req.query.filter || null;
        const tickets = db.getAllTickets(filter);
        const stats = db.getTicketStats();
        
        res.render('admin/tickets', {
            tickets,
            stats,
            filter,
            page: 'admin-tickets'
        });
    });

    return router;
};

module.exports.path = '/admin';
