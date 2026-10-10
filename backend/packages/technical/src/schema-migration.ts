import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryRunner } from 'typeorm';

export type SchemaService = 'identity' | 'response' | 'logistics';

export async function applySchema(queryRunner: QueryRunner, service: SchemaService): Promise<void> {
  const candidates = [
    ...(process.env.C48_SCHEMA_DIR ? [resolve(process.env.C48_SCHEMA_DIR)] : []),
    resolve(process.cwd(), 'schema'),
    resolve(process.cwd(), '../docs/backend/schema'),
  ];
  const path = candidates.map((dir) => join(dir, service + '.sql')).find(existsSync);
  if (!path) {
    throw new Error('Schema SQL for ' + service + ' was not found');
  }
  await queryRunner.query(readFileSync(path, 'utf8'));
}

export async function dropSchema(queryRunner: QueryRunner): Promise<void> {
  const sql = [
    'DO $c48$',
    'DECLARE',
    '  item record;',
    'BEGIN',
    '  FOR item IN',
    '    SELECT n.nspname, c.relname, c.relkind',
    '    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
    "    WHERE n.nspname = 'public' AND c.relname NOT IN ('typeorm_migrations', 'typeorm_migrations_id_seq')",
    "      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')",
    '      AND NOT EXISTS (',
    "        SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass",
    "          AND d.objid = c.oid AND d.deptype = 'e'",
    '      )',
    "    ORDER BY CASE c.relkind WHEN 'v' THEN 1 WHEN 'm' THEN 1 WHEN 'f' THEN 2",
    "      WHEN 'r' THEN 3 WHEN 'p' THEN 3 WHEN 'S' THEN 4 ELSE 5 END",
    '  LOOP',
    "    IF item.relkind = 'S' THEN",
    "      EXECUTE format('DROP SEQUENCE IF EXISTS %I.%I CASCADE', item.nspname, item.relname);",
    "    ELSIF item.relkind = 'v' THEN",
    "      EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', item.nspname, item.relname);",
    "    ELSIF item.relkind = 'm' THEN",
    "      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I.%I CASCADE', item.nspname, item.relname);",
    "    ELSIF item.relkind = 'f' THEN",
    "      EXECUTE format('DROP FOREIGN TABLE IF EXISTS %I.%I CASCADE', item.nspname, item.relname);",
    '    ELSE',
    "      EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', item.nspname, item.relname);",
    '    END IF;',
    '  END LOOP;',
    '  FOR item IN',
    '    SELECT n.nspname, p.proname, p.prokind, pg_get_function_identity_arguments(p.oid) AS args',
    '    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace',
    "    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p', 'a')",
    '      AND NOT EXISTS (',
    "        SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass",
    "          AND d.objid = p.oid AND d.deptype = 'e'",
    '      )',
    '  LOOP',
    "    IF item.prokind = 'p' THEN",
    "      EXECUTE format('DROP PROCEDURE IF EXISTS %I.%I(%s) CASCADE', item.nspname, item.proname, item.args);",
    "    ELSIF item.prokind = 'a' THEN",
    "      EXECUTE format('DROP AGGREGATE IF EXISTS %I.%I(%s) CASCADE', item.nspname, item.proname, item.args);",
    '    ELSE',
    "      EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', item.nspname, item.proname, item.args);",
    '    END IF;',
    '  END LOOP;',
    '  FOR item IN',
    '    SELECT n.nspname, t.typname, t.typtype',
    '    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace',
    "    WHERE n.nspname = 'public' AND t.typname <> 'typeorm_migrations' AND t.typtype IN ('d', 'e', 'c', 'r')",
    "      AND left(t.typname, 1) <> '_'",
    '      AND NOT EXISTS (',
    "        SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass",
    "          AND d.objid = t.oid AND d.deptype = 'e'",
    '      )',
    '  LOOP',
    "    IF item.typtype = 'd' THEN",
    "      EXECUTE format('DROP DOMAIN IF EXISTS %I.%I CASCADE', item.nspname, item.typname);",
    '    ELSE',
    "      EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', item.nspname, item.typname);",
    '    END IF;',
    '  END LOOP;',
    'END',
    '$c48$;',
  ].join('\n');
  await queryRunner.query(sql);
}
