-- C48 Response service — SYNTHETIC DEMO SEED (catalogs, region boundaries, campaigns, teams, requests, missions, notices).
-- Target: an EMPTY database that already has docs/backend/schema/response.sql applied (PostgreSQL 16+ / PostGIS 3).
-- Load:   psql -v ON_ERROR_STOP=1 -f seed-response.sql          (single transaction; assertions at the end abort it on mismatch)
--
-- Response has no FK to Identity, so user / organization / region ids are opaque uuids matching seed-identity.sql:
--   ORG_COORD 00000000-0000-4000-8000-000000000001   ORG_VOLUNTEER ...000000000002
--   CAMPAIGN_ACTIVE ...0000c1   CAMPAIGN_DRAFT ...0000c2   users ...000101 .. ...000111 (see seed-identity.sql header)
-- All people, phones (0900000xxx), hashes and call-signs are fictional. received_at / captured_at are relative to now().
--
-- Scenario map (request id suffix -> short name):
--   f1 R1  guest SELF, UNKNOWN category, no phone/headcount/description, GPS in DEMO_A, SUBMITTED, has tracking_secret_hash
--   f2 R2  PROXY by citizen1, VERIFYING, alternate contact, 2 NO_ANSWER attempts (aged: overdue)
--   f3 R3  VERIFIED (CONTACT_CONFIRMED), campaign-linked          f4 R4  DUPLICATE of R3
--   f5 R5  IN_PROGRESS P2, Logistics-admitted, ACCEPTED mission team 1 (+ earlier FAILED mission with EN_ROUTE history)
--   f6 R6  P1 with OFFERED mission to COORDINATOR-mode team 'Đại đội cơ động (demo)'
--   f7 R7  unassigned: region NULL, point lon 105.0 lat 21.0 (deliberately outside DEMO_A and DEMO_B boundaries)
--   f8 R8  RATE_LIMITED_REVIEW lane        f9 R9  declared danger, SUBMITTED, 45 min old (overdue)
--   fa R10 REJECTED with reason            fb R11 PROXY in PROXY_QUOTA_REVIEW lane
--   fc R12 RESOLVED, COMPLETED mission with outcome_note, logistics_admitted_at NULL and NULL seal ("rescue only")
--   fd R13 TRIAGED P3 with no mission yet
-- NOTE: R6 is stored as DISPATCHED (03-response-api.md recompute rule: any OFFERED mission and no accepted work => DISPATCHED);
-- the TRIAGED state is covered by R13.

BEGIN;

