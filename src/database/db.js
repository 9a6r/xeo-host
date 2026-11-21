const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'system.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, 
        username TEXT, 
        avatar TEXT, 
        coins INTEGER DEFAULT 0, 
        isAdmin INTEGER DEFAULT 0, 
        isBanned INTEGER DEFAULT 0, 
        banReason TEXT
    );
    CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        ownerId TEXT, 
        name TEXT, 
        isSuspended INTEGER DEFAULT 0, 
        collaborators TEXT DEFAULT '[]', 
        startup_file TEXT DEFAULT 'index.js',
        ram INTEGER DEFAULT 512,
        cpu INTEGER DEFAULT 50,
        disk INTEGER DEFAULT 1024,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_resources (
        user_id TEXT PRIMARY KEY,
        ram INTEGER DEFAULT 0,
        cpu INTEGER DEFAULT 0,
        disk INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY, 
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS redeem_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        coins INTEGER NOT NULL,
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        reference_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS code_redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (code_id) REFERENCES redeem_codes(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        server_id INTEGER,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        api_key TEXT UNIQUE, 
        name TEXT, 
        permissions TEXT, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        target TEXT DEFAULT 'all',
        priority INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        expires_at DATETIME,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS announcement_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER,
        user_id TEXT,
        read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(announcement_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        closed_by TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS ticket_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        message TEXT DEFAULT '',
        attachments TEXT,
        is_staff INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES tickets(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`);

// Add columns if they don't exist (for existing databases)
try { db.exec('ALTER TABLE servers ADD COLUMN ram INTEGER DEFAULT 512'); } catch(e) {}
try { db.exec('ALTER TABLE ticket_messages ADD COLUMN attachments TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE servers ADD COLUMN cpu INTEGER DEFAULT 50'); } catch(e) {}
try { db.exec('ALTER TABLE servers ADD COLUMN disk INTEGER DEFAULT 1024'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT'); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN banType TEXT DEFAULT 'account'"); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN lastIp TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN deviceHash TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN deviceToken TEXT'); } catch(e) {}

db.exec(`
    CREATE TABLE IF NOT EXISTS banned_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        ban_type TEXT NOT NULL,
        ip_address TEXT,
        device_hash TEXT,
        device_token TEXT,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Defaults
const setConf = (k, v) => db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)").run(k, v);
setConf('price', '5');
setConf('credit_rate', '1');
setConf('sitename', 'XeoStudio');
setConf('payment_id', 'NONE');
setConf('payment_channel', 'NONE');
setConf('probot_id', '282859044593598464');

module.exports = {
    db,
    
    // Users
    getUser: (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id),
    getLocalUserByUsername: (username) => db.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND password_hash IS NOT NULL').get(username),
    registerLocalUser: (username, password) => {
        const cleanUser = (username || '').trim();
        const existing = db.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND password_hash IS NOT NULL').get(cleanUser);
        if (existing) {
            return { success: false, error: 'اسم المستخدم مسجل بالفعل، اختر اسماً آخر' };
        }
        const id = '99' + Date.now().toString() + Math.floor(100 + Math.random() * 900).toString();
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        const passwordHash = `${salt}:${hash}`;
        db.prepare('INSERT INTO users (id, username, avatar, password_hash) VALUES (?, ?, ?, ?)').run(id, cleanUser, '', passwordHash);
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        return { success: true, user };
    },
    authenticateLocalUser: (username, password) => {
        const cleanUser = (username || '').trim();
        const user = db.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?) AND password_hash IS NOT NULL').get(cleanUser);
        if (!user || !user.password_hash) {
            return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
        }
        const [salt, storedHash] = user.password_hash.split(':');
        if (!salt || !storedHash) {
            return { success: false, error: 'هذا الحساب مسجل عبر ديسكورد فقط' };
        }
        const hashBuffer = crypto.scryptSync(password, salt, 64);
        const storedBuffer = Buffer.from(storedHash, 'hex');
        if (hashBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
            return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
        }
        return { success: true, user };
    },
    createUser: (p) => {
        db.prepare('INSERT OR IGNORE INTO users (id,username,avatar) VALUES (?,?,?)').run(p.id, p.username, p.avatar);
        db.prepare('UPDATE users SET username=?, avatar=? WHERE id=?').run(p.username, p.avatar, p.id);
        return db.prepare('SELECT * FROM users WHERE id=?').get(p.id);
    },
    updateCoins: (id, val) => db.prepare('UPDATE users SET coins = coins + ? WHERE id=?').run(val, id),
    setCoins: (id, val) => db.prepare('UPDATE users SET coins = ? WHERE id=?').run(val, id),
    setAdmin: (id, val) => db.prepare('UPDATE users SET isAdmin = ? WHERE id=?').run(val, id),
    setBan: (id, val, r, type = 'account') => {
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
        db.prepare('UPDATE users SET isBanned=?, banReason=?, banType=? WHERE id=?').run(val, r || null, val ? type : null, id);
        db.prepare('DELETE FROM banned_targets WHERE user_id=?').run(id);
        if (val && user && type === 'ip' && user.lastIp) {
            db.prepare('INSERT INTO banned_targets (user_id, ban_type, ip_address, reason) VALUES (?, ?, ?, ?)').run(
                id, 'ip', user.lastIp, r || null
            );
        } else if (!val && user && user.lastIp) {
            db.prepare('DELETE FROM banned_targets WHERE ip_address=?').run(user.lastIp);
        }
    },
    updateUserIp: (id, ip) => {
        if (!id || !ip) return;
        db.prepare('UPDATE users SET lastIp=? WHERE id=?').run(ip, id);
    },
    checkBanStatus: (ip, userId = null) => {
        // 1. Check IP Ban
        if (ip) {
            const ipBan = db.prepare("SELECT * FROM banned_targets WHERE ban_type='ip' AND ip_address=? LIMIT 1").get(ip);
            if (ipBan) return { banned: true, type: 'ip', reason: ipBan.reason || null };
        }
        // 2. Check Account Ban
        if (userId) {
            const u = db.prepare('SELECT isBanned, banType, banReason FROM users WHERE id=?').get(userId);
            if (u && u.isBanned) {
                return { banned: true, type: 'account', reason: u.banReason || null };
            }
        }
        return { banned: false };
    },
    getAllUsers: () => db.prepare('SELECT * FROM users').all(),

    // Servers
    createServer: (oid, name) => {
        const info = db.prepare('INSERT INTO servers (ownerId, name) VALUES (?,?)').run(oid, name);
        const id = info.lastInsertRowid;
        return db.prepare('SELECT * FROM servers WHERE id=?').get(id);
    },
    updateServerCollabs: (id, collabs) => 
        db.prepare('UPDATE servers SET collaborators=? WHERE id=?').run(JSON.stringify(collabs), id),
    getServer: (id) => db.prepare('SELECT * FROM servers WHERE id=?').get(id),
    getUserServers: (uid) => db.prepare('SELECT * FROM servers WHERE ownerId=? OR collaborators LIKE ?').all(uid, `%"${uid}"%`),
    getAllServers: () => db.prepare('SELECT s.*, u.username FROM servers s LEFT JOIN users u ON s.ownerId=u.id').all(),
    deleteServer: (id) => db.prepare('DELETE FROM servers WHERE id=?').run(id),
    suspendServer: (id, val) => db.prepare('UPDATE servers SET isSuspended=? WHERE id=?').run(val, id),
    updateStartup: (id, val) => db.prepare('UPDATE servers SET startup_file=? WHERE id=?').run(val, id),
    updateServerName: (id, val) => db.prepare('UPDATE servers SET name=? WHERE id=?').run(val, id),
    updateServerResources: (id, ram, cpu, disk) => db.prepare('UPDATE servers SET ram=?, cpu=?, disk=? WHERE id=?').run(ram, cpu, disk, id),

    // User Resources
    getUserResources: (userId) => {
        const res = db.prepare('SELECT * FROM user_resources WHERE user_id=?').get(userId);
        return res || { user_id: userId, ram: 0, cpu: 0, disk: 0 };
    },
    setUserResources: (userId, ram, cpu, disk) => {
        db.prepare('INSERT OR REPLACE INTO user_resources (user_id, ram, cpu, disk) VALUES (?, ?, ?, ?)').run(userId, ram, cpu, disk);
    },
    addUserResources: (userId, ram, cpu, disk) => {
        const current = module.exports.getUserResources(userId);
        db.prepare('INSERT OR REPLACE INTO user_resources (user_id, ram, cpu, disk) VALUES (?, ?, ?, ?)').run(
            userId, 
            current.ram + ram, 
            current.cpu + cpu, 
            current.disk + disk
        );
    },
    getUserUsedResources: (userId) => {
        const result = db.prepare('SELECT COALESCE(SUM(ram), 0) as ram, COALESCE(SUM(cpu), 0) as cpu, COALESCE(SUM(disk), 0) as disk FROM servers WHERE ownerId=?').get(userId);
        return result || { ram: 0, cpu: 0, disk: 0 };
    },

    // Config
    getConfig: (k) => (db.prepare('SELECT value FROM config WHERE key=?').get(k) || {}).value,
    setConfig: (k, v) => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?,?)').run(k, String(v)),

    // Redeem Codes
    generateCode: (length = 16) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < length; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
            if ((i + 1) % 4 === 0 && i < length - 1) code += '-';
        }
        return code;
    },
    
    createRedeemCode: (coins, maxUses = 1, createdBy = null, expiresAt = null, customCode = null) => {
        const code = customCode || module.exports.generateCode();
        db.prepare(`
            INSERT INTO redeem_codes (code, coins, max_uses, created_by, expires_at) 
            VALUES (?, ?, ?, ?, ?)
        `).run(code, coins, maxUses, createdBy, expiresAt);
        return db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code);
    },
    
    getRedeemCode: (code) => db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code),
    
    getAllRedeemCodes: () => db.prepare(`
        SELECT rc.*, u.username as creator_name,
        (SELECT COUNT(*) FROM code_redemptions WHERE code_id = rc.id) as redemption_count
        FROM redeem_codes rc 
        LEFT JOIN users u ON rc.created_by = u.id 
        ORDER BY rc.created_at DESC
    `).all(),
    
    redeemCode: (code, userId) => {
        const codeData = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code);
        
        if (!codeData) return { success: false, error: 'Invalid code' };
        if (!codeData.is_active) return { success: false, error: 'Code is inactive' };
        if (codeData.used_count >= codeData.max_uses) return { success: false, error: 'Code has reached maximum uses' };
        if (codeData.expires_at && new Date(codeData.expires_at) < new Date()) return { success: false, error: 'Code has expired' };
        
        const alreadyRedeemed = db.prepare('SELECT * FROM code_redemptions WHERE code_id = ? AND user_id = ?').get(codeData.id, userId);
        if (alreadyRedeemed) return { success: false, error: 'You have already redeemed this code' };
        
        db.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').run(codeData.id);
        db.prepare('INSERT INTO code_redemptions (code_id, user_id) VALUES (?, ?)').run(codeData.id, userId);
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(codeData.coins, userId);
        
        module.exports.addTransaction(userId, 'redeem', codeData.coins, `Redeemed code: ${code}`, codeData.id.toString());
        
        return { success: true, coins: codeData.coins };
    },
    
    deleteRedeemCode: (id) => {
        db.prepare('DELETE FROM code_redemptions WHERE code_id = ?').run(id);
        db.prepare('DELETE FROM redeem_codes WHERE id = ?').run(id);
    },
    
    toggleRedeemCode: (id) => {
        const code = db.prepare('SELECT is_active FROM redeem_codes WHERE id = ?').get(id);
        if (code) {
            db.prepare('UPDATE redeem_codes SET is_active = ? WHERE id = ?').run(code.is_active ? 0 : 1, id);
        }
    },

    // Transactions
    addTransaction: (userId, type, amount, description = null, referenceId = null) => {
        db.prepare(`
            INSERT INTO transactions (user_id, type, amount, description, reference_id) 
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, type, amount, description, referenceId);
    },
    
    getUserTransactions: (userId, limit = 50) => db.prepare(`
        SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit),
    
    getAllTransactions: (limit = 100) => db.prepare(`
        SELECT t.*, u.username 
        FROM transactions t 
        LEFT JOIN users u ON t.user_id = u.id 
        ORDER BY t.created_at DESC LIMIT ?
    `).all(limit),

    // Stats
    getPaymentStats: () => {
        const totalRedeemed = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE type = 'redeem'").get();
        const totalSpent = db.prepare("SELECT SUM(ABS(amount)) as total FROM transactions WHERE type = 'purchase'").get();
        const activeCodesCount = db.prepare('SELECT COUNT(*) as count FROM redeem_codes WHERE is_active = 1').get();
        const totalCodesCount = db.prepare('SELECT COUNT(*) as count FROM redeem_codes').get();
        
        return {
            totalRedeemed: totalRedeemed?.total || 0,
            totalSpent: totalSpent?.total || 0,
            activeCodes: activeCodesCount?.count || 0,
            totalCodes: totalCodesCount?.count || 0
        };
    },

    // Activity Logs
    addActivityLog: (userId, action, serverId = null, details = null, ipAddress = null) => {
        db.prepare(`
            INSERT INTO activity_logs (user_id, server_id, action, details, ip_address) 
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, serverId, action, details, ipAddress);
    },

    getUserActivityLogs: (userId, limit = 50) => db.prepare(`
        SELECT al.*, s.name as server_name 
        FROM activity_logs al 
        LEFT JOIN servers s ON al.server_id = s.id 
        WHERE al.user_id = ? 
        ORDER BY al.created_at DESC LIMIT ?
    `).all(userId, limit),

    getServerActivityLogs: (serverId, limit = 50) => db.prepare(`
        SELECT al.*, u.username 
        FROM activity_logs al 
        LEFT JOIN users u ON al.user_id = u.id 
        WHERE al.server_id = ? 
        ORDER BY al.created_at DESC LIMIT ?
    `).all(serverId, limit),

    getAllActivityLogs: (limit = 100) => db.prepare(`
        SELECT al.*, u.username, s.name as server_name 
        FROM activity_logs al 
        LEFT JOIN users u ON al.user_id = u.id 
        LEFT JOIN servers s ON al.server_id = s.id 
        ORDER BY al.created_at DESC LIMIT ?
    `).all(limit),

    getActivityStats: (userId) => {
        const today = db.prepare(`
            SELECT COUNT(*) as count FROM activity_logs 
            WHERE user_id = ? AND date(created_at) = date('now')
        `).get(userId);
        const week = db.prepare(`
            SELECT COUNT(*) as count FROM activity_logs 
            WHERE user_id = ? AND created_at >= datetime('now', '-7 days')
        `).get(userId);
        const total = db.prepare(`
            SELECT COUNT(*) as count FROM activity_logs WHERE user_id = ?
        `).get(userId);
        
        return {
            today: today?.count || 0,
            week: week?.count || 0,
            total: total?.count || 0
        };
    },

    // API Keys
    getApiKeys: () => db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all(),
    getApiKeyByKey: (key) => db.prepare('SELECT * FROM api_keys WHERE api_key=?').get(key),
    createApiKey: (key, name, permissions) => db.prepare('INSERT INTO api_keys (api_key, name, permissions) VALUES (?,?,?)').run(key, name, permissions),
    deleteApiKey: (id) => db.prepare('DELETE FROM api_keys WHERE id=?').run(id),
    regenerateApiKey: (id, newKey) => db.prepare('UPDATE api_keys SET api_key=? WHERE id=?').run(newKey, id),
    
    // Announcements
    getAnnouncements: () => db.prepare('SELECT a.*, u.username as author FROM announcements a LEFT JOIN users u ON a.created_by = u.id ORDER BY a.priority DESC, a.created_at DESC').all(),
    getActiveAnnouncements: (target = 'all') => db.prepare(`
        SELECT * FROM announcements 
        WHERE is_active = 1 
        AND (target = 'all' OR target = ?)
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY priority DESC, created_at DESC
    `).all(target),
    getAnnouncement: (id) => db.prepare('SELECT * FROM announcements WHERE id = ?').get(id),
    createAnnouncement: (data) => db.prepare(`
        INSERT INTO announcements (title, content, type, target, priority, expires_at, created_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.title, data.content, data.type, data.target, data.priority, data.expires_at, data.created_by),
    updateAnnouncement: (id, data) => db.prepare(`
        UPDATE announcements SET title=?, content=?, type=?, target=?, priority=?, expires_at=?, is_active=? WHERE id=?
    `).run(data.title, data.content, data.type, data.target, data.priority, data.expires_at, data.is_active, id),
    deleteAnnouncement: (id) => {
        db.prepare('DELETE FROM announcement_reads WHERE announcement_id = ?').run(id);
        db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    },
    toggleAnnouncement: (id) => db.prepare('UPDATE announcements SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id),
    
    // Announcement Reads
    markAnnouncementRead: (announcementId, userId) => db.prepare('INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)').run(announcementId, userId),
    getUnreadAnnouncements: (userId, target = 'all') => db.prepare(`
        SELECT a.* FROM announcements a
        LEFT JOIN announcement_reads ar ON a.id = ar.announcement_id AND ar.user_id = ?
        WHERE a.is_active = 1 
        AND (a.target = 'all' OR a.target = ?)
        AND (a.expires_at IS NULL OR a.expires_at > datetime('now'))
        AND ar.id IS NULL
        ORDER BY a.priority DESC, a.created_at DESC
    `).all(userId, target),
    getAnnouncementReadCount: (announcementId) => db.prepare('SELECT COUNT(*) as count FROM announcement_reads WHERE announcement_id = ?').get(announcementId)?.count || 0,

    // Tickets
    createTicket: (userId, subject, category, priority, message) => {
        const result = db.prepare(`
            INSERT INTO tickets (user_id, subject, category, priority) 
            VALUES (?, ?, ?, ?)
        `).run(userId, subject, category, priority);
        const ticketId = result.lastInsertRowid;
        // Add first message
        db.prepare(`
            INSERT INTO ticket_messages (ticket_id, user_id, message, is_staff) 
            VALUES (?, ?, ?, 0)
        `).run(ticketId, userId, message);
        return ticketId;
    },
    
    getTicket: (id) => db.prepare(`
        SELECT t.*, u.username, u.avatar 
        FROM tickets t 
        LEFT JOIN users u ON t.user_id = u.id 
        WHERE t.id = ?
    `).get(id),
    
    getUserTickets: (userId) => db.prepare(`
        SELECT t.*, 
            (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count,
            (SELECT created_at FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
        FROM tickets t 
        WHERE t.user_id = ? 
        ORDER BY t.updated_at DESC
    `).all(userId),
    
    getAllTickets: (status = null) => {
        if (status) {
            return db.prepare(`
                SELECT t.*, u.username, u.avatar,
                    (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
                FROM tickets t 
                LEFT JOIN users u ON t.user_id = u.id 
                WHERE t.status = ?
                ORDER BY 
                    CASE t.priority 
                        WHEN 'urgent' THEN 1 
                        WHEN 'high' THEN 2 
                        WHEN 'medium' THEN 3 
                        WHEN 'low' THEN 4 
                    END,
                    t.updated_at DESC
            `).all(status);
        }
        return db.prepare(`
            SELECT t.*, u.username, u.avatar,
                (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
            FROM tickets t 
            LEFT JOIN users u ON t.user_id = u.id 
            ORDER BY 
                CASE t.status WHEN 'open' THEN 1 WHEN 'pending' THEN 2 WHEN 'closed' THEN 3 END,
                CASE t.priority 
                    WHEN 'urgent' THEN 1 
                    WHEN 'high' THEN 2 
                    WHEN 'medium' THEN 3 
                    WHEN 'low' THEN 4 
                END,
                t.updated_at DESC
        `).all();
    },
    
    getTicketMessages: (ticketId) => db.prepare(`
        SELECT tm.*, u.username, u.avatar, u.isAdmin
        FROM ticket_messages tm 
        LEFT JOIN users u ON tm.user_id = u.id 
        WHERE tm.ticket_id = ? 
        ORDER BY tm.created_at ASC
    `).all(ticketId),
    
    addTicketMessage: (ticketId, userId, message, isStaff = 0, attachments = null) => {
        const attachmentsJson = attachments ? JSON.stringify(attachments) : null;
        db.prepare(`
            INSERT INTO ticket_messages (ticket_id, user_id, message, is_staff, attachments) 
            VALUES (?, ?, ?, ?, ?)
        `).run(ticketId, userId, message, isStaff, attachmentsJson);
        db.prepare(`UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ticketId);
    },
    
    updateTicketStatus: (ticketId, status, closedBy = null) => {
        if (status === 'closed') {
            db.prepare(`
                UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP, closed_by = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(status, closedBy, ticketId);
        } else {
            db.prepare(`
                UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(status, ticketId);
        }
    },
    
    getTicketStats: () => {
        const open = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'open'").get();
        const pending = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'pending'").get();
        const closed = db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status = 'closed'").get();
        const total = db.prepare("SELECT COUNT(*) as count FROM tickets").get();
        return {
            open: open?.count || 0,
            pending: pending?.count || 0,
            closed: closed?.count || 0,
            total: total?.count || 0
        };
    },
    
    getOpenTicketsCount: () => db.prepare("SELECT COUNT(*) as count FROM tickets WHERE status IN ('open', 'pending')").get()?.count || 0
};

