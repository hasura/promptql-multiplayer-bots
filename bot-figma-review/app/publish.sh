#!/bin/sh
# Publish (or update) the Figma Design Review app artifact for this bot.
set -e
ID="${1:-figma-review}"
PORT="${PORT:-8100}"
TITLE="${TITLE:-Figma Design Review}"
BODY=$(cat <<EOF
{"version":2,"host":"vm","sandbox_id":"$PROMPTQL_SANDBOX_ID","kind":"web","port":$PORT,"protocol":"http",
 "readiness":{"path":"/readyz"},
 "required_permissions":{"integrations":["figma","__figma"],"artifacts":true}}
EOF
)
curl -sS -w "\nHTTP %{http_code}\n" -X PUT "$PROMPTQL_PLATFORM_API_URL/v1/artifacts/threads/$PROMPTQL_THREAD_ID/$ID" \
  -H "Authorization: Bearer $PROMPTQL_USER_JWT" \
  -H "X-PromptQL-Artifact-Type: app" \
  -H "X-PromptQL-Artifact-Title: $TITLE" \
  -H "Content-Type: application/json" \
  --data "$BODY"