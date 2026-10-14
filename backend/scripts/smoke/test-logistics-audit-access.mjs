import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const argon2 = require('argon2');

function primaryIdentityDatabaseUrl() {
  let url;
  if (process.env.C48_IDENTITY_DATABASE_URL) {
    url = new URL(process.env.C48_IDENTITY_DATABASE_URL);
  } else {
    const password = process.env.IDENTITY_MIGRATOR_PASSWORD;
    if (!password) throw new Error('C48_IDENTITY_DATABASE_URL or IDENTITY_MIGRATOR_PASSWORD is required');
    url = new URL('postgresql://127.0.0.1:55432/c48_identity');
    url.username = 'identity_migrator';
    url.password = password;
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/gu, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.port !== '55432' || databaseName !== 'c48_identity' || url.search || url.hash) {
    throw new Error('The audit access smoke requires the primary loopback c48_identity database on port 55432');
  }
  return url.toString();
}

const identityDatabaseUrl = primaryIdentityDatabaseUrl();

function loopbackOrigin(variable, defaultValue) {
  const base = new URL(process.env[variable] || defaultValue);
  if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
    throw new Error(`${variable} must use a loopback host`);
  }
  if (base.pathname !== '/' || base.search || base.hash) throw new Error(`${variable} must be an origin without a path`);
  return base.origin;
}

const identityOrigin = loopbackOrigin('C48_T18_IDENTITY_BASE_URL', 'http://127.0.0.1:3001');
const logisticsOrigin = loopbackOrigin('C48_T18_LOGISTICS_BASE_URL', 'http://127.0.0.1:3003');
const database = new Client({ connectionString: identityDatabaseUrl });
const userIds = [];

