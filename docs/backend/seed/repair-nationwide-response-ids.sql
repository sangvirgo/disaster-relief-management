-- One-time repair for the synthetic nationwide fixture on the primary c48_response DB.
-- It keeps the three already-valid SOS rows and their history, remaps them to
-- valid campaign IDs, and removes only malformed fixture rows before reseeding.
-- Run before seed-nationwide-response.sql; no database or volume reset is used.
BEGIN;

SELECT pg_advisory_xact_lock(48352026, 16);

CREATE FUNCTION pg_temp.c48_nationwide_uuid(value text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  WITH digest AS (SELECT md5(value) AS hex)
  SELECT CASE WHEN hex::uuid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN hex::uuid
    ELSE overlay(overlay(hex placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid
  END FROM digest;
$$;

CREATE TEMP TABLE invalid_nationwide_campaign ON COMMIT DROP AS
SELECT c.id AS old_id, pg_temp.c48_nationwide_uuid('c48-nationwide-campaign-' || seq) AS new_id
  FROM generate_series(1, 12) AS seq
  JOIN campaign c ON c.id=md5('c48-nationwide-campaign-' || seq)::uuid
 WHERE c.id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

CREATE TEMP TABLE invalid_nationwide_request ON COMMIT DROP AS
SELECT id FROM assistance_request
 WHERE tracking_code ~ '^C48VN[0-9]{5}$'
   AND id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

DO $$ BEGIN
  IF (SELECT count(*) FROM invalid_nationwide_campaign) <> 10
     OR (SELECT count(*) FROM invalid_nationwide_request) <> 45
     OR (SELECT count(*) FROM assistance_request WHERE tracking_code ~ '^C48VN[0-9]{5}$') <> 48 THEN
    RAISE EXCEPTION 'Fixture counts changed; inspect the primary database before cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM campaign WHERE id IN (SELECT old_id FROM invalid_nationwide_campaign)
             AND (version <> 1 OR status <> 'ACTIVE')) THEN
    RAISE EXCEPTION 'An invalid campaign was edited; preserve it for manual review';
  END IF;
  IF EXISTS (SELECT 1 FROM campaign WHERE id IN (SELECT new_id FROM invalid_nationwide_campaign)) THEN
    RAISE EXCEPTION 'Replacement campaign ID already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM assistance_request
              WHERE campaign_id IN (SELECT old_id FROM invalid_nationwide_campaign)
                AND tracking_code !~ '^C48VN[0-9]{5}$')
     OR EXISTS (SELECT 1 FROM campaign_engagement WHERE campaign_id IN (SELECT old_id FROM invalid_nationwide_campaign))
     OR EXISTS (SELECT 1 FROM mission WHERE request_id IN (SELECT id FROM invalid_nationwide_request))
     OR EXISTS (SELECT 1 FROM evidence_metadata WHERE request_id IN (SELECT id FROM invalid_nationwide_request))
     OR EXISTS (SELECT 1 FROM verification_decision WHERE request_id IN (SELECT id FROM invalid_nationwide_request))
     OR EXISTS (SELECT 1 FROM contact_attempt WHERE request_id IN (SELECT id FROM invalid_nationwide_request))
     OR EXISTS (SELECT 1 FROM resolution_intent WHERE request_id IN (SELECT id FROM invalid_nationwide_request))
     OR EXISTS (SELECT 1 FROM capability_recovery WHERE request_id IN (SELECT id FROM invalid_nationwide_request))
     OR EXISTS (SELECT 1 FROM assistance_request WHERE canonical_request_id IN (SELECT id FROM invalid_nationwide_request)) THEN
    RAISE EXCEPTION 'Fixture has operational dependencies; preserve it for manual review';
  END IF;
END $$;

INSERT INTO campaign (id,name,objective,status,starts_at,ends_at,created_by_user_id,created_at,version,center,radius_m)
SELECT m.new_id,c.name,c.objective,c.status,c.starts_at,c.ends_at,c.created_by_user_id,c.created_at,c.version,c.center,c.radius_m
  FROM invalid_nationwide_campaign m JOIN campaign c ON c.id=m.old_id;

-- The append-only guard is suspended only inside this transaction for the
-- synthetic rows being removed; PostgreSQL restores it on any rollback.
ALTER TABLE request_event DISABLE TRIGGER request_event_append_only;

DELETE FROM ai_advisory WHERE request_id IN (SELECT id FROM invalid_nationwide_request);
DELETE FROM request_event WHERE request_id IN (SELECT id FROM invalid_nationwide_request);
DELETE FROM request_subject WHERE request_id IN (SELECT id FROM invalid_nationwide_request);
DELETE FROM assistance_request WHERE id IN (SELECT id FROM invalid_nationwide_request);

UPDATE assistance_request r SET campaign_id=m.new_id
  FROM invalid_nationwide_campaign m
 WHERE r.campaign_id=m.old_id;

-- Preserve the three valid SOS IDs and any non-seed history. Replace only
-- malformed seed events so the next seed run cannot double their timeline.
DELETE FROM request_event
 WHERE request_id IN (SELECT id FROM assistance_request WHERE tracking_code ~ '^C48VN[0-9]{5}$')
   AND payload->>'seed_fixture' = 'true'
   AND id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

ALTER TABLE request_event ENABLE TRIGGER request_event_append_only;

DELETE FROM campaign WHERE id IN (SELECT old_id FROM invalid_nationwide_campaign);

COMMIT;
