\i constraint-tests.sql
INSERT INTO region_boundary VALUES ('R1', ST_Multi(ST_GeomFromText('POLYGON((106 10,107 10,107 11,106 11,106 10))',4326)),'synthetic');
SELECT expect_fail('invalid (bowtie) region polygon', $$INSERT INTO region_boundary VALUES ('BAD', ST_Multi(ST_GeomFromText('POLYGON((0 0,1 1,1 0,0 1,0 0))',4326)),'x')$$);
INSERT INTO incident_category VALUES ('FLOOD','Ngập lụt','ACTIVE');
INSERT INTO skill VALUES ('BOAT','Xuồng');
INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind) VALUES
 ('00000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'R1','Đội A','VOLUNTEER');
SELECT expect_fail('unknown region code on team', $$INSERT INTO rescue_team (organization_id,operating_region_code,name,team_kind) VALUES (gen_random_uuid(),'ZZ','Đội B','VOLUNTEER')$$);
INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id)
 VALUES ('00000000-0000-0000-0000-0000000000b1','TRK0000001','FLOOD','SELF','0900000000',gen_random_uuid()),
        ('00000000-0000-0000-0000-0000000000b2','TRK0000002','FLOOD','SELF','0900000000',gen_random_uuid());
INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid());
SELECT expect_fail('team capacity-one (second active mission)', $$INSERT INTO mission (request_id,team_id,work_cycle,coordinator_user_id) VALUES ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',1,gen_random_uuid())$$);
SELECT expect_fail('PROXY requires account', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000003','FLOOD','PROXY','0900000000',gen_random_uuid())$$);
SELECT expect_fail('DUPLICATE needs canonical', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id,status) VALUES ('TRK0000004','FLOOD','SELF','0900000000',gen_random_uuid(),'DUPLICATE')$$);
SELECT expect_fail('duplicate tracking_code', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000001','FLOOD','SELF','0900000000',gen_random_uuid())$$);
SELECT expect_fail('tracking code format (blank)', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('  ','FLOOD','SELF','0900000000',gen_random_uuid())$$);
SELECT expect_fail('phone format', $$INSERT INTO assistance_request (tracking_code,incident_category_code,report_mode,reporter_contact_phone,organization_id) VALUES ('TRK0000009','FLOOD','SELF','',gen_random_uuid())$$);
SELECT expect_fail('invalid status value', $$UPDATE assistance_request SET status='LOL'$$);
SELECT expect_fail('TRIAGED needs priority', $$UPDATE assistance_request SET status='TRIAGED' WHERE id='00000000-0000-0000-0000-0000000000b1'$$);
SELECT expect_fail('priority needs basis', $$UPDATE assistance_request SET priority='P1' WHERE id='00000000-0000-0000-0000-0000000000b1'$$);
SELECT expect_fail('resolved_at without seal', $$UPDATE assistance_request SET resolved_at=now() WHERE id='00000000-0000-0000-0000-0000000000b1'$$);
SELECT expect_fail('VERIFYING needs verifying_since', $$UPDATE assistance_request SET status='VERIFYING' WHERE id='00000000-0000-0000-0000-0000000000b1'$$);
UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE',resolved_at=now(),resolution_seal_id='00000000-0000-0000-0000-00000000005e' WHERE id='00000000-0000-0000-0000-0000000000b2';
SELECT expect_fail('one seal per request', $$UPDATE assistance_request SET status='RESOLVED',priority='P2',priority_basis='COMPLETE',resolved_at=now(),resolution_seal_id='00000000-0000-0000-0000-00000000005e' WHERE id='00000000-0000-0000-0000-0000000000b1'$$);
SELECT expect_fail('terminal mission needs ended_at', $$UPDATE mission SET status='COMPLETED'$$);
SELECT expect_fail('ACCEPTED needs accepted_at', $$UPDATE mission SET status='ACCEPTED'$$);
SELECT expect_fail('override needs reason', $$UPDATE mission SET suggested_team_id=gen_random_uuid()$$);
SELECT expect_fail('evidence XOR owner', $$INSERT INTO evidence_metadata (object_key,declared_bytes) VALUES ('k1',10)$$);
SELECT expect_fail('evidence mime allow-list', $$INSERT INTO evidence_metadata (request_id,object_key,declared_bytes,detected_mime) VALUES ('00000000-0000-0000-0000-0000000000b1','k2',10,'application/x-msdownload')$$);
SELECT expect_fail('TWO_COORDINATOR needs distinct second', $$INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,concurring_user_id) VALUES ('00000000-0000-0000-0000-0000000000b1','VERIFIED','TWO_COORDINATOR_JUDGMENT','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')$$);
SELECT expect_fail('REJECTED carries no basis', $$INSERT INTO verification_decision (request_id,outcome,basis,reason,reviewer_user_id) VALUES ('00000000-0000-0000-0000-0000000000b1','REJECTED','CORROBORATED','x','00000000-0000-0000-0000-000000000001')$$);
INSERT INTO request_event (request_id,event_type) VALUES ('00000000-0000-0000-0000-0000000000b1','X');
SELECT expect_fail('request_event append-only', $$UPDATE request_event SET event_type='Y'$$);
SELECT expect_fail('request_event cannot be truncated', $$TRUNCATE request_event$$);
SELECT expect_fail('event status vocabulary', $$INSERT INTO request_event (request_id,event_type,to_status) VALUES ('00000000-0000-0000-0000-0000000000b1','X','ZZZ')$$);
INSERT INTO resolution_intent (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status) VALUES ('00000000-0000-0000-0000-0000000000b1',1,'RESOLUTION',gen_random_uuid(),1,'TRIAGED');
SELECT expect_fail('one open intent per request', $$INSERT INTO resolution_intent (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status) VALUES ('00000000-0000-0000-0000-0000000000b1',1,'CANCELLATION',gen_random_uuid(),1,'TRIAGED')$$);
INSERT INTO team_member (team_id,user_id,member_role) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000011','LEADER');
SELECT expect_fail('one active leader per team', $$INSERT INTO team_member (team_id,user_id,member_role) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000012','LEADER')$$);
SELECT expect_fail('INACTIVE member needs left_at', $$UPDATE team_member SET status='INACTIVE'$$);
-- subject rules
SELECT expect_fail('GPS needs accuracy + capture time', $$INSERT INTO request_subject (request_id,report_mode,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b1','SELF',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'GPS')$$);
SELECT expect_fail('manual pin must not fabricate accuracy', $$INSERT INTO request_subject (request_id,report_mode,people_affected,location,location_source,location_accuracy_m) VALUES ('00000000-0000-0000-0000-0000000000b1','SELF',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN',5)$$);
SELECT expect_fail('subject mode must match request mode', $$INSERT INTO request_subject (request_id,report_mode,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b1','PROXY',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN')$$);
INSERT INTO request_subject (request_id,report_mode,people_affected,location,location_source,location_accuracy_m,location_captured_at) VALUES ('00000000-0000-0000-0000-0000000000b1','SELF',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'GPS',12,now());
INSERT INTO team_position VALUES ('00000000-0000-0000-0000-0000000000a1',ST_GeogFromText('SRID=4326;POINT(106.71 10.775)'),10,now(),'GPS',gen_random_uuid(),NULL);
SELECT 'nearby teams within 10km: '||count(*) FROM team_position tp JOIN request_subject rs ON ST_DWithin(tp.location,rs.location,10000);
SELECT expect_fail('PROXY without relationship (NULL)', $$INSERT INTO assistance_request (id,tracking_code,incident_category_code,report_mode,reporter_user_id,reporter_contact_phone,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b3','TRK0000007','FLOOD','PROXY',gen_random_uuid(),'0900000000',gen_random_uuid()); INSERT INTO request_subject (request_id,report_mode,people_affected,location,location_source) VALUES ('00000000-0000-0000-0000-0000000000b3','PROXY',3,ST_GeogFromText('SRID=4326;POINT(106.70 10.77)'),'MANUAL_PIN')$$);
