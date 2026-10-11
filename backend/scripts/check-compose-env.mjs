import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const args = ['compose', '--profile', 'storage', '--profile', 'seed', '--env-file', '.env.example', '-f', 'infra/compose.yaml', 'config', '--format', 'json'];
const result = spawnSync('docker', args, { encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Docker Compose config failed (${result.status}): ${result.stderr.trim()}`);
const compose = JSON.parse(result.stdout);
const expected = {
  postgres: ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'],
  'db-init': ['POSTGRES_PASSWORD', 'IDENTITY_MIGRATOR_PASSWORD', 'IDENTITY_APP_PASSWORD', 'RESPONSE_MIGRATOR_PASSWORD', 'RESPONSE_APP_PASSWORD', 'LOGISTICS_MIGRATOR_PASSWORD', 'LOGISTICS_APP_PASSWORD'],
  'identity-migrate': ['NODE_ENV', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR'],
  'response-migrate': ['NODE_ENV', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR'],
  'logistics-migrate': ['NODE_ENV', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR'],
  'identity-api': ['NODE_ENV', 'PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR', 'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'WEB_ALLOWED_ORIGINS', 'SECRET_HASH_PEPPER_AUTH_V1', 'SECRET_HASH_PEPPER_AUTH_CURRENT', 'ARGON2_MEMORY_KIB', 'ARGON2_TIME_COST', 'ARGON2_PARALLELISM', 'ARGON2_MAX_CONCURRENCY', 'IDENTITY_SERVICE_CLIENT_ID', 'IDENTITY_SERVICE_CLIENT_SECRET', 'RESPONSE_SERVICE_CLIENT_ID', 'RESPONSE_SERVICE_CLIENT_SECRET', 'LOGISTICS_SERVICE_CLIENT_ID', 'LOGISTICS_SERVICE_CLIENT_SECRET', 'RESPONSE_BASE_URL'],
  'response-api': ['NODE_ENV', 'PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR', 'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_PUBLIC_KEY', 'WEB_ALLOWED_ORIGINS', 'RESPONSE_SERVICE_CLIENT_ID', 'RESPONSE_SERVICE_CLIENT_SECRET', 'IDENTITY_BASE_URL', 'LOGISTICS_BASE_URL', 'SECRET_HASH_PEPPER_SOS', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'SOS_SOFT_LIMIT_PER_IP', 'SOS_HARD_LIMIT_PER_IP', 'SOS_GLOBAL_PER_MIN', 'PROXY_OPEN_CAP', 'VERIFY_OVERDUE_MINUTES', 'OFFER_OVERDUE_MINUTES', 'TEAM_POSITION_FRESH_MINUTES', 'TEAM_SEARCH_RADIUS_M', 'TEAM_BAND_TOLERANCE_M', 'TEAM_BAND_TOLERANCE_P2_M', 'TEAM_BAND_TOLERANCE_P1_M', 'SIGNED_URL_TTL_S', 'SCHEDULER_ENABLED', 'INTROSPECT_TIMEOUT_MS', 'DEMO_INTAKE_ORGANIZATION_ID'],
  'logistics-api': ['NODE_ENV', 'PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR', 'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_PUBLIC_KEY', 'LOGISTICS_SERVICE_CLIENT_ID', 'LOGISTICS_SERVICE_CLIENT_SECRET', 'IDENTITY_BASE_URL', 'RESPONSE_BASE_URL', 'SECRET_HASH_PEPPER_DONATION', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'SCHEDULER_ENABLED', 'INTROSPECT_TIMEOUT_MS'],
  nginx: ['SOS_SOFT_LIMIT_PER_IP', 'SOS_HARD_LIMIT_PER_IP', 'NGINX_ENVSUBST_FILTER'],
  minio: ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'],
  'minio-init': ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'S3_RESPONSE_ACCESS_KEY', 'S3_RESPONSE_SECRET_KEY', 'S3_LOGISTICS_ACCESS_KEY', 'S3_LOGISTICS_SECRET_KEY'],
  seed: ['NODE_ENV', 'PGHOST', 'PGPORT', 'IDENTITY_MIGRATOR_PASSWORD', 'RESPONSE_MIGRATOR_PASSWORD', 'LOGISTICS_MIGRATOR_PASSWORD', 'SEED_PASSWORD', 'ARGON2_MEMORY_KIB', 'ARGON2_TIME_COST', 'ARGON2_PARALLELISM'],
};

assert.deepEqual(Object.keys(compose.services).sort(), Object.keys(expected).sort(), 'Compose services need explicit environment allow-lists');
for (const [name, keys] of Object.entries(expected)) {
  const service = compose.services[name];
  assert.ok(service, `missing Compose service ${name}`);
  assert.ok(!service.env_file, `${name} must not load a shared env_file`);
  assert.deepEqual(Object.keys(service.environment ?? {}).sort(), [...keys].sort(), `${name} environment allow-list changed`);
}
const production = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } });
if (production.error) throw production.error;
if (production.status !== 0) throw new Error(`Production Compose config failed (${production.status}): ${production.stderr.trim()}`);
assert.equal(JSON.parse(production.stdout).services.seed.environment.NODE_ENV, 'production', 'seed must refuse production mode');
process.stdout.write(`PASS Compose environment allow-lists for ${Object.keys(expected).length} services\n`);
