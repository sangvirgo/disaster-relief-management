import argon2 from 'argon2';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { Client } = pg;
const seedPassword = process.env.SEED_PASSWORD;
if (process.env.NODE_ENV === 'production') {
  throw new Error('Demo seeding is disabled in production.');
}
if (!seedPassword || seedPassword.startsWith('replace-') || seedPassword.length < 10) {
  throw new Error('Set a local SEED_PASSWORD with at least 10 characters before seeding.');
}

const integer = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(name + ' must be a positive integer.');
  }
  return value;
};

const passwordHash = await argon2.hash(seedPassword, {
  type: argon2.argon2id,
  memoryCost: integer('ARGON2_MEMORY_KIB', 65536),
  timeCost: integer('ARGON2_TIME_COST', 3),
  parallelism: integer('ARGON2_PARALLELISM', 1),
});

const services = [
  ['identity', 'identity_migrator', 'IDENTITY_MIGRATOR_PASSWORD', 'c48_identity', 'region'],
  ['response', 'response_migrator', 'RESPONSE_MIGRATOR_PASSWORD', 'c48_response', 'incident_category'],
  ['logistics', 'logistics_migrator', 'LOGISTICS_MIGRATOR_PASSWORD', 'c48_logistics', 'unit'],
];

function prepareSql(service) {
  const lines = readFileSync(resolve('seed', 'seed-' + service + '.sql'), 'utf8').split(/\r?\n/);
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
      throw new Error('Unsupported psql directive in seed-' + service + '.sql.');
    }
    filtered.push(line);
  }
  if (skippingPasswordFallback) {
    throw new Error('Unclosed seed password fallback in seed-identity.sql.');
  }
  const sql = filtered.join('\n');
  return service === 'identity'
    ? sql.split(":'seed_password_hash'").join("'" + passwordHash.replaceAll("'", "''") + "'")
    : sql;
}

for (const [service, user, passwordKey, database, markerTable] of services) {
  const client = new Client({
    host: process.env.PGHOST ?? 'postgres',
    port: Number(process.env.PGPORT ?? 5432),
    user,
    password: process.env[passwordKey],
    database,
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  try {
    const result = await client.query('SELECT EXISTS (SELECT 1 FROM public.' + markerTable + ' LIMIT 1) AS has_data');
    if (result.rows[0].has_data) {
      throw new Error(database + ' already contains demo data; run scripts/db/seed --reset.');
    }
    await client.query(prepareSql(service));
    process.stdout.write('Seeded synthetic ' + service + ' data.\n');
  } finally {
    await client.end();
  }
}
