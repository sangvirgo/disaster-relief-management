import { createHash, createHmac } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedMode } from './seed-mode.mjs';

const { Client } = pg;
if (process.env.NODE_ENV === 'production') {
  throw new Error('Demo seeding is disabled in production.');
}

const integer = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(name + ' must be a positive integer.');
  }
  return value;
};

let passwordHash;
const demoDonationSecret = createHash('sha256').update('c48-demo-donation-GD7K2N01-v1').digest('base64url');

function demoDonationCapabilityHash(pepper) {
  if (pepper.length < 32 || pepper.length > 256) {
    throw new Error('Set SECRET_HASH_PEPPER_DONATION before seeding the demo donation fixture.');
  }
  const digest = createHmac('sha256', pepper)
    .update('donation-delivery').update('\0').update(demoDonationSecret).digest('hex');
  return 'v1:' + digest;
}

async function createPasswordHash() {
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword || seedPassword.startsWith('replace-') || seedPassword.length < 10) {
    throw new Error('Set a local SEED_PASSWORD with at least 10 characters before seeding.');
  }
  return argon2.hash(seedPassword, {
    type: argon2.argon2id,
    memoryCost: integer('ARGON2_MEMORY_KIB', 65536),
    timeCost: integer('ARGON2_TIME_COST', 3),
    parallelism: integer('ARGON2_PARALLELISM', 1),
  });
}

const services = [
  ['identity', 'identity_migrator', 'IDENTITY_MIGRATOR_PASSWORD', 'c48_identity'],
  ['response', 'response_migrator', 'RESPONSE_MIGRATOR_PASSWORD', 'c48_response'],
  ['logistics', 'logistics_migrator', 'LOGISTICS_MIGRATOR_PASSWORD', 'c48_logistics'],
];

function prepareSql(
  service,
  filename = 'seed-' + service + '.sql',
  campaignCreatorId = '00000000-0000-4000-8000-000000000104',
) {
  let source = readFileSync(resolve('seed', filename), 'utf8');
  for (const [marker, include] of [
    ['-- @include campaign support', 'seed-campaign-support.sql'],
    ['-- @include demo campaigns', 'seed-campaigns.sql'],
    ['-- @include demo expansion', 'seed-expansion-' + service + '.sql'],
  ]) {
    if (source.includes(marker)) source = source.replace(marker, readFileSync(resolve('seed', include), 'utf8'));
  }
  if (source.includes('{{donation_capability_hash}}')) {
    source = source.replaceAll('{{donation_capability_hash}}', demoDonationCapabilityHash(process.env.SECRET_HASH_PEPPER_DONATION ?? ''));
  }
  if (source.includes('{{campaign_creator_id}}')) {
    if (!/^[0-9a-f-]{36}$/iu.test(campaignCreatorId)) throw new Error('Invalid campaign seed creator id.');
    source = source.replaceAll('{{campaign_creator_id}}', campaignCreatorId);
  }
  const lines = source.split(/\r?\n/);
  const filtered = [];
  let skippingPasswordFallback = false;
  for (const line of lines) {
    if (service === 'identity' && line.startsWith('\\if :{?seed_password_hash}')) {
      skippingPasswordFallback = true;
      continue;
    }
    if (skippingPasswordFallback) {
      if (line.startsWith('\\endif')) {
        skippingPasswordFallback = false;
      }
      continue;
    }
    if (line.startsWith('\\o')) {
      continue;
    }
    if (line.startsWith('\\')) {
      throw new Error('Unsupported psql directive in ' + filename + '.');
    }
    filtered.push(line);
  }
  if (skippingPasswordFallback) {
    throw new Error('Unclosed seed password fallback in seed-identity.sql.');
  }
  const sql = filtered.join('\n');
  return service === 'identity' && sql.includes(":'seed_password_hash'")
    ? sql.split(":'seed_password_hash'").join("'" + passwordHash.replaceAll("'", "''") + "'")
    : sql;
}

function quoteIdentifier(identifier) {
  return '"' + identifier.replaceAll('"', '""') + '"';
}

async function hasApplicationData(client) {
  const tables = await client.query(
    `SELECT c.relname AS table_name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname <> 'typeorm_migrations'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
           WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY c.relname`,
  );
  for (const { table_name: tableName } of tables.rows) {
    const result = await client.query(
      'SELECT EXISTS (SELECT 1 FROM public.' + quoteIdentifier(tableName) + ' LIMIT 1) AS has_data',
    );
    if (result.rows[0].has_data) return true;
  }
  return false;
}

async function runTransaction(client, sql) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

