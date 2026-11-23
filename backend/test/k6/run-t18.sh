#!/usr/bin/env bash
# Run the T18 k6 scenario (20 VUs, 2 min warm-up + 10 min measured) through an SSM port-forward.
#
#   Terminal A (keep open):
#     aws ssm start-session --profile c48 --region ap-southeast-2 --target <instance-id> \
#       --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'
#   Terminal B:   bash backend/test/k6/run-t18.sh
#
# Writes synthetic SOS requests to the target database. The password is typed at a hidden prompt, never stored.
set -euo pipefail
BASE="${C48_K6_PUBLIC_URL:-http://127.0.0.1:8080}"
cd "$(dirname "${BASH_SOURCE[0]}")"

curl -fsS --max-time 5 "$BASE/health/live" >/dev/null || { echo "Cannot reach $BASE/health/live: is the port-forward running?" >&2; exit 1; }
read -r -p 'username: ' U
read -rs -p 'password: ' P; echo
reply="$(curl -s -X POST "$BASE/api/v1/identity/auth/login" -H 'Content-Type: application/json' \
  -d "$(U="$U" P="$P" python3 -c 'import json,os;print(json.dumps({"username":os.environ["U"],"password":os.environ["P"],"client_kind":"NATIVE"}))')")"
C48_K6_ACCESS_TOKEN="$(printf '%s' "$reply" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
if [[ -z "$C48_K6_ACCESS_TOKEN" ]]; then
  echo "Login failed: $(printf '%s' "$reply" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("code","unknown"))')" >&2
  exit 1
fi
export C48_K6_ACCESS_TOKEN
echo "Logged in (token length ${#C48_K6_ACCESS_TOKEN}). Starting k6: about 12 minutes."
K6_ENABLE_SOS_WRITES=1 C48_K6_PUBLIC_URL="$BASE" \
C48_K6_SOS_LONGITUDE="${C48_K6_SOS_LONGITUDE:-105.8}" C48_K6_SOS_LATITUDE="${C48_K6_SOS_LATITUDE:-21.0}" \
C48_K6_INCIDENT_CATEGORY="${C48_K6_INCIDENT_CATEGORY:-FLOOD}" \
exec k6 run t18-hardening.js
