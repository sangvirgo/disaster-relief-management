\i constraint-tests.sql
INSERT INTO region VALUES ('R1','Khu vực 1','ACTIVE');
INSERT INTO organization (id,name,organization_kind) VALUES ('00000000-0000-0000-0000-0000000000a1','Trung tâm','COORDINATION');
INSERT INTO app_user (id,username,display_name,password_hash) VALUES ('00000000-0000-0000-0000-0000000000b1','Alice','A','h');
SELECT expect_fail('username case-insensitive unique', $$INSERT INTO app_user (username,display_name,password_hash) VALUES ('alice','A2','h')$$);
SELECT expect_fail('username must not contain spaces', $$INSERT INTO app_user (username,display_name,password_hash) VALUES ('a b  c','A2','h')$$);
SELECT expect_fail('blank organization name', $$INSERT INTO organization (name,organization_kind) VALUES ('   ','OTHER')$$);
SELECT expect_fail('NFD name rejected (NFC only)', $$INSERT INTO organization (name,organization_kind) VALUES (normalize('Cụ',NFD),'OTHER')$$);
SELECT expect_fail('SYSTEM scope must not carry org', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','ADMIN','SYSTEM','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1')$$);
SELECT expect_fail('ADMIN only with SYSTEM scope', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','ADMIN','ORGANIZATION','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1')$$);
SELECT expect_fail('CITIZEN cannot be CAMPAIGN scoped', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,campaign_id,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','CITIZEN','CAMPAIGN','00000000-0000-0000-0000-0000000000a1',gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1')$$);
SELECT expect_fail('staff role cannot be SYSTEM scoped', $$INSERT INTO role_grant (user_id,role_code,scope_type,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','SYSTEM','00000000-0000-0000-0000-0000000000b1')$$);
INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','ORGANIZATION','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
SELECT expect_fail('duplicate live grant', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','ORGANIZATION','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1')$$);
UPDATE role_grant SET revoked_at=now(), revoked_by='00000000-0000-0000-0000-0000000000b1';
INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','ORGANIZATION','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
SELECT expect_fail('revoke before create', $$UPDATE role_grant SET revoked_at=created_at - interval '1 day', revoked_by=user_id WHERE revoked_at IS NULL$$);
SELECT expect_fail('invalid role code', $$INSERT INTO role_grant (user_id,role_code,scope_type,granted_by) VALUES ('00000000-0000-0000-0000-0000000000b1','ROOT','SYSTEM','00000000-0000-0000-0000-0000000000b1')$$);
-- sessions
INSERT INTO session_family (id,user_id,client_kind,authz_version,absolute_expires_at) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','WEB',1,now()+interval '7 days');
INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h1');
SELECT expect_fail('only one live token per family', $$INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h2')$$);
UPDATE refresh_session SET rotated_at=now() WHERE token_hash='h1';
INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h2');
SELECT expect_fail('family expiry must be in the future', $$INSERT INTO session_family (user_id,client_kind,authz_version,absolute_expires_at) VALUES ('00000000-0000-0000-0000-0000000000b1','WEB',1,now()-interval '1 day')$$);
SELECT expect_fail('audit append-only', $$INSERT INTO audit_log (action,entity_type,entity_id) VALUES ('x','y','1'); UPDATE audit_log SET action='z'$$);
SELECT expect_fail('audit cannot be truncated', $$TRUNCATE audit_log$$);
INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash) VALUES ('a','c','00000000-0000-0000-0000-000000000001','h');
SELECT expect_fail('idempotency key unique per scope+command', $$INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash) VALUES ('a','c','00000000-0000-0000-0000-000000000001','h2')$$);
