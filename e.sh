#!/usr/bin/env bash
set -e

APP_DIR="/home/ubuntu/xeo-host"
[ ! -d "$APP_DIR" ] && APP_DIR="/root/xeo-host"
if [ ! -d "$APP_DIR/src" ]; then
  echo "❌ لم يتم العثور على مجلد المشروع!"
  exit 1
fi

command -v zip >/dev/null 2>&1 || (sudo apt-get update -y && sudo apt-get install -y zip)
command -v rsync >/dev/null 2>&1 || (sudo apt-get update -y && sudo apt-get install -y rsync)

STAGE="/tmp/xeo_export_stage"
OUT_ZIP="$HOME/xeo-host-final.zip"

sudo rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "📦 جاري نسخ ملفات المشروع النظيفة (بدون المساس بالسيرفر الشغال)..."
sudo rsync -a \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='instances' \
  --exclude='backups' \
  --exclude='temp' \
  --exclude='src/temp' \
  --exclude='.env' \
  --exclude='*.log' \
  --exclude='.git' \
  "$APP_DIR/" "$STAGE/"

sudo chown -R "$(whoami):$(whoami)" "$STAGE"

mkdir -p "$STAGE/backups" "$STAGE/instances" "$STAGE/data/uploads" "$STAGE/public/uploads" "$STAGE/temp"
touch "$STAGE/backups/.gitkeep" "$STAGE/instances/.gitkeep" "$STAGE/data/.gitkeep" "$STAGE/temp/.gitkeep"

cat << 'EOF_ENV' > "$STAGE/.env.example"
# ==========================================
# XeoStudio Hosting - Environment Variables
# انسخ هذا الملف باسم .env أو شغّل setup.sh لإعداده تلقائياً
# ==========================================

# توكن بوت الديسكورد (اختياري في هذا الإصدار)
TOKEN=YOUR_BOT_TOKEN

# بيانات تطبيق الديسكورد لتسجيل الدخول (من Discord Developer Portal -> OAuth2)
CLIENT_ID=YOUR_DISCORD_CLIENT_ID
CLIENT_SECRET=YOUR_DISCORD_CLIENT_SECRET
CALLBACK_URL=http://YOUR_SERVER_IP:3000/auth/discord/callback

# معرفات السوبر أدمن في الديسكورد (افصل بينهم بفاصلة لو أكثر من أدمن)
ADMIN_ID=YOUR_DISCORD_USER_ID

# مفتاح تشفير الجلسات (اكتب أي نص عشوائي طويل)
SESSION_SECRET=CHANGE_THIS_TO_A_RANDOM_SECRET_KEY

# بورت تشغيل لوحة التحكم
PORT=3000

# إعدادات HTTPS (اجعلها false لو تستخدم Cloudflare Tunnel أو Nginx)
USE_HTTPS=false
CF_CERT_PATH=./cloudflare/cert.pem
CF_KEY_PATH=./cloudflare/key.pem
EOF_ENV

