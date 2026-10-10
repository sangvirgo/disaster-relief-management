#!/usr/bin/env bash
# Two-session race tests for response.sql (T0-S exit gate). Real concurrency: two backgrounded psql processes per race.
# Session A: BEGIN; <stmt>; pg_sleep(1.0); COMMIT.  Session B starts ~0.3 s later and runs while A holds its locks.
# Usage: PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=x ./race-tests-response.sh   (creates and drops database hr_race)
set -u
cd "$(dirname "$0")"
export PGPASSWORD="${PGPASSWORD:-x}" PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55432}" PGUSER="${PGUSER:-postgres}"
DB=hr_race
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILS=0

psql -qX -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null || exit 2
P() { psql -qXAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
P -f response.sql >/dev/null || { echo "response.sql failed to load"; exit 2; }

# ---------- fixtures ----------
P >/dev/null <<'SQL'
INSERT INTO region_boundary VALUES ('R1', ST_Multi(ST_GeomFromText('POLYGON((106 10,107 10,107 11,106 11,106 10))',4326)));
INSERT INTO incident_category VALUES ('FLOOD','Ngập lụt');
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind) VALUES
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000d1','R1','Đội A','VOLUNTEER'),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000d1','R1','Đội B','VOLUNTEER');
-- six requests with one snapshot event each (mission.verification_revision must reference an event of the same request)
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,organization_id)
  SELECT ('00000000-0000-0000-0000-00000000b00'||i)::uuid, 'TRK000000'||i, 'FLOOD','SELF','00000000-0000-0000-0000-0000000000d1' FROM generate_series(1,6) i;
INSERT INTO request_event (id,request_id,event_type)
  SELECT ('00000000-0000-0000-0000-00000000e00'||i)::uuid, ('00000000-0000-0000-0000-00000000b00'||i)::uuid, 'VERIFIED_SNAPSHOT' FROM generate_series(1,6) i;
-- request 5 is the lock-rule subject: TRIAGED so the status change to RESOLVING is legal
UPDATE assistance_request SET status='TRIAGED', priority='P2', priority_basis='COMPLETE', verification_revision='00000000-0000-0000-0000-00000000e005' WHERE id='00000000-0000-0000-0000-00000000b005';
CREATE TABLE race_log (who text, seen_status text, waited_s numeric);
SQL

# race NAME STMT_A STMT_B  -> runs A then B (0.3 s later), prints B's stderr/stdout into $TMP/B.out
run_race() {
  local a="$1" b="$2"
  { echo "\\set VERBOSITY sqlstate"; echo "BEGIN;"; echo "$a"; echo "SELECT pg_sleep(1.0);"; echo "COMMIT;"; } > "$TMP/A.sql"
  { echo "\\set VERBOSITY sqlstate"; echo "BEGIN;"; echo "$b"; echo "COMMIT;"; } > "$TMP/B.sql"
  psql -qXAt -d "$DB" -f "$TMP/A.sql" >"$TMP/A.out" 2>&1 &
  local pa=$!
  sleep 0.3
  local t0; t0=$(date +%s.%N)
  psql -qXAt -d "$DB" -f "$TMP/B.sql" >"$TMP/B.out" 2>&1 &
  local pb=$!
  wait $pa; wait $pb
  B_ELAPSED=$(awk -v a="$(date +%s.%N)" -v b="$t0" 'BEGIN{printf "%.2f", a-b}')
}
verdict() { # name ok detail
  if [ "$2" = 1 ]; then echo "PASS $1 -- $3"; else echo "FAIL $1 -- $3"; FAILS=$((FAILS+1)); fi
}
slow_enough() { awk -v e="$B_ELAPSED" 'BEGIN{exit !(e>0.5)}'; }   # B must have waited for A's commit (~0.7 s after start)

# (a) supplement review for the same reviewed_event_id
EV='00000000-0000-0000-0000-00000000e0ff'
run_race "INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-00000000b001','SUPPLEMENT_REVIEW','{\"reviewed_event_id\":\"$EV\"}');" \
         "INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-00000000b001','SUPPLEMENT_REVIEW','{\"reviewed_event_id\":\"$EV\"}');"
N=$(P -c "SELECT count(*) FROM request_event WHERE event_type='SUPPLEMENT_REVIEW' AND payload->>'reviewed_event_id'='$EV'")
ok=0; [ "$N" = 1 ] && grep -q 23505 "$TMP/B.out" && slow_enough && ok=1
verdict "(a) SUPPLEMENT_REVIEW one per reviewed_event_id" $ok "rows=$N, B blocked ${B_ELAPSED:0:4}s then $(grep -o '2[0-9]\{4\}' "$TMP/B.out" | head -1)"

