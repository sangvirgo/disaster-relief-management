-- Read-only preflight. Provision these roles with fresh isolated credentials
-- before restore; archives preserve object ownership and ACLs, not cluster roles.
WITH expected(name, can_login) AS (
  VALUES (:'service' || '_migrator', true),
         (:'service' || '_app_login', true),
         ('c48_' || :'service' || '_app', false),
         ('c48_logistics_owner', false)
)
SELECT COALESCE(
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
  AND (SELECT pg_get_userbyid(datdba) = :'service' || '_migrator'
         FROM pg_database WHERE datname = current_database())
  AND (SELECT count(*) = 4 FROM expected e JOIN pg_roles r ON r.rolname = e.name
        WHERE r.rolcanlogin = e.can_login AND r.rolinherit
          AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
  AND pg_has_role(:'service' || '_app_login', 'c48_' || :'service' || '_app', 'MEMBER')
  AND NOT pg_has_role(:'service' || '_app_login', 'c48_logistics_owner', 'MEMBER')
  AND NOT pg_has_role(:'service' || '_app_login', :'service' || '_migrator', 'MEMBER'),
  false);
