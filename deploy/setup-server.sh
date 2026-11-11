#!/usr/bin/env bash
# Runs ON the server. Idempotent: safe to re-run on every deploy.
set -euo pipefail
APP=/home/ubuntu/valshoptracker

# 1. 2 GB swap (the VM only has 1 GB RAM)
if ! swapon --show | grep -q /swapfile; then
  echo ">> Adding 2G swap"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 2. Node 22 (node:sqlite needs >= 22.13)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo ">> Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >/dev/null
fi
echo ">> node $(node -v)"

# 3. Production dependencies only
cd "$APP"
npm ci --omit=dev --no-audit --no-fund

# 4. systemd service
sudo cp "$APP/deploy/valshop.service" /etc/systemd/system/valshop.service
sudo systemctl daemon-reload
sudo systemctl enable valshop >/dev/null 2>&1
sudo systemctl restart valshop
sleep 5
sudo systemctl --no-pager status valshop | head -5
echo ">> Recent logs:"
sudo journalctl -u valshop -n 15 --no-pager
