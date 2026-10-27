-- Read-only acceptance checks, executed after each atomic archive restore.
SELECT COALESCE(
  has_schema_privilege(:'service' || '_app_login', 'public', 'USAGE')
  AND NOT has_schema_privilege(:'service' || '_app_login', 'public', 'CREATE')
  AND has_table_privilege(:'service' || '_app_login', 'public.audit_log', 'SELECT')
  AND has_table_privilege(:'service' || '_app_login', 'public.audit_log', 'INSERT')
  AND NOT has_table_privilege(:'service' || '_app_login', 'public.audit_log', 'UPDATE,DELETE,TRUNCATE')
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege(name)
                   WHERE NOT has_table_privilege(:'service' || '_app_login', 'public.idempotency_record', privilege.name))
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e')
       AND pg_get_userbyid(c.relowner) <> :'service' || '_migrator'
  )
  AND CASE WHEN :'service' = 'logistics' THEN
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement' AND p.pronargs = 0
               AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'c48_logistics_owner'
               AND p.proconfig @> ARRAY['search_path=pg_catalog, public'])
    AND NOT has_table_privilege('logistics_app_login', 'public.stock_balance', 'UPDATE,DELETE,TRUNCATE')
    AND has_column_privilege('logistics_app_login', 'public.stock_balance', 'warehouse_id', 'INSERT')
    AND NOT has_column_privilege('logistics_app_login', 'public.stock_balance', 'on_hand', 'INSERT,UPDATE')
    AND NOT has_table_privilege('logistics_app_login', 'public.stock_movement', 'UPDATE,DELETE,TRUNCATE')
    AND NOT has_function_privilege('logistics_app_login', 'public.apply_stock_movement()', 'EXECUTE')
    AND has_column_privilege('c48_logistics_owner', 'public.stock_balance', 'on_hand', 'UPDATE')
    AND has_column_privilege('c48_logistics_owner', 'public.stock_balance', 'reserved', 'UPDATE')
    AND NOT has_schema_privilege('c48_logistics_owner', 'public', 'CREATE')
    ELSE true END,
  false);
