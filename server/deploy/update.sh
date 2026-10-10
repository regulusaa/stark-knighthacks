#!/usr/bin/env bash
# Pull main, reinstall dependencies, restart, and check /health. Run as root on the server:
#   bash /opt/stark/server/deploy/update.sh
set -euo pipefail
APP=/opt/stark
cd "$APP"
sudo -u stark -H git -C "$APP" pull --ff-only origin main
sudo -u stark -H bash -c "cd $APP && npm ci --omit=dev"
systemctl restart stark

for i in $(seq 1 20); do
  if [ "$(curl -fsS http://127.0.0.1:3000/health 2>/dev/null)" = ok ]; then
    echo "health ok ($(git -C "$APP" log --oneline -1))"
    HOST="$(awk 'NF && $1 !~ /^#/ {print $1; exit}' /etc/caddy/Caddyfile)"
    if [ "$(curl -fsS "https://$HOST/health" 2>/dev/null)" = ok ]; then echo "https ok: https://$HOST/health"; else
      echo "!!! HTTPS check failed for https://$HOST/health (app is up locally; check: journalctl -u caddy)" >&2; exit 1; fi
    exit 0
  fi
  sleep 1
done
echo "!!! /health is NOT ok after restart. Recent logs:" >&2
journalctl -u stark -n 40 --no-pager >&2
exit 1
