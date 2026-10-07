#!/usr/bin/env sh
# One-shot setup for the last30days bot inside a PromptQL bot VM. Idempotent.
#
#   curl -fsSL https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-last30days/scripts/bootstrap.sh | sh
#
# Clones the upstream research engine (mvanhorn/last30days-skill) and installs
# the PromptQL wrapper beside it. No API keys are written anywhere.
set -e

RAW=https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/bot-last30days/scripts
ENGINE=/workspace/last30days-skill
WRAP=/workspace/last30days-pql
OUT=/workspace/last30days-out

mkdir -p "$OUT" "$WRAP/config"

if [ ! -d "$ENGINE/.git" ]; then
  git clone --depth 1 https://github.com/mvanhorn/last30days-skill.git "$ENGINE"
else
  git -C "$ENGINE" pull --ff-only -q || true
fi

# Install (or refresh) the wrapper. If this script is run from a checkout of the
# bot folder, prefer the local copy; otherwise fetch it from the repository.
if [ -f "$(dirname "$0")/pql_run.py" ]; then
  cp "$(dirname "$0")/pql_run.py" "$WRAP/pql_run.py"
else
  curl -fsSL "$RAW/pql_run.py" -o "$WRAP/pql_run.py"
fi

VERSION=$(cd "$ENGINE/skills/last30days/scripts" && python3 last30days.py --version 2>/dev/null || echo unknown)
echo "last30days engine version: $VERSION"
echo "run: cd $WRAP && python3 pql_run.py \"<topic>\" --quick --emit=compact --save-dir=$OUT"