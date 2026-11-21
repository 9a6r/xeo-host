process.noDeprecation = true;
console.clear();

require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');

const { Server } = require('socket.io');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs-extra');


const db = require('./database/db');
const procMgr = require('./sockets/processManager');
const { loadRoutes } = require('./handlers/routeHandler');
const pluginHandler = require('./handlers/pluginHandler');

// Helper function to check if user is a super admin (supports multiple IDs separated by comma)
const getAdminIds = () => (process.env.ADMIN_ID || '').split(',').map(id => id.trim()).filter(id => id);
const isSuperAdmin = (userId) => getAdminIds().includes(userId);

const getClientIp = (req) => {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (xff) return xff.split(',')[0].trim();
    return (req.socket?.remoteAddress || '').replace('::ffff:', '');
};

const parseCookies = (req) => {
    const list = {};
    const rc = req.headers.cookie;
    if (rc) {
        rc.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            const k = parts.shift().trim();
            const v = parts.join('=');
            if (k) list[k] = decodeURIComponent(v || '');
        });
    }
    return list;
};

const app = express();

let server;

const certPath = process.env.CF_CERT_PATH || "./cloudflare/cert.pem";
const keyPath = process.env.CF_KEY_PATH || "./cloudflare/key.pem";
if (process.env.USE_HTTPS === 'true' && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const httpsOptions = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
    };
    server = https.createServer(httpsOptions, app);
    console.log('[SYSTEM] HTTPS enabled using Cloudflare Origin Certificate');
} else {
    if (process.env.USE_HTTPS === 'true') {
        console.warn('[SYSTEM] ⚠️ USE_HTTPS is true but certificate files were not found. Falling back to HTTP.');
    }
    server = http.createServer(app);
    console.log('[SYSTEM] Running on HTTP');
}
const io = new Server(server, { cors: { origin: "*" } });

// Session middleware (shared with Socket.io)
const sessionMiddleware = session({ 
    secret: process.env.SESSION_SECRET, 
    resave: false, 
    saveUninitialized: false 
});

// Auth
passport.serializeUser((u, d) => d(null, u.id));
passport.deserializeUser((id, d) => d(null, db.getUser(id)));
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify']
}, (a, r, p, d) => {
    try {
        let u = db.createUser(p);
        if(isSuperAdmin(p.id)) { db.setAdmin(p.id, 1); u.isAdmin=1; }
        return d(null, u);
    } catch(e) { return d(e, null); }
}));

app.use(sessionMiddleware);

// Share session with Socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../data/uploads')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.sitename = db.getConfig('sitename');
    res.locals.siteLogo = db.getConfig('site_logo') || '';
    res.locals.superAdmins = getAdminIds();
    res.locals.isSuperAdmin = isSuperAdmin;

    const ip = getClientIp(req);
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        db.updateUserIp(req.user.id, ip);
    }

    // Check Account & IP Ban (Allow /login and /auth/discord so Admin can always log in)
    const isAdminLoginPath = req.path === '/login' || req.path.startsWith('/auth/discord') || req.path === '/auth/local/login' || req.path === '/logout';
    if (!isAdminLoginPath) {
        const userId = (req.isAuthenticated && req.isAuthenticated() && req.user) ? req.user.id : null;
        if (!userId || !isSuperAdmin(userId)) {
            const banCheck = db.checkBanStatus(ip, userId);
            if (banCheck.banned) {
                return res.status(403).render('errors/error', {
                    code: 'BANNED',
                    msg: 'Account Suspended',
                    reason: banCheck.reason
                });
            }
        }
    }

    // Maintenance Check
    const isMaint = db.getConfig('maintenance') === 'true';
    if (isMaint && !req.path.startsWith('/auth') && !req.path.startsWith('/login') && !req.path.startsWith('/admin')) {
        if (req.isAuthenticated() && req.user.isAdmin) return next();
        return res.render('maintenance');
    }
    next();
});

const isAuth = (req, res, next) => req.isAuthenticated() ? (req.user.isBanned ? res.render('errors/error', {code:'BANNED', msg:'Account Suspended', reason: req.user.banReason}) : next()) : res.redirect('/');
const isAdmin = (req, res, next) => (req.isAuthenticated() && req.user.isAdmin) ? next() : res.render('errors/error', {code:403, msg:'Access Denied'});

