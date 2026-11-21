module.exports = (io, db) => {
    io.on('connection', (socket) => {
        socket.on('joinTicket', (ticketId) => {
            try {
                const userId = socket.request?.session?.passport?.user;
                if (!userId) return;
                const user = db.getUser(userId);
                if (!user || user.isBanned) return;
                const ticket = db.getTicket(ticketId);
                if (!ticket) return;
                if (ticket.user_id !== userId && !user.isAdmin) return;
                socket.join('ticket_' + ticketId);
                socket.ticketId = ticketId;
            } catch (e) {}
        });

        socket.on('ticketReply', async ({ ticketId, message, attachments }, callback) => {
            try {
                const userId = socket.request?.session?.passport?.user;
                if (!userId) return callback({ success: false, error: 'Not authenticated' });

                const user = db.getUser(userId);
                if (!user || user.isBanned) return callback({ success: false, error: 'Access denied' });

                const ticket = db.getTicket(ticketId);
                if (!ticket) return callback({ success: false, error: 'Ticket not found' });

                if (ticket.user_id !== userId && !user.isAdmin) {
                    return callback({ success: false, error: 'Access denied' });
                }

                if (ticket.status === 'closed') {
                    return callback({ success: false, error: 'Ticket is closed' });
                }

                const hasMessage = message && message.trim().length > 0;
                const hasAttachments = attachments && attachments.length > 0;

                if (!hasMessage && !hasAttachments) {
                    return callback({ success: false, error: 'Message or attachment required' });
                }

                const isStaff = user.isAdmin ? 1 : 0;
                db.addTicketMessage(ticketId, userId, hasMessage ? message.trim() : '', isStaff, hasAttachments ? attachments : null);

                if (isStaff && ticket.status === 'open') {
                    db.updateTicketStatus(ticketId, 'pending');
                    io.to('ticket_' + ticketId).emit('ticketStatus', { status: 'pending' });
                } else if (!isStaff && ticket.status === 'pending') {
                    db.updateTicketStatus(ticketId, 'open');
                    io.to('ticket_' + ticketId).emit('ticketStatus', { status: 'open' });
                }

                const msgData = {
                    id: Date.now(),
                    user_id: userId,
                    username: user.username,
                    avatar: user.avatar,
                    message: hasMessage ? message.trim() : null,
                    attachments: hasAttachments ? attachments : null,
                    is_staff: isStaff,
                    isAdmin: user.isAdmin,
                    created_at: new Date().toISOString()
                };

                io.to('ticket_' + ticketId).emit('ticketMessage', msgData);
                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: 'Server error' });
            }
        });

        socket.on('ticketClose', ({ ticketId }, callback) => {
            try {
                const userId = socket.request?.session?.passport?.user;
                if (!userId) return callback({ success: false, error: 'Not authenticated' });

                const user = db.getUser(userId);
                const ticket = db.getTicket(ticketId);

                if (!ticket) return callback({ success: false, error: 'Ticket not found' });
                if (ticket.user_id !== userId && !user.isAdmin) {
                    return callback({ success: false, error: 'Access denied' });
                }

                db.updateTicketStatus(ticketId, 'closed', userId);
                io.to('ticket_' + ticketId).emit('ticketStatus', { status: 'closed' });
                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: 'Server error' });
            }
        });

        socket.on('ticketStatus', ({ ticketId, status }, callback) => {
            try {
                const userId = socket.request?.session?.passport?.user;
                if (!userId) return callback({ success: false, error: 'Not authenticated' });

                const user = db.getUser(userId);
                if (!user?.isAdmin) return callback({ success: false, error: 'Admin only' });

                const validStatuses = ['open', 'pending', 'closed'];
                if (!validStatuses.includes(status)) {
                    return callback({ success: false, error: 'Invalid status' });
                }

                db.updateTicketStatus(ticketId, status, status === 'closed' ? userId : null);
                io.to('ticket_' + ticketId).emit('ticketStatus', { status });
                callback({ success: true });
            } catch (err) {
                callback({ success: false, error: 'Server error' });
            }
        });

        socket.on('ticketTyping', ({ ticketId }) => {
            const userId = socket.request?.session?.passport?.user;
            if (userId) {
                socket.to('ticket_' + ticketId).emit('ticketTyping', { userId });
            }
        });
    });
};

