/**
 * Process Manager with Dashboard Socket
 * Manages server processes and broadcasts stats via Socket.IO
 */

const { spawn, execSync } = require('child_process');
const pidusage = require('pidusage');
const fs = require('fs');
const path = require('path');

// File to store running servers state
const STATE_FILE = path.join(__dirname, '../../data/running_servers.json');

class ProcessManager {
    constructor() {
        this.processes = new Map();
        this.logs = new Map();
        this.stats = new Map();
        this.limits = new Map();
        this.warnings = new Map();
        this.startTimes = new Map(); // Track server start times
        
        // Dashboard socket
        this.dashboardNamespace = null;
        this.userSubscriptions = new Map();
        this.db = null;
        this.io = null;
        
        // Ensure data directory exists
        const dataDir = path.join(__dirname, '../../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    // Save running servers state to file
    _saveRunningState() {
        try {
            const runningServers = Array.from(this.processes.keys());
            fs.writeFileSync(STATE_FILE, JSON.stringify(runningServers, null, 2));
        } catch (err) {
            console.error('[ProcessManager] Failed to save running state:', err.message);
        }
    }

    // Load and restore running servers on startup
    async autoStartServers(io, db) {
        this.io = io;
        this.db = db;
        
        try {
            if (!fs.existsSync(STATE_FILE)) {
                console.log('[AutoStart] No previous state found');
                return;
            }
            
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            const serverIds = JSON.parse(data);
            
            if (!Array.isArray(serverIds) || serverIds.length === 0) {
                console.log('[AutoStart] No servers to restore');
                return;
            }
            
            console.log(`[AutoStart] Restoring ${serverIds.length} server(s)...`);
            
            for (const serverId of serverIds) {
                const server = db.getServer(serverId);
                if (server && !server.isSuspended) {
                    console.log(`[AutoStart] Starting server: ${server.name} (ID: ${serverId})`);
                    // Small delay between starts to avoid overload
                    await new Promise(resolve => setTimeout(resolve, 500));
                    this.start(server, io);
                } else if (server && server.isSuspended) {
                    console.log(`[AutoStart] Skipping suspended server: ${server.name} (ID: ${serverId})`);
                } else {
                    console.log(`[AutoStart] Server not found: ${serverId}`);
                }
            }
            
            console.log('[AutoStart] Restoration complete');
        } catch (err) {
            console.error('[AutoStart] Failed to restore servers:', err.message);
        }
    }

    // Initialize dashboard socket
    initDashboardSocket(io, db) {
        this.db = db;
        this.dashboardNamespace = io.of('/dashboard');
        
        this.dashboardNamespace.on('connection', (socket) => {
            const userId = socket.handshake.query.userId;
            const isAdmin = socket.handshake.query.isAdmin === 'true';
            
            if (!userId) {
                socket.disconnect();
                return;
            }
            
            console.log(`[Dashboard] User ${userId} connected`);
            
            // Store subscription
            this.userSubscriptions.set(socket.id, {
                userId,
                isAdmin,
                viewingAll: false
            });
            
            // Join user's room
            socket.join(`user:${userId}`);
            
            // Send initial stats
            this._sendUserStats(socket, userId);
            
            // Handle view mode change (admin only)
            socket.on('setViewMode', (mode) => {
                const sub = this.userSubscriptions.get(socket.id);
                if (sub && sub.isAdmin) {
                    sub.viewingAll = mode === 'all';
                    this.userSubscriptions.set(socket.id, sub);
                    
                    if (sub.viewingAll) {
                        socket.join('admin:all');
                        this._sendAllStats(socket);
                    } else {
                        socket.leave('admin:all');
                        this._sendUserStats(socket, userId);
                    }
                }
            });
            
            // Handle stats refresh request
            socket.on('requestStats', () => {
                const sub = this.userSubscriptions.get(socket.id);
                if (sub) {
                    if (sub.viewingAll && sub.isAdmin) {
                        this._sendAllStats(socket);
                    } else {
                        this._sendUserStats(socket, sub.userId);
                    }
                }
            });
            
            socket.on('disconnect', () => {
                console.log(`[Dashboard] User ${userId} disconnected`);
                this.userSubscriptions.delete(socket.id);
            });
        });
    }

    // Send stats for user's servers
    _sendUserStats(socket, userId) {
        if (!this.db) return;
        try {
            const servers = this.db.getUserServers(userId);
            const stats = {};
            
            for (const server of servers) {
                stats[server.id] = {
                    running: this.isRunning(server.id),
                    stats: this.getStats(server.id)
                };
            }
            
            socket.emit('statsUpdate', stats);
        } catch (err) {
            console.error('[Dashboard] Error sending user stats:', err);
        }
    }

    // Send stats for all servers (admin)
    _sendAllStats(socket) {
        if (!this.db) return;
        try {
            const allServers = this.db.getAllServers();
            const stats = {};
            
            for (const server of allServers) {
                stats[server.id] = {
                    running: this.isRunning(server.id),
                    stats: this.getStats(server.id)
                };
            }
            
            socket.emit('allStatsUpdate', stats);
        } catch (err) {
            console.error('[Dashboard] Error sending all stats:', err);
        }
    }

    // Broadcast stats to dashboard users
    _broadcastToDashboard(allStats) {
        if (!this.dashboardNamespace || !this.db) return;
        
        const userServerMap = new Map();
        const adminsViewingAll = new Set();
        
        for (const [socketId, sub] of this.userSubscriptions) {
            if (sub.viewingAll && sub.isAdmin) {
                adminsViewingAll.add(sub.userId);
            } else {
                if (!userServerMap.has(sub.userId)) {
                    try {
                        const servers = this.db.getUserServers(sub.userId);
                        userServerMap.set(sub.userId, servers.map(s => s.id));
                    } catch (e) {
                        userServerMap.set(sub.userId, []);
                    }
                }
            }
        }
        
        // Send to users viewing their own servers
        for (const [userId, serverIds] of userServerMap) {
            const userStats = {};
            for (const serverId of serverIds) {
                if (allStats[serverId]) {
                    userStats[serverId] = allStats[serverId];
                } else {
                    userStats[serverId] = {
                        running: this.isRunning(serverId),
                        stats: this.getStats(serverId)
                    };
                }
            }
            
            if (Object.keys(userStats).length > 0) {
                this.dashboardNamespace.to(`user:${userId}`).emit('statsUpdate', userStats);
            }
        }
        
        // Send to admins viewing all
        if (adminsViewingAll.size > 0) {
            try {
                const allServers = this.db.getAllServers();
                const fullStats = {};
                
                for (const server of allServers) {
                    if (allStats[server.id]) {
                        fullStats[server.id] = allStats[server.id];
                    } else {
                        fullStats[server.id] = {
                            running: this.isRunning(server.id),
                            stats: this.getStats(server.id)
                        };
                    }
                }
                
                this.dashboardNamespace.to('admin:all').emit('allStatsUpdate', fullStats);
            } catch (err) {}
        }
    }

    // Kernel-level isolation: get unprivileged 'xeobot' UID/GID if panel runs as root
    _getBotCredentials(dir) {
        try {
            if (process.getuid && process.getuid() === 0) {
                const uid = parseInt(execSync('id -u xeobot 2>/dev/null').toString().trim());
                const gid = parseInt(execSync('id -g xeobot 2>/dev/null').toString().trim());
                if (!isNaN(uid) && !isNaN(gid)) {
                    execSync(`chown -R xeobot:xeobot ${JSON.stringify(dir)} && chmod 700 ${JSON.stringify(dir)}`);
                    return { uid, gid };
                }
            }
        } catch (e) {}
        return {};
    }

    _getSafeBotEnv(dir) {
        return {
            PATH: process.env.PATH,
            HOME: dir,
            LANG: process.env.LANG || 'en_US.UTF-8',
            FORCE_COLOR: '1',
            PYTHONUNBUFFERED: '1',
            NODE_ENV: 'production',
             npm_config_cache: path.join(dir, '.npm_cache')
        };
    }

    // Normalize ID to number
    _normalizeId(id) {
        return typeof id === 'number' ? id : parseInt(id);
    }

    start(server, io) {
        const serverId = this._normalizeId(server.id);
        if (this.processes.has(serverId)) return;

        const dir = path.join(__dirname, '../../instances', serverId.toString());
        const entry = server.startup_file || 'index.js';

        const fullEntryPath = path.resolve(dir, entry);
        if (!fullEntryPath.startsWith(path.resolve(dir))) {
            this.pushLog(serverId, io, '❌ Security Error: Invalid startup file path.');
            return;
        }

        if (!fs.existsSync(fullEntryPath)) {
            this.pushLog(serverId, io, '❌ Critical: File "' + entry + '" not found!');
            return;
        }

        // Store resource limits
        this.limits.set(serverId, {
            ram: server.ram || 512,
            cpu: server.cpu || 50,
            disk: server.disk || 1024
        });
        this.warnings.set(serverId, 0);

        const limits = this.limits.get(serverId);
        
        const ext = path.extname(entry).toLowerCase();

        // === PYTHON SUPPORT (.py) ===
        if (ext === '.py') {
            const venvDir = path.join(dir, '.venv');
            const venvPython = path.join(venvDir, 'bin', 'python3');
            const venvPip = path.join(venvDir, 'bin', 'pip');
            const reqPath = path.join(dir, 'requirements.txt');

            const runPythonBot = () => {
                if (fs.existsSync(reqPath)) {
                    this.pushLog(serverId, io, '\n🐍 [Python] Installing requirements.txt...');
                    io.to('s_' + serverId).emit('status', 'installing');
                    const creds = this._getBotCredentials(dir);
                    const pipProc = spawn(venvPip, ['install', '--no-cache-dir', '-r', 'requirements.txt'], {
                        cwd: dir,
                        env: this._getSafeBotEnv(dir),
                        ...creds,
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    pipProc.stdout.on('data', d => this.pushLog(serverId, io, d.toString()));
                    pipProc.stderr.on('data', d => this.pushLog(serverId, io, d.toString()));
                    pipProc.on('close', (code) => {
                        if (code === 0) {
                            this.pushLog(serverId, io, '✅ [Python] Requirements installed successfully!');
                            this._startProcess(server, io, serverId, dir, entry, limits);
                        } else {
                            this.pushLog(serverId, io, '❌ [Python] Failed to install requirements.txt (Code: ' + code + ')');
                            io.to('s_' + serverId).emit('status', 'offline');
                        }
                    });
                    return;
                }
                this._startProcess(server, io, serverId, dir, entry, limits);
            };

            if (!fs.existsSync(venvPython)) {
                this.pushLog(serverId, io, '\n🐍 [Python] Creating isolated Python virtual environment (.venv)...');
                io.to('s_' + serverId).emit('status', 'installing');
                const creds = this._getBotCredentials(dir);
                const venvProc = spawn('python3', ['-m', 'venv', '.venv'], {
                    cwd: dir,
                    env: this._getSafeBotEnv(dir),
                    ...creds,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                venvProc.stdout.on('data', d => this.pushLog(serverId, io, d.toString()));
                venvProc.stderr.on('data', d => this.pushLog(serverId, io, d.toString()));
                venvProc.on('close', (code) => {
                    if (code === 0) {
                        this.pushLog(serverId, io, '✅ [Python] Environment ready!');
                        runPythonBot();
                    } else {
                        this.pushLog(serverId, io, '❌ [Python] Failed to create venv (Code: ' + code + ')');
                        io.to('s_' + serverId).emit('status', 'offline');
                    }
                });
                return;
            } else {
                runPythonBot();
                return;
            }
        }

        // Check if package.json exists and install dependencies first
        const packageJsonPath = path.join(dir, 'package.json');
        const nodeModulesPath = path.join(dir, 'node_modules');
        
        if (fs.existsSync(packageJsonPath)) {
            // Security check: Remove dangerous scripts from package.json
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                let modified = false;
                
                // List of dangerous scripts that could execute malicious code
                const dangerousScripts = [
                    'preinstall', 'install', 'postinstall',
                    'preuninstall', 'uninstall', 'postuninstall',
                    'prepublish', 'prepublishOnly', 'publish', 'postpublish',
                    'prepack', 'pack', 'postpack',
                    'prepare', 'preshrinkwrap', 'shrinkwrap', 'postshrinkwrap'
                ];
                
                if (packageJson.scripts) {
                    for (const script of dangerousScripts) {
                        if (packageJson.scripts[script]) {
                            delete packageJson.scripts[script];
                            modified = true;
                            this.pushLog(serverId, io, `⚠️ [Security] Removed dangerous script: "${script}"`);
                        }
                    }
                }
                
                // Save cleaned package.json if modified
                if (modified) {
                    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
                    this.pushLog(serverId, io, '🛡️ [Security] package.json sanitized');
                }
            } catch (err) {
                this.pushLog(serverId, io, '⚠️ [Warning] Could not parse package.json: ' + err.message);
            }
            
            // Check if node_modules exists and has packages
            // Also check if package-lock.json changed (dependencies updated)
            let needsInstall = !fs.existsSync(nodeModulesPath);
            
            // Even if node_modules exists, check if it's empty or missing key packages
            if (!needsInstall) {
                try {
                    const nodeModulesContent = fs.readdirSync(nodeModulesPath);
                    // If node_modules is empty or only has .bin folder
                    if (nodeModulesContent.length === 0 || 
                        (nodeModulesContent.length === 1 && nodeModulesContent[0] === '.bin')) {
                        needsInstall = true;
                    }
                    
                    // Check if dependencies in package.json are actually installed
                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                    const deps = { ...packageJson.dependencies };
                    
                    for (const dep of Object.keys(deps)) {
                        const depPath = path.join(nodeModulesPath, dep);
                        if (!fs.existsSync(depPath)) {
                            needsInstall = true;
                            this.pushLog(serverId, io, `📦 [System] Missing package: ${dep}`);
                            break;
                        }
                    }
                } catch (err) {
                    // If we can't read, assume we need to install
                    needsInstall = true;
                }
            }
            
            if (needsInstall) {
                this.pushLog(serverId, io, '\n📦 [System] Installing dependencies...');
                io.to('s_' + serverId).emit('status', 'installing');
                
                // Use --ignore-scripts to prevent any script execution during install
                const creds = this._getBotCredentials(dir);
                const npmInstall = spawn('npm', ['install', '--production', '--ignore-scripts'], {
                    cwd: dir,
                    env: this._getSafeBotEnv(dir),
                    ...creds,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                npmInstall.stdout.on('data', d => this.pushLog(serverId, io, d.toString()));
                npmInstall.stderr.on('data', d => this.pushLog(serverId, io, d.toString()));
                
                npmInstall.on('close', (code) => {
                    if (code === 0) {
                        this.pushLog(serverId, io, '✅ [System] Dependencies installed successfully!');
                        // Now start the actual server
                        this._startProcess(server, io, serverId, dir, entry, limits);
                    } else {
                        this.pushLog(serverId, io, '❌ [System] Failed to install dependencies (Code: ' + code + ')');
                        io.to('s_' + serverId).emit('status', 'offline');
                    }
                });
                
                npmInstall.on('error', (err) => {
                    this.pushLog(serverId, io, '❌ [System] npm install error: ' + err.message);
                    io.to('s_' + serverId).emit('status', 'offline');
                });
                
                return; // Exit here, _startProcess will be called after npm install
            }
        }
        
        // No package.json or node_modules already exists, start directly
        this._startProcess(server, io, serverId, dir, entry, limits);
    }
    
    _startProcess(server, io, serverId, dir, entry, limits) {
        this.pushLog(serverId, io, '\n🟢 [System] Booting ' + server.name + '...');
        this.pushLog(serverId, io, `📊 [Limits] RAM: ${limits.ram}MB | CPU: ${limits.cpu}% | Disk: ${limits.disk}MB`);
        
        // Save start time
        const startTime = Date.now();
        this.startTimes.set(serverId, startTime);
        
        // Send status with start time
        io.to('s_' + serverId).emit('status', { status: 'online', startTime: startTime });

        try {
            const maxMemoryMB = limits.ram;
            const ext = path.extname(entry).toLowerCase();
            let cmd = process.execPath;
            let args = [`--max-old-space-size=${maxMemoryMB}`, entry];

            if (ext === '.py') {
                const venvPython = path.join(dir, '.venv', 'bin', 'python3');
                cmd = fs.existsSync(venvPython) ? venvPython : 'python3';
                args = ['-u', entry];
                this.pushLog(serverId, io, '🐍 [Runtime] Starting with Python 3...');
            } else if (ext === '.sh') {
                cmd = 'bash';
                args = [entry];
                this.pushLog(serverId, io, '🐚 [Runtime] Starting with Bash...');
            } else if (ext === '.ts') {
                cmd = 'npx';
                args = ['tsx', entry];
                this.pushLog(serverId, io, '📘 [Runtime] Starting with TypeScript (tsx)...');
            } else {
                this.pushLog(serverId, io, '🟢 [Runtime] Starting with Node.js...');
            }

            const creds = this._getBotCredentials(dir);
            const child = spawn(cmd, args, {
                cwd: dir,
                env: this._getSafeBotEnv(dir),
                ...creds,
                stdio: ['pipe', 'pipe', 'pipe'] // Enable stdin, stdout, stderr
            });

            this.processes.set(serverId, child);
            
            // Save running state
            this._saveRunningState();

            child.stdout.on('data', d => this.pushLog(serverId, io, d.toString()));
            child.stderr.on('data', d => this.pushLog(serverId, io, d.toString()));

            child.on('close', (code) => {
                this.processes.delete(serverId);
                this.limits.delete(serverId);
                this.warnings.delete(serverId);
                this.startTimes.delete(serverId);
                io.to('s_' + serverId).emit('status', { status: 'offline' });
                this.pushLog(serverId, io, '\n🔴 [System] Server exited (Code: ' + code + ')');
                
                // Save running state
                this._saveRunningState();
                
                // Notify dashboard about server stop
                this._notifyServerStateChange(serverId, false);
            });
            
            // Notify dashboard about server start
            this._notifyServerStateChange(serverId, true);

        } catch (e) {
            this.pushLog(serverId, io, '❌ Spawn Error: ' + e.message);
        }
    }

    stop(serverId, io, removeFromAutoStart = true) {
        const id = this._normalizeId(serverId);
        const child = this.processes.get(id);
        if (child) {
            try { process.kill(child.pid); } catch(e){}
            this.processes.delete(id);
            this.startTimes.delete(id);
            io.to('s_' + id).emit('status', { status: 'offline' });
            this.pushLog(id, io, '\n🔴 [System] Process Killed.');
            
            // Save running state (remove from auto-start if manually stopped)
            if (removeFromAutoStart) {
                this._saveRunningState();
            }
            
            // Notify dashboard
            this._notifyServerStateChange(id, false);
        }
    }

    restart(server, io) {
        const serverId = this._normalizeId(server.id);
        // Don't remove from auto-start on restart
        this.stop(serverId, io, false);
        setTimeout(() => this.start(server, io), 1000);
    }

    // Send command to process stdin
    sendCommand(serverId, command, io) {
        const id = this._normalizeId(serverId);
        const child = this.processes.get(id);
        
        if (!child) {
            return { success: false, error: 'Server is not running' };
        }
        
        if (!child.stdin || !child.stdin.writable) {
            return { success: false, error: 'Cannot write to process stdin' };
        }
        
        try {
            // Write command to stdin with newline
            child.stdin.write(command + '\n');
            this.pushLog(id, io, `> ${command}`);
            return { success: true };
        } catch (err) {
            return { success: false, error: 'Failed to send command: ' + err.message };
        }
    }

    // Notify dashboard about server state change
    _notifyServerStateChange(serverId, running) {
        if (!this.dashboardNamespace || !this.db) return;
        
        const server = this.db.getServer(serverId);
        if (!server) return;
        
        const update = {
            [serverId]: {
                running: running,
                stats: this.getStats(serverId)
            }
        };
        
        // Notify owner
        this.dashboardNamespace.to(`user:${server.ownerId}`).emit('statsUpdate', update);
        
        // Notify admins viewing all
        this.dashboardNamespace.to('admin:all').emit('allStatsUpdate', update);
    }

    pushLog(serverId, io, msg) {
        const id = this._normalizeId(serverId);
        if (!this.logs.has(id)) this.logs.set(id, []);
        const history = this.logs.get(id);
        const cleanMsg = msg.replace(/\n$/, '');
        const timestamp = new Date().toISOString();
        const logEntry = { msg: cleanMsg, time: timestamp };
        history.push(logEntry);
        if (history.length > 50) history.shift();
        io.to('s_' + id).emit('log', logEntry);
    }

    getHistory(serverId) { 
        const id = this._normalizeId(serverId);
        return this.logs.get(id) || []; 
    }

    clearHistory(serverId) {
        const id = this._normalizeId(serverId);
        this.logs.set(id, []);
    }
    
    getServerState(serverId) {
        const id = this._normalizeId(serverId);
        return {
            running: this.processes.has(id),
            stats: this.stats.get(id) || null,
            history: this.logs.get(id) || [],
            startTime: this.startTimes.get(id) || null
        };
    }

    async broadcastStats(io) {
        const allStats = {};
        
        for (const [id, child] of this.processes) {
            try {
                const stats = await pidusage(child.pid);
                const cpuUsage = parseFloat(stats.cpu.toFixed(1));
                const ramUsage = parseFloat((stats.memory / 1024 / 1024).toFixed(1));
                
                const formattedStats = { 
                    cpu: cpuUsage.toString(), 
                    ram: ramUsage.toString() 
                };
                this.stats.set(id, formattedStats);
                
                // Send to server console
                io.to('s_' + id).emit('stats', formattedStats);
                
                // Collect for dashboard
                allStats[id] = {
                    running: true,
                    stats: formattedStats
                };

                // Check limits
                const limits = this.limits.get(id);
                if (limits) {
                    const ramLimit = limits.ram;
                    const cpuLimit = limits.cpu;
                    let warnings = this.warnings.get(id) || 0;

                    if (ramUsage > ramLimit) {
                        warnings++;
                        this.warnings.set(id, warnings);
                        
                        if (warnings >= 3) {
                            this.pushLog(id, io, `\n⚠️ [LIMIT] RAM exceeded! Using ${ramUsage}MB / ${ramLimit}MB - Stopping server...`);
                            this.stop(id, io);
                            continue;
                        } else {
                            this.pushLog(id, io, `⚠️ [WARNING] RAM high: ${ramUsage}MB / ${ramLimit}MB (${warnings}/3 warnings)`);
                        }
                    }
                    
                    if (cpuUsage > cpuLimit * 2) {
                        this.pushLog(id, io, `⚠️ [WARNING] CPU very high: ${cpuUsage}% / ${cpuLimit}%`);
                    }
                    
                    if (ramUsage <= ramLimit && cpuUsage <= cpuLimit) {
                        this.warnings.set(id, 0);
                    }
                }
            } catch (e) {
                this.stats.delete(id);
            }
        }
        
        // Broadcast to dashboard
        if (Object.keys(allStats).length > 0 || this.userSubscriptions.size > 0) {
            this._broadcastToDashboard(allStats);
        }
    }

    getStats(serverId) {
        const id = this._normalizeId(serverId);
        return this.stats.get(id) || null;
    }

    getMultipleStats(serverIds) {
        const result = {};
        for (const sid of serverIds) {
            const id = this._normalizeId(sid);
            result[id] = this.stats.get(id) || null;
        }
        return result;
    }

    isRunning(serverId) {
        const id = this._normalizeId(serverId);
        return this.processes.has(id);
    }
}

module.exports = new ProcessManager();

