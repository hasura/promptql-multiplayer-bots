#!/usr/bin/env bash
# Install (or reinstall) Bot Factory as the systemd service "botfactory".
# Run from the package directory on the bot's v2 VM:  ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"
DIR=$(pwd)
PORT=${BF_PORT:-$(python3 -c 'import json;print(json.load(open("config.json")).get("port") or 8090)' 2>/dev/null || echo 8090)}

command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }
if [ ! -f config.json ] && [ -z "${BF_PROJECT_ID:-}" ]; then
  echo "No config.json found. Copy config.example.json to config.json and fill it in (see DEPLOY.md)."; exit 1
fi
mkdir -p data

# The api_url is the bot's Platform API base. Pin it into .env so the service sees it
# even though systemd does not inherit the shell's PROMPTQL_* variables.
touch .env && chmod 600 .env
if [ -n "${PROMPTQL_PLATFORM_API_URL:-}" ] && ! grep -q '^BF_API_URL=' .env; then
  echo "BF_API_URL=$PROMPTQL_PLATFORM_API_URL" >> .env
fi
if [ -n "${PROMPTQL_THREAD_ID:-}" ] && ! grep -q '^PROMPTQL_THREAD_ID=' .env; then
  echo "PROMPTQL_THREAD_ID=$PROMPTQL_THREAD_ID" >> .env
fi

sed -e "s#@USER@#$(id -un)#g" -e "s#@DIR@#$DIR#g" botfactory.service | sudo tee /etc/systemd/system/botfactory.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable botfactory.service >/dev/null 2>&1
sudo systemctl restart botfactory.service

for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/readyz" || true)
  case "$code" in 2*) break;; esac; sleep 1
done
echo "service: $(systemctl is-active botfactory.service) / $(systemctl is-enabled botfactory.service)"
echo "readyz:  HTTP $code on port $PORT"
case "$code" in 2*) ;; *) sudo journalctl -u botfactory.service -n 30 --no-pager; exit 1;; esac
curl -s "localhost:$PORT/api/catalog" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("catalog:", len(d.get("bots",[])), "bots:", ", ".join(b["name"] for b in d.get("bots",[])))'