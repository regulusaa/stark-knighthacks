#!/usr/bin/env bash
# One-time provisioning of a fresh Ubuntu 24.04 Vultr server for Stark (master plan 12.2). Run as root:
#   bash setup.sh [hostname]      hostname defaults to <public-ip-with-dashes>.sslip.io
#   STARK_BRANCH=agent/claude-core bash setup.sh    deploy a branch other than main (saved for update.sh)
# Installs Node 20 (NodeSource), git and Caddy (Ubuntu archive); clones the repo into /opt/stark as the "stark" user; installs the systemd
# unit and the Caddyfile; opens only 22/80/443. It never writes secrets: create /etc/stark.env yourself.
set -euo pipefail

REPO=https://github.com/regulusaa/stark-knighthacks.git
APP=/opt/stark
BRANCH="${STARK_BRANCH:-main}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

IP="$(hostname -I | awk '{print $1}')"
HOST="${1:-${IP//./-}.sslip.io}"
echo "==> hostname: $HOST"

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
rm -f /etc/apt/sources.list.d/caddy-stable.list  # left by an older version of this script
apt-get update -q
apt-get install -yq git curl ufw ca-certificates gnupg

if ! node -v 2>/dev/null | grep -q '^v20\.'; then
  echo "==> Node 20 LTS (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -yq nodejs
fi

if ! command -v caddy >/dev/null; then
  # Caddy's own apt repo (Cloudsmith) started answering 402, so use Ubuntu's package (universe, Caddy 2.x).
  echo "==> Caddy (Ubuntu archive)"
  rm -f /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

echo "==> user and app"
id stark >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/stark --shell /usr/sbin/nologin stark
if [ ! -d "$APP/.git" ]; then
  git clone --branch "$BRANCH" "$REPO" "$APP"
fi
echo "$BRANCH" > /etc/stark.branch
chown -R stark:stark "$APP"
sudo -u stark -H bash -c "cd $APP && npm ci --omit=dev"

echo "==> env file"
if [ ! -f /etc/stark.env ]; then
  install -m 600 -o root -g root /dev/null /etc/stark.env
  echo "    created an EMPTY /etc/stark.env (root-only). Fill it in yourself; see stark.env.example."
fi

echo "==> systemd + Caddy"
install -m 644 "$HERE/stark.service" /etc/systemd/system/stark.service
sed "s/__HOST__/$HOST/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now stark
systemctl enable caddy
systemctl reload-or-restart caddy

echo "==> firewall (22, 80, 443 only)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> local health"
for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/health && echo
echo "done. Next: put the real values in /etc/stark.env, then: systemctl restart stark"
echo "public URL: https://$HOST/health"
