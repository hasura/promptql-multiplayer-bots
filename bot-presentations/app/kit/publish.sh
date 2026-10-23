#!/bin/sh
# Presentation kit: publishes the running editor as an app artifact on the current bot.
# Usage: sh kit/publish.sh <identifier> "<title>" [port]
#   identifier: lowercase letters, digits and hyphens, at most 32 characters (it becomes part of the hostname)
#   title: plain ASCII, one line
# DRY_RUN=1 prints the declaration instead of publishing.
set -eu
ID=${1:?usage: sh kit/publish.sh <identifier> "<title>" [port]}
TITLE=${2:?usage: sh kit/publish.sh <identifier> "<title>" [port]}
PORT=${3:-8080}
echo "$ID" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$' || { echo "ERROR: bad identifier '$ID'"; exit 1; }
SBX=${PROMPTQL_SANDBOX_ID:?PROMPTQL_SANDBOX_ID is not set}
BODY=$(printf '{"version":2,"host":"vm","sandbox_id":"%s","kind":"web","port":%s,"protocol":"http","readiness":{"path":"/readyz"},"required_permissions":{"integrations":["__google-drive-v2","__microsoft-powerpoint"]}}' "$SBX" "$PORT")
if [ "${DRY_RUN:-0}" = 1 ]; then echo "$BODY"; exit 0; fi
curl -sS -f -X PUT "$PROMPTQL_PLATFORM_API_URL/v1/artifacts/threads/$PROMPTQL_THREAD_ID/$ID" \
  -H "Authorization: Bearer $PROMPTQL_USER_JWT" \
  -H "X-PromptQL-Artifact-Type: app" \
  -H "X-PromptQL-Artifact-Title: $TITLE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
echo
