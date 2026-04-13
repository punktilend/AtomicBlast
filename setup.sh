#!/bin/bash
# Puls Proxy — VPS Setup Script
# Run this on your RackNerd box (23.95.216.131) as root or sudo user

set -e

echo "=== Installing dependencies ==="
apt-get update -y
apt-get install -y ffmpeg nodejs npm git

echo "=== Checking ffmpeg ==="
ffmpeg -version | head -1

echo "=== Checking node ==="
node -v
npm -v

echo "=== Cloning / copying project ==="
# If you're SFTPing the files manually, skip this block
# Otherwise set up your repo here:
# git clone https://github.com/punktilend/puls-proxy.git /opt/puls-proxy

mkdir -p /opt/puls-proxy
cd /opt/puls-proxy

echo "=== Installing node modules ==="
npm install

echo "=== Installing PM2 for process management ==="
npm install -g pm2

echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy your files to /opt/puls-proxy/"
echo "  2. cp .env.example .env && nano .env  (fill in B2 keys)"
echo "  3. pm2 start server.js --name puls-proxy"
echo "  4. pm2 save && pm2 startup"
echo ""
echo "Test it:"
echo "  curl http://23.95.216.131:3000/health"
