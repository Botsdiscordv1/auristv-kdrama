#!/bin/bash
# Remoto: instalar Caddy (requiere root en el VPS)
set -e
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl > /dev/null 2>&1
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
apt-get update > /dev/null 2>&1
apt-get install -y caddy > /dev/null 2>&1
caddy version