CREATE FUNCTION pg_temp.u(h text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('00000000-0000-4000-8000-' || lpad(h, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.pt(lon double precision, lat double precision) RETURNS geography LANGUAGE sql IMMUTABLE AS
$$ SELECT ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography $$;

-- ---------- catalogs ----------
INSERT INTO incident_category (code, display_name) VALUES
  ('FLOOD','Ngập lụt'), ('LANDSLIDE','Sạt lở đất'), ('STORM','Bão, gió lốc'), ('FIRE','Cháy'),
  ('MEDICAL','Cấp cứu y tế'), ('TRAPPED','Người bị mắc kẹt'), ('SUPPLY_SHORTAGE','Thiếu lương thực, nhu yếu phẩm'),
  ('OTHER','Khác'), ('UNKNOWN','Chưa rõ')
ON CONFLICT DO NOTHING;
INSERT INTO skill (code, display_name) VALUES
  ('BOAT','Điều khiển xuồng, thuyền'), ('FIRST_AID','Sơ cấp cứu'), ('CLIMBING','Leo trèo, cứu hộ địa hình'),
  ('TRUCK_DRIVER','Lái xe tải'), ('RADIO','Liên lạc vô tuyến')
ON CONFLICT DO NOTHING;
INSERT INTO incident_category_skill (category_code, skill_code) VALUES
  ('FLOOD','BOAT'), ('TRAPPED','BOAT'), ('MEDICAL','FIRST_AID'), ('LANDSLIDE','CLIMBING')
ON CONFLICT DO NOTHING;

-- Boundaries are simple rectangles. DEMO_A lon 106.60-106.80 / lat 10.70-10.85; DEMO_B lon 107.50-107.70 / lat 16.00-16.15.
-- The point (lon 105.0, lat 21.0) lies in neither, so a request there stays region-less (R7).
INSERT INTO region_boundary (region_code, geom) VALUES
  ('DEMO_A', ST_Multi(ST_MakeEnvelope(106.60, 10.70, 106.80, 10.85, 4326))),
  ('DEMO_B', ST_Multi(ST_MakeEnvelope(107.50, 16.00, 107.70, 16.15, 4326)))
ON CONFLICT DO NOTHING;

-- ---------- campaigns ----------
INSERT INTO campaign (id, organization_id, region_code, name, objective, status, starts_at, ends_at, created_by_user_id, created_at) VALUES
  (pg_temp.u('c1'), pg_temp.u('1'), 'DEMO_A', 'Chiến dịch cứu trợ lũ Khu vực Nam (demo)',
   'Cứu hộ và cứu trợ khẩn cấp cho các hộ bị ngập (dữ liệu demo).', 'ACTIVE',
   now() - interval '7 days', now() + interval '30 days', pg_temp.u('104'), now() - interval '8 days'),
  (pg_temp.u('c2'), pg_temp.u('1'), 'DEMO_B', 'Chiến dịch chuẩn bị mùa mưa bão Khu vực Trung (demo)',
   'Bản nháp chiến dịch chuẩn bị trước mùa mưa bão (dữ liệu demo).', 'DRAFT',
   NULL, NULL, pg_temp.u('104'), now() - interval '2 days')
ON CONFLICT DO NOTHING;

-- ---------- teams ----------
INSERT INTO rescue_team (id, organization_id, operating_region_code, name, team_kind, reporting_mode, external_contact_note,
                         readiness_required, affiliation_verified_at, affiliation_verified_by, availability, created_at) VALUES
  (pg_temp.u('a1'), pg_temp.u('2'), 'DEMO_A', 'Đội xuồng cứu hộ 1',            'VOLUNTEER',  'APP',         NULL, false, now() - interval '5 days', pg_temp.u('102'), 'AVAILABLE',   now() - interval '6 days'),
  (pg_temp.u('a2'), pg_temp.u('2'), 'DEMO_A', 'Đội y tế lưu động',             'VOLUNTEER',  'APP',         NULL, false, now() - interval '5 days', pg_temp.u('102'), 'AVAILABLE',   now() - interval '6 days'),
  (pg_temp.u('a3'), pg_temp.u('1'), 'DEMO_A', 'Đại đội cơ động (demo)',        'MILITARY',   'COORDINATOR', 'Liên lạc qua bộ đàm, hô hiệu DEMO-ALPHA (giả lập); tần số do điều phối viên giữ.', false, now() - interval '4 days', pg_temp.u('102'), 'AVAILABLE', now() - interval '5 days'),
  (pg_temp.u('a4'), pg_temp.u('1'), 'DEMO_A', 'Đội cứu hỏa - cứu nạn (demo)',  'GOVERNMENT', 'COORDINATOR', 'Liên hệ trực ban qua số nội bộ 0900000900 (giả lập).', false, now() - interval '4 days', pg_temp.u('102'), 'AVAILABLE', now() - interval '5 days'),
  -- readiness latch example: not yet verified and flagged UNAVAILABLE until a leader and affiliation are confirmed
  (pg_temp.u('a5'), pg_temp.u('2'), 'DEMO_A', 'Đội tình nguyện dự bị',         'VOLUNTEER',  'APP',         NULL, true,  NULL, NULL, 'UNAVAILABLE', now() - interval '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO team_member (team_id, user_id, member_role) VALUES
  (pg_temp.u('a1'), pg_temp.u('10c'), 'LEADER'),
  (pg_temp.u('a1'), pg_temp.u('10e'), 'MEMBER'),
  (pg_temp.u('a2'), pg_temp.u('10d'), 'LEADER')
ON CONFLICT DO NOTHING;

INSERT INTO team_skill (team_id, skill_code) VALUES
  (pg_temp.u('a1'), 'BOAT'), (pg_temp.u('a1'), 'FIRST_AID'), (pg_temp.u('a2'), 'FIRST_AID'),
  (pg_temp.u('a3'), 'RADIO'), (pg_temp.u('a3'), 'TRUCK_DRIVER')
ON CONFLICT DO NOTHING;

INSERT INTO team_position (team_id, location, accuracy_m, captured_at, source, set_by_user_id) VALUES
  (pg_temp.u('a1'), pg_temp.pt(106.70, 10.78), 12.0, now() - interval '2 minutes',  'GPS',                 pg_temp.u('10c')),
  (pg_temp.u('a2'), pg_temp.pt(106.65, 10.73), 18.0, now() - interval '40 minutes', 'GPS',                 pg_temp.u('10d')),   -- stale
  (pg_temp.u('a3'), pg_temp.pt(106.75, 10.80), NULL, now() - interval '5 minutes',  'COORDINATOR_REPORTED', pg_temp.u('102'))
ON CONFLICT DO NOTHING;

-- ---------- requests (snapshot pointer is set after the snapshot events exist) ----------
-- R1 guest SELF, as little information as possible
INSERT INTO assistance_request (id, tracking_code, tracking_secret_hash, incident_category_code, report_mode, organization_id, region_code,
                                status, review_lane, received_at) VALUES
  (pg_temp.u('f1'), 'C48DEM0001', 'demo$sha256$0000000000000000000000000000000000000000000000000000000000000001',
   'UNKNOWN', 'SELF', pg_temp.u('1'), 'DEMO_A', 'SUBMITTED', 'NORMAL', now() - interval '5 minutes');

-- R2 PROXY by citizen1, VERIFYING (verifying_since older than the 15 min threshold)
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_user_id, reporter_name, reporter_contact_phone,
                                description, organization_id, region_code, status, verifying_since, received_at) VALUES
  (pg_temp.u('f2'), 'C48DEM0002', 'FLOOD', 'PROXY', pg_temp.u('10f'), 'Người dân 1 (demo)', '0900000002',
   'Báo hộ người thân lớn tuổi sống một mình, nước dâng quá thắt lưng.', pg_temp.u('1'), 'DEMO_A', 'VERIFYING',
   now() - interval '90 minutes', now() - interval '2 hours');

-- R3 VERIFIED, campaign-linked
INSERT INTO assistance_request (id, tracking_code, campaign_id, incident_category_code, report_mode, reporter_user_id, reporter_name, reporter_contact_phone,
                                description, organization_id, region_code, status, received_at) VALUES
  (pg_temp.u('f3'), 'C48DEM0003', pg_temp.u('c1'), 'FLOOD', 'SELF', pg_temp.u('110'), 'Người dân 2 (demo)', '0900000003',
   'Nước ngập tầng trệt, còn 4 người trong nhà.', pg_temp.u('1'), 'DEMO_A', 'VERIFIED', now() - interval '3 hours');

-- R4 duplicate of R3
INSERT INTO assistance_request (id, tracking_code, incident_category_code, canonical_request_id, report_mode, reporter_contact_phone,
                                description, organization_id, region_code, status, received_at) VALUES
  (pg_temp.u('f4'), 'C48DEM0004', 'FLOOD', pg_temp.u('f3'), 'SELF', '0900000004',
   'Cùng địa chỉ với báo cáo trước, gọi lại vì lo lắng.', pg_temp.u('1'), 'DEMO_A', 'DUPLICATE', now() - interval '150 minutes');

-- R5 IN_PROGRESS, admitted by Logistics, campaign-linked (the request Logistics links to)
INSERT INTO assistance_request (id, tracking_code, campaign_id, incident_category_code, report_mode, reporter_user_id, reporter_name, reporter_contact_phone,
                                description, organization_id, region_code, status, priority, priority_basis, work_cycle,
                                attribution_locked_at, logistics_admitted_at, received_at, version) VALUES
  (pg_temp.u('f5'), 'C48DEM0005', pg_temp.u('c1'), 'TRAPPED', 'SELF', pg_temp.u('10f'), 'Người dân 1 (demo)', '0900000005',
   'Gia đình 5 người mắc kẹt trên mái nhà, cần xuồng và nhu yếu phẩm.', pg_temp.u('1'), 'DEMO_A', 'IN_PROGRESS', 'P2', 'COMPLETE', 1,
   now() - interval '5 hours', now() - interval '4 hours', now() - interval '6 hours', 6);

-- R6 P1 with an OFFERED mission (DISPATCHED)
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_user_id, reporter_name, reporter_contact_phone,
                                description, organization_id, region_code, status, priority, priority_basis, reporter_declared_danger,
                                attribution_locked_at, received_at, version) VALUES
  (pg_temp.u('f6'), 'C48DEM0006', 'TRAPPED', 'SELF', pg_temp.u('110'), 'Người dân 2 (demo)', '0900000006',
   'Có người già và trẻ nhỏ bị mắc kẹt, nước đang lên nhanh.', pg_temp.u('1'), 'DEMO_A', 'DISPATCHED', 'P1', 'COMPLETE', true,
   now() - interval '50 minutes', now() - interval '2 hours', 5);

-- R7 unassigned region, location outside every boundary
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_contact_phone, description,
                                organization_id, region_code, status, received_at) VALUES
  (pg_temp.u('f7'), 'C48DEM0007', 'OTHER', 'SELF', '0900000007', 'Vị trí nằm ngoài các khu vực đã cấu hình, cần điều phối viên gán khu vực.',
   pg_temp.u('1'), NULL, 'SUBMITTED', now() - interval '8 minutes');

-- R8 rate-limited review lane (guest, repeated submissions from one source)
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_contact_phone, source_ip_hash, description,
                                organization_id, region_code, status, review_lane, received_at) VALUES
  (pg_temp.u('f8'), 'C48DEM0008', 'UNKNOWN', 'SELF', '0900000008', 'demo-ip-hash-0001', 'Nhiều báo cáo liên tiếp từ cùng một nguồn.',
   pg_temp.u('1'), 'DEMO_A', 'SUBMITTED', 'RATE_LIMITED_REVIEW', now() - interval '12 minutes');