// تحميل المسارات تلقائياً باستخدام fast-glob
async function initRoutes() {
    // تهيئة نظام الإضافات
    await pluginHandler.init(app, {
        db,
        io,
        middlewares: { isAuth, isAdmin, passport }
    });

    // إضافة middleware للثيمات والبلقنات - يحقن السكريبتات تلقائياً
    app.use((req, res, next) => {
        res.locals.themeCSS = pluginHandler.getThemeCSS();
        res.locals.activeTheme = pluginHandler.activeTheme;
        res.locals.pluginHandler = pluginHandler;
        
        // Add open tickets count for admin sidebar
        if (req.isAuthenticated() && req.user.isAdmin) {
            res.locals.openTickets = db.getOpenTicketsCount();
        }
        
        // حفظ الدالة الأصلية للـ render
        const originalRender = res.render.bind(res);
        
        res.render = function(view, options = {}, callback) {
            // جمع كل السكريبتات من البلقنات المفعلة
            let pluginScripts = '';
            let pluginStyles = '';
            
            // الحصول على سكريبتات البلقنات
            for (const plugin of pluginHandler.getAllPlugins()) {
                if (plugin.enabled && plugin.module) {
                    // إذا كان البلقن يحتوي على دالة getScript
                    if (typeof plugin.module.getScript === 'function') {
                        pluginScripts += plugin.module.getScript(plugin.settings) || '';
                    }
                    // دعم الاسم القديم getSnowScript للتوافقية
                    if (typeof plugin.module.getSnowScript === 'function') {
                        pluginScripts += plugin.module.getSnowScript(plugin.settings) || '';
                    }
                    // إذا كان البلقن يحتوي على دالة getStyles
                    if (typeof plugin.module.getStyles === 'function') {
                        pluginStyles += plugin.module.getStyles(plugin.settings) || '';
                    }
                }
            }
            
            // إضافة السكريبتات والستايلات للـ options
            options.pluginScripts = pluginScripts;
            options.pluginStyles = pluginStyles;
            options.themeCSS = res.locals.themeCSS;
            options.pluginHandler = pluginHandler;
            
            // استدعاء الدالة الأصلية
            originalRender(view, options, callback);
        };
        
        next();
    });

    await loadRoutes(app, {
        routesDir: path.join(__dirname, 'routes'),
        middlewares: { isAuth, isAdmin, passport },
        dependencies: { db, io, procMgr, pluginHandler }
    });
    
    // 404 Handler - يجب أن يكون في النهاية
    app.use((req, res) => res.status(404).render('errors/error', { code: 404, msg: 'Page Not Found' }));
}

// Helper to verify socket user has permission to access serverId
function socketCanAccessServer(socket, serverId) {
    const userId = socket.request?.session?.passport?.user;
    if (!userId) return false;
    const user = db.getUser(userId);
    if (!user || user.isBanned) return false;
    if (user.isAdmin || isSuperAdmin(user.id)) return true;
    const srv = db.getServer(serverId);
    if (!srv) return false;
    const collabs = JSON.parse(srv.collaborators || '[]');
    return srv.ownerId === user.id || collabs.includes(user.id);
}

// Socket.io - Server Console
io.on('connection', s => { 
    s.on('join', id => { 
        const serverId = parseInt(id);
        if (!socketCanAccessServer(s, serverId)) return;
        s.join('s_'+serverId); 
        
        const state = procMgr.getServerState(serverId);
        console.log(`[Socket] User joined server ${serverId}, history: ${state.history.length} logs`);
        
        // Send status with startTime if running
        if (state.running) {
            s.emit('status', { status: 'online', startTime: state.startTime });
        } else {
            s.emit('status', { status: 'offline' });
        }
        if (state.stats) s.emit('stats', state.stats);
        state.history.forEach(l => s.emit('log', l)); 
    });
    
    // Handle command input from console
    s.on('command', (data) => {
        const { serverId, command } = data;
        if (!serverId || !command) return;
        
        const id = parseInt(serverId);
        if (!socketCanAccessServer(s, id)) return;
        
        // Check if console commands are enabled
        const consoleConfig = db.getConfig('console_commands');
        const consoleCommandsEnabled = consoleConfig === 'true' || consoleConfig === true;
        
        if (consoleCommandsEnabled) {
            // Commands enabled - send to process stdin
            const result = procMgr.sendCommand(id, command, io);
            if (!result.success) {
                s.emit('commandResponse', { error: result.error });
            }
        } else {
            // Commands disabled - just log the text (don't execute)
            procMgr.pushLog(id, io, `[User Input] ${command}`);
        }
    });
    
    // Handle console clear via socket
    s.on('clearConsole', (data) => {
        const { serverId } = data;
        if (!serverId) return;
        
        const id = parseInt(serverId);
        procMgr.clearHistory(id);
        
        // Notify all clients in this server room that console was cleared
        io.to(`server-${id}`).emit('consoleCleared');
    });
});

// Socket.io - Ticket System
require('./sockets/ticketSocket')(io, db);

// Initialize Dashboard Socket in ProcessManager
procMgr.initDashboardSocket(io, db);

// Auto-start servers that were running before shutdown
procMgr.autoStartServers(io, db);

// Broadcast stats every 2 seconds
setInterval(() => procMgr.broadcastStats(io), 2000);

// Network Config & Server Start
let netConf = { ip: '0.0.0.0', port: process.env.PORT || 3000 };
try {
    if(fs.existsSync(path.join(__dirname, '../network.json'))) {
        const raw = fs.readFileSync(path.join(__dirname, '../network.json'));
        netConf = JSON.parse(raw);
    }
} catch(e) { console.error('Network Config Error:', e.message); }

// تهيئة المسارات ثم تشغيل السيرفر
initRoutes().then(() => {
    server.listen(netConf.port, netConf.ip, () => {
        console.log('\x1b[36m╔════════════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[36m║           \x1b[1m\x1b[35mX E O   S T U D I O\x1b[0m              ║\x1b[36m║\x1b[0m');
        console.log('\x1b[36m║      \x1b[33mBy Xeo Studio (Legendary & Ali)\x1b[0m      ║\x1b[36m║\x1b[0m');
        console.log('\x1b[36m╚════════════════════════════════════════════╝\x1b[0m');
        console.log('');
console.log(`\x1b[32m[SYSTEM] ✅ Server Online at ${process.env.USE_HTTPS === 'true' ? 'https' : 'http'}://${netConf.ip}:${netConf.port}\x1b[0m`);
        console.log('\x1b[34m[INFO]   🔗 Support: https://discord.gg/8QRmF2Ae2m\x1b[0m');
    });
});


