\i constraint-tests.sql
CREATE OR REPLACE FUNCTION expect_no_column(tbl text, col text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = tbl AND column_name = col) THEN
    RAISE EXCEPTION 'FAIL % still has column %', tbl, col; END IF;
  RAISE NOTICE 'PASS % has no column %', tbl, col;
END $$;
INSERT INTO region (code,name,status) VALUES ('R1','Khu vực 1','ACTIVE');
INSERT INTO organization (id,name,organization_kind) VALUES ('00000000-0000-0000-0000-0000000000a1','Trung tâm','COORDINATION');
INSERT INTO app_user (id,username,display_name,password_hash) VALUES ('00000000-0000-0000-0000-0000000000b1','Alice','A','h');
SELECT expect_fail('username case-insensitive unique', $$INSERT INTO app_user (username,display_name,password_hash) VALUES ('alice','A2','h')$$);
SELECT expect_fail('username must not contain spaces', $$INSERT INTO app_user (username,display_name,password_hash) VALUES ('a b  c','A2','h')$$);
SELECT expect_fail('blank organization name', $$INSERT INTO organization (name,organization_kind) VALUES ('   ','OTHER')$$);
SELECT expect_fail('NFD name rejected (NFC only)', $$INSERT INTO organization (name,organization_kind) VALUES (normalize('Cụ',NFD),'OTHER')$$);
SELECT expect_fail('SYSTEM scope must not carry org', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','ADMIN','SYSTEM','00000000-0000-0000-0000-0000000000a1')$$);
SELECT expect_fail('ADMIN only with SYSTEM scope', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','ADMIN','ORGANIZATION','00000000-0000-0000-0000-0000000000a1')$$);
SELECT expect_fail('CITIZEN cannot be CAMPAIGN scoped', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,campaign_id) VALUES ('00000000-0000-0000-0000-0000000000b1','CITIZEN','CAMPAIGN','00000000-0000-0000-0000-0000000000a1',gen_random_uuid())$$);
SELECT expect_fail('staff role cannot be SYSTEM scoped', $$INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','SYSTEM')$$);
SELECT expect_fail('REGION scope needs a region', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','REGION','00000000-0000-0000-0000-0000000000a1')$$);
INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','ORGANIZATION','00000000-0000-0000-0000-0000000000a1');
SELECT expect_fail('duplicate live grant', $$INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','ORGANIZATION','00000000-0000-0000-0000-0000000000a1')$$);
UPDATE role_grant SET revoked_at=now();
INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','COORDINATOR','ORGANIZATION','00000000-0000-0000-0000-0000000000a1');
SELECT expect_fail('revoke before create', $$UPDATE role_grant SET revoked_at=created_at - interval '1 day' WHERE revoked_at IS NULL$$);
SELECT expect_fail('invalid role code', $$INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ('00000000-0000-0000-0000-0000000000b1','ROOT','SYSTEM')$$);
-- cleaned-up columns must be gone
SELECT expect_no_column('role_grant','granted_by');
SELECT expect_no_column('app_user','updated_at');
SELECT expect_no_column('refresh_session','id');
SELECT expect_no_column('membership','id');
-- membership: pair is the key
INSERT INTO membership (user_id,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1');
SELECT expect_fail('one membership per user and organization', $$INSERT INTO membership (user_id,organization_id) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1')$$);
-- sessions
INSERT INTO session_family (id,user_id,client_kind,authz_version,absolute_expires_at) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','WEB',1,now()+interval '7 days');
INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h1');
SELECT expect_fail('only one live token per family', $$INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h2')$$);
SELECT expect_fail('token hash is the key', $$INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h1')$$);
UPDATE refresh_session SET rotated_at=now() WHERE token_hash='h1';
INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f1','h2');
SELECT expect_fail('family expiry must be in the future', $$INSERT INTO session_family (user_id,client_kind,authz_version,absolute_expires_at) VALUES ('00000000-0000-0000-0000-0000000000b1','WEB',1,now()-interval '1 day')$$);
SELECT expect_fail('revoke reason ADMIN no longer exists', $$UPDATE session_family SET revoked_at=now(), revoke_reason='ADMIN'$$);
UPDATE session_family SET revoked_at=now(), revoke_reason='PASSWORD_CHANGE';
SELECT expect_fail('revoke reason requires revoked_at', $$INSERT INTO session_family (user_id,client_kind,authz_version,absolute_expires_at,revoke_reason) VALUES ('00000000-0000-0000-0000-0000000000b1','WEB',1,now()+interval '1 day','LOGOUT')$$);
SELECT expect_fail('audit append-only', $$INSERT INTO audit_log (action,entity_type,entity_id) VALUES ('x','y','1'); UPDATE audit_log SET action='z'$$);
SELECT expect_fail('audit cannot be truncated', $$TRUNCATE audit_log$$);
INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash) VALUES ('a','c','00000000-0000-0000-0000-000000000001','h');
SELECT expect_fail('idempotency key unique per scope+command', $$INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash) VALUES ('a','c','00000000-0000-0000-0000-000000000001','h2')$$);
SELECT expect_no_column('idempotency_record','response_body');
SELECT expect_fail('resource type and id are paired', $$INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash,resource_type) VALUES ('a','c','00000000-0000-0000-0000-000000000002','h','user')$$);
INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash,response_status,resource_type,resource_id) VALUES ('a','c','00000000-0000-0000-0000-000000000003','h',201,'user','00000000-0000-0000-0000-0000000000b1');
-- region/organization carry a version for expected_version commands
UPDATE region SET version = version + 1 WHERE code='R1';
UPDATE organization SET version = version + 1;

-- ---------- restricted application role c48_identity_app ----------
INSERT INTO audit_log (action,entity_type,entity_id) VALUES ('seed','user','1');
SET ROLE c48_identity_app;
SELECT expect_sqlstate('app role: UPDATE audit_log denied', $$UPDATE audit_log SET action='z'$$, '42501');
SELECT expect_sqlstate('app role: DELETE audit_log denied', $$DELETE FROM audit_log$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE audit_log denied', $$TRUNCATE audit_log$$, '42501');
SELECT expect_sqlstate('app role: TRUNCATE app_user denied', $$TRUNCATE app_user CASCADE$$, '42501');
SELECT expect_sqlstate('app role: DELETE app_user denied (not a cleanup table)', $$DELETE FROM app_user$$, '42501');
SELECT expect_sqlstate('app role: DELETE role_grant denied', $$DELETE FROM role_grant$$, '42501');
SELECT expect_sqlstate('app role: CREATE FUNCTION denied', $$CREATE FUNCTION app_made_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'$$, '42501');
SELECT expect_sqlstate('app role: CREATE TABLE denied', $$CREATE TABLE app_made_tbl (a int)$$, '42501');
INSERT INTO audit_log (action,entity_type,entity_id) VALUES ('app.insert','user','2');
UPDATE app_user SET version = version + 1 WHERE username = 'alice';
INSERT INTO session_family (id,user_id,client_kind,authz_version,absolute_expires_at) VALUES ('00000000-0000-0000-0000-0000000000f9','00000000-0000-0000-0000-0000000000b1','NATIVE',1,now()+interval '1 day');
INSERT INTO refresh_session (family_id,token_hash) VALUES ('00000000-0000-0000-0000-0000000000f9','hx1');
UPDATE refresh_session SET rotated_at = now() WHERE token_hash = 'hx1';
DELETE FROM refresh_session WHERE token_hash = 'hx1';
DELETE FROM session_family WHERE id = '00000000-0000-0000-0000-0000000000f9';
DELETE FROM idempotency_record WHERE idempotency_key = '00000000-0000-0000-0000-000000000003';
SELECT 'PASS app role: legitimate insert/update/cleanup-delete allowed';
RESET ROLE;
SELECT expect_fail('superuser still blocked by append-only trigger', $$UPDATE audit_log SET action='z'$$);