const clients = new Map();
try {
  let hasData = false;
  for (const [service, user, passwordKey, database] of services) {
    const client = new Client({
      host: process.env.PGHOST ?? 'postgres',
      port: Number(process.env.PGPORT ?? 5432),
      user,
      password: process.env[passwordKey],
      database,
      connectionTimeoutMillis: 5000,
    });
    clients.set(service, client);
    await client.connect();
    hasData = await hasApplicationData(client) || hasData;
  }

  if (seedMode(hasData) === 'full') {
    passwordHash = await createPasswordHash();
    for (const [service] of services) {
      await clients.get(service).query(prepareSql(service));
      process.stdout.write('Seeded synthetic ' + service + ' data.\n');
    }
  } else {
    passwordHash = await createPasswordHash();
    await runTransaction(clients.get('identity'), prepareSql('identity', 'seed-campaign-support.sql'));
    await runTransaction(clients.get('identity'), prepareSql('identity', 'seed-expansion-identity.sql'));
    const identityPrerequisites = await clients.get('identity').query(`
      WITH fixture(user_id, username, role_code, scope_type, organization_id, requires_membership) AS (VALUES
        ('00000000-0000-4000-8000-000000000112'::uuid, 'ops_seed', 'OPERATIONS_MANAGER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000001'::uuid, true),
        ('00000000-0000-4000-8000-000000000113'::uuid, 'citizen3', 'CITIZEN', 'SYSTEM', NULL::uuid, false),
        ('00000000-0000-4000-8000-000000000114'::uuid, 'vol_leader3', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, true),
        ('00000000-0000-4000-8000-000000000115'::uuid, 'vol_member3', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, true),
        ('00000000-0000-4000-8000-000000000116'::uuid, 'vol_leader4', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, true),
        ('00000000-0000-4000-8000-000000000117'::uuid, 'vol_member4', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, true),
        ('00000000-0000-4000-8000-000000000118'::uuid, 'coord_seed', 'COORDINATOR', 'ORGANIZATION', '00000000-0000-4000-8000-000000000001'::uuid, true)
      )
      SELECT
        (SELECT count(*)::int
           FROM fixture f
           JOIN app_user u ON u.id = f.user_id AND u.username::text = f.username
                          AND u.status = 'ACTIVE' AND u.must_change_password
           JOIN role_grant g ON g.user_id = f.user_id AND g.role_code = f.role_code AND g.scope_type = f.scope_type
                            AND g.organization_id IS NOT DISTINCT FROM f.organization_id
                            AND g.region_code IS NULL AND g.campaign_id IS NULL AND g.revoked_at IS NULL
           LEFT JOIN membership m ON m.user_id = f.user_id AND m.organization_id = f.organization_id AND m.status = 'ACTIVE'
          WHERE NOT f.requires_membership OR m.user_id IS NOT NULL) AS users_ready,
        (SELECT count(*)::int FROM region WHERE status = 'ACTIVE' AND (
            (code = 'DEMO_A' AND name = 'Khu vực Nam (demo)') OR
            (code = 'DEMO_B' AND name = 'Khu vực Trung (demo)') OR
            (code = 'DEMO_C' AND name = 'Khu vực Bắc (demo)'))) AS regions_ready,
        (SELECT count(*)::int FROM organization WHERE status = 'ACTIVE' AND (
            (id = '00000000-0000-4000-8000-000000000001' AND name = 'Trung tâm điều phối C48 (demo)' AND organization_kind = 'COORDINATION') OR
            (id = '00000000-0000-4000-8000-000000000002' AND name = 'Hội tình nguyện miền Nam (demo)' AND organization_kind = 'VOLUNTEER'))) AS organizations_ready
    `);
    const identityReady = identityPrerequisites.rows[0];
    if (identityReady.users_ready !== 7 || identityReady.regions_ready !== 3 || identityReady.organizations_ready !== 2) {
      throw new Error('Demo fixture ID or scope conflicts in Identity; dependent Response and Logistics fixtures were not seeded.');
    }
    const creators = await clients.get('identity').query(
      "SELECT id FROM app_user WHERE status = 'ACTIVE' ORDER BY created_at, id LIMIT 1",
    );
    const campaignCreatorId = creators.rows[0]?.id ?? '00000000-0000-4000-8000-000000000104';
    await runTransaction(clients.get('response'), prepareSql('response', 'seed-campaigns.sql', campaignCreatorId));
    const logisticsCampaign = await clients.get('response').query(
      `SELECT 1 FROM campaign
        WHERE id = '00000000-0000-4000-8000-0000000000c3'
          AND organization_id = '00000000-0000-4000-8000-000000000001'
          AND region_code = 'DEMO_A'
          AND name = 'Hỗ trợ khẩn cấp khu vực Nam'
          AND status = 'ACTIVE'`,
    );
    if (logisticsCampaign.rowCount !== 1) {
      throw new Error('Demo campaign ...0c3 conflicts in Response; Response expansion and dependent Logistics fixtures were not seeded.');
    }
    await runTransaction(clients.get('response'), prepareSql('response', 'seed-expansion-response.sql'));
    await runTransaction(clients.get('logistics'), prepareSql('logistics', 'seed-expansion-logistics.sql'));
    process.stdout.write('Ensured synthetic Identity, Response, Logistics, and campaign fixtures with idempotent seed updates.\n');
  }
} finally {
  await Promise.all([...clients.values()].map((client) => client.end()));
}