if [ ! -f "$STAGE/ecosystem.config.js" ]; then
cat << 'EOF_ECO' > "$STAGE/ecosystem.config.js"
module.exports = {
  apps: [
    {
      name: "xeo-host",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
EOF_ECO
fi

cat << 'EOF_README' > "$STAGE/README.md"
# XeoStudio Hosting (Modified & Hardened Edition)

لوحة استضافة بوتات وتطبيقات تدعم **Node.js** و **Python 3** و **TypeScript** و **Bash**، مع عزل أمني كامل ونظام تسجيل دخول مزدوج.

## المميزات المضافة في هذه النسخة
- **دعم لغات متعددة:** Node.js (`.js`)، Python 3 (`.py` مع بيئة معزولة `.venv` وتثبيت تلقائي لـ `requirements.txt` ومدير حزم PIP)، TypeScript (`.ts`)، و Bash (`.sh`).
- **نظام دخول مزدوج:** تسجيل دخول وإنشاء حسابات بـ **اسم مستخدم وكلمة مرور** (بدون إيميل أو رقم هاتف) + **تسجيل الدخول عبر Discord OAuth2**.
- **أمان وعزل على مستوى النظام:** تشغيل البوتات عبر مستخدم لينكس معزول (`xeobot`) لمنع قراءة ملفات اللوحة أو قاعدة البيانات، عزل متغيرات البيئة (`process.env`)، فحص صلاحيات الـ Socket، وتثبيت حد المساحة الفعلي (`Disk Quota`) مع حماية Zip-Bomb/Zip-Slip.
- **إدارة متقدمة للمستخدمين:** باند حساب (`Account Ban`)، باند شبكة (`IP Ban`)، وحذف نهائي للحساب وسيرفراته.

## التسطيب السريع على Ubuntu / Debian VPS
    unzip xeo-host-final.zip -d ~/xeo-host && cd ~/xeo-host && sudo bash setup.sh

سيتولى السكربت تلقائياً تثبيت: `Node.js 20`، `PM2`، `Python 3 (venv & pip)`، إعداد المستخدم المعزول `xeobot`، توليد `.env`، وفتح البورت أو تشغيل `Cloudflare Tunnel`.

## أوامر التحكم السريعة (`xeo`)
- `xeo status` — عرض حالة اللوحة واستهلاك الموارد
- `xeo logs` — عرض سجل التشغيل المباشر
- `xeo restart` — إعادة تشغيل اللوحة
- `xeo stop` — إيقاف اللوحة
- `xeo url` — عرض رابط الموقع ورابط الـ Callback
- `xeo env` — تعديل ملف `.env` وإعادة التشغيل تلقائياً
EOF_README

cat << 'EOF_SETUP' > "$STAGE/setup.sh"
#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         🚀 XeoStudio Hosting - التسطيب السريع الشامل       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"

SUDO=""
[ "$EUID" -ne 0 ] && SUDO="sudo"

echo -e "${GREEN}[1/6] 📦 تثبيت الأدوات الأساسية وبيئة Python 3...${NC}"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -y
$SUDO apt-get install -y curl wget git unzip build-essential python3 python3-venv python3-pip python3-dev openssl iptables-persistent netfilter-persistent || \
$SUDO apt-get install -y curl wget git unzip build-essential python3 python3-venv python3-pip python3-dev openssl

echo -e "${GREEN}[2/6] 🟢 التحقق من Node.js 20 و PM2...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
if ! command -v pm2 &> /dev/null; then
  $SUDO npm install -g pm2
fi

echo -e "${GREEN}[3/6] 🌐 إعداد طريقة الاتصال والبورت...${NC}"
echo "  1) Cloudflare Tunnel (رابط جاهز تلقائي بدون فتح بورتات)"
echo "  2) IP / Domain مباشر"
read -p "اختر الطريقة [1 أو 2 - الافتراضي 1]: " CONN_MODE
CONN_MODE=${CONN_MODE:-1}
read -p "🔹 البورت الداخلي [افتراضي 3000]: " INPUT_PORT
PORT=${INPUT_PORT:-3000}

$SUDO iptables -I INPUT -p tcp --dport ${PORT} -j ACCEPT 2>/dev/null || true
$SUDO netfilter-persistent save >/dev/null 2>&1 || true
$SUDO ufw allow ${PORT}/tcp >/dev/null 2>&1 || true

PUBLIC_IP=$(curl -s https://api.ipify.org || echo "127.0.0.1")
BASE_URL="http://${PUBLIC_IP}:${PORT}"

if [ "$CONN_MODE" == "1" ]; then
  ARCH=$(dpkg --print-architecture)
  if ! command -v cloudflared &> /dev/null; then
    if [ "$ARCH" == "arm64" ] || [ "$ARCH" == "aarch64" ]; then
      wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -O /tmp/cloudflared.deb
    else
      wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -O /tmp/cloudflared.deb
    fi
    $SUDO dpkg -i /tmp/cloudflared.deb && rm -f /tmp/cloudflared.deb
  fi
  pm2 delete xeo-tunnel >/dev/null 2>&1 || true
  rm -f /tmp/tunnel.log
  pm2 start "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:${PORT}" --name xeo-tunnel --output /tmp/tunnel.log --error /tmp/tunnel.log
  for i in {1..15}; do
    TUNNEL_URL=$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' /tmp/tunnel.log | head -n 1 || true)
    [ -n "$TUNNEL_URL" ] && break
    sleep 1
  done
  [ -n "$TUNNEL_URL" ] && BASE_URL="$TUNNEL_URL"
else
  read -p "🔹 الدومين أو الـ IP (اتركه فارغاً لـ http://${PUBLIC_IP}:${PORT}): " INPUT_BASE_URL
  BASE_URL=${INPUT_BASE_URL:-http://${PUBLIC_IP}:${PORT}}
  BASE_URL=${BASE_URL%/}
fi

echo -e "${GREEN}[4/6] ⚙️ إعداد ملف .env...${NC}"
read -p "🔹 CLIENT_ID (أو Enter للتخطي): " INPUT_CLIENT_ID
read -p "🔹 CLIENT_SECRET (أو Enter للتخطي): " INPUT_CLIENT_SECRET
read -p "🔹 TOKEN البوت (أو Enter للتخطي): " INPUT_TOKEN
read -p "🔹 ADMIN_ID (الـ ID الخاص بك كأدمن): " INPUT_ADMIN_ID

RANDOM_SECRET=$(openssl rand -hex 32)
cat > .env <<EOL
TOKEN=${INPUT_TOKEN:-YOUR_BOT_TOKEN}
CLIENT_ID=${INPUT_CLIENT_ID:-YOUR_CLIENT_ID}
CLIENT_SECRET=${INPUT_CLIENT_SECRET:-YOUR_CLIENT_SECRET}
CALLBACK_URL=${BASE_URL}/auth/discord/callback
ADMIN_ID=${INPUT_ADMIN_ID:-YOUR_ADMIN_ID}
SESSION_SECRET=${RANDOM_SECRET}
PORT=${PORT}
USE_HTTPS=false
CF_CERT_PATH=./cloudflare/cert.pem
CF_KEY_PATH=./cloudflare/key.pem
EOL

echo -e "${GREEN}[5/6] 📚 تثبيت المكاتب وتطبيق العزل الأمني (xeobot)...${NC}"
mkdir -p backups instances data/uploads public/uploads temp
npm install --production

id -u xeobot >/dev/null 2>&1 || $SUDO useradd -r -s /usr/sbin/nologin -d "$(pwd)/instances" xeobot
$SUDO chmod 711 "$(dirname "$(pwd)")" "$(pwd)" "$(pwd)/instances" 2>/dev/null || true
$SUDO chown -R root:root "$(pwd)/src" "$(pwd)/data" "$(pwd)/backups" "$(pwd)/.env" 2>/dev/null || true
$SUDO chmod 600 "$(pwd)/.env" 2>/dev/null || true
$SUDO chmod 700 "$(pwd)/data" "$(pwd)/src" "$(pwd)/backups" 2>/dev/null || true
$SUDO chown -R xeobot:xeobot "$(pwd)/instances" 2>/dev/null || true

pm2 delete xeo-host >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save

echo -e "${GREEN}[6/6] 🛠️ إنشاء أمر التحكم (xeo)...${NC}"
APP_DIR=$(pwd)
$SUDO tee /usr/local/bin/xeo > /dev/null <<EOL
#!/usr/bin/env bash
cd "${APP_DIR}"
case "\$1" in
  start)   pm2 start xeo-host ;;
  stop)    pm2 stop xeo-host ;;
  restart) pm2 restart xeo-host ;;
  logs)    pm2 logs xeo-host ;;
  status)  pm2 status ;;
  url)
    TUNNEL_URL=\$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | head -n 1 || true)
    [ -n "\$TUNNEL_URL" ] && echo "🌐 الرابط: \$TUNNEL_URL" && echo "🔗 Callback: \$TUNNEL_URL/auth/discord/callback" || echo "🌐 http://${PUBLIC_IP}:${PORT}"
    ;;
  env)     nano "${APP_DIR}/.env" && pm2 restart xeo-host ;;
  *)       echo "الاستخدام: xeo {start|stop|restart|logs|status|url|env}" ;;
esac
EOL
$SUDO chmod +x /usr/local/bin/xeo

echo -e "${CYAN}🎉 تم التسطيب والتشغيل بنجاح!${NC}"
echo -e "🌐 رابط اللوحة: ${GREEN}${BASE_URL}${NC}"
echo -e "🔗 رابط OAuth2 Redirect للديسكورد: ${YELLOW}${BASE_URL}/auth/discord/callback${NC}"
EOF_SETUP
chmod +x "$STAGE/setup.sh"

rm -f "$OUT_ZIP"
(cd "$STAGE" && zip -r -q "$OUT_ZIP" .)
rm -rf "$STAGE"

echo ""
echo "✅ تم تجهيز البروجكت النهائي بنجاح في:"
ls -lh "$OUT_ZIP"
