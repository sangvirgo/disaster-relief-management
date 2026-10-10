-- EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) evidence for the Response service hot queries (T0-S exit gate).
-- Usage (from this directory, fresh empty database):
--   createdb hr_perf && psql -X -v ON_ERROR_STOP=1 -d hr_perf -f explain-response.sql
-- Fixed seed (setseed). Dataset: 200k assistance_request (+subject), 3k rescue_team (+position, 1-2 skills), ~20k mission, 300k request_event.
-- Each query is run once silently (warm cache) and then recorded.
\set ON_ERROR_STOP on
\i response.sql
SELECT setseed(0.42);
\timing off

-- ---------- catalogs ----------
INSERT INTO region_boundary VALUES
 ('R1', ST_Multi(ST_GeomFromText('POLYGON((106 10,107 10,107 11,106 11,106 10))',4326))),
 ('R2', ST_Multi(ST_GeomFromText('POLYGON((107 10,108 10,108 11,107 11,107 10))',4326))),
 ('R3', ST_Multi(ST_GeomFromText('POLYGON((105 10,106 10,106 11,105 11,105 10))',4326)));
INSERT INTO incident_category VALUES ('FLOOD','Ngập lụt'),('FIRE','Hỏa hoạn'),('MEDICAL','Y tế'),('UNKNOWN','Chưa rõ');
INSERT INTO skill VALUES ('BOAT','Xuồng'),('ROPE','Dây cứu hộ'),('MEDIC','Y tế');
INSERT INTO incident_category_skill VALUES ('FLOOD','BOAT'),('FLOOD','ROPE'),('FIRE','ROPE'),('MEDICAL','MEDIC');
INSERT INTO campaign (id,organization_id,region_code,name,status,created_by_user_id)
  SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', 'R1', 'Chiến dịch '||i, 'ACTIVE', gen_random_uuid() FROM generate_series(1,20) i;

-- ---------- requests (200k): 20% SUBMITTED/VERIFYING, 5% VERIFIED..RESOLVING (10k), 75% terminal; ~1% outside every region ----------
CREATE TEMP TABLE seed AS
SELECT i, gen_random_uuid() AS id, random() AS u, 105 + random()*3.03 AS lon, 10 + random() AS lat,
       random() AS ut, random() AS uc, random() AS uorg, random() AS ucat, random() AS uuser, random() AS ucamp
FROM generate_series(1,200000) i;
CREATE TEMP TABLE camp AS SELECT id, row_number() OVER (ORDER BY id) AS n FROM campaign;

INSERT INTO assistance_request (id,tracking_code,campaign_id,incident_category_code,report_mode,reporter_user_id,reporter_contact_phone,
    organization_id,region_code,status,verifying_since,priority,priority_basis,reporter_declared_danger,resolved_at,received_at)
SELECT s.id, upper(substr(md5(s.i::text),1,12)),
       CASE WHEN s.ucamp < 0.3 THEN (SELECT id FROM camp WHERE n = 1 + (s.i % 20)) END,
       CASE WHEN s.ucat < 0.4 THEN 'FLOOD' WHEN s.ucat < 0.6 THEN 'FIRE' WHEN s.ucat < 0.8 THEN 'MEDICAL' ELSE 'UNKNOWN' END,
       'SELF',
       CASE WHEN s.uuser < 0.5 THEN ('00000000-0000-0000-0000-'||lpad((1 + (s.i % 2000))::text,12,'0'))::uuid END,
       CASE WHEN s.uc < 0.86 THEN '09'||lpad((s.i % 100000000)::text,8,'0') END,
       CASE WHEN s.uorg < 0.9 THEN '00000000-0000-0000-0000-0000000000d1'::uuid ELSE '00000000-0000-0000-0000-0000000000d2'::uuid END,
       CASE WHEN s.lon < 106 THEN 'R3' WHEN s.lon < 107 THEN 'R1' WHEN s.lon < 108 THEN 'R2' END,
       st, CASE WHEN st = 'VERIFYING' THEN now() - s.ut*interval '2 days' END,
       CASE WHEN st IN ('TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING','CLOSED') THEN 'P3' END,
       CASE WHEN st IN ('TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING','CLOSED') THEN 'COMPLETE' END,
       s.u < 0.02,
       CASE WHEN st = 'CLOSED' THEN now() - s.ut*interval '60 days' END,
       now() - s.ut*interval '90 days'
