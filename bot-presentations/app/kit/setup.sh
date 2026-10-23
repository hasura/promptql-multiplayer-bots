#!/bin/sh
# Presentation kit: installs the slide editor in the current directory as an enabled systemd service.
# Usage (from the app directory, after `python3 deck.py` has written data/seed.json):
#   sh kit/setup.sh <unit-name> [port]
# Re-running is safe: it reinstalls the unit and restarts the service, which picks up code changes.
set -eu
UNIT=${1:?usage: sh kit/setup.sh <unit-name> [port]}
PORT=${2:-8080}
APP=$(pwd)
[ -f server.py ] || { echo "ERROR: run this from the app directory (server.py not found)"; exit 1; }
[ -f data/seed.json ] || { echo "ERROR: data/seed.json missing; run python3 deck.py first"; exit 1; }
[ -n "${PROMPTQL_PLATFORM_API_URL:-}" ] || { echo "ERROR: PROMPTQL_PLATFORM_API_URL is not set"; exit 1; }
command -v google-chrome >/dev/null 2>&1 || echo "WARNING: google-chrome not found; PDF export and QA will fail"
if ss -ltn 2>/dev/null | grep -q ":$PORT " && ! systemctl is-active --quiet "$UNIT"; then
  echo "ERROR: port $PORT is already used by another service; pick another port"; exit 1
fi

[ -x .venv/bin/python ] || uv venv --python 3.14 .venv
uv pip install --quiet --python .venv/bin/python \
  python-pptx==1.0.2 lxml==6.1.3 pillow==12.3.0 cairosvg==2.9.1 xlsxwriter==3.2.9

# systemd does not inherit the VM shell environment, so the platform URL is written into the unit.
sudo tee "/etc/systemd/system/$UNIT.service" >/dev/null <<EOF
[Unit]
Description=Slide editor (PromptQL presentation kit)
After=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=PROMPTQL_PLATFORM_API_URL=$PROMPTQL_PLATFORM_API_URL
ExecStart=$APP/.venv/bin/python $APP/server.py
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT" >/dev/null 2>&1
sudo systemctl stop "$UNIT"
# The server copies data/seed.json to data/deck.json only when deck.json is missing.
# RESEED=1 throws away the current deck (and its history) so a rebuilt seed.json takes effect.
if [ "${RESEED:-0}" = 1 ]; then rm -rf data/deck.json data/history; echo "reseeded from data/seed.json"; fi
sudo systemctl start "$UNIT"

code=000
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/readyz" || true)
  [ "$code" = 204 ] && break
  sleep 0.5
done
echo "readyz=$code enabled=$(systemctl is-enabled "$UNIT") active=$(systemctl is-active "$UNIT")"
[ "$code" = 204 ]
