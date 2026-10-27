import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const args = ['compose', '--profile', 'storage', '--profile', 'seed', '--env-file', '.env.example', '-f', 'infra/compose.yaml', 'config', '--format', 'json'];
const result = spawnSync('docker', args, { encoding: 'utf8' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Docker Compose config failed (${result.status}): ${result.stderr.trim()}`);
const compose = JSON.parse(result.stdout);
const expectedEnvironment = {
  postgres: ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'],
  'db-init': [
    'POSTGRES_PASSWORD', 'IDENTITY_MIGRATOR_PASSWORD', 'IDENTITY_APP_PASSWORD', 'RESPONSE_MIGRATOR_PASSWORD',
    'RESPONSE_APP_PASSWORD', 'LOGISTICS_MIGRATOR_PASSWORD', 'LOGISTICS_APP_PASSWORD',
  ],
  'identity-migrate': ['NODE_ENV', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR'],
  'response-migrate': ['NODE_ENV', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR'],
  'logistics-migrate': ['NODE_ENV', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR'],
  'identity-api': [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR',
    'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'WEB_ALLOWED_ORIGINS',
    'SECRET_HASH_PEPPER_AUTH_V1', 'SECRET_HASH_PEPPER_AUTH_CURRENT', 'EMAIL_OTP_PEPPER', 'IDENTITY_EMAIL_SMTP_HOST',
    'IDENTITY_EMAIL_SMTP_PORT', 'IDENTITY_EMAIL_SMTP_SECURE', 'IDENTITY_EMAIL_SMTP_USER', 'IDENTITY_EMAIL_SMTP_PASSWORD',
    'IDENTITY_EMAIL_FROM', 'GOOGLE_CLIENT_IDS', 'ARGON2_MEMORY_KIB', 'ARGON2_TIME_COST',
    'ARGON2_PARALLELISM', 'ARGON2_MAX_CONCURRENCY', 'IDENTITY_SERVICE_CLIENT_ID', 'IDENTITY_SERVICE_CLIENT_SECRET',
    'RESPONSE_SERVICE_CLIENT_ID', 'RESPONSE_SERVICE_CLIENT_SECRET', 'LOGISTICS_SERVICE_CLIENT_ID',
    'LOGISTICS_SERVICE_CLIENT_SECRET', 'RESPONSE_BASE_URL',
  ],
  'response-api': [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR',
    'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_PUBLIC_KEY', 'WEB_ALLOWED_ORIGINS', 'RESPONSE_SERVICE_CLIENT_ID',
    'RESPONSE_SERVICE_CLIENT_SECRET', 'IDENTITY_BASE_URL', 'LOGISTICS_BASE_URL', 'SECRET_HASH_PEPPER_SOS',
    'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'SOS_SOFT_LIMIT_PER_IP',
    'SOS_HARD_LIMIT_PER_IP', 'SOS_GLOBAL_PER_MIN', 'PROXY_OPEN_CAP', 'PROXY_DAILY_SOFT_LIMIT',
    'VERIFY_OVERDUE_MINUTES', 'OFFER_OVERDUE_MINUTES', 'TEAM_POSITION_FRESH_MINUTES', 'TEAM_SEARCH_RADIUS_M',
    'TEAM_BAND_TOLERANCE_M', 'TEAM_BAND_TOLERANCE_P2_M', 'TEAM_BAND_TOLERANCE_P1_M', 'SIGNED_URL_TTL_S',
    'SCHEDULER_ENABLED', 'RESOLUTION_RECOVERY_ENABLED', 'INTROSPECT_TIMEOUT_MS', 'DEMO_INTAKE_ORGANIZATION_ID', 'GEMINI_API_KEY', 'GEMINI_MODEL',
  ],
  'logistics-api': [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'DB_POOL_MAX', 'DB_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS', 'LOG_LEVEL', 'C48_SCHEMA_DIR',
    'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_PUBLIC_KEY', 'WEB_ALLOWED_ORIGINS', 'LOGISTICS_SERVICE_CLIENT_ID',
    'LOGISTICS_SERVICE_CLIENT_SECRET', 'IDENTITY_BASE_URL', 'RESPONSE_BASE_URL', 'SECRET_HASH_PEPPER_DONATION',
    'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'SCHEDULER_ENABLED', 'INTROSPECT_TIMEOUT_MS',
  ],
  web: [],
  nginx: ['SOS_SOFT_LIMIT_PER_IP', 'SOS_HARD_LIMIT_PER_IP', 'NGINX_ENVSUBST_FILTER'],
  minio: ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'],
  'minio-init': ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'S3_RESPONSE_ACCESS_KEY', 'S3_RESPONSE_SECRET_KEY', 'S3_LOGISTICS_ACCESS_KEY', 'S3_LOGISTICS_SECRET_KEY'],
  seed: [
    'NODE_ENV', 'PGHOST', 'PGPORT', 'IDENTITY_MIGRATOR_PASSWORD', 'RESPONSE_MIGRATOR_PASSWORD', 'LOGISTICS_MIGRATOR_PASSWORD',
    'SEED_PASSWORD', 'ARGON2_MEMORY_KIB', 'ARGON2_TIME_COST', 'ARGON2_PARALLELISM',
  ],
};
const expectedServices = Object.keys(expectedEnvironment);

assert.equal(compose.name, 'c48', 'all Compose resources must belong to the main C48 project');
assert.deepEqual(Object.keys(compose.services).sort(), [...expectedServices].sort(), 'Compose may contain only primary C48 services');
for (const name of expectedServices) {
  assert.doesNotMatch(name, /test/i, `Docker service name ${name} must not contain test`);
  const service = compose.services[name];
  assert.equal(service.container_name, `reliva-${name}`, `${name} must use its explicit Reliva container name`);
  assert.ok(!service.env_file, `${name} must not load a shared env_file`);
  assert.deepEqual(Object.keys(service.environment ?? {}).sort(), [...expectedEnvironment[name]].sort(), `${name} environment allow-list changed`);
  if (service.image) assert.doesNotMatch(service.image, /(?:^|[/:._-])test(?:$|[/:._-])/i, `${name} image name must not contain test`);
}

for (const [namespace, tag] of [['reliva', 'latest'], ['ghcr.io/sangvirgo', 'handoff-test']]) {
  const configured = spawnSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, C48_IMAGE_NAMESPACE: namespace, C48_IMAGE_TAG: tag },
  });
  if (configured.error) throw configured.error;
  if (configured.status !== 0) throw new Error(`Compose image configuration failed (${configured.status}): ${configured.stderr.trim()}`);
  const configuredServices = JSON.parse(configured.stdout).services;
  for (const [service, imageName] of Object.entries({
    'identity-migrate': 'identity-api', 'identity-api': 'identity-api', seed: 'identity-api',
    'response-migrate': 'response-api', 'response-api': 'response-api',
    'logistics-migrate': 'logistics-api', 'logistics-api': 'logistics-api', web: 'web',
  })) {
    assert.equal(configuredServices[service].image, `${namespace}/${imageName}:${tag}`, `${service} must use its configured image namespace and tag`);
  }
}

for (const name of ['postgres', 'db-init', 'identity-migrate', 'response-migrate', 'logistics-migrate', 'identity-api', 'response-api', 'logistics-api', 'web', 'nginx']) {
  assert.equal(compose.services[name].profiles, undefined, `${name} must be available without a profile`);
}
for (const name of ['postgres', 'identity-api', 'response-api', 'logistics-api']) {
  assert.equal(compose.services[name].ports?.length, 1, `${name} must expose one host port for host-side checks`);
  assert.equal(compose.services[name].ports[0].host_ip, '127.0.0.1', `${name} must bind only to loopback`);
}
assert.equal(compose.services.postgres.ports[0].target, 5432);
assert.equal(compose.services.postgres.ports[0].published, '55432');
assert.equal(compose.services['identity-api'].ports[0].published, '3001');
assert.equal(compose.services['response-api'].ports[0].published, '3002');
assert.equal(compose.services['logistics-api'].ports[0].published, '3003');
assert.equal(compose.services.nginx.ports[0].host_ip, '127.0.0.1', 'nginx must bind only to loopback');
const s3BackupPorts = compose.services.minio.ports.filter((port) => port.target === 9000);
assert.equal(s3BackupPorts.length, 1, 'the existing MinIO service must expose one S3 backup port');
assert.equal(s3BackupPorts[0].host_ip, '127.0.0.1', 'the S3 backup transport must bind only to loopback');
assert.equal(s3BackupPorts[0].published, '59000');
assert.match(compose.services.minio.image, /\/minio:RELEASE\.2025-10-15T17-29-55Z$/);
assert.match(compose.services['minio-init'].image, /\/minio-mc:RELEASE\.2025-08-13T08-35-41Z$/);
assert.ok(!compose.services.minio.volumes.some((volume) => volume.target === '/minio.license'),
  'MinIO Community needs no license mount');
assert.deepEqual(Object.keys(compose.services.web.build.args).sort(), ['VITE_GOOGLE_CLIENT_ID', 'VITE_GOOGLE_MAPS_API_KEY']);
assert.equal(compose.services.web.ports?.length ?? 0, 0, 'web must be reachable only through the Nginx ingress');
assert.equal(compose.services.nginx.depends_on.web.condition, 'service_healthy');

assert.deepEqual(Object.keys(compose.volumes).sort(), ['minio-data', 'pgdata'], 'C48 must keep its two stable volumes');
assert.equal(compose.volumes.pgdata.name, 'c48_pgdata', 'PostgreSQL data must use the stable C48 volume');
assert.equal(compose.volumes['minio-data'].name, 'c48_minio-data', 'MinIO data must use the stable C48 volume');
assert.deepEqual(Object.keys(compose.networks), ['c48-internal'], 'all services must share the stable C48 network');
assert.equal(compose.networks['c48-internal'].name, 'c48-internal', 'network name must remain stable');
for (const [name, volume] of Object.entries(compose.volumes)) {
  assert.doesNotMatch(name, /test/i, `Docker volume name ${name} must not contain test`);
  assert.doesNotMatch(volume.name ?? name, /test/i, `Docker volume name ${volume.name ?? name} must not contain test`);
}
for (const [name, network] of Object.entries(compose.networks)) {
  assert.doesNotMatch(name, /test/i, `Docker network name ${name} must not contain test`);
  assert.doesNotMatch(network.name ?? name, /test/i, `Docker network name ${network.name ?? name} must not contain test`);
}

const production = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } });
if (production.error) throw production.error;
if (production.status !== 0) throw new Error(`Production Compose config failed (${production.status}): ${production.stderr.trim()}`);
assert.equal(JSON.parse(production.stdout).services.seed.environment.NODE_ENV, 'production', 'seed must refuse production mode');
process.stdout.write(`PASS primary C48 Compose services, loopback ports, and resource names (${expectedServices.length} services)\n`);
