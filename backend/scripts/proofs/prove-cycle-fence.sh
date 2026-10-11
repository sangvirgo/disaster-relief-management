#!/usr/bin/env bash
set -euo pipefail

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=test-only
DB=c48_logistics_fence
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $DB"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $DB TEMPLATE c48_logistics"
P() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

P >/dev/null <<'SQL'
INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id,state) VALUES
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2',1,'00000000-0000-0000-0000-0000000000c3','OPEN');
INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES
  ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000c1','RESOLUTION','ABORTED');
INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES
  ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000c1','RESOLUTION','SEALED');
UPDATE fulfillment_cycle SET state='SEALED' WHERE id='00000000-0000-0000-0000-0000000000c1';
SQL

P <<'SQL'
DO $test$
BEGIN
  BEGIN
    UPDATE cycle_intent SET state='SEALED' WHERE intent_id='00000000-0000-0000-0000-0000000000c4';
    RAISE EXCEPTION 'delayed seal unexpectedly changed an aborted intent';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS durable ABORTED tombstone refused delayed seal';
  END;
END
$test$;
SQL
STATE="$(P -c "SELECT state FROM cycle_intent WHERE intent_id='00000000-0000-0000-0000-0000000000c4'")"
MISMATCH="$(P -c "SELECT count(*) FROM check_cycle_state_matches_intent() WHERE cycle_id='00000000-0000-0000-0000-0000000000c1'")"
[ "$STATE" = ABORTED ] && [ "$MISMATCH" = 0 ] || { echo "FAIL durable cycle intent fence" >&2; exit 1; }
echo "PASS aborted cycle intent remains fenced while the newer seal stays current"
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE $DB"