-- R9 declared danger, SUBMITTED, aged 45 minutes
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_contact_phone, description,
                                organization_id, region_code, status, reporter_declared_danger, received_at) VALUES
  (pg_temp.u('f9'), 'C48DEM0009', 'FIRE', 'SELF', '0900000009', 'Cháy lan nhanh gần khu dân cư, người báo cho biết đang gặp nguy hiểm.',
   pg_temp.u('1'), 'DEMO_A', 'SUBMITTED', true, now() - interval '45 minutes');

-- R10 REJECTED with reason
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_contact_phone, description,
                                organization_id, region_code, status, received_at) VALUES
  (pg_temp.u('fa'), 'C48DEM0010', 'OTHER', 'SELF', '0900000010', 'Nội dung thử nghiệm, không có sự cố.',
   pg_temp.u('1'), 'DEMO_A', 'REJECTED', now() - interval '1 day');

-- R11 PROXY report held in the proxy quota review lane
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_user_id, reporter_name, reporter_contact_phone,
                                description, organization_id, region_code, status, review_lane, received_at) VALUES
  (pg_temp.u('fb'), 'C48DEM0011', 'SUPPLY_SHORTAGE', 'PROXY', pg_temp.u('110'), 'Người dân 2 (demo)', '0900000011',
   'Báo hộ nhiều hộ trong cùng một xóm, vượt hạn mức báo hộ.', pg_temp.u('1'), 'DEMO_A', 'SUBMITTED', 'PROXY_QUOTA_REVIEW',
   now() - interval '20 minutes');

-- R12 RESOLVED rescue-only: Logistics never admitted it => no seal (resolved_pair CHECK allows NULL seal only then)
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_user_id, reporter_name, reporter_contact_phone,
                                description, organization_id, region_code, status, priority, priority_basis, work_cycle,
                                attribution_locked_at, logistics_admitted_at, resolution_seal_id, resolved_at, received_at, version) VALUES
  (pg_temp.u('fc'), 'C48DEM0012', 'MEDICAL', 'SELF', pg_temp.u('10f'), 'Người dân 1 (demo)', '0900000012',
   'Người bị thương nhẹ cần sơ cứu và đưa đến trạm y tế.', pg_temp.u('1'), 'DEMO_A', 'RESOLVED', 'P3', 'COMPLETE', 1,
   now() - interval '20 hours', NULL, NULL, now() - interval '18 hours', now() - interval '22 hours', 8);

-- R13 TRIAGED, no mission yet
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, reporter_contact_phone, description,
                                organization_id, region_code, status, priority, priority_basis, received_at, version) VALUES
  (pg_temp.u('fd'), 'C48DEM0013', 'LANDSLIDE', 'SELF', '0900000013', 'Sạt lở nhẹ chặn lối vào nhà, chưa có người bị thương.',
   pg_temp.u('1'), 'DEMO_A', 'TRIAGED', 'P3', 'INCOMPLETE_INFO', now() - interval '3 hours', 4);

