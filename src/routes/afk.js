const express = require('express');
const router = express.Router();

// Track last claim timestamp per user in memory to prevent spam/exploit
const lastClaimTime = new Map();

module.exports = ({ db, isAuth }) => {
    function getAfkSettings() {
        return {
            enabled: db.getConfig('afk_enabled') !== 'false',
            coins: parseInt(db.getConfig('afk_coins')) || 1,
            interval: parseInt(db.getConfig('afk_interval')) || 60,
            maxDaily: parseInt(db.getConfig('afk_max_daily')) || 0
        };
    }

    function getTodayKey() {
        return new Date().toISOString().split('T')[0];
    }

    function getDailyEarned(userId) {
        const key = `afk_daily_${userId}_${getTodayKey()}`;
        return parseInt(db.getConfig(key)) || 0;
    }

    function setDailyEarned(userId, amount) {
        const key = `afk_daily_${userId}_${getTodayKey()}`;
        db.setConfig(key, String(amount));
    }

    router.get('/afk', isAuth, (req, res) => {
        const settings = getAfkSettings();
        if (!settings.enabled) {
            return res.redirect('/dashboard?error=AFK rewards are currently disabled');
        }
        const dailyEarned = getDailyEarned(req.user.id);
        res.render('afk', {
            settings,
            dailyEarned,
            page: 'afk'
        });
    });

    router.post('/afk/claim', isAuth, (req, res) => {
        try {
            const settings = getAfkSettings();
            if (!settings.enabled) {
                return res.json({ success: false, error: 'disabled' });
            }

            // Server-side cooldown check (allow 2s network grace)
            const now = Date.now();
            const last = lastClaimTime.get(req.user.id) || 0;
            const minWaitMs = Math.max(5, settings.interval - 2) * 1000;
            if (now - last < minWaitMs) {
                return res.json({ success: false, error: 'cooldown' });
            }

            const dailyEarned = getDailyEarned(req.user.id);
            if (settings.maxDaily > 0 && dailyEarned >= settings.maxDaily) {
                return res.json({ success: false, error: 'daily_limit' });
            }

            let coinsToGive = settings.coins;
            if (settings.maxDaily > 0) {
                const remaining = settings.maxDaily - dailyEarned;
                coinsToGive = Math.min(coinsToGive, remaining);
            }

            if (coinsToGive <= 0) {
                return res.json({ success: false, error: 'daily_limit' });
            }

            lastClaimTime.set(req.user.id, now);
            db.updateCoins(req.user.id, coinsToGive);
            setDailyEarned(req.user.id, dailyEarned + coinsToGive);
            db.addTransaction(req.user.id, 'afk', coinsToGive, 'AFK reward');

            const user = db.getUser(req.user.id);

            res.json({
                success: true,
                coins: coinsToGive,
                newBalance: user ? user.coins : 0,
                dailyEarned: dailyEarned + coinsToGive
            });
        } catch (err) {
            console.error('[AFK] Claim error:', err);
            res.json({ success: false, error: 'server_error' });
        }
    });

    return router;
};

module.exports.path = '/';