async function request(origin, path, { body, token, sourceIp } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sourceIp) headers['X-Forwarded-For'] = sourceIp;
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${path} returned a non-JSON response`);
  }
  return { status: response.status, headers: response.headers, body: value };
}

async function createTemporaryActor(role, label) {
  const suffix = randomBytes(6).toString('hex');
  const username = `t18audit${role.toLowerCase()}${suffix}`;
  const password = `T18 audit access ${suffix}!`;
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 8_192,
    timeCost: 1,
    parallelism: 1,
  });
  const inserted = await database.query(
    'INSERT INTO app_user (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [username, `Tài khoản kiểm tra quyền ${label} ${suffix}`, passwordHash],
  );
  const userId = inserted.rows[0].id;
  userIds.push(userId);
  await database.query(
    'INSERT INTO role_grant (user_id, role_code, scope_type) VALUES ($1, $2, $3)',
    [userId, role, 'SYSTEM'],
  );
  return { username, password };
}

async function login(actor, sourceIp) {
  const result = await request(identityOrigin, '/api/v1/identity/auth/login', {
    body: { username: actor.username, password: actor.password, client_kind: 'NATIVE' },
    sourceIp,
  });
  assert.equal(result.status, 200, 'temporary Identity actor login must succeed');
  assert.equal(typeof result.body?.access_token, 'string');
  return result.body.access_token;
}

async function temporaryAuditRowCount() {
  const result = await database.query(
    'SELECT count(*)::int AS count FROM audit_log WHERE actor_user_id = ANY($1::uuid[])',
    [userIds],
  );
  return result.rows[0].count;
}

async function cleanupTemporaryActors() {
  if (userIds.length === 0) return;
  const familyRows = await database.query('SELECT id FROM session_family WHERE user_id = ANY($1::uuid[])', [userIds]);
  const familyIds = familyRows.rows.map(({ id }) => id);
  await database.query('BEGIN');
  try {
    await database.query(
      `DELETE FROM refresh_session
        WHERE family_id IN (SELECT id FROM session_family WHERE user_id = ANY($1::uuid[]))`,
      [userIds],
    );
    await database.query('DELETE FROM session_family WHERE user_id = ANY($1::uuid[])', [userIds]);
    await database.query('DELETE FROM role_grant WHERE user_id = ANY($1::uuid[])', [userIds]);
    await database.query('DELETE FROM app_user WHERE id = ANY($1::uuid[])', [userIds]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    throw error;
  }

  const remaining = await database.query(
    `SELECT
       (SELECT count(*)::int FROM app_user WHERE id = ANY($1::uuid[])) AS users,
       (SELECT count(*)::int FROM role_grant WHERE user_id = ANY($1::uuid[])) AS grants,
       (SELECT count(*)::int FROM session_family WHERE user_id = ANY($1::uuid[])) AS sessions,
       (SELECT count(*)::int FROM refresh_session WHERE family_id = ANY($2::uuid[])) AS refresh_sessions`,
    [userIds, familyIds],
  );
  assert.deepEqual(remaining.rows[0], { users: 0, grants: 0, sessions: 0, refresh_sessions: 0 });
}

await database.connect();
try {
  const admin = await createTemporaryActor('ADMIN', 'quản trị');
  const restricted = await createTemporaryActor('VOLUNTEER', 'tình nguyện viên');
  const auditRowsBefore = await temporaryAuditRowCount();
  assert.equal(auditRowsBefore, 0, 'temporary actors must not have pre-existing Identity audit records');
  const adminToken = await login(admin, '198.51.100.181');
  const restrictedToken = await login(restricted, '198.51.100.182');
  const auditPath = '/api/v1/logistics/audit-logs?entity_type=distribution&limit=1';

  const allowed = await request(logisticsOrigin, auditPath, { token: adminToken });
  assert.equal(allowed.status, 200, 'SYSTEM ADMIN with AUDIT_READ must access the Logistics audit route');
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.ok(Array.isArray(allowed.body?.items));
  assert.ok(allowed.body.next_cursor === null || typeof allowed.body.next_cursor === 'string');
  const auditItems = allowed.body.items;
  if (auditItems.length === 0) {
    console.log('SKIP Logistics audit filtering: no distribution audit rows; content is not verified.');
  } else {
    assert.ok(auditItems.length > 0, 'a populated distribution page must be non-empty');
    assert.ok(auditItems.every((item) => item.entity_type === 'distribution'), 'audit page must respect entity_type');
    const entityId = auditItems[0].entity_id;
    assert.equal(typeof entityId, 'string');
    assert.ok(entityId.length > 0);
    const entityAuditPath = `/api/v1/logistics/audit-logs?entity_type=distribution&entity_id=${encodeURIComponent(entityId)}&limit=1`;
    const entityAudit = await request(logisticsOrigin, entityAuditPath, { token: adminToken });
    assert.equal(entityAudit.status, 200, 'SYSTEM ADMIN must retrieve an entity_id-filtered audit page');
    assert.equal(entityAudit.headers.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(entityAudit.body?.items));
    assert.ok(entityAudit.body.items.length > 0, 'the selected audit row must remain visible with both filters');
    assert.ok(entityAudit.body.items.every((item) => item.entity_type === 'distribution' && item.entity_id === entityId),
      'audit page must respect entity_type and entity_id');
    const nonmatchingEntityId = randomUUID();
    assert.notEqual(nonmatchingEntityId, entityId);
    const unmatchedAuditPath = `/api/v1/logistics/audit-logs?entity_type=distribution&entity_id=${nonmatchingEntityId}&limit=1`;
    const unmatchedAudit = await request(logisticsOrigin, unmatchedAuditPath, { token: adminToken });
    assert.equal(unmatchedAudit.status, 200, 'SYSTEM ADMIN must retrieve an empty page for a valid nonmatching entity_id');
    assert.equal(unmatchedAudit.headers.get('cache-control'), 'no-store');
    assert.deepEqual(unmatchedAudit.body?.items, [], 'entity_id filtering must exclude rows with a nonmatching entity_id');
    console.log('PASS Logistics audit filtering: populated results match the requested entity_id; a valid nonmatching entity_id returns no rows.');
  }

  const denied = await request(logisticsOrigin, auditPath, { token: restrictedToken });
  assert.equal(denied.status, 403);
  assert.equal(denied.body?.code, 'FORBIDDEN');
  assert.equal(denied.body?.message, 'Bạn không có quyền thực hiện thao tác này.');
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.equal(typeof denied.body?.correlation_id, 'string');
  assert.ok(denied.body.correlation_id.length > 0);

  const auditRowsAfter = await temporaryAuditRowCount();
  assert.equal(auditRowsAfter, auditRowsBefore, 'the read-only access smoke must not append Identity audit records');
  console.log(`PASS Logistics audit permissions: SYSTEM ADMIN allowed; restricted actor received Vietnamese FORBIDDEN; Identity audit rows ${auditRowsBefore} -> ${auditRowsAfter}.`);
} finally {
  try {
    await cleanupTemporaryActors();
  } finally {
    await database.end();
  }
}
