#!/usr/bin/env bash
set -euo pipefail

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=test-only
DB=c48_response_race
TMP="$(mktemp -d)"
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $DB TEMPLATE c48_response"

P() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
P >/dev/null <<'SQL'
INSERT INTO region_boundary VALUES ('R1', ST_Multi(ST_GeomFromText('POLYGON((106 10,107 10,107 11,106 11,106 10))',4326)));
INSERT INTO incident_category VALUES ('FLOOD','Ngập lụt');
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind) VALUES
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','R1','Đội A','VOLUNTEER');
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,organization_id) VALUES
  ('00000000-0000-0000-0000-00000000b001','TRK00000001','FLOOD','SELF','00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000b002','TRK00000002','FLOOD','SELF','00000000-0000-0000-0000-0000000000d1');
INSERT INTO request_event (id,request_id,event_type) VALUES
  ('00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-00000000b001','VERIFIED_SNAPSHOT'),
  ('00000000-0000-0000-0000-00000000e002','00000000-0000-0000-0000-00000000b002','VERIFIED_SNAPSHOT');
INSERT INTO team_position (team_id,location,captured_at,source,set_by_user_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1',ST_SetSRID(ST_MakePoint(106.5,10.5),4326)::geography,now(),'GPS','00000000-0000-0000-0000-0000000000d1');
SQL

NEAR="$(P -c "SELECT count(*) FROM team_position WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(106.5,10.5),4326)::geography, 1000)")"
[ "$NEAR" = 1 ] || { echo "FAIL ST_DWithin expected one nearby position, found $NEAR" >&2; exit 1; }
P -c "BEGIN; SELECT team_id FROM team_position WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(106.5,10.5),4326)::geography, 1000) ORDER BY team_id FOR UPDATE; COMMIT;"
echo "PASS ST_DWithin + deterministic FOR UPDATE selected one team position"

cat > "$TMP/A.sql" <<'SQL'
BEGIN;
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision)
VALUES ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid(),'00000000-0000-0000-0000-00000000e001');
SELECT pg_sleep(1.0);
COMMIT;
SQL
cat > "$TMP/B.sql" <<'SQL'
\set VERBOSITY verbose
BEGIN;
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision)
VALUES ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid(),'00000000-0000-0000-0000-00000000e002');
COMMIT;
SQL

psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB" -f "$TMP/A.sql" >"$TMP/A.out" 2>&1 &
pa=$!
sleep 0.3
start="$(date +%s%N)"
if psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB" -f "$TMP/B.sql" >"$TMP/B.out" 2>&1; then
  b_exit=0
else
  b_exit=$?
fi
end="$(date +%s%N)"
wait "$pa"
wait_ms=$(( (end - start) / 1000000 ))
rows="$(P -c "SELECT count(*) FROM mission WHERE team_id='00000000-0000-0000-0000-0000000000a1' AND status='OFFERED'")"
if [ "$b_exit" -eq 0 ] || [ "$rows" != 1 ] || [ "$wait_ms" -lt 500 ] || ! grep -q '23505' "$TMP/B.out" || ! grep -q 'mission_team_one_active_uq' "$TMP/B.out"; then
  cat "$TMP/B.out" >&2
  echo "FAIL migrated mission race rows=$rows waited=${wait_ms}ms exit=$b_exit" >&2
  exit 1
fi
printf 'PASS migrated mission_team_one_active_uq (SQLSTATE 23505, waited %sms)\n' "$wait_ms"
