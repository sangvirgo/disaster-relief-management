-- One-time correction of the 2026-11-16 synthetic SOS pins outside Viet Nam land.
-- Requires /tmp/vietnam-adm0.geojson in the existing reliva-postgres container.
-- Boundary: geoBoundaries VNM ADM0, represented year 2016, CC BY 4.0.
-- This only moves untouched synthetic manual pins; request and event history stay intact.
BEGIN;

CREATE TEMP TABLE bad_seed_request ON COMMIT DROP AS
WITH boundary AS (
  SELECT ST_GeomFromGeoJSON(
    (pg_read_file('/tmp/vietnam-adm0.geojson')::jsonb->'features'->0->'geometry')::text
  ) AS geom
)
SELECT r.id, r.tracking_code, s.location AS old_location
  FROM assistance_request r
  JOIN request_subject s ON s.request_id=r.id
 CROSS JOIN boundary
 WHERE (r.tracking_code LIKE 'C48X%' OR r.tracking_code LIKE 'C48VN%')
   AND NOT ST_Covers(boundary.geom, s.location::geometry)
   AND r.version=1
   AND r.status IN ('SUBMITTED','VERIFYING');

DO $$
BEGIN
  IF (SELECT count(*) FROM bad_seed_request) <> 32 THEN
    RAISE EXCEPTION 'Expected exactly 32 untouched out-of-land seed reports';
  END IF;
  IF EXISTS (
    SELECT 1 FROM request_event e JOIN bad_seed_request b ON b.id=e.request_id
     WHERE e.event_type NOT IN ('REQUEST_SUBMITTED','VERIFICATION_STARTED')
  ) OR EXISTS (
    SELECT 1 FROM assistance_request child JOIN bad_seed_request b ON b.id=child.canonical_request_id
  ) OR EXISTS (
    SELECT 1 FROM mission m JOIN bad_seed_request b ON b.id=m.request_id
  ) OR EXISTS (
    SELECT 1 FROM verification_decision d JOIN bad_seed_request b ON b.id=d.request_id
  ) OR EXISTS (
    SELECT 1 FROM contact_attempt a JOIN bad_seed_request b ON b.id=a.request_id
  ) OR EXISTS (
    SELECT 1 FROM evidence_metadata e JOIN bad_seed_request b ON b.id=e.request_id
  ) OR EXISTS (
    SELECT 1 FROM ai_advisory a JOIN bad_seed_request b ON b.id=a.request_id
  ) OR EXISTS (
    SELECT 1 FROM resolution_intent i JOIN bad_seed_request b ON b.id=i.request_id
  ) OR EXISTS (
    SELECT 1 FROM capability_recovery c JOIN bad_seed_request b ON b.id=c.request_id
  ) THEN
    RAISE EXCEPTION 'A misplaced seed report has subsequent activity; manual review required';
  END IF;
END $$;

CREATE TEMP TABLE corrected_seed_location ON COMMIT DROP AS
WITH boundary AS (
  SELECT ST_GeomFromGeoJSON(
    (pg_read_file('/tmp/vietnam-adm0.geojson')::jsonb->'features'->0->'geometry')::text
  ) AS geom
), anchors AS (
  SELECT b.id, b.tracking_code, b.old_location, boundary.geom,
         CASE WHEN b.tracking_code IN
           ('C48X000109','C48X000110','C48X000111','C48X000112')
           -- Correct the original Hương Khê hub, which was entered ~50 km south.
           THEN ST_SetSRID(ST_MakePoint(105.700,18.176),4326)
           ELSE ST_ClosestPoint(boundary.geom,b.old_location::geometry)
         END AS anchor
    FROM bad_seed_request b CROSS JOIN boundary
)
SELECT a.id, a.tracking_code, a.old_location,
       location.point AS corrected_location
  FROM anchors a
 CROSS JOIN LATERAL (
   SELECT candidate.point
     FROM generate_series(-12,12) dx
    CROSS JOIN generate_series(-12,12) dy
    CROSS JOIN LATERAL (
      SELECT ST_SetSRID(ST_MakePoint(
        ST_X(a.anchor) + dx * 0.005, ST_Y(a.anchor) + dy * 0.005),4326) AS point
    ) candidate
    WHERE ST_Covers(a.geom,candidate.point)
      AND ST_Distance(ST_Boundary(a.geom),candidate.point) >= 0.003
      AND NOT EXISTS (
        SELECT 1 FROM campaign c WHERE c.status='ACTIVE' AND c.center IS NOT NULL
          AND a.tracking_code LIKE 'C48X%'
          AND ST_DWithin(c.center,candidate.point::geography,c.radius_m)
      )
    ORDER BY ST_Distance(candidate.point::geography,a.anchor::geography),
             ST_Distance(candidate.point::geography,a.old_location)
    LIMIT 1
 ) location;

DO $$ BEGIN
  IF (SELECT count(*) FROM corrected_seed_location) <> 32 THEN
    RAISE EXCEPTION 'Could not find land locations for every misplaced seed report';
  END IF;
END $$;

UPDATE request_subject s
   SET location=f.corrected_location::geography,
       household_reference_note=concat_ws('; ',s.household_reference_note,
         'Tọa độ mô phỏng đã hiệu chỉnh trên đất liền Việt Nam')
  FROM corrected_seed_location f
 WHERE s.request_id=f.id;

SELECT tracking_code,
       round(ST_Distance(old_location,corrected_location::geography)::numeric/1000,1) AS moved_km,
       round(ST_Y(corrected_location)::numeric,5) AS latitude,
       round(ST_X(corrected_location)::numeric,5) AS longitude
  FROM corrected_seed_location ORDER BY tracking_code;

DO $$
DECLARE outside_count int;
BEGIN
  SELECT count(*) INTO outside_count
    FROM assistance_request r
    JOIN request_subject s ON s.request_id=r.id
   CROSS JOIN (
     SELECT ST_GeomFromGeoJSON(
       (pg_read_file('/tmp/vietnam-adm0.geojson')::jsonb->'features'->0->'geometry')::text
     ) AS geom
   ) boundary
   WHERE (r.tracking_code LIKE 'C48X%' OR r.tracking_code LIKE 'C48VN%')
     AND NOT ST_Covers(boundary.geom, s.location::geometry);
  IF outside_count <> 0 THEN
    RAISE EXCEPTION 'Seed reports still lie outside Viet Nam land: %', outside_count;
  END IF;
END $$;

COMMIT;
