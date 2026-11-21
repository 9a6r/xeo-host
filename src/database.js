const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'core.db'));
db.pragma('journal_mode = WAL'); // Performance

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
    CREATE TABLE IF NOT EXISTS user_resources (
        user_id TEXT PRIMARY KEY,
        ram INTEGER DEFAULT 0,
        cpu INTEGER DEFAULT 0,
        disk INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`);

// Add columns if they don't exist (for existing databases)
try { db.exec('ALTER TABLE servers ADD COLUMN ram INTEGER DEFAULT 512'); } catch(e) {}
try { db.exec('ALTER TABLE servers ADD COLUMN cpu INTEGER DEFAULT 50'); } catch(e) {}
try { db.exec('ALTER TABLE servers ADD COLUMN disk INTEGER DEFAULT 1024'); } catch(e) {}

// Defaults
const setConf = (k, v) => db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)").run(k, v);
setConf('price', '5');
setConf('sitename', 'XeoStudio');

module.exports = {
    db,
    // Users
    getUser: (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id),
    createUser: (p) => {
        db.prepare('INSERT OR IGNORE INTO users (id,username,avatar) VALUES (?,?,?)').run(p.id, p.username, p.avatar);
        db.prepare('UPDATE users SET username=?, avatar=? WHERE id=?').run(p.username, p.avatar, p.id);
        return db.prepare('SELECT * FROM users WHERE id=?').get(p.id);
    },
    updateCoins: (id, val) => db.prepare('UPDATE users SET coins = coins + ? WHERE id=?').run(val, id),
    setCoins: (id, val) => db.prepare('UPDATE users SET coins = ? WHERE id=?').run(val, id),
    setAdmin: (id, val) => db.prepare('UPDATE users SET isAdmin = ? WHERE id=?').run(val, id),
    setBan: (id, val, r) => db.prepare('UPDATE users SET isBanned=?, banReason=? WHERE id=?').run(val, r||null, id),
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
        
        // Check if user already redeemed this code
        const alreadyRedeemed = db.prepare('SELECT * FROM code_redemptions WHERE code_id = ? AND user_id = ?').get(codeData.id, userId);
        if (alreadyRedeemed) return { success: false, error: 'You have already redeemed this code' };
        
        // Redeem the code
        db.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').run(codeData.id);
        db.prepare('INSERT INTO code_redemptions (code_id, user_id) VALUES (?, ?)').run(codeData.id, userId);
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(codeData.coins, userId);
        
        // Log transaction
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
    }
};