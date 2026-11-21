const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs-extra');
const { spawn, execSync } = require('child_process');

function getServerPath(serverId, relPath = '') {
    const base = path.join(__dirname, '../../../instances', serverId.toString());
    const full = path.join(base, relPath);
    if (!full.startsWith(base)) throw new Error('Invalid path');
    return full;
}

function getBotCreds(dir) {
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

module.exports = ({ db, io, isAuth }) => {
    router.use('/:id/startup', isAuth, (req, res, next) => {
        const s = db.getServer(req.params.id);
        if (!s) return res.render('errors/error', { code: 404, msg: 'Not Found' });

        if (s.isSuspended && !req.user.isAdmin)
            return res.render('errors/error', { code: 'SUSPENDED', msg: 'Suspended' });

        const collaborators = JSON.parse(s.collaborators || '[]');
        const isOwner = s.ownerId === req.user.id;
        const isCollaborator = collaborators.includes(req.user.id);
        const isAdmin = req.user.isAdmin;

        if (!isOwner && !isCollaborator && !isAdmin)
            return res.render('errors/error', { code: 403, msg: 'Denied' });

        req.server = s;
        req.isOwner = isOwner;
        req.serverNavStyle = db.getConfig('server_nav_style') || 'tabs';
        next();
    });

    router.get('/:id/startup', (req, res) => {
        res.render('server/startup', { s: req.server, serverNavStyle: req.serverNavStyle });
    });

    router.post('/:id/startup/save', (req, res) => {
        try {
            const startupFile = (req.body.startup_file || 'index.js').trim();
            if (startupFile.includes('..') || startupFile.startsWith('/')) {
                return res.status(400).json({ error: 'Invalid startup file path' });
            }
            db.updateStartup(req.server.id, startupFile);

            const targetFile = getServerPath(req.server.id, startupFile);
            if (!fs.existsSync(targetFile)) {
                fs.ensureDirSync(path.dirname(targetFile));
                if (startupFile.endsWith('.py')) {
                    fs.writeFileSync(targetFile, "import time\nprint('✅ Python Server Online!', flush=True)\nwhile True:\n    time.sleep(10)\n");
                } else if (startupFile.endsWith('.js')) {
                    fs.writeFileSync(targetFile, "console.log('✅ Node.js Server Online!');\nsetInterval(() => {}, 10000);\n");
                }
            }

            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to save startup file' });
        }
    });

    router.post('/:id/startup/install', (req, res) => {
        try {
            const pkg = (req.body.pkg || '').trim();
            const manager = (req.body.manager || 'npm').toLowerCase();
            if (!pkg) return res.status(400).json({ error: 'Package name is required' });

            if (!/^[a-zA-Z0-9_@./=<>~^-]+(\s+[a-zA-Z0-9_@./=<>~^-]+)*$/.test(pkg)) {
                return res.status(400).json({ error: 'Invalid package name format' });
            }

            const serverPath = getServerPath(req.server.id);
            const roomId = 's_' + req.server.id;
            const creds = getBotCreds(serverPath);
            const safeEnv = {
                PATH: process.env.PATH,
                HOME: serverPath,
                LANG: process.env.LANG || 'en_US.UTF-8',
                npm_config_yes: 'true',
                npm_config_cache: path.join(serverPath, '.npm_cache')
            };

            const emitLog = (text) => {
                io.to(roomId).emit('log', { msg: text, time: new Date().toISOString() });
            };

            if (manager === 'pip') {
                emitLog('🐍 [Python] Installing pip package: ' + pkg);
                const cmd = `if [ ! -d ".venv" ]; then python3 -m venv .venv; fi && ./.venv/bin/pip install --no-cache-dir ${pkg} && ./.venv/bin/pip freeze > requirements.txt`;
                const p = spawn('bash', ['-c', cmd], { cwd: serverPath, env: safeEnv, ...creds });
                p.stdout.on('data', d => emitLog(d.toString()));
                p.stderr.on('data', d => emitLog(d.toString()));
                p.on('close', (code) => {
                    if (code === 0) emitLog('✅ [Python] Package installed and saved to requirements.txt!');
                    else emitLog('❌ [Python] Installation failed with code: ' + code);
                });
            } else {
                emitLog('📦 [NPM] Installing package: ' + pkg);
                const p = spawn('npm', ['install', ...pkg.split(/\s+/), '--save', '--ignore-scripts'], { cwd: serverPath, env: safeEnv, ...creds });
                p.stdout.on('data', d => emitLog(d.toString()));
                p.stderr.on('data', d => emitLog(d.toString()));
                p.on('close', (code) => {
                    if (code === 0) emitLog('✅ [NPM] Package installed successfully!');
                    else emitLog('❌ [NPM] Installation failed with code: ' + code);
                });
            }

            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to install package' });
        }
    });

    return router;
};

module.exports.path = '/server';

