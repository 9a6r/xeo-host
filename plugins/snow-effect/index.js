/**
 * Snow Effect Plugin ❄️
 * تأثير تساقط الثلج
 */

module.exports = {
    async init({ plugin }) {
        console.log(`[${plugin.name}] ❄️ Snow effect initialized`);
    },

    // دالة getScript - يتم استدعاؤها تلقائياً من الهاندلر
    getScript(settings) {
        const count = settings.snowflakeCount || 100;
        const size = settings.snowflakeSize || 'medium';
        const speed = settings.fallSpeed || 'normal';
        const color = settings.snowColor || '#ffffff';
        const wind = settings.enableWind !== false;

        // تحديد الأحجام
        const sizeMap = {
            small: { min: 2, max: 5 },
            medium: { min: 4, max: 10 },
            large: { min: 8, max: 15 }
        };

        // تحديد السرعات
        const speedMap = {
            slow: { min: 1, max: 3 },
            normal: { min: 2, max: 5 },
            fast: { min: 4, max: 8 }
        };

        const sizeConfig = sizeMap[size] || sizeMap.medium;
        const speedConfig = speedMap[speed] || speedMap.normal;

        return `
        <style>
            .snowflake {
                position: fixed;
                top: -10px;
                z-index: 9999;
                pointer-events: none;
                opacity: 0.8;
                animation: snowfall linear infinite;
            }
            
            @keyframes snowfall {
                0% {
                    transform: translateY(-10px) rotate(0deg);
                }
                100% {
                    transform: translateY(100vh) rotate(360deg);
                }
            }
            
            .snowflake::before {
                content: '❄';
                display: block;
                color: ${color};
                text-shadow: 0 0 5px ${color}40;
            }
        </style>
        
        <script>
        (function() {
            const snowContainer = document.createElement('div');
            snowContainer.id = 'snow-container';
            snowContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;overflow:hidden;';
            document.body.appendChild(snowContainer);
            
            const snowflakeCount = ${count};
            const sizeMin = ${sizeConfig.min};
            const sizeMax = ${sizeConfig.max};
            const speedMin = ${speedConfig.min};
            const speedMax = ${speedConfig.max};
            const enableWind = ${wind};
            
            function createSnowflake() {
                const snowflake = document.createElement('div');
                snowflake.className = 'snowflake';
                
                const size = Math.random() * (sizeMax - sizeMin) + sizeMin;
                const duration = Math.random() * (15 - 5) + 5 / (speedMax / 3);
                const startX = Math.random() * 100;
                const opacity = Math.random() * 0.6 + 0.4;
                
                snowflake.style.left = startX + 'vw';
                snowflake.style.fontSize = size + 'px';
                snowflake.style.opacity = opacity;
                snowflake.style.animationDuration = duration + 's';
                snowflake.style.animationDelay = Math.random() * duration + 's';
                
                if (enableWind) {
                    const windOffset = (Math.random() - 0.5) * 200;
                    snowflake.style.animation = 'snowfall ' + duration + 's linear infinite';
                    snowflake.animate([
                        { transform: 'translateY(-10px) translateX(0) rotate(0deg)' },
                        { transform: 'translateY(50vh) translateX(' + windOffset/2 + 'px) rotate(180deg)' },
                        { transform: 'translateY(100vh) translateX(' + windOffset + 'px) rotate(360deg)' }
                    ], {
                        duration: duration * 1000,
                        iterations: Infinity,
                        easing: 'linear'
                    });
                }
                
                snowContainer.appendChild(snowflake);
                
                // إعادة إنشاء الثلج عند انتهاء الأنيميشن
                snowflake.addEventListener('animationiteration', () => {
                    snowflake.style.left = Math.random() * 100 + 'vw';
                });
            }
            
            // إنشاء رقاقات الثلج
            for (let i = 0; i < snowflakeCount; i++) {
                setTimeout(() => createSnowflake(), i * 50);
            }
            
            // تأثير الرياح المتغيرة
            if (enableWind) {
                setInterval(() => {
                    const snowflakes = document.querySelectorAll('.snowflake');
                    snowflakes.forEach(sf => {
                        const currentLeft = parseFloat(sf.style.left);
                        const windPush = (Math.random() - 0.5) * 2;
                        sf.style.left = Math.max(0, Math.min(100, currentLeft + windPush)) + 'vw';
                    });
                }, 2000);
            }
        })();
        </script>
        `;
    },

    async destroy() {
        console.log('[Snow Effect] ❄️ Snow effect disabled');
    }
};
