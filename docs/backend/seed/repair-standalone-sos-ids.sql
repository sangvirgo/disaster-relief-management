-- One-time repair for malformed synthetic standalone SOS IDs in c48_response.
-- The 23 campaign attachments on these fixture rows are intentionally removed
-- with the rows, as approved for a clean demo reseed. Valid SOS rows are kept.
-- Run before seed-standalone-sos-response.sql; no database reset is used.
BEGIN;

SELECT pg_advisory_xact_lock(48352026, 17);

CREATE TEMP TABLE invalid_standalone_request ON COMMIT DROP AS
SELECT id FROM assistance_request
 WHERE tracking_code ~ '^C48X[0-9]{6}$'
   AND id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

DO $$ BEGIN
  IF (SELECT count(*) FROM invalid_standalone_request) <> 238
     OR (SELECT count(*) FROM assistance_request WHERE tracking_code ~ '^C48X[0-9]{6}$') <> 272
     OR (SELECT count(*) FROM assistance_request WHERE id IN (SELECT id FROM invalid_standalone_request) AND campaign_id IS NOT NULL) <> 23 THEN
    RAISE EXCEPTION 'Standalone fixture counts changed; inspect the primary database before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM assistance_request WHERE id IN (SELECT id FROM invalid_standalone_request)
             AND status NOT IN ('SUBMITTED','VERIFYING'))
     OR EXISTS (SELECT 1 FROM request_event WHERE request_id IN (SELECT id FROM invalid_standalone_request)
                AND event_type::text NOT IN ('REQUEST_SUBMITTED','VERIFICATION_STARTED','CAMPAIGN_ATTACHED'))
     OR EXISTS (SELECT 1 FROM mission WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM evidence_metadata WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM verification_decision WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM contact_attempt WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM resolution_intent WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM capability_recovery WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM ai_advisory WHERE request_id IN (SELECT id FROM invalid_standalone_request))
     OR EXISTS (SELECT 1 FROM assistance_request WHERE canonical_request_id IN (SELECT id FROM invalid_standalone_request)) THEN
    RAISE EXCEPTION 'Standalone fixture has operational dependencies; preserve it for manual review';
  END IF;
END $$;

-- The append-only guard is suspended only in this transaction. A rollback
-- restores it automatically; the statement below enables it before commit.
ALTER TABLE request_event DISABLE TRIGGER request_event_append_only;
DELETE FROM request_event WHERE request_id IN (SELECT id FROM invalid_standalone_request);
ALTER TABLE request_event ENABLE TRIGGER request_event_append_only;

DELETE FROM request_subject WHERE request_id IN (SELECT id FROM invalid_standalone_request);
DELETE FROM assistance_request WHERE id IN (SELECT id FROM invalid_standalone_request);

COMMIT;
