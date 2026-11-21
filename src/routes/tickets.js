const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../public/uploads/tickets');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB max - accept all file types
});

module.exports = ({ db, isAuth }) => {
    // Tickets List Page
    router.get('/', isAuth, (req, res) => {
        const tickets = db.getUserTickets(req.user.id);
        res.render('tickets', {
            tickets,
            page: 'tickets',
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // Create Ticket
    router.post('/create', isAuth, (req, res) => {
        try {
            const { subject, category, priority, message } = req.body;
            
            if (!subject || !message) {
                return res.redirect('/tickets?error=Subject and message are required');
            }
            
            if (subject.length > 100) {
                return res.redirect('/tickets?error=Subject too long (max 100 characters)');
            }
            
            if (message.trim().length === 0) {
                return res.redirect('/tickets?error=Message cannot be empty');
            }
            
            const ticketId = db.createTicket(
                req.user.id,
                subject.trim(),
                category || 'general',
                priority || 'medium',
                message.trim()
            );
            
            // Log activity
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'ticket_create', null, `Created ticket #${ticketId}: ${subject}`, ip);
            
            res.redirect(`/tickets/${ticketId}?success=Ticket created successfully!`);
        } catch (err) {
            console.error('[TICKETS] Create error:', err);
            res.redirect('/tickets?error=Failed to create ticket');
        }
    });

    // View Ticket
    router.get('/:id', isAuth, (req, res) => {
        const ticket = db.getTicket(req.params.id);
        
        if (!ticket) {
            return res.redirect('/tickets?error=Ticket not found');
        }
        
        // Check access (owner or admin)
        if (ticket.user_id !== req.user.id && !req.user.isAdmin) {
            return res.redirect('/tickets?error=Access denied');
        }
        
        const messages = db.getTicketMessages(ticket.id);
        
        res.render('ticket-view', {
            ticket,
            messages,
            page: 'tickets',
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // Reply to Ticket
    router.post('/:id/reply', isAuth, (req, res) => {
        try {
            const ticket = db.getTicket(req.params.id);
            
            if (!ticket) {
                return res.redirect('/tickets?error=Ticket not found');
            }
            
            // Check access
            if (ticket.user_id !== req.user.id && !req.user.isAdmin) {
                return res.redirect('/tickets?error=Access denied');
            }
            
            if (ticket.status === 'closed') {
                return res.redirect(`/tickets/${ticket.id}?error=Cannot reply to closed ticket`);
            }
            
            const { message } = req.body;
            
            if (!message || message.trim().length === 0) {
                return res.redirect(`/tickets/${ticket.id}?error=Message cannot be empty`);
            }
            
            const isStaff = req.user.isAdmin ? 1 : 0;
            db.addTicketMessage(ticket.id, req.user.id, message.trim(), isStaff);
            
            // If staff replies, set to pending. If user replies, set to open
            if (isStaff && ticket.status === 'open') {
                db.updateTicketStatus(ticket.id, 'pending');
            } else if (!isStaff && ticket.status === 'pending') {
                db.updateTicketStatus(ticket.id, 'open');
            }
            
            res.redirect(`/tickets/${ticket.id}?success=Reply sent!`);
        } catch (err) {
            console.error('[TICKETS] Reply error:', err);
            res.redirect(`/tickets/${req.params.id}?error=Failed to send reply`);
        }
    });

    // Close Ticket
    router.post('/:id/close', isAuth, (req, res) => {
        try {
            const ticket = db.getTicket(req.params.id);
            
            if (!ticket) {
                return res.redirect('/tickets?error=Ticket not found');
            }
            
            // Check access
            if (ticket.user_id !== req.user.id && !req.user.isAdmin) {
                return res.redirect('/tickets?error=Access denied');
            }
            
            db.updateTicketStatus(ticket.id, 'closed', req.user.id);
            
            // Log activity
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            db.addActivityLog(req.user.id, 'ticket_close', null, `Closed ticket #${ticket.id}`, ip);
            
            res.redirect(`/tickets/${ticket.id}?success=Ticket closed`);
        } catch (err) {
            console.error('[TICKETS] Close error:', err);
            res.redirect(`/tickets/${req.params.id}?error=Failed to close ticket`);
        }
    });

    // Update Status (Admin only)
    router.post('/:id/status', isAuth, (req, res) => {
        try {
            if (!req.user.isAdmin) {
                return res.redirect('/tickets?error=Access denied');
            }
            
            const ticket = db.getTicket(req.params.id);
            
            if (!ticket) {
                return res.redirect('/tickets?error=Ticket not found');
            }
            
            const { status } = req.body;
            const validStatuses = ['open', 'pending', 'closed'];
            
            if (!validStatuses.includes(status)) {
                return res.redirect(`/tickets/${ticket.id}?error=Invalid status`);
            }
            
            db.updateTicketStatus(ticket.id, status, status === 'closed' ? req.user.id : null);
            
            res.redirect(`/tickets/${ticket.id}?success=Status updated to ${status}`);
        } catch (err) {
            console.error('[TICKETS] Status update error:', err);
            res.redirect(`/tickets/${req.params.id}?error=Failed to update status`);
        }
    });

    // Upload files API
    router.post('/:id/upload', isAuth, upload.array('files', 5), (req, res) => {
        try {
            const ticket = db.getTicket(req.params.id);
            
            if (!ticket) {
                return res.status(404).json({ success: false, error: 'Ticket not found' });
            }
            
            if (ticket.user_id !== req.user.id && !req.user.isAdmin) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
            
            if (ticket.status === 'closed') {
                return res.status(400).json({ success: false, error: 'Ticket is closed' });
            }
            
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, error: 'No files uploaded' });
            }
            
            const attachments = req.files.map(file => ({
                name: file.originalname,
                path: '/uploads/tickets/' + file.filename,
                type: file.mimetype,
                size: file.size
            }));
            
            res.json({ success: true, attachments });
        } catch (err) {
            console.error('[TICKETS] Upload error:', err);
            res.status(500).json({ success: false, error: 'Upload failed' });
        }
    });

    return router;
};

module.exports.path = '/tickets';
