const express = require('express');
const router = express.Router();

module.exports = ({ db, isAuth }) => {
    // Helper function to get store prices
    function getPrices() {
        return {
            ram: parseFloat(db.getConfig('store_price_ram')) || 0.1,
            cpu: parseFloat(db.getConfig('store_price_cpu')) || 1,
            disk: parseFloat(db.getConfig('store_price_disk')) || 0.05
        };
    }

    // Store Page
    router.get('/store', isAuth, (req, res) => {
        const resources = db.getUserResources(req.user.id);
        const usedResources = db.getUserUsedResources(req.user.id);
        const prices = getPrices();
        
        // Calculate available resources
        const available = {
            ram: resources.ram - usedResources.ram,
            cpu: resources.cpu - usedResources.cpu,
            disk: resources.disk - usedResources.disk
        };

        res.render('store', {
            resources: available,
            prices,
            page: 'store',
            message: req.query.success || req.query.error ? {
                type: req.query.success ? 'success' : 'error',
                text: req.query.success || req.query.error
            } : null
        });
    });

    // Buy Resources
    router.post('/store/buy', isAuth, (req, res) => {
        try {
            const { type, amount } = req.body;
            const prices = getPrices();
            const amountNum = parseInt(amount);

            if (!['ram', 'cpu', 'disk'].includes(type)) {
                return res.redirect('/store?error=Invalid resource type');
            }

            if (!amountNum || amountNum <= 0) {
                return res.redirect('/store?error=Invalid amount');
            }

            // Calculate price
            const price = Math.ceil(amountNum * prices[type]);

            // Check if user has enough coins
            const user = db.getUser(req.user.id);
            if (user.coins < price) {
                return res.redirect('/store?error=Not enough coins. You need ' + price + ' coins.');
            }

            // Deduct coins
            db.updateCoins(req.user.id, -price);

            // Add resources
            const ramAdd = type === 'ram' ? amountNum : 0;
            const cpuAdd = type === 'cpu' ? amountNum : 0;
            const diskAdd = type === 'disk' ? amountNum : 0;
            db.addUserResources(req.user.id, ramAdd, cpuAdd, diskAdd);

            // Log transaction
            db.addTransaction(req.user.id, 'purchase', -price, `Purchased ${amountNum} ${type.toUpperCase()}`);

            const typeNames = { ram: 'RAM', cpu: 'CPU', disk: 'Disk' };
            const units = { ram: 'MB', cpu: '%', disk: 'MB' };
            res.redirect(`/store?success=Purchased ${amountNum}${units[type]} ${typeNames[type]} for ${price} coins!`);
        } catch (err) {
            console.error('[STORE] Buy error:', err);
            res.redirect('/store?error=Failed to purchase resources');
        }
    });

    return router;
};

module.exports.path = '/';
