#!/usr/bin/env bash
# Publish the running service as this bot's App Artifact (identifier "bot-factory").
# Run on the same VM that runs the service:  ./publish.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${PROMPTQL_PLATFORM_API_URL:?run this inside the VM of the bot that hosts the app}" "${PROMPTQL_USER_JWT:?}" "${PROMPTQL_THREAD_ID:?}" "${PROMPTQL_SANDBOX_ID:?}"
PORT=${BF_PORT:-$(python3 -c 'import json;print(json.load(open("config.json")).get("port") or 8090)' 2>/dev/null || echo 8090)}
TITLE=${BF_APP_TITLE:-$(python3 -c 'import json;print(json.load(open("brand.json")).get("app_title") or "Bot Factory")' 2>/dev/null || echo "Bot Factory")}
IDENT=${BF_ARTIFACT_ID:-bot-factory}

cat > /tmp/bot-factory-app.json <<EOF
{"version":2,"host":"vm","sandbox_id":"$PROMPTQL_SANDBOX_ID","kind":"web","port":$PORT,"protocol":"http","readiness":{"path":"/readyz"},"required_permissions":{"promptql_graphql":"read_write"}}
EOF
curl -sS -X PUT "$PROMPTQL_PLATFORM_API_URL/v1/artifacts/threads/$PROMPTQL_THREAD_ID/$IDENT" \
  -H "Authorization: Bearer $PROMPTQL_USER_JWT" -H "X-PromptQL-Artifact-Type: app" \
  -H "X-PromptQL-Artifact-Title: $TITLE" -H "Content-Type: application/json" \
  --data-binary @/tmp/bot-factory-app.json -w "\nHTTP %{http_code}\n"
echo "Published artifact '$IDENT' on bot $PROMPTQL_THREAD_ID. Next: pin it as Room TV (pin_room_tv.py)."