FROM seed s
CROSS JOIN LATERAL (SELECT CASE
   WHEN s.u < 0.10 THEN 'SUBMITTED' WHEN s.u < 0.20 THEN 'VERIFYING'
   WHEN s.u < 0.23 THEN 'VERIFIED' WHEN s.u < 0.235 THEN 'TRIAGED' WHEN s.u < 0.24 THEN 'DISPATCHED' WHEN s.u < 0.245 THEN 'IN_PROGRESS' WHEN s.u < 0.25 THEN 'RESOLVING'
   WHEN s.u < 0.60 THEN 'CLOSED' WHEN s.u < 0.85 THEN 'REJECTED' ELSE 'CANCELLED' END) x(st);
-- a few duplicates pointing at an earlier request
UPDATE assistance_request d SET status='DUPLICATE', canonical_request_id=c.id
  FROM (SELECT a.id AS dup, b.id FROM (SELECT id, row_number() OVER () rn FROM assistance_request WHERE status='REJECTED' LIMIT 2000) a
        JOIN (SELECT id, row_number() OVER () rn FROM assistance_request WHERE status='CLOSED' LIMIT 2000) b USING (rn)) c
 WHERE d.id = c.dup;
INSERT INTO request_subject (request_id,people_affected,location,location_source)
SELECT id, 1 + (i % 9), ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography, 'MANUAL_PIN' FROM seed;

-- ---------- teams (3k), positions, skills ----------
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind,availability)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', 'R1', 'Đội '||i,
       (ARRAY['VOLUNTEER','MILITARY','GOVERNMENT'])[1 + i % 3], CASE WHEN random() < 0.9 THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END
FROM generate_series(1,3000) i;
CREATE TEMP TABLE tm AS SELECT id, row_number() OVER (ORDER BY id) AS n FROM rescue_team;
INSERT INTO team_position (team_id,location,accuracy_m,captured_at,source,set_by_user_id)
SELECT id, ST_SetSRID(ST_MakePoint(106 + random(), 10 + random()),4326)::geography, 15, now() - random()*interval '40 minutes', 'GPS', gen_random_uuid()
FROM tm WHERE n <= 2900;
INSERT INTO team_skill SELECT id, (ARRAY['BOAT','ROPE','MEDIC'])[1 + (n % 3)] FROM tm;
INSERT INTO team_skill SELECT id, (ARRAY['BOAT','ROPE','MEDIC'])[1 + ((n + 1 + (n/3)::int % 2) % 3)] FROM tm WHERE random() < 0.7 ON CONFLICT DO NOTHING;

-- ---------- request_event (300k): 20k verification snapshots + 280k skewed timeline events ----------
CREATE TEMP TABLE snap AS SELECT s.i, s.id AS request_id, gen_random_uuid() AS event_id FROM seed s WHERE s.i <= 20000;
INSERT INTO request_event (id,request_id,event_type,occurred_at)
SELECT event_id, request_id, 'VERIFIED_SNAPSHOT', now() - random()*interval '30 days' FROM snap;
INSERT INTO request_event (request_id,event_type,visibility,from_status,to_status,occurred_at)
SELECT s.id, 'STATUS_CHANGED', CASE WHEN g.i % 3 = 0 THEN 'REPORTER' ELSE 'STAFF' END, 'SUBMITTED', 'VERIFYING', now() - random()*interval '90 days'
FROM (SELECT 1 + floor(power(random(),2)*199999)::int AS i FROM generate_series(1,280000)) g JOIN seed s ON s.i = g.i;

