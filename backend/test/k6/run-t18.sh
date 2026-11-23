#!/usr/bin/env bash
# Run the T18 k6 scenario through an SSM port-forward: 20 VUs, 2 min warm-up, then 10 min measured as SEGMENTS
# measured segments of equal length. The access token lives at most 10 minutes, so the script logs in again before
# every segment (the first one also covers the warm-up, so it stays under 10 minutes in total).
#
#   Terminal A (keep open):
#     aws ssm start-session --profile c48 --region ap-southeast-2 --target <instance-id> \
#       --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'
#   Terminal B:   bash backend/test/k6/run-t18.sh
#
# Environment: C48_K6_VUS (20), SEGMENTS (2), SEGMENT_MINUTES (5), C48_K6_SOS_LONGITUDE/LATITUDE, C48_K6_INCIDENT_CATEGORY.
# Writes synthetic SOS requests to the target database. The password is typed at a hidden prompt, never stored.
set -euo pipefail
BASE="${C48_K6_PUBLIC_URL:-http://127.0.0.1:8080}"
SEGMENTS="${SEGMENTS:-2}"
SEGMENT_MINUTES="${SEGMENT_MINUTES:-5}"
cd "$(dirname "${BASH_SOURCE[0]}")"

curl -fsS --max-time 5 "$BASE/health/live" >/dev/null || { echo "Cannot reach $BASE/health/live: is the port-forward running?" >&2; exit 1; }
read -r -p 'username: ' U
read -rs -p 'password: ' P; echo

login() {
  local reply token
  reply="$(curl -s -X POST "$BASE/api/v1/identity/auth/login" -H 'Content-Type: application/json' \
    -d "$(U="$U" P="$P" python3 -c 'import json,os;print(json.dumps({"username":os.environ["U"],"password":os.environ["P"],"client_kind":"NATIVE"}))')")"
  token="$(printf '%s' "$reply" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
  if [[ -z "$token" ]]; then
    echo "Login failed: $(printf '%s' "$reply" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("code","unknown"))')" >&2
    return 1
  fi
  printf '%s' "$token"
}

for ((segment = 1; segment <= SEGMENTS; segment++)); do
  C48_K6_ACCESS_TOKEN="$(login)"; export C48_K6_ACCESS_TOKEN
  warmup='0s'; if ((segment == 1)); then warmup='2m'; fi
  echo "Segment $segment of $SEGMENTS (token length ${#C48_K6_ACCESS_TOKEN}, warm-up $warmup, measured ${SEGMENT_MINUTES}m)."
  K6_ENABLE_SOS_WRITES=1 C48_K6_PUBLIC_URL="$BASE" C48_K6_VUS="${C48_K6_VUS:-20}" \
  C48_K6_WARMUP="$warmup" C48_K6_MEASURED="${SEGMENT_MINUTES}m" \
  C48_K6_SOS_LONGITUDE="${C48_K6_SOS_LONGITUDE:-105.8}" C48_K6_SOS_LATITUDE="${C48_K6_SOS_LATITUDE:-21.0}" \
  C48_K6_INCIDENT_CATEGORY="${C48_K6_INCIDENT_CATEGORY:-FLOOD}" \
  k6 run --quiet t18-hardening.js || echo "Segment $segment ended with failed thresholds (see the summary above)." >&2
done