-- ---------- request subjects ----------
INSERT INTO request_subject (request_id, people_affected, location, location_source, location_accuracy_m, location_captured_at,
                             reporter_relationship, beneficiary_contact_phone, alternate_contact_name, alternate_contact_phone,
                             information_source, contactability) VALUES
  (pg_temp.u('f1'), NULL, pg_temp.pt(106.66, 10.77), 'GPS', 25.0, now() - interval '5 minutes', NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.u('f2'), 3,    pg_temp.pt(106.72, 10.74), 'MANUAL_PIN', NULL, NULL, 'Con cháu', NULL, 'Người hàng xóm (demo)', '0900000102', 'Người nhà báo qua điện thoại', 'UNKNOWN'),
  (pg_temp.u('f3'), 4,    pg_temp.pt(106.68, 10.76), 'GPS', 15.0, now() - interval '3 hours', NULL, '0900000003', NULL, NULL, NULL, 'REACHABLE'),
  (pg_temp.u('f4'), 4,    pg_temp.pt(106.68, 10.76), 'GPS', 30.0, now() - interval '150 minutes', NULL, NULL, NULL, NULL, NULL, 'REACHABLE'),
  (pg_temp.u('f5'), 5,    pg_temp.pt(106.69, 10.79), 'GPS', 10.0, now() - interval '6 hours', NULL, '0900000005', NULL, NULL, NULL, 'REACHABLE'),
  (pg_temp.u('f6'), 3,    pg_temp.pt(106.74, 10.81), 'GPS', 8.0,  now() - interval '2 hours', NULL, '0900000006', NULL, NULL, NULL, 'REACHABLE'),
  (pg_temp.u('f7'), 2,    pg_temp.pt(105.00, 21.00), 'MANUAL_PIN', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'UNKNOWN'),
  (pg_temp.u('f8'), NULL, pg_temp.pt(106.63, 10.72), 'GPS', 40.0, now() - interval '12 minutes', NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.u('f9'), 6,    pg_temp.pt(106.77, 10.83), 'GPS', 20.0, now() - interval '45 minutes', NULL, '0900000009', NULL, NULL, NULL, 'REACHABLE'),
  (pg_temp.u('fa'), 1,    pg_temp.pt(106.62, 10.71), 'MANUAL_PIN', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'UNKNOWN'),
  (pg_temp.u('fb'), 12,   pg_temp.pt(106.64, 10.74), 'MANUAL_PIN', NULL, NULL, 'Hàng xóm', NULL, 'Trưởng xóm (demo)', '0900000111', 'Người báo hộ trực tiếp quan sát', 'REACHABLE'),
  (pg_temp.u('fc'), 1,    pg_temp.pt(106.71, 10.77), 'GPS', 12.0, now() - interval '22 hours', NULL, '0900000012', NULL, NULL, NULL, 'REACHABLE'),
  (pg_temp.u('fd'), 2,    pg_temp.pt(106.78, 10.82), 'MANUAL_PIN', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'UNKNOWN');

