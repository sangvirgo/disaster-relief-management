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
  ]) {
    if (source.includes(marker)) source = source.replace(marker, readFileSync(resolve('seed', include), 'utf8'));
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
    await runTransaction(clients.get('identity'), prepareSql('identity', 'seed-campaign-support.sql'));
    const creators = await clients.get('identity').query(
      "SELECT id FROM app_user WHERE status = 'ACTIVE' ORDER BY created_at, id LIMIT 1",
    );
    const campaignCreatorId = creators.rows[0]?.id ?? '00000000-0000-4000-8000-000000000104';
    await runTransaction(clients.get('response'), prepareSql('response', 'seed-campaigns.sql', campaignCreatorId));
    process.stdout.write('Ensured demo campaign support and campaigns without changing existing records.\n');
  }
} finally {
  await Promise.all([...clients.values()].map((client) => client.end()));
}
