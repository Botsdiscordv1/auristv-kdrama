#!/bin/bash
# Remoto: activar Caddy con el dominio kdramas.auristv.dpdns.org (requiere root)
set -e
# 1) Caddyfile
cp /tmp/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile > /dev/null && echo "Caddyfile válido"

# 2) Firewall: 80 (HTTP-01 challenge) y 443
iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
netfilter-persistent save > /dev/null 2>&1 && echo "iptables 80/443 abiertos y persistidos"
ufw status 2>/dev/null | grep -q "Status: active" && ufw allow 80/tcp && ufw allow 443/tcp || true

# 3) Arrancar/recargar Caddy
systemctl enable caddy > /dev/null 2>&1
systemctl restart caddy
sleep 2
systemctl is-active caddy && echo "Caddy activo"
