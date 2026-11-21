/**
 * Neon Cyberpunk Theme
 */

module.exports = {
    async init({ plugin }) {
        console.log(`[Theme] ${plugin.name} loaded`);
    },

    async destroy() {
        console.log('[Theme] Neon Cyberpunk Theme unloaded');
    }
};