-- ---------- missions (~20k): 1000 teams hold one active mission, the rest are terminal; 10% created in the last 24 h ----------
INSERT INTO mission (request_id,team_id,work_cycle,status,coordinator_user_id,verification_revision,created_at)
SELECT sn.request_id, t.id, 1,
       CASE WHEN sn.i <= 1000 THEN (ARRAY['OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE'])[1 + sn.i % 4]
            ELSE (ARRAY['COMPLETED','COMPLETED','FAILED','DECLINED','CANCELLED'])[1 + sn.i % 5] END,
       gen_random_uuid(), sn.event_id,
       CASE WHEN sn.i % 10 = 0 THEN now() - random()*interval '23 hours' ELSE now() - interval '2 days' - random()*interval '28 days' END
FROM snap sn JOIN tm t ON t.n = 1 + (sn.i % 3000);

ANALYZE;
SELECT 'assistance_request' t, count(*) FROM assistance_request UNION ALL SELECT 'request_subject', count(*) FROM request_subject
 UNION ALL SELECT 'verified+ open', count(*) FROM assistance_request WHERE status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING')
 UNION ALL SELECT 'region NULL', count(*) FROM assistance_request WHERE region_code IS NULL
 UNION ALL SELECT 'rescue_team', count(*) FROM rescue_team UNION ALL SELECT 'team_position', count(*) FROM team_position UNION ALL SELECT 'team_skill', count(*) FROM team_skill
 UNION ALL SELECT 'mission', count(*) FROM mission UNION ALL SELECT 'request_event', count(*) FROM request_event;

-- ---------- parameters ----------
SELECT a.id AS rid, a.organization_id AS oid, s.location AS rloc, a.received_at AS rts, a.incident_category_code AS rcat
  FROM assistance_request a JOIN request_subject s ON s.request_id = a.id
 WHERE a.status = 'VERIFIED' AND a.region_code = 'R1' AND a.incident_category_code = 'FLOOD' AND a.organization_id = '00000000-0000-0000-0000-0000000000d1' AND a.received_at > now() - interval '20 days'
 ORDER BY a.id LIMIT 1 \gset
SELECT campaign_id AS cid FROM assistance_request WHERE campaign_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1 \gset
SELECT reporter_user_id AS uid FROM assistance_request WHERE reporter_user_id IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1 \gset
SELECT request_id AS tid FROM request_event GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1 \gset
-- cursor = last row of page 1 (20 rows)
SELECT received_at AS kts, id AS kid FROM assistance_request WHERE reporter_user_id = :'uid' ORDER BY received_at DESC, id DESC OFFSET 19 LIMIT 1 \gset
SELECT count(*) AS events_on_timeline_request FROM request_event WHERE request_id = :'tid';

