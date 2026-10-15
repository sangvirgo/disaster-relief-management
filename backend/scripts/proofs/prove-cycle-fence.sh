#!/usr/bin/env bash
set -euo pipefail

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=c48_logistics
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must come from the primary C48 PostgreSQL service}"

psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $proof$
DECLARE
  v_cycle_id uuid := gen_random_uuid();
  v_aborted_id uuid := gen_random_uuid();
  v_sealed_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
  v_organization_id uuid := gen_random_uuid();
  state_value text;
  mismatch_count integer;
BEGIN
  INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id,state)
    VALUES (v_cycle_id,v_request_id,1,v_organization_id,'OPEN');
  INSERT INTO cycle_intent (intent_id,cycle_id,kind,state)
    VALUES (v_aborted_id,v_cycle_id,'RESOLUTION','ABORTED');
  INSERT INTO cycle_intent (intent_id,cycle_id,kind,state)
    VALUES (v_sealed_id,v_cycle_id,'RESOLUTION','SEALED');
  UPDATE fulfillment_cycle SET state='SEALED' WHERE id=v_cycle_id;

  BEGIN
    UPDATE cycle_intent SET state='SEALED' WHERE intent_id=v_aborted_id;
    RAISE EXCEPTION 'delayed seal unexpectedly changed an aborted intent';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS durable ABORTED tombstone refused delayed seal';
  END;

  SELECT state INTO state_value FROM cycle_intent WHERE intent_id=v_aborted_id;
  SELECT count(*) INTO mismatch_count FROM check_cycle_state_matches_intent() WHERE cycle_id=v_cycle_id;
  IF state_value <> 'ABORTED' OR mismatch_count <> 0 THEN
    RAISE EXCEPTION 'cycle intent fence failed: state %, mismatch count %', state_value, mismatch_count;
  END IF;
  RAISE NOTICE 'PASS aborted cycle intent remains fenced while the newer seal stays current';
END
$proof$;
ROLLBACK;
SQL
