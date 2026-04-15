#!/bin/bash
# Deploy a Supabase Edge Function using the Management API
# Usage: ./scripts/deploy-function.sh <function-name> [--verify-jwt=false]

set -e

FUNCTION_NAME="${1:?Usage: deploy-function.sh <function-name>}"
VERIFY_JWT="${2:-false}"
PROJECT_ID="iykqsdiochxtfrtmuzdr"
FUNCTION_DIR="supabase/functions/${FUNCTION_NAME}"
ENTRYPOINT="${FUNCTION_DIR}/index.ts"

if [ ! -f "$ENTRYPOINT" ]; then
  echo "❌ File not found: $ENTRYPOINT"
  exit 1
fi

# Check for access token
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "❌ SUPABASE_ACCESS_TOKEN not set"
  echo "Get one from: https://supabase.com/dashboard/account/tokens"
  echo "Then: export SUPABASE_ACCESS_TOKEN=sbp_..."
  exit 1
fi

echo "📦 Deploying ${FUNCTION_NAME}..."
FILE_CONTENT=$(cat "$ENTRYPOINT")
FILE_SIZE=$(echo -n "$FILE_CONTENT" | wc -c | tr -d ' ')
echo "   File: ${ENTRYPOINT} (${FILE_SIZE} bytes)"

# Create the multipart form data
BOUNDARY="----FormBoundary$(date +%s)"

BODY=$(printf -- "--%s\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{\"name\":\"%s\",\"verify_jwt\":%s,\"entrypoint_path\":\"index.ts\"}\r\n--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"index.ts\"\r\nContent-Type: application/typescript\r\n\r\n%s\r\n--%s--" \
  "$BOUNDARY" "$FUNCTION_NAME" "$VERIFY_JWT" "$BOUNDARY" "$FILE_CONTENT" "$BOUNDARY")

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X PUT \
  "https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/${FUNCTION_NAME}" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: multipart/form-data; boundary=${BOUNDARY}" \
  --data-binary "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
RESPONSE_BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  VERSION=$(echo "$RESPONSE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('version','?'))" 2>/dev/null || echo "?")
  echo "✅ ${FUNCTION_NAME} deployed (v${VERSION})"
else
  echo "❌ Deploy failed (HTTP ${HTTP_CODE})"
  echo "$RESPONSE_BODY"
  exit 1
fi