-- ---------- queries: stored as text with @token@ placeholders, substituted with quoted literals (so the planner sees constants) ----------
CREATE TEMP TABLE params (k text PRIMARY KEY, v text);
INSERT INTO params VALUES ('rid',:'rid'),('oid',:'oid'),('rloc',:'rloc'),('rts',:'rts'),('rcat',:'rcat'),('cid',:'cid'),('uid',:'uid'),('tid',:'tid'),('kts',:'kts'),('kid',:'kid');
CREATE TEMP TABLE q (n int PRIMARY KEY, label text, sql text);
INSERT INTO q VALUES
(1, 'i   candidate teams (10 km, fresh, AVAILABLE, no active mission, skills superset, band order)', $q$
SELECT * FROM (
  SELECT c.*, min(c.dist_m) OVER () AS nearest_m FROM (
    SELECT t.id AS team_id, ST_Distance(p.location, @rloc@::geography) AS dist_m,
           (SELECT count(*) FROM mission m WHERE m.team_id = t.id AND m.status NOT IN ('DECLINED','CANCELLED') AND m.created_at > now() - interval '24 hours') AS recent_missions
      FROM team_position p
      JOIN rescue_team t ON t.id = p.team_id AND t.status = 'ACTIVE' AND t.availability = 'AVAILABLE'
     WHERE ST_DWithin(p.location, @rloc@::geography, 10000)
       AND p.captured_at > now() - interval '30 minutes'
       AND NOT EXISTS (SELECT 1 FROM mission m WHERE m.team_id = t.id AND m.status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE'))
       AND NOT EXISTS (SELECT 1 FROM incident_category_skill cs WHERE cs.category_code = @rcat@
                        AND NOT EXISTS (SELECT 1 FROM team_skill ts WHERE ts.team_id = t.id AND ts.skill_code = cs.skill_code))
  ) c
) b
ORDER BY (b.dist_m <= b.nearest_m + 2000) DESC,
         CASE WHEN b.dist_m <= b.nearest_m + 2000 THEN b.recent_missions END ASC NULLS LAST,
         b.dist_m, b.team_id
LIMIT 20 $q$),
(2, 'ii  heatmap 1 km grid, 30 days, region R1, org-scoped, verified open canonical', $q$
SELECT ST_SnapToGrid(ST_Transform(s.location::geometry, 32648), 1000) AS cell, count(*) AS n
  FROM assistance_request a JOIN request_subject s ON s.request_id = a.id
 WHERE a.organization_id = @oid@ AND a.region_code = 'R1'
   AND a.status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING') AND a.canonical_request_id IS NULL
   AND a.received_at >= now() - interval '30 days'
 GROUP BY 1 $q$),
(3, 'iii duplicate candidates (same category, +-24 h, within 1 km)', $q$
SELECT a.id, ST_Distance(s.location, @rloc@::geography) AS dist_m
  FROM assistance_request a JOIN request_subject s ON s.request_id = a.id
 WHERE a.organization_id = @oid@ AND a.incident_category_code = @rcat@ AND a.id <> @rid@
   AND a.received_at BETWEEN @rts@::timestamptz - interval '24 hours' AND @rts@::timestamptz + interval '24 hours'
   AND ST_DWithin(s.location, @rloc@::geography, 1000) $q$),
(4, 'iv  request timeline newest 50', $q$
SELECT * FROM request_event WHERE request_id = @tid@ ORDER BY occurred_at DESC, id DESC LIMIT 50 $q$),
(5, 'v   reporter "my requests" keyset page 2', $q$
SELECT id, status, received_at FROM assistance_request
 WHERE reporter_user_id = @uid@ AND (received_at, id) < (@kts@::timestamptz, @kid@::uuid)
 ORDER BY received_at DESC, id DESC LIMIT 20 $q$),
(6, 'vi  unassigned queue (region NULL, open), FIFO 50', $q$
SELECT id, received_at FROM assistance_request
 WHERE organization_id = @oid@ AND region_code IS NULL AND status NOT IN ('REJECTED','DUPLICATE','CANCELLED','CLOSED')
 ORDER BY received_at, id LIMIT 50 $q$),
(7, 'vii campaign-scoped queue (open), FIFO 50', $q$
SELECT id, received_at FROM assistance_request
 WHERE campaign_id = @cid@ AND status NOT IN ('REJECTED','DUPLICATE','CANCELLED','CLOSED')
 ORDER BY received_at, id LIMIT 50 $q$);

CREATE FUNCTION run_explain(do_print boolean) RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE r record; stmt text; p record; line text;
BEGIN
  FOR r IN SELECT * FROM q ORDER BY n LOOP
    stmt := r.sql;
    FOR p IN SELECT * FROM params LOOP stmt := replace(stmt, '@'||p.k||'@', quote_literal(p.v)); END LOOP;
    IF do_print THEN RETURN NEXT '=== ' || r.label; END IF;
    FOR line IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ' || stmt LOOP
      IF do_print THEN RETURN NEXT line; END IF;
    END LOOP;
  END LOOP;
END $$;
SELECT count(*) AS warmup_lines FROM run_explain(false);
\pset tuples_only on
\pset format unaligned
SELECT * FROM run_explain(true);
