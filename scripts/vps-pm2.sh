#!/bin/bash
# Remoto: instalar PM2 global (requiere root en el VPS) y habilitar Redis
sudo npm install -g pm2 > /tmp/pm2b.log 2>&1
pm2 -v
sudo systemctl enable redis-server > /dev/null 2>&1
sudo systemctl start redis-server
redis-cli ping