# (b) failure review for the same mission
M='00000000-0000-0000-0000-0000000000f9'
run_race "INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-00000000b002','MISSION_FAILURE_REVIEW','{\"mission_id\":\"$M\"}');" \
         "INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-00000000b002','MISSION_FAILURE_REVIEW','{\"mission_id\":\"$M\"}');"
N=$(P -c "SELECT count(*) FROM request_event WHERE event_type='MISSION_FAILURE_REVIEW' AND payload->>'mission_id'='$M'")
ok=0; [ "$N" = 1 ] && grep -q 23505 "$TMP/B.out" && slow_enough && ok=1
verdict "(b) MISSION_FAILURE_REVIEW one per mission" $ok "rows=$N, B blocked ${B_ELAPSED:0:4}s then $(grep -o '2[0-9]\{4\}' "$TMP/B.out" | head -1)"

# (c) two OFFERED missions for the same team (different requests)
ins() { echo "INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision) VALUES ('00000000-0000-0000-0000-00000000b00$1','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid(),'00000000-0000-0000-0000-00000000e00$1');"; }
run_race "$(ins 3)" "$(ins 4)"
N=$(P -c "SELECT count(*) FROM mission WHERE team_id='00000000-0000-0000-0000-0000000000a1' AND status='OFFERED'")
ok=0; [ "$N" = 1 ] && grep -q 23505 "$TMP/B.out" && slow_enough && ok=1
verdict "(c) one active mission per team (mission_team_one_active_uq)" $ok "rows=$N, B blocked ${B_ELAPSED:0:4}s then $(grep -o '2[0-9]\{4\}' "$TMP/B.out" | head -1)"

# (d) capability_recovery with the same code_hash
cap() { echo "INSERT INTO capability_recovery (request_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-00000000b006','race-hash',now()+interval '30 minutes',gen_random_uuid(),'IDENTITY_CHECKED');"; }
run_race "$(cap)" "$(cap)"
N=$(P -c "SELECT count(*) FROM capability_recovery WHERE code_hash='race-hash'")
ok=0; [ "$N" = 1 ] && grep -q 23505 "$TMP/B.out" && slow_enough && ok=1
verdict "(d) capability_recovery code_hash unique" $ok "rows=$N, B blocked ${B_ELAPSED:0:4}s then $(grep -o '2[0-9]\{4\}' "$TMP/B.out" | head -1)"

# (e) documented lock rule: B locks the request row (SELECT ... FOR UPDATE) before inserting an OFFERED mission.
#     A flips the request to RESOLVING and holds the transaction. B must wait, then observe RESOLVING (not the stale TRIAGED).
R5='00000000-0000-0000-0000-00000000b005'
run_race "UPDATE assistance_request SET status='RESOLVING', version=version+1 WHERE id='$R5';" \
"SELECT status AS seen FROM assistance_request WHERE id='$R5' FOR UPDATE \\gset
INSERT INTO race_log VALUES ('B', :'seen', 0);
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision)
  SELECT id,'00000000-0000-0000-0000-0000000000a2',1,gen_random_uuid(),verification_revision FROM assistance_request
   WHERE id='$R5' AND status IN ('TRIAGED','DISPATCHED','IN_PROGRESS');"
SEEN=$(P -c "SELECT seen_status FROM race_log WHERE who='B'")
MISS=$(P -c "SELECT count(*) FROM mission WHERE request_id='$R5'")
FINAL=$(P -c "SELECT status FROM assistance_request WHERE id='$R5'")
ok=0; [ "$SEEN" = RESOLVING ] && [ "$MISS" = 0 ] && [ "$FINAL" = RESOLVING ] && slow_enough && ok=1
verdict "(e) FOR UPDATE lock order: B waits and sees new status" $ok "B waited ${B_ELAPSED:0:4}s, saw status=$SEEN, guarded insert created $MISS missions, final=$FINAL"

P -c "SELECT 1" >/dev/null
psql -qXAt -d postgres -c "DROP DATABASE $DB" >/dev/null
[ "$FAILS" = 0 ] && { echo "ALL RACES PASS"; exit 0; } || { echo "$FAILS RACE(S) FAILED"; exit 1; }
