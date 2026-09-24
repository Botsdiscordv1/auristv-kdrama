#!/bin/bash
# Remoto: abrir puerto 3002 en el firewall del VPS
# Oracle Cloud también exige regla en la Security List de la VCN (consola web).
iptables -I INPUT -p tcp --dport 3002 -j ACCEPT 2>/dev/null && echo "iptables 3002 abierto"
# Persistir regla si iptables-persistent existe
command -v netfilter-persistent >/dev/null && netfilter-persistent save && echo "regla persistida"
# ufw (si está activo)
ufw status 2>/dev/null | grep -q "Status: active" && ufw allow 3002/tcp && echo "ufw 3002 abierto"
echo "hecho"
