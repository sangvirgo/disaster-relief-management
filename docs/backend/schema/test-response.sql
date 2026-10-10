\i constraint-tests.sql
CREATE OR REPLACE FUNCTION assert_that(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS TRUE THEN RAISE NOTICE 'PASS %', label; ELSE RAISE EXCEPTION 'FAIL %', label; END IF; END $$;
-- stricter helper: the statement must fail with the given SQLSTATE and constraint/index name
CREATE OR REPLACE FUNCTION expect_err(label text, stmt text, want_state text, want_constraint text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text; cn text;
BEGIN
  BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAIL % (statement succeeded)', label USING ERRCODE = 'XX999';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, cn = CONSTRAINT_NAME;
    IF st = 'XX999' THEN RAISE; END IF;
    cn := nullif(cn,''); IF st <> want_state OR cn IS DISTINCT FROM want_constraint THEN
      RAISE EXCEPTION 'FAIL % (got % / %, wanted % / %)', label, st, cn, want_state, want_constraint USING ERRCODE = 'XX999';
    END IF;
    RAISE NOTICE 'PASS % [% %]', label, st, cn;
  END;
END $$;

INSERT INTO region_boundary VALUES ('R1', ST_Multi(ST_GeomFromText('POLYGON((106 10,107 10,107 11,106 11,106 10))',4326)));
SELECT expect_fail('invalid (bowtie) region polygon', $$INSERT INTO region_boundary VALUES ('BAD', ST_Multi(ST_GeomFromText('POLYGON((0 0,1 1,1 0,0 1,0 0))',4326)))$$);
-- fixture seed (data, not DDL): UNKNOWN category with no required skills
INSERT INTO incident_category VALUES ('FLOOD','Ngập lụt'),('UNKNOWN','Chưa rõ');
INSERT INTO skill VALUES ('BOAT','Xuồng');
INSERT INTO incident_category_skill VALUES ('FLOOD','BOAT');
SELECT expect_err('category skill unknown skill', $$INSERT INTO incident_category_skill VALUES ('FLOOD','NOPE')$$, '23503', 'incident_category_skill_skill_code_fkey');
SELECT expect_err('category skill duplicate pair', $$INSERT INTO incident_category_skill VALUES ('FLOOD','BOAT')$$, '23505', 'incident_category_skill_pkey');
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind) VALUES
 ('00000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'R1','Đội A','VOLUNTEER');
SELECT expect_fail('unknown region code on team', $$INSERT INTO rescue_team (organization_id,operating_region_code,name,team_kind) VALUES (gen_random_uuid(),'ZZ','Đội B','VOLUNTEER')$$);

-- team reporting mode
SELECT expect_err('reporting_mode value', $$INSERT INTO rescue_team (organization_id,operating_region_code,name,team_kind,reporting_mode) VALUES (gen_random_uuid(),'R1','Đội X','VOLUNTEER','RADIO')$$, '23514', 'rescue_team_reporting_mode_check');
SELECT expect_err('COORDINATOR team without contact note (NULL)', $$INSERT INTO rescue_team (organization_id,operating_region_code,name,team_kind,reporting_mode) VALUES (gen_random_uuid(),'R1','Đội C','GOVERNMENT','COORDINATOR')$$, '23514', 'coordinator_needs_contact');
SELECT expect_err('COORDINATOR team with blank contact note', $$INSERT INTO rescue_team (organization_id,operating_region_code,name,team_kind,reporting_mode,external_contact_note) VALUES (gen_random_uuid(),'R1','Đội C','GOVERNMENT','COORDINATOR','   ')$$, '23514', 'coordinator_needs_contact');
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind,reporting_mode,external_contact_note) VALUES
 ('00000000-0000-0000-0000-0000000000a2',gen_random_uuid(),'R1','Đội QS','MILITARY','COORDINATOR','Chỉ huy: 0900111222');   -- accepted with zero members
SELECT assert_that('COORDINATOR team accepted with zero members, readiness_required defaults false', (SELECT count(*) FROM team_member WHERE team_id='00000000-0000-0000-0000-0000000000a2')=0 AND (SELECT readiness_required FROM rescue_team WHERE id='00000000-0000-0000-0000-0000000000a2')=false);

-- request intake: optional phone/headcount
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id)
 VALUES ('00000000-0000-0000-0000-0000000000b1','TRK0000001','FLOOD','SELF','0900000000',gen_random_uuid()),
        ('00000000-0000-0000-0000-0000000000b2','TRK0000002','FLOOD','SELF','0900000000',gen_random_uuid());
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,organization_id)
 VALUES ('00000000-0000-0000-0000-0000000000b4','TRK0000010','UNKNOWN','SELF',gen_random_uuid());   -- NULL phone accepted