-- ---------- timeline events (REPORTER-visible submission + staff events) ----------
-- event id scheme: 'e' + request suffix (1-2 hex) + 2-digit sequence, e.g. request f5 -> e5xx, request fc -> ecxx
INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility, from_status, to_status, reason, payload, occurred_at) VALUES
  (pg_temp.u('e101'), pg_temp.u('f1'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '5 minutes'),
  (pg_temp.u('e201'), pg_temp.u('f2'), pg_temp.u('10f'),   'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '2 hours'),
  (pg_temp.u('e202'), pg_temp.u('f2'), pg_temp.u('106'),   'VERIFICATION_STARTED', 'REPORTER', 'SUBMITTED', 'VERIFYING', NULL, '{"public_text_code":"VERIFYING"}', now() - interval '90 minutes'),
  (pg_temp.u('e301'), pg_temp.u('f3'), pg_temp.u('110'),   'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '3 hours'),
  (pg_temp.u('e302'), pg_temp.u('f3'), pg_temp.u('108'),   'VERIFICATION_APPROVED', 'REPORTER', 'VERIFYING', 'VERIFIED', NULL,
     '{"public_text_code":"VERIFIED","snapshot":{"incident_category_code":"FLOOD","people_affected":4,"region_code":"DEMO_A"}}', now() - interval '170 minutes'),
  (pg_temp.u('e401'), pg_temp.u('f4'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '150 minutes'),
  (pg_temp.u('e402'), pg_temp.u('f4'), pg_temp.u('108'),   'MARKED_DUPLICATE', 'REPORTER', 'SUBMITTED', 'DUPLICATE', 'Trùng với báo cáo C48DEM0003.', '{"public_text_code":"DUPLICATE"}', now() - interval '140 minutes'),
  (pg_temp.u('e501'), pg_temp.u('f5'), pg_temp.u('10f'),   'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '6 hours'),
  (pg_temp.u('e502'), pg_temp.u('f5'), pg_temp.u('108'),   'VERIFICATION_APPROVED', 'REPORTER', 'VERIFYING', 'VERIFIED', NULL,
     '{"public_text_code":"VERIFIED","snapshot":{"incident_category_code":"TRAPPED","people_affected":5,"region_code":"DEMO_A"}}', now() - interval '330 minutes'),
  (pg_temp.u('e503'), pg_temp.u('f5'), pg_temp.u('102'),   'TRIAGED', 'STAFF', 'VERIFIED', 'TRIAGED', 'Ưu tiên P2: có trẻ nhỏ, nước đang rút chậm.', '{"priority":"P2"}', now() - interval '320 minutes'),
  (pg_temp.u('e504'), pg_temp.u('f5'), pg_temp.u('102'),   'MISSION_OFFERED', 'STAFF', 'TRIAGED', 'DISPATCHED', NULL, '{"mission_id":"00000000-0000-4000-8000-0000000000b2","team_id":"00000000-0000-4000-8000-0000000000a2"}', now() - interval '300 minutes'),
  (pg_temp.u('e505'), pg_temp.u('f5'), pg_temp.u('10d'),   'MISSION_EN_ROUTE', 'REPORTER', 'DISPATCHED', 'IN_PROGRESS', NULL, '{"public_text_code":"TEAM_EN_ROUTE","mission_id":"00000000-0000-4000-8000-0000000000b2"}', now() - interval '280 minutes'),
  (pg_temp.u('e506'), pg_temp.u('f5'), pg_temp.u('102'),   'MISSION_FAILED', 'STAFF', 'IN_PROGRESS', 'TRIAGED', 'Xuồng không tiếp cận được do dòng chảy mạnh.', '{"mission_id":"00000000-0000-4000-8000-0000000000b2"}', now() - interval '250 minutes'),
  (pg_temp.u('e507'), pg_temp.u('f5'), pg_temp.u('102'),   'MISSION_FAILURE_REVIEW', 'STAFF', NULL, NULL, 'Đã xem xét, giao lại cho đội xuồng khác.', '{"mission_id":"00000000-0000-4000-8000-0000000000b2"}', now() - interval '240 minutes'),
  (pg_temp.u('e508'), pg_temp.u('f5'), pg_temp.u('102'),   'MISSION_OFFERED', 'STAFF', 'TRIAGED', 'DISPATCHED', NULL, '{"mission_id":"00000000-0000-4000-8000-0000000000b1","team_id":"00000000-0000-4000-8000-0000000000a1"}', now() - interval '230 minutes'),
  (pg_temp.u('e509'), pg_temp.u('f5'), pg_temp.u('10c'),   'MISSION_ACCEPTED', 'REPORTER', 'DISPATCHED', 'IN_PROGRESS', NULL, '{"public_text_code":"TEAM_ASSIGNED","mission_id":"00000000-0000-4000-8000-0000000000b1"}', now() - interval '220 minutes'),
  (pg_temp.u('e601'), pg_temp.u('f6'), pg_temp.u('110'),   'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '2 hours'),
  (pg_temp.u('e602'), pg_temp.u('f6'), pg_temp.u('108'),   'VERIFICATION_APPROVED', 'REPORTER', 'VERIFYING', 'VERIFIED', NULL,
     '{"public_text_code":"VERIFIED","snapshot":{"incident_category_code":"TRAPPED","people_affected":3,"region_code":"DEMO_A"}}', now() - interval '100 minutes'),
  (pg_temp.u('e603'), pg_temp.u('f6'), pg_temp.u('102'),   'TRIAGED', 'STAFF', 'VERIFIED', 'TRIAGED', 'Ưu tiên P1: nguy hiểm đến tính mạng.', '{"priority":"P1"}', now() - interval '60 minutes'),
  (pg_temp.u('e604'), pg_temp.u('f6'), pg_temp.u('102'),   'MISSION_OFFERED', 'STAFF', 'TRIAGED', 'DISPATCHED', NULL, '{"mission_id":"00000000-0000-4000-8000-0000000000b3","team_id":"00000000-0000-4000-8000-0000000000a3"}', now() - interval '50 minutes'),
  (pg_temp.u('e701'), pg_temp.u('f7'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '8 minutes'),
  (pg_temp.u('e801'), pg_temp.u('f8'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '12 minutes'),
  (pg_temp.u('e901'), pg_temp.u('f9'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '45 minutes'),
  (pg_temp.u('ea01'), pg_temp.u('fa'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '1 day'),
  (pg_temp.u('ea02'), pg_temp.u('fa'), pg_temp.u('108'),   'REQUEST_REJECTED', 'REPORTER', 'SUBMITTED', 'REJECTED', 'Báo cáo thử nghiệm, không có sự cố thực tế.', '{"public_text_code":"REJECTED"}', now() - interval '23 hours'),
  (pg_temp.u('eb01'), pg_temp.u('fb'), pg_temp.u('110'),   'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '20 minutes'),
  (pg_temp.u('ec01'), pg_temp.u('fc'), pg_temp.u('10f'),   'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '22 hours'),
  (pg_temp.u('ec02'), pg_temp.u('fc'), pg_temp.u('109'),   'VERIFICATION_APPROVED', 'REPORTER', 'VERIFYING', 'VERIFIED', NULL,
     '{"public_text_code":"VERIFIED","snapshot":{"incident_category_code":"MEDICAL","people_affected":1,"region_code":"DEMO_A"}}', now() - interval '21 hours'),
  (pg_temp.u('ec03'), pg_temp.u('fc'), pg_temp.u('103'),   'TRIAGED', 'STAFF', 'VERIFIED', 'TRIAGED', NULL, '{"priority":"P3"}', now() - interval '20 hours'),
  (pg_temp.u('ec04'), pg_temp.u('fc'), pg_temp.u('103'),   'MISSION_OFFERED', 'STAFF', 'TRIAGED', 'DISPATCHED', NULL, '{"mission_id":"00000000-0000-4000-8000-0000000000b4"}', now() - interval '20 hours'),
  (pg_temp.u('ec05'), pg_temp.u('fc'), pg_temp.u('10d'),   'MISSION_ACCEPTED', 'REPORTER', 'DISPATCHED', 'IN_PROGRESS', NULL, '{"public_text_code":"TEAM_ASSIGNED"}', now() - interval '19 hours'),
  (pg_temp.u('ec06'), pg_temp.u('fc'), pg_temp.u('103'),   'REQUEST_RESOLVED', 'REPORTER', 'IN_PROGRESS', 'RESOLVED', 'Đã sơ cứu và bàn giao trạm y tế.', '{"public_text_code":"RESOLVED"}', now() - interval '18 hours'),
  (pg_temp.u('ed01'), pg_temp.u('fd'), NULL,               'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED', NULL, '{"public_text_code":"RECEIVED"}', now() - interval '3 hours'),
  (pg_temp.u('ed02'), pg_temp.u('fd'), pg_temp.u('108'),   'VERIFICATION_APPROVED', 'REPORTER', 'VERIFYING', 'VERIFIED', NULL,
     '{"public_text_code":"VERIFIED","snapshot":{"incident_category_code":"LANDSLIDE","people_affected":2,"region_code":"DEMO_A"}}', now() - interval '170 minutes'),
  (pg_temp.u('ed03'), pg_temp.u('fd'), pg_temp.u('102'),   'TRIAGED', 'STAFF', 'VERIFIED', 'TRIAGED', 'Thông tin còn thiếu, ưu tiên tạm thời P3.', '{"priority":"P3"}', now() - interval '160 minutes');

-- approved snapshot pointers (same-request FK)
UPDATE assistance_request r SET verification_revision = pg_temp.u(s.ev)
FROM (VALUES ('f3','e302'),('f5','e502'),('f6','e602'),('fc','ec02'),('fd','ed02')) AS s(req, ev)
WHERE r.id = pg_temp.u(s.req);

-- ---------- contact attempts, decisions ----------
INSERT INTO contact_attempt (id, request_id, actor_user_id, contact_target, outcome, note, attempted_at) VALUES
  (pg_temp.u('d1'), pg_temp.u('f2'), pg_temp.u('106'), 'REPORTER',  'NO_ANSWER', 'Gọi 2 hồi chuông, không bắt máy.', now() - interval '80 minutes'),
  (pg_temp.u('d2'), pg_temp.u('f2'), pg_temp.u('106'), 'ALTERNATE', 'NO_ANSWER', 'Số liên hệ phụ cũng không trả lời.', now() - interval '60 minutes'),
  (pg_temp.u('d3'), pg_temp.u('f3'), pg_temp.u('107'), 'REPORTER',  'REACHED',   'Người báo xác nhận địa chỉ và số người.', now() - interval '175 minutes');

INSERT INTO verification_decision (id, request_id, outcome, basis, reviewer_user_id, reason, reason_kind, decided_at) VALUES
  (pg_temp.u('d101'), pg_temp.u('f3'), 'VERIFIED',  'CONTACT_CONFIRMED', pg_temp.u('108'), NULL, NULL, now() - interval '170 minutes'),
  (pg_temp.u('d102'), pg_temp.u('f4'), 'DUPLICATE', NULL,                pg_temp.u('108'), 'Trùng với báo cáo C48DEM0003 cùng địa chỉ.', NULL, now() - interval '140 minutes'),
  (pg_temp.u('d103'), pg_temp.u('fa'), 'REJECTED',  NULL,                pg_temp.u('108'), 'Báo cáo thử nghiệm, không có sự cố thực tế.', 'CLEARLY_INVALID', now() - interval '23 hours'),
  (pg_temp.u('d104'), pg_temp.u('f5'), 'VERIFIED',  'CORROBORATED',      pg_temp.u('108'), NULL, NULL, now() - interval '330 minutes'),
  (pg_temp.u('d105'), pg_temp.u('f6'), 'VERIFIED',  'CONTACT_CONFIRMED', pg_temp.u('108'), NULL, NULL, now() - interval '100 minutes'),
  (pg_temp.u('d106'), pg_temp.u('fc'), 'VERIFIED',  'CONTACT_CONFIRMED', pg_temp.u('109'), NULL, NULL, now() - interval '21 hours'),
  (pg_temp.u('d107'), pg_temp.u('fd'), 'VERIFIED',  'EVIDENCE_REVIEWED', pg_temp.u('108'), NULL, NULL, now() - interval '170 minutes');

-- ---------- missions ----------
-- capacity-one: team 1 holds one active mission (R5), team 3 holds one (R6); teams 2, 4, 5 hold none.
INSERT INTO mission (id, request_id, team_id, work_cycle, status, coordinator_user_id, suggested_team_id, verification_revision, created_at, version) VALUES
  (pg_temp.u('b2'), pg_temp.u('f5'), pg_temp.u('a2'), 1, 'FAILED',    pg_temp.u('102'), pg_temp.u('a2'), pg_temp.u('e502'), now() - interval '300 minutes', 4),
  (pg_temp.u('b4'), pg_temp.u('fc'), pg_temp.u('a2'), 1, 'COMPLETED', pg_temp.u('103'), pg_temp.u('a2'), pg_temp.u('ec02'), now() - interval '20 hours', 5),
  (pg_temp.u('b1'), pg_temp.u('f5'), pg_temp.u('a1'), 1, 'ACCEPTED',  pg_temp.u('102'), pg_temp.u('a1'), pg_temp.u('e502'), now() - interval '230 minutes', 2),
  (pg_temp.u('b3'), pg_temp.u('f6'), pg_temp.u('a3'), 1, 'OFFERED',   pg_temp.u('102'), pg_temp.u('a3'), pg_temp.u('e602'), now() - interval '50 minutes', 1);

INSERT INTO mission_event (id, mission_id, actor_user_id, from_status, to_status, reason, outcome_note, occurred_at, recorded_at) VALUES
  -- b2: earlier failed attempt on R5 (EN_ROUTE history)
  (pg_temp.u('1b21'), pg_temp.u('b2'), pg_temp.u('102'), NULL,        'OFFERED',  NULL, NULL, now() - interval '300 minutes', now() - interval '300 minutes'),
  (pg_temp.u('1b22'), pg_temp.u('b2'), pg_temp.u('10d'), 'OFFERED',   'ACCEPTED', NULL, NULL, now() - interval '295 minutes', now() - interval '295 minutes'),
  (pg_temp.u('1b23'), pg_temp.u('b2'), pg_temp.u('10d'), 'ACCEPTED',  'EN_ROUTE', NULL, NULL, now() - interval '280 minutes', now() - interval '280 minutes'),
  (pg_temp.u('1b24'), pg_temp.u('b2'), pg_temp.u('10d'), 'EN_ROUTE',  'FAILED',   'Xuồng không tiếp cận được do dòng chảy mạnh.', NULL, now() - interval '250 minutes', now() - interval '250 minutes'),
  -- b1: current accepted mission on R5
  (pg_temp.u('1b11'), pg_temp.u('b1'), pg_temp.u('102'), NULL,        'OFFERED',  NULL, NULL, now() - interval '230 minutes', now() - interval '230 minutes'),
  (pg_temp.u('1b12'), pg_temp.u('b1'), pg_temp.u('10c'), 'OFFERED',   'ACCEPTED', NULL, NULL, now() - interval '220 minutes', now() - interval '220 minutes'),
  -- b3: offered to a COORDINATOR-mode team, not yet answered
  (pg_temp.u('1b31'), pg_temp.u('b3'), pg_temp.u('102'), NULL,        'OFFERED',  NULL, NULL, now() - interval '50 minutes', now() - interval '50 minutes'),
  -- b4: R12 completed with a human outcome note
  (pg_temp.u('1b41'), pg_temp.u('b4'), pg_temp.u('103'), NULL,        'OFFERED',   NULL, NULL, now() - interval '20 hours', now() - interval '20 hours'),
  (pg_temp.u('1b42'), pg_temp.u('b4'), pg_temp.u('10d'), 'OFFERED',   'ACCEPTED',  NULL, NULL, now() - interval '19 hours', now() - interval '19 hours'),
  (pg_temp.u('1b43'), pg_temp.u('b4'), pg_temp.u('10d'), 'ACCEPTED',  'EN_ROUTE',  NULL, NULL, now() - interval '1130 minutes', now() - interval '1130 minutes'),
  (pg_temp.u('1b44'), pg_temp.u('b4'), pg_temp.u('10d'), 'EN_ROUTE',  'ON_SCENE',  NULL, NULL, now() - interval '1100 minutes', now() - interval '1100 minutes'),
  (pg_temp.u('1b45'), pg_temp.u('b4'), pg_temp.u('10d'), 'ON_SCENE',  'COMPLETED', NULL, 'Đã sơ cứu vết thương và đưa người bị thương đến trạm y tế gần nhất (demo).', now() - interval '18 hours', now() - interval '18 hours');

-- closed resolution intent for R12 (command state machine finished; no seal because Logistics never admitted the request)
INSERT INTO resolution_intent (id, request_id, work_cycle, kind, state, actor_user_id, expected_request_version, previous_status, reason, version, created_at, updated_at) VALUES
  (pg_temp.u('1e1'), pg_temp.u('fc'), 1, 'RESOLUTION', 'COMPLETED', pg_temp.u('103'), 7, 'IN_PROGRESS', 'Đã sơ cứu và bàn giao trạm y tế.', 2,
   now() - interval '18 hours' - interval '1 minute', now() - interval '18 hours');

-- ---------- notices for coord1 (codes + ids only; Vietnamese text is rendered from the catalog) ----------
INSERT INTO notice (id, recipient_user_id, source_id, source_version, notice_type, payload, created_at, read_at) VALUES
  (pg_temp.u('1f1'), pg_temp.u('102'), pg_temp.u('f9'), 1, 'REQUEST_OVERDUE',
     '{"request_id":"00000000-0000-4000-8000-0000000000f9","reason_code":"DECLARED_DANGER_AGED","review_lane":"NORMAL"}', now() - interval '20 minutes', NULL),
  (pg_temp.u('1f2'), pg_temp.u('102'), pg_temp.u('b3'), 1, 'MISSION_OFFER_PENDING',
     '{"mission_id":"00000000-0000-4000-8000-0000000000b3","request_id":"00000000-0000-4000-8000-0000000000f6","team_id":"00000000-0000-4000-8000-0000000000a3"}', now() - interval '50 minutes', NULL),
  (pg_temp.u('1f3'), pg_temp.u('102'), pg_temp.u('f2'), 1, 'REQUEST_OVERDUE',
     '{"request_id":"00000000-0000-4000-8000-0000000000f2","reason_code":"VERIFYING_AGED","review_lane":"NORMAL"}', now() - interval '30 minutes', now() - interval '10 minutes');

-- minimal audit trail (evidence_metadata intentionally empty: the demo seed carries no files)
INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason)
VALUES (NULL, 'SEED_LOADED', 'SYSTEM', 'seed-response', 'Dữ liệu demo tổng hợp, không phải người thật');

-- ---------- scenario assertions (RAISE EXCEPTION aborts the whole transaction) ----------
\o /dev/null
CREATE FUNCTION pg_temp.must(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'SEED ASSERTION FAILED: %', label; END IF; END $$;

SELECT pg_temp.must('13 requests', (SELECT count(*) FROM assistance_request) = 13);
SELECT pg_temp.must('every request has exactly one subject', (SELECT count(*) FROM request_subject) = 13);
SELECT pg_temp.must('statuses covered: SUBMITTED VERIFYING VERIFIED DUPLICATE REJECTED TRIAGED DISPATCHED IN_PROGRESS RESOLVED',
  (SELECT count(DISTINCT status) FROM assistance_request WHERE status IN ('SUBMITTED','VERIFYING','VERIFIED','DUPLICATE','REJECTED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVED')) = 9);
SELECT pg_temp.must('one request per non-NORMAL lane',
  (SELECT count(*) FROM assistance_request WHERE review_lane = 'RATE_LIMITED_REVIEW') = 1
  AND (SELECT count(*) FROM assistance_request WHERE review_lane = 'PROXY_QUOTA_REVIEW') = 1);
SELECT pg_temp.must('R1 minimal guest report',
  (SELECT reporter_user_id IS NULL AND reporter_contact_phone IS NULL AND description IS NULL AND tracking_secret_hash IS NOT NULL
          AND incident_category_code = 'UNKNOWN' AND region_code = 'DEMO_A' FROM assistance_request WHERE id = pg_temp.u('f1'))
  AND (SELECT people_affected IS NULL FROM request_subject WHERE request_id = pg_temp.u('f1')));
SELECT pg_temp.must('R2 proxy verifying with 2 NO_ANSWER attempts and alternate contact',
  (SELECT report_mode = 'PROXY' AND status = 'VERIFYING' FROM assistance_request WHERE id = pg_temp.u('f2'))
  AND (SELECT count(*) FROM contact_attempt WHERE request_id = pg_temp.u('f2') AND outcome = 'NO_ANSWER') = 2
  AND (SELECT alternate_contact_phone IS NOT NULL FROM request_subject WHERE request_id = pg_temp.u('f2')));
SELECT pg_temp.must('R3 verified with CONTACT_CONFIRMED and snapshot',
  (SELECT status = 'VERIFIED' AND verification_revision IS NOT NULL FROM assistance_request WHERE id = pg_temp.u('f3'))
  AND EXISTS (SELECT 1 FROM verification_decision WHERE request_id = pg_temp.u('f3') AND basis = 'CONTACT_CONFIRMED'));
SELECT pg_temp.must('R4 duplicate of R3', (SELECT canonical_request_id = pg_temp.u('f3') AND status = 'DUPLICATE' FROM assistance_request WHERE id = pg_temp.u('f4')));
SELECT pg_temp.must('R5 in progress, admitted, accepted mission for team 1, campaign-linked',
  (SELECT status = 'IN_PROGRESS' AND work_cycle = 1 AND attribution_locked_at IS NOT NULL AND logistics_admitted_at IS NOT NULL
          AND campaign_id = pg_temp.u('c1') AND region_code = 'DEMO_A' AND resolution_seal_id IS NULL FROM assistance_request WHERE id = pg_temp.u('f5'))
  AND EXISTS (SELECT 1 FROM mission m JOIN request_event e ON e.id = m.verification_revision AND e.request_id = m.request_id
              WHERE m.request_id = pg_temp.u('f5') AND m.team_id = pg_temp.u('a1') AND m.status = 'ACCEPTED')
  AND EXISTS (SELECT 1 FROM mission_event WHERE to_status = 'EN_ROUTE' AND mission_id IN (SELECT id FROM mission WHERE request_id = pg_temp.u('f5'))));
SELECT pg_temp.must('R6 P1 with OFFERED mission to a COORDINATOR-mode military team',
  (SELECT priority = 'P1' FROM assistance_request WHERE id = pg_temp.u('f6'))
  AND EXISTS (SELECT 1 FROM mission m JOIN rescue_team t ON t.id = m.team_id
              WHERE m.request_id = pg_temp.u('f6') AND m.status = 'OFFERED' AND t.reporting_mode = 'COORDINATOR' AND t.team_kind = 'MILITARY'));
SELECT pg_temp.must('R7 unassigned and outside every boundary',
  (SELECT region_code IS NULL FROM assistance_request WHERE id = pg_temp.u('f7'))
  AND NOT EXISTS (SELECT 1 FROM region_boundary b, request_subject s WHERE s.request_id = pg_temp.u('f7') AND ST_Intersects(b.geom, s.location::geometry)));
SELECT pg_temp.must('R9 declared danger SUBMITTED older than 20 minutes',
  (SELECT reporter_declared_danger AND status = 'SUBMITTED' AND received_at < now() - interval '20 minutes' FROM assistance_request WHERE id = pg_temp.u('f9')));
SELECT pg_temp.must('R10 rejected with reason',
  EXISTS (SELECT 1 FROM verification_decision WHERE request_id = pg_temp.u('fa') AND outcome = 'REJECTED' AND reason IS NOT NULL)
  AND (SELECT status = 'REJECTED' FROM assistance_request WHERE id = pg_temp.u('fa')));
SELECT pg_temp.must('R12 resolved without seal or Logistics admission, completed mission has outcome_note',
  (SELECT status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolution_seal_id IS NULL AND logistics_admitted_at IS NULL FROM assistance_request WHERE id = pg_temp.u('fc'))
  AND EXISTS (SELECT 1 FROM mission m JOIN mission_event me ON me.mission_id = m.id
              WHERE m.request_id = pg_temp.u('fc') AND m.status = 'COMPLETED' AND me.outcome_note IS NOT NULL));
SELECT pg_temp.must('capacity-one: every team has at most one active mission and exactly 2 are active',
  (SELECT coalesce(max(c), 0) FROM (SELECT count(*) c FROM mission WHERE status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE') GROUP BY team_id) x) = 1
  AND (SELECT count(*) FROM mission WHERE status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE')) = 2);
SELECT pg_temp.must('teams: 5 teams, mixed kinds/modes, stale position, no position, readiness latch',
  (SELECT count(*) FROM rescue_team) = 5
  AND (SELECT count(*) FROM rescue_team WHERE reporting_mode = 'COORDINATOR' AND external_contact_note IS NOT NULL) = 2
  AND (SELECT count(*) FROM team_position WHERE captured_at < now() - interval '30 minutes') = 1
  AND NOT EXISTS (SELECT 1 FROM team_position WHERE team_id = pg_temp.u('a4'))
  AND NOT EXISTS (SELECT 1 FROM team_member WHERE team_id IN (pg_temp.u('a3'), pg_temp.u('a4')))
  AND EXISTS (SELECT 1 FROM rescue_team WHERE id = pg_temp.u('a5') AND readiness_required AND availability = 'UNAVAILABLE'));
SELECT pg_temp.must('regions do not overlap and 9 categories / 5 skills / 4 category-skill links',
  NOT (SELECT ST_Intersects(a.geom, b.geom) FROM region_boundary a, region_boundary b WHERE a.region_code = 'DEMO_A' AND b.region_code = 'DEMO_B')
  AND (SELECT count(*) FROM incident_category) = 9 AND (SELECT count(*) FROM skill) = 5 AND (SELECT count(*) FROM incident_category_skill) = 4);
SELECT pg_temp.must('2 campaigns ACTIVE+DRAFT; 3 notices for coord1',
  (SELECT count(*) FROM campaign WHERE status IN ('ACTIVE','DRAFT')) = 2
  AND (SELECT count(*) FROM notice WHERE recipient_user_id = pg_temp.u('102')) = 3
  AND (SELECT count(*) FROM evidence_metadata) = 0);

\o
COMMIT;
