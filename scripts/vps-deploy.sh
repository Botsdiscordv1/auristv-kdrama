#!/bin/bash
# Remoto: despliegue de AurisTv_kdramas en el VPS (puerto 3002)
set -e
APP=/home/ubuntu/kdramas

cd "$APP"
npm install --omit=dev --no-audit --no-fund > /tmp/npm-install.log 2>&1 || npm install --no-audit --no-fund > /tmp/npm-install.log 2>&1
echo "npm install OK ($(grep -c 'added' /tmp/npm-install.log || true))"

# Ecosystem PM2 con puerto dedicado 3002
cat > "$APP/ecosystem.config.js" <<'EOF'
module.exports = {
  apps: [
    {
      name: "auris-kdramas",
      script: "index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
        PORT: 3002,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
EOF

mkdir -p "$APP/logs"
cd "$APP"
pm2 delete auris-kdramas >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save
# pm2 startup (auto-arranque al reiniciar el VPS)
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null | grep -o 'sudo .*' | bash || true

sleep 4
pm2 status
curl -s http://localhost:3002/api/health | head -c 300
echo
