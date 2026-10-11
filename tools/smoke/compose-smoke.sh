#!/usr/bin/env bash
# Black-box check of the running local stack (docker compose up), through the gateway:
# sign in with dev-auth, call profile-service, and wait for notification-service to receive UserRegistered.
set -euo pipefail
GATEWAY=${GATEWAY:-http://localhost:8080}
AUTH=${AUTH:-http://localhost:4100}

user_id=$(node -e "console.log(crypto.randomUUID())")
token=$(curl -fsS -X POST "$AUTH/token" -H 'content-type: application/json' \
  -d "{\"sub\":\"$user_id\",\"email\":\"smoke-$user_id@example.com\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')

echo "gateway health"; curl -fsS "$GATEWAY/health"; echo
echo "unauthenticated call is rejected"
test "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/v1/me")" = 401

echo "GET /v1/me creates the user"
me=$(curl -fsS "$GATEWAY/v1/me" -H "authorization: Bearer $token")
echo "$me"
echo "$me" | grep -q "\"id\":\"$user_id\""

echo "waiting for notification-service to receive UserRegistered"
for _ in $(seq 1 50); do
  status=$(curl -s -o /tmp/prefs.json -w '%{http_code}' "$GATEWAY/v1/me/notification-preferences" -H "authorization: Bearer $token")
  if [ "$status" = 200 ]; then cat /tmp/prefs.json; echo; echo "smoke OK"; exit 0; fi
  sleep 0.5
done
echo "notification preferences never appeared (last status $status)" >&2
exit 1