SELECT assert_that('SOS with NULL phone accepted', (SELECT reporter_contact_phone FROM assistance_request WHERE id='00000000-0000-0000-0000-0000000000b4') IS NULL);
INSERT INTO request_subject (request_id,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b4',NULL,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN');   -- NULL headcount and NULL contactability for SELF
SELECT assert_that('SELF subject with NULL people_affected and NULL contactability accepted', (SELECT people_affected FROM request_subject WHERE request_id='00000000-0000-0000-0000-0000000000b4') IS NULL);
SELECT expect_err('supplied phone format (empty)', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000009','FLOOD','SELF','',gen_random_uuid())$$, '23514', 'assistance_request_reporter_contact_phone_check');
SELECT expect_err('supplied phone format (letters)', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000011','FLOOD','SELF','abc',gen_random_uuid())$$, '23514', 'assistance_request_reporter_contact_phone_check');
SELECT expect_err('supplied people_affected 0', $$INSERT INTO request_subject (request_id,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b2',0,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN')$$, '23514', 'request_subject_people_affected_check');
SELECT expect_err('supplied people_affected 10001', $$INSERT INTO request_subject (request_id,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b2',10001,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN')$$, '23514', 'request_subject_people_affected_check');
SELECT expect_err('GEOCODED location source is gone', $$INSERT INTO request_subject (request_id,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b2',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'GEOCODED')$$, '23514', 'location_source_shape');

-- verification snapshot events (same-request FK target)
INSERT INTO request_event (id,request_id,event_type) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1','VERIFIED_SNAPSHOT'),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000b2','VERIFIED_SNAPSHOT');
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1');
SELECT expect_err('team capacity-one (second active mission)', $$INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision) VALUES ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid(),'00000000-0000-0000-0000-0000000000e2')$$, '23505', 'mission_team_one_active_uq');
SELECT expect_err('mission verification_revision from another request', $$INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id,verification_revision) VALUES ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2',1,gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1')$$, '23503', 'mission_verification_revision_request_id_fkey');
SELECT expect_err('mission verification_revision is required', $$INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id) VALUES ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2',1,gen_random_uuid())$$, '23502', NULL);
SELECT expect_err('request verification_revision from another request', $$UPDATE assistance_request SET verification_revision='00000000-0000-0000-0000-0000000000e2' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23503', 'request_verification_revision_fk');
UPDATE assistance_request SET verification_revision='00000000-0000-0000-0000-0000000000e1' WHERE id='00000000-0000-0000-0000-0000000000b1';
SELECT assert_that('request verification_revision from own request accepted', (SELECT verification_revision FROM assistance_request WHERE id='00000000-0000-0000-0000-0000000000b1')='00000000-0000-0000-0000-0000000000e1');

SELECT expect_err('PROXY requires account', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000003','FLOOD','PROXY','0900000000',gen_random_uuid())$$, '23514', 'proxy_needs_account');
SELECT expect_err('DUPLICATE needs canonical', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id,status) VALUES ('TRK0000004','FLOOD','SELF','0900000000',gen_random_uuid(),'DUPLICATE')$$, '23514', 'duplicate_has_canonical');
SELECT expect_err('duplicate tracking_code', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000001','FLOOD','SELF','0900000000',gen_random_uuid())$$, '23505', 'assistance_request_tracking_code_key');
SELECT expect_err('tracking code format (blank)', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('  ','FLOOD','SELF','0900000000',gen_random_uuid())$$, '23514', 'assistance_request_tracking_code_check');
SELECT expect_fail('invalid status value', $$UPDATE assistance_request SET status='LOL'$$);
SELECT expect_err('TRIAGED needs priority', $$UPDATE assistance_request SET status='TRIAGED' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23514', 'triaged_has_priority');
SELECT expect_err('priority needs basis', $$UPDATE assistance_request SET priority='P1' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23514', 'priority_pair');
SELECT expect_err('VERIFYING needs verifying_since', $$UPDATE assistance_request SET status='VERIFYING' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23514', 'verifying_since_set');

-- resolved_pair rework and attribution/admission locks
SELECT expect_err('seal without resolved_at', $$UPDATE assistance_request SET resolution_seal_id='00000000-0000-0000-0000-00000000005f' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23514', 'resolved_pair');
SELECT expect_err('logistics_admitted_at without attribution_locked_at', $$UPDATE assistance_request SET logistics_admitted_at=now() WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23514', 'admitted_implies_locked');
SELECT expect_err('RESOLVED needs resolved_at', $$UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23514', 'resolved_status');
-- not admitted: resolved_at with NULL seal is fine
UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE',resolved_at=now() WHERE id='00000000-0000-0000-0000-0000000000b4';
SELECT assert_that('resolved with NULL seal accepted when not admitted', (SELECT status FROM assistance_request WHERE id='00000000-0000-0000-0000-0000000000b4')='RESOLVED');
-- admitted: NULL seal rejected, seal accepted
UPDATE assistance_request SET attribution_locked_at=now(), logistics_admitted_at=now() WHERE id='00000000-0000-0000-0000-0000000000b2';
SELECT expect_err('resolved_at with NULL seal rejected when admitted', $$UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE',resolved_at=now() WHERE id='00000000-0000-0000-0000-0000000000b2'$$, '23514', 'resolved_pair');
UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE',resolved_at=now(),resolution_seal_id='00000000-0000-0000-0000-00000000005e' WHERE id='00000000-0000-0000-0000-0000000000b2';
SELECT expect_err('one seal per request', $$UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE',resolved_at=now(),resolution_seal_id='00000000-0000-0000-0000-00000000005e' WHERE id='00000000-0000-0000-0000-0000000000b1'$$, '23505', 'request_seal_uq');

SELECT expect_fail('override needs reason', $$UPDATE mission SET suggested_team_id=gen_random_uuid()$$);
SELECT expect_fail('evidence XOR owner', $$INSERT INTO evidence_metadata (object_key,declared_bytes) VALUES ('k1',10)$$);
SELECT expect_fail('evidence mime allow-list', $$INSERT INTO evidence_metadata (request_id,object_key,declared_bytes,detected_mime) VALUES ('00000000-0000-0000-0000-0000000000b1','k2',10,'application/x-msdownload')$$);
INSERT INTO evidence_metadata (request_id,object_key,declared_bytes) VALUES ('00000000-0000-0000-0000-0000000000b1','dup-key',10),('00000000-0000-0000-0000-0000000000b1','dup-key',10);
SELECT 'PASS object_key is no longer unique' ;
SELECT expect_fail('TWO_COORDINATOR needs distinct second', $$INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,concurring_user_id) VALUES ('00000000-0000-0000-0000-0000000000b1','VERIFIED','TWO_COORDINATOR_JUDGMENT','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')$$);
SELECT expect_fail('REJECTED carries no basis', $$INSERT INTO verification_decision (request_id,outcome,basis,reason,reviewer_user_id) VALUES ('00000000-0000-0000-0000-0000000000b1','REJECTED','CORROBORATED','x','00000000-0000-0000-0000-000000000001')$$);

-- request_event: append-only and review uniqueness
INSERT INTO request_event (request_id,event_type) VALUES ('00000000-0000-0000-0000-0000000000b1','X');
SELECT expect_fail('request_event append-only', $$UPDATE request_event SET event_type='Y'$$);
SELECT expect_fail('request_event cannot be truncated', $$TRUNCATE request_event CASCADE$$);
SELECT expect_fail('event status vocabulary', $$INSERT INTO request_event (request_id,event_type,to_status) VALUES ('00000000-0000-0000-0000-0000000000b1','X','ZZZ')$$);
INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-0000000000b1','SUPPLEMENT_REVIEW','{"reviewed_event_id":"00000000-0000-0000-0000-0000000000e1"}');
SELECT expect_err('duplicate SUPPLEMENT_REVIEW for same reviewed event', $$INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-0000000000b1','SUPPLEMENT_REVIEW','{"reviewed_event_id":"00000000-0000-0000-0000-0000000000e1"}')$$, '23505', 'request_event_supplement_review_uq');
INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-0000000000b1','SUPPLEMENT_REVIEW','{"reviewed_event_id":"00000000-0000-0000-0000-0000000000e9"}');
INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-0000000000b1','MISSION_FAILURE_REVIEW','{"mission_id":"00000000-0000-0000-0000-0000000000f1"}');
SELECT expect_err('duplicate MISSION_FAILURE_REVIEW for same mission', $$INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-0000000000b1','MISSION_FAILURE_REVIEW','{"mission_id":"00000000-0000-0000-0000-0000000000f1"}')$$, '23505', 'request_event_failure_review_uq');
INSERT INTO request_event (request_id,event_type,payload) VALUES ('00000000-0000-0000-0000-0000000000b1','AUTHORITY_REFERRED','{"referred_body":"UBND"}'),('00000000-0000-0000-0000-0000000000b1','AUTHORITY_REFERRED','{"referred_body":"UBND"}');
SELECT assert_that('AUTHORITY_REFERRED events are not unique-constrained, authority_referral table gone', to_regclass('authority_referral') IS NULL);

-- resolution_intent
INSERT INTO resolution_intent (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status) VALUES ('00000000-0000-0000-0000-0000000000b1',1,'RESOLUTION',gen_random_uuid(),1,'TRIAGED');
SELECT assert_that('resolution_intent version defaults to 1', (SELECT version FROM resolution_intent LIMIT 1)=1);
SELECT expect_err('one open intent per request', $$INSERT INTO resolution_intent (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status) VALUES ('00000000-0000-0000-0000-0000000000b1',1,'CANCELLATION',gen_random_uuid(),1,'TRIAGED')$$, '23505', 'resolution_intent_one_open_uq');
SELECT expect_err('intent version >= 1', $$INSERT INTO resolution_intent (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status,state,version) VALUES ('00000000-0000-0000-0000-0000000000b1',1,'CANCELLATION',gen_random_uuid(),1,'TRIAGED','ABORTED',0)$$, '23514', 'resolution_intent_version_check');
SELECT expect_err('intent reason nonblank', $$INSERT INTO resolution_intent (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status,state,reason) VALUES ('00000000-0000-0000-0000-0000000000b1',1,'CANCELLATION',gen_random_uuid(),1,'TRIAGED','ABORTED','  ')$$, '23514', 'resolution_intent_reason_check');

-- team_member: membership = left_at IS NULL
INSERT INTO team_member (team_id,user_id,member_role) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000011','LEADER');
SELECT expect_err('one active leader per team', $$INSERT INTO team_member (team_id,user_id,member_role) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000012','LEADER')$$, '23505', 'team_one_leader_uq');
SELECT expect_err('one active team per user', $$INSERT INTO team_member (team_id,user_id,member_role) VALUES ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000011','MEMBER')$$, '23505', 'team_member_one_team_uq');
UPDATE team_member SET left_at=now() WHERE user_id='00000000-0000-0000-0000-000000000011';
INSERT INTO team_member (team_id,user_id,member_role) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000012','LEADER'),('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000011','MEMBER');
SELECT 'PASS leaving (left_at) frees the leader slot and the one-team slot' ;

-- subject rules (report_mode lives on the request; PROXY rules are a trigger)
SELECT expect_fail('GPS needs accuracy + capture time', $$INSERT INTO request_subject (request_id,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b1',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'GPS')$$);
SELECT expect_fail('manual pin must not fabricate accuracy', $$INSERT INTO request_subject (request_id,people_affected,location,location_source,location_accuracy_m) VALUES ('00000000-0000-0000-0000-0000000000b1',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN',5)$$);
INSERT INTO request_subject (request_id,people_affected,location,location_source,location_accuracy_m,location_captured_at) VALUES ('00000000-0000-0000-0000-0000000000b1',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'GPS',12,now());
INSERT INTO team_position VALUES ('00000000-0000-0000-0000-0000000000a1',ST_GeogFromText('SRID=4326;POINT(106.71 10.775)'),10,now(),'GPS',gen_random_uuid());
SELECT 'nearby teams within 10km: '||count(*) FROM team_position tp JOIN request_subject rs ON ST_DWithin(tp.location,rs.location,10000);
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,reporter_user_id,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b3','TRK0000007','FLOOD','PROXY',gen_random_uuid(),gen_random_uuid());
SELECT expect_err('PROXY without relationship (NULL)', $$INSERT INTO request_subject (request_id,people_affected,location,location_source,contactability) VALUES ('00000000-0000-0000-0000-0000000000b3',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN','REACHABLE')$$, '23514', 'proxy_has_relationship');
SELECT expect_err('PROXY with blank relationship', $$INSERT INTO request_subject (request_id,people_affected,location,location_source,contactability,reporter_relationship) VALUES ('00000000-0000-0000-0000-0000000000b3',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN','REACHABLE','  ')$$, '23514', 'proxy_has_relationship');
SELECT expect_err('PROXY without contactability', $$INSERT INTO request_subject (request_id,people_affected,location,location_source,reporter_relationship) VALUES ('00000000-0000-0000-0000-0000000000b3',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN','Hàng xóm')$$, '23514', 'proxy_has_contactability');
SELECT expect_err('contactability vocabulary', $$INSERT INTO request_subject (request_id,people_affected,location,location_source,contactability,reporter_relationship) VALUES ('00000000-0000-0000-0000-0000000000b3',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN','MAYBE','Hàng xóm')$$, '23514', 'request_subject_contactability_check');
INSERT INTO request_subject (request_id,people_affected,location,location_source,contactability,reporter_relationship) VALUES ('00000000-0000-0000-0000-0000000000b3',NULL,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN','UNKNOWN','Hàng xóm');
SELECT 'PASS PROXY with relationship, contactability, NULL headcount and NULL phone accepted';

-- mission_event
INSERT INTO mission (id,request_id,team_id,work_cycle,coordinator_user_id,verification_revision,status) VALUES ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2',1,gen_random_uuid(),'00000000-0000-0000-0000-0000000000e2','COMPLETED');
INSERT INTO mission_event (mission_id,actor_user_id,to_status,outcome_note) VALUES ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'COMPLETED','Đã đưa 3 người ra khỏi vùng ngập');
SELECT assert_that('mission_event has recorded_at default', (SELECT recorded_at FROM mission_event LIMIT 1) IS NOT NULL);
SELECT expect_err('outcome_note nonblank', $$INSERT INTO mission_event (mission_id,actor_user_id,to_status,outcome_note) VALUES ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'COMPLETED','  ')$$, '23514', 'mission_event_outcome_note_check');
SELECT expect_fail('recorded_basis needs reported_by', $$INSERT INTO mission_event (mission_id,actor_user_id,to_status,recorded_basis,reason) VALUES ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'COMPLETED','RADIO','x')$$);
SELECT expect_fail('mission_event append-only', $$UPDATE mission_event SET reason='x'$$);

-- capability_recovery
INSERT INTO capability_recovery (id,request_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1','hash-1',now()+interval '30 minutes',gen_random_uuid(),'IDENTITY_CHECKED');
SELECT expect_err('capability_recovery code_hash unique', $$INSERT INTO capability_recovery (request_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-0000000000b1','hash-1',now()+interval '30 minutes',gen_random_uuid(),'x')$$, '23505', 'capability_recovery_code_hash_key');
SELECT expect_err('capability_recovery consumed_at without consumer', $$UPDATE capability_recovery SET consumed_at=now()$$, '23514', 'consumed_pair');
SELECT expect_err('capability_recovery consumer without consumed_at', $$UPDATE capability_recovery SET consumed_by_user_id=gen_random_uuid()$$, '23514', 'consumed_pair');
SELECT expect_err('capability_recovery expires_at must follow created_at', $$INSERT INTO capability_recovery (request_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-0000000000b1','hash-2',now()-interval '1 minute',gen_random_uuid(),'x')$$, '23514', 'expires_after_created');
SELECT expect_err('capability_recovery request must exist', $$INSERT INTO capability_recovery (request_id,code_hash,expires_at,issued_by_user_id,basis) VALUES (gen_random_uuid(),'hash-3',now()+interval '1 minute',gen_random_uuid(),'x')$$, '23503', 'capability_recovery_request_id_fkey');
UPDATE capability_recovery SET consumed_at=now(), consumed_by_user_id=gen_random_uuid();
SELECT 'PASS capability_recovery consumed pair accepted together';

-- idempotency_record
SELECT expect_err('idempotency resource pair (type only)', $$INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash,resource_type) VALUES ('s','c',gen_random_uuid(),'h','REQUEST')$$, '23514', 'idempotency_record_check');
INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash,resource_type,resource_id) VALUES ('s','c',gen_random_uuid(),'h','REQUEST',gen_random_uuid());
SELECT 'PASS idempotency resource pair accepted';

-- notice
INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type) VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-0000000000b1',1,'T');
SELECT expect_err('notice dedupe', $$INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type) VALUES ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-0000000000b1',1,'T')$$, '23505', 'notice_source_id_source_version_recipient_user_id_notice_ty_key');

-- planner check for the attention-index query shape
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT id FROM assistance_request WHERE organization_id='00000000-0000-0000-0000-000000000001' AND status IN ('SUBMITTED','VERIFYING') ORDER BY received_at, id LIMIT 50;
RESET enable_seqscan;

-- ---------- restricted application role c48_response_app ----------
SET ROLE c48_response_app;
SELECT expect_sqlstate('app role: UPDATE audit_log denied', $$UPDATE audit_log SET action='z'$$, '42501');
SELECT expect_sqlstate('app role: DELETE audit_log denied', $$DELETE FROM audit_log$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE audit_log denied', $$TRUNCATE audit_log$$, '42501');
SELECT expect_sqlstate('app role: UPDATE request_event denied', $$UPDATE request_event SET reason='x'$$, '42501');
SELECT expect_sqlstate('app role: DELETE request_event denied', $$DELETE FROM request_event$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE request_event denied', $$TRUNCATE request_event CASCADE$$, '42501');
SELECT expect_sqlstate('app role: UPDATE mission_event denied', $$UPDATE mission_event SET reason='x'$$, '42501');
SELECT expect_sqlstate('app role: DELETE mission_event denied', $$DELETE FROM mission_event$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE mission_event denied', $$TRUNCATE mission_event$$, '42501');
SELECT expect_sqlstate('app role: UPDATE verification_decision denied', $$UPDATE verification_decision SET reason='x'$$, '42501');
SELECT expect_sqlstate('app role: DELETE verification_decision denied', $$DELETE FROM verification_decision$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE verification_decision denied', $$TRUNCATE verification_decision$$, '42501');
SELECT expect_sqlstate('app role: UPDATE contact_attempt denied', $$UPDATE contact_attempt SET note='x'$$, '42501');
SELECT expect_sqlstate('app role: DELETE contact_attempt denied', $$DELETE FROM contact_attempt$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE contact_attempt denied', $$TRUNCATE contact_attempt$$, '42501');
SELECT expect_sqlstate('app role: DELETE assistance_request denied', $$DELETE FROM assistance_request$$, '42501');
SELECT expect_sqlstate('app role: DELETE mission denied', $$DELETE FROM mission$$, '42501');
SELECT expect_sqlstate('app role: INSERT catalog skill denied (seed data)', $$INSERT INTO skill VALUES ('X1','x')$$, '42501');
SELECT expect_sqlstate('app role: CREATE FUNCTION denied', $$CREATE FUNCTION app_made_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'$$, '42501');
SELECT expect_sqlstate('app role: CREATE TABLE denied', $$CREATE TABLE app_made_tbl (a int)$$, '42501');
-- legitimate writes
UPDATE assistance_request SET status='CANCELLED', version=version+1 WHERE id='00000000-0000-0000-0000-0000000000b2';
INSERT INTO request_event (request_id,event_type,from_status,to_status) VALUES ('00000000-0000-0000-0000-0000000000b2','CANCELLED','SUBMITTED','CANCELLED');
INSERT INTO mission_event (mission_id,actor_user_id,to_status) VALUES ('00000000-0000-0000-0000-0000000000f2',gen_random_uuid(),'COMPLETED');
INSERT INTO audit_log (action,entity_type,entity_id) VALUES ('app.insert','request','b2');
UPDATE mission SET status='CANCELLED', version=version+1 WHERE id='00000000-0000-0000-0000-0000000000f2';
DELETE FROM notice WHERE source_id='00000000-0000-0000-0000-0000000000b1';
DELETE FROM idempotency_record;
DELETE FROM evidence_metadata;
SELECT 'PASS app role: legitimate insert/update/cleanup-delete allowed';
RESET ROLE;
SELECT assert_that('app role writes visible after RESET ROLE', (SELECT status FROM assistance_request WHERE id='00000000-0000-0000-0000-0000000000b2')='CANCELLED');
