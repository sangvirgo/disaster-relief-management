#!/usr/bin/env bash
set -euo pipefail

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must come from the primary C48 PostgreSQL service}"
DB=c48_response
TMP="$(mktemp -d)"
P() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

request_a="$(P -c 'SELECT gen_random_uuid()')"
request_b="$(P -c 'SELECT gen_random_uuid()')"
team_id="$(P -c 'SELECT gen_random_uuid()')"
organization_id="$(P -c 'SELECT gen_random_uuid()')"
request_event_a="$(P -c 'SELECT gen_random_uuid()')"
request_event_b="$(P -c 'SELECT gen_random_uuid()')"
region_code="C48_RACE_$(printf '%s' "$request_a" | tr -d '-' | cut -c1-12 | tr '[:lower:]' '[:upper:]')"
category_code="C48_RACE_$(printf '%s' "$request_b" | tr -d '-' | cut -c1-12 | tr '[:lower:]' '[:upper:]')"
track_a="$(printf '%s' "$request_a" | tr -d '-' | cut -c1-12 | tr '[:lower:]' '[:upper:]')"
track_b="$(printf '%s' "$request_b" | tr -d '-' | cut -c1-12 | tr '[:lower:]' '[:upper:]')"

cleanup() {
  if [[ -n "${request_a:-}" && -n "${request_b:-}" ]]; then
    P -c "DELETE FROM mission WHERE request_id IN ('$request_a','$request_b'); DELETE FROM request_event WHERE request_id IN ('$request_a','$request_b'); DELETE FROM assistance_request WHERE id IN ('$request_a','$request_b'); DELETE FROM team_position WHERE team_id='$team_id'; DELETE FROM rescue_team WHERE id='$team_id'; DELETE FROM region_boundary WHERE region_code='$region_code'; DELETE FROM incident_category WHERE code='$category_code'" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

P >/dev/null <<SQL
INSERT INTO region_boundary VALUES ('$region_code', ST_Multi(ST_GeomFromText('POLYGON((106 10,107 10,107 11,106 11,106 10))',4326)));
INSERT INTO incident_category VALUES ('$category_code','Kiểm tra cạnh tranh');
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind) VALUES
  ('$team_id','$organization_id','$region_code','Đội kiểm tra $team_id','VOLUNTEER');
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,organization_id) VALUES
  ('$request_a','$track_a','$category_code','SELF','$organization_id'),
  ('$request_b','$track_b','$category_code','SELF','$organization_id');
INSERT INTO request_event (id,request_id,event_type) VALUES
  ('$request_event_a','$request_a','VERIFIED_SNAPSHOT'),
  ('$request_event_b','$request_b','VERIFIED_SNAPSHOT');
INSERT INTO team_position (team_id,location,captured_at,source,set_by_user_id) VALUES
  ('$team_id',ST_SetSRID(ST_MakePoint(106.5,10.5),4326)::geography,now(),'GPS','$organization_id');
SQL

NEAR="$(P -c "SELECT count(*) FROM team_position WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(106.5,10.5),4326)::geography, 1000)")"
[ "$NEAR" = 1 ] || { echo "FAIL ST_DWithin expected one nearby position, found $NEAR" >&2; exit 1; }
P -c "BEGIN; SELECT team_id FROM team_position WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(106.5,10.5),4326)::geography, 1000) ORDER BY team_id FOR UPDATE; COMMIT;"
echo 'PASS ST_DWithin + deterministic FOR UPDATE selected one team position'

cat > "$TMP/A.sql" <<SQL
BEGIN;
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision)
VALUES ('$request_a','$team_id',1,gen_random_uuid(),'$request_event_a');
SELECT pg_sleep(1.0);
COMMIT;
SQL
cat > "$TMP/B.sql" <<SQL
\\set VERBOSITY verbose
BEGIN;
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision)
VALUES ('$request_b','$team_id',1,gen_random_uuid(),'$request_event_b');
COMMIT;
SQL

P -f "$TMP/A.sql" >"$TMP/A.out" 2>&1 &
pa=$!
sleep 0.3
start="$(date +%s%N)"
if P -f "$TMP/B.sql" >"$TMP/B.out" 2>&1; then
  b_exit=0
else
  b_exit=$?
fi
end="$(date +%s%N)"
wait "$pa"
wait_ms=$(( (end - start) / 1000000 ))
rows="$(P -c "SELECT count(*) FROM mission WHERE team_id='$team_id' AND status='OFFERED'")"
if [ "$b_exit" -eq 0 ] || [ "$rows" != 1 ] || [ "$wait_ms" -lt 500 ] || ! grep -q '23505' "$TMP/B.out" || ! grep -q 'mission_team_one_active_uq' "$TMP/B.out"; then
  cat "$TMP/B.out" >&2
  echo "FAIL migrated mission race rows=$rows waited=${wait_ms}ms exit=$b_exit" >&2
  exit 1
fi
printf 'PASS migrated mission_team_one_active_uq (SQLSTATE 23505, waited %sms)\n' "$wait_ms"
