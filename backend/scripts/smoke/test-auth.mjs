import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const databaseUrl = process.env.C48_IDENTITY_DATABASE_URL;
const appDatabaseUrl = process.env.C48_IDENTITY_APP_DATABASE_URL;
const baseUrl = new URL(process.env.C48_IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001/api/v1/identity');
const origin = process.env.C48_SMOKE_ORIGIN ?? 'http://localhost:8080';
if (!databaseUrl || !appDatabaseUrl) throw new Error('C48_IDENTITY_DATABASE_URL and C48_IDENTITY_APP_DATABASE_URL must point at the primary C48 Identity database');

process.env.DATABASE_URL = appDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX ?? '4';
const { DataSource } = require('typeorm');
const { IdempotencyService, canonicalRequestHash } = require('../../dist/packages/technical/src/idempotency/idempotency.js');
const { postgresOptions } = require('../../dist/packages/technical/src/persistence/postgres-options.js');

const database = new Client({ connectionString: databaseUrl });
const appDatabase = new DataSource(postgresOptions([], 'identity'));
const idempotency = new IdempotencyService();
const userIds = new Set();
const familyIds = new Set();
const idempotencyKeys = new Set();
let sequence = 1;

function ip() {
  return `198.51.100.${sequence++}`;
}

async function call(path, { method = 'GET', body, headers = {}, cookies } = {}) {
  const requestHeaders = { ...headers };
  if (cookies?.size) requestHeaders.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const requestUrl = new URL(`${baseUrl.pathname.replace(/\/$/, '')}${path}`, baseUrl.origin);
  const response = await fetch(requestUrl, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  if (text) {
    try { value = JSON.parse(text); } catch { value = text; }
  }
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return { status: response.status, body: value, headers: response.headers, setCookies };
}

function mergeCookies(jar, setCookies) {
  for (const line of setCookies) {
    const pair = line.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    if (/Max-Age=0/i.test(line)) jar.delete(name);
    else jar.set(name, pair.slice(separator + 1));
  }
}

function tokenClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function userInput() {
  const suffix = randomBytes(5).toString('hex');
  return {
    username: `c48${suffix}`,
    display_name: `Người dùng thử ${suffix}`,
    password: `Fields remain private ${suffix}!`,
  };
}

async function register(input, key = randomUUID(), requestIp = ip()) {
  idempotencyKeys.add(key);
  return call('/auth/register', {
    method: 'POST', body: input,
    headers: { 'Idempotency-Key': key, 'X-Forwarded-For': requestIp },
  });
}

function expectError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body?.code, code, JSON.stringify(result.body));
  assert.match(result.body?.message ?? '', /[ăâđêôơưáàảãạằắẳẵặầấẩẫậèéẻẽẹềếểệìíỉĩịòóỏõọồốổỗộờớởỡợùúỏõọứửữựỳýỷỹỵ]/i);
  assert.ok(result.body?.correlation_id);
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

await database.connect();
try {
  await appDatabase.initialize();
  const csrf = await call('/auth/csrf', { headers: { Origin: origin } });
  assert.equal(csrf.status, 200);
  assert.equal(csrf.body.csrf_token, csrf.headers.get('x-csrf-token'));
  const browserCookies = new Map();
  mergeCookies(browserCookies, csrf.setCookies);
  assert.ok(browserCookies.has('c48_pre') && browserCookies.has('c48_csrf'));
  for (const name of ['c48_pre', 'c48_csrf']) {
    const cookie = csrf.setCookies.find((value) => value.startsWith(name + '='));
    assert.ok(cookie?.includes('Secure') && cookie.includes('SameSite=Strict') && cookie.includes('Path=/api/v1'));
  }
  assert.ok(csrf.setCookies.find((value) => value.startsWith('c48_pre='))?.includes('HttpOnly'));
  assert.ok(!csrf.setCookies.find((value) => value.startsWith('c48_csrf='))?.includes('HttpOnly'));

  const privileged = userInput();
  const forbiddenFields = await call('/auth/register', {
    method: 'POST', body: { ...privileged, role_code: 'ADMIN', scope_type: 'SYSTEM' }, cookies: browserCookies,
    headers: { Origin: origin, 'X-CSRF-Token': csrf.body.csrf_token, 'Idempotency-Key': randomUUID(), 'X-Forwarded-For': ip() },
  });
  expectError(forbiddenFields, 400, 'VALIDATION_FAILED');
  const missingCsrf = await call('/auth/register', {
    method: 'POST', body: privileged, cookies: browserCookies,
    headers: { Origin: origin, 'Idempotency-Key': randomUUID(), 'X-Forwarded-For': ip() },
  });
  expectError(missingCsrf, 403, 'CSRF_INVALID');

  const weak = await register({ ...userInput(), password: 'Password123' });
  expectError(weak, 400, 'PASSWORD_WEAK');

  const input = userInput();
  const registerKey = randomUUID();
  const registered = await register(input, registerKey);
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  assert.deepEqual(Object.keys(registered.body).sort(), ['user']);
  assert.deepEqual(Object.keys(registered.body.user).sort(), ['display_name', 'id', 'username']);
  assert.ok(!JSON.stringify(registered.body).includes(input.password));
  const userId = registered.body.user.id;
  userIds.add(userId);
  idempotencyKeys.add(registerKey);
  const replay = await register(input, registerKey, ip());
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(replay.body, registered.body);
  const duplicateCase = await register({ ...input, username: input.username.toUpperCase() });
  expectError(duplicateCase, 409, 'USERNAME_TAKEN');
  const grants = await database.query('SELECT role_code, scope_type FROM role_grant WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  assert.deepEqual(grants.rows, [{ role_code: 'CITIZEN', scope_type: 'SYSTEM' }]);

  const badBrowserAsNative = await call('/auth/login', {
    method: 'POST', body: { username: input.username, password: input.password, client_kind: 'NATIVE' },
    headers: { Origin: origin, 'X-Forwarded-For': ip() },
  });
  expectError(badBrowserAsNative, 403, 'FORBIDDEN');

  const webLogin = await call('/auth/login', {
    method: 'POST', body: { username: input.username, password: input.password, client_kind: 'WEB' },
    cookies: browserCookies,
    headers: { Origin: origin, 'X-CSRF-Token': csrf.body.csrf_token, 'X-Forwarded-For': ip() },
  });
  assert.equal(webLogin.status, 200, JSON.stringify(webLogin.body));
  assert.deepEqual(Object.keys(webLogin.body).sort(), ['must_change_password', 'session', 'user']);
  assert.ok(!('access_token' in webLogin.body) && !('refresh_token' in webLogin.body));
  assert.notEqual(webLogin.headers.get('x-csrf-token'), csrf.body.csrf_token);
  for (const [name, path] of [['c48_access', '/api/v1'], ['c48_refresh', '/api/v1/identity/auth']]) {
    const cookie = webLogin.setCookies.find((value) => value.startsWith(name + '='));
    assert.ok(cookie?.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Strict') && cookie.includes(`Path=${path}`));
    mergeCookies(browserCookies, [cookie]);
  }
  mergeCookies(browserCookies, webLogin.setCookies.filter((value) => value.startsWith('c48_pre=') || value.startsWith('c48_csrf=')));
  const accessTokenFromCookie = browserCookies.get('c48_access');
  const meWeb = await call('/me', { cookies: browserCookies });
  assert.equal(meWeb.status, 200, JSON.stringify(meWeb.body));
  assert.equal(meWeb.headers.get('cache-control'), 'no-store');
  assert.equal(meWeb.body.id, userId);
  assert.equal(meWeb.body.grants[0].role_code, 'CITIZEN');
  assert.ok(!JSON.stringify(meWeb.body).includes('password_hash'));

  const missingOriginLogout = await call('/auth/logout', { method: 'POST', cookies: browserCookies });
  expectError(missingOriginLogout, 403, 'FORBIDDEN');
  const logout = await call('/auth/logout', {
    method: 'POST', cookies: browserCookies,
    headers: { Origin: origin, 'X-CSRF-Token': webLogin.headers.get('x-csrf-token') },
  });
  assert.equal(logout.status, 204);
  assert.ok(logout.setCookies.some((value) => value.startsWith('c48_access=') && (/Max-Age=0/i.test(value) || /Expires=Thu, 01 Jan 1970/i.test(value))));
  const loggedOutMe = await call('/me', { headers: { Cookie: `c48_access=${accessTokenFromCookie}` } });
  expectError(loggedOutMe, 401, 'SESSION_EXPIRED');

  const nativeLogin = await call('/auth/login', {
    method: 'POST', body: { username: input.username.toUpperCase(), password: input.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  assert.equal(nativeLogin.status, 200, JSON.stringify(nativeLogin.body));
  assert.ok(nativeLogin.body.access_token && nativeLogin.body.refresh_token);
  assert.deepEqual(nativeLogin.body.user, { id: userId, username: input.username, display_name: input.display_name });
  assert.deepEqual(nativeLogin.setCookies, []);
  const nativeClaims = tokenClaims(nativeLogin.body.access_token);
  familyIds.add(nativeClaims.sid);
  const meNative = await call('/me', { headers: { Authorization: `Bearer ${nativeLogin.body.access_token}` } });
  assert.equal(meNative.status, 200, JSON.stringify(meNative.body));
  const nativeTransportRejected = await call('/me', {
    headers: { Authorization: `Bearer ${nativeLogin.body.access_token}`, Origin: origin },
  });
  expectError(nativeTransportRejected, 403, 'FORBIDDEN');

  const newPassword = `A safer field account ${randomBytes(5).toString('hex')}!`;
  const changeKey = randomUUID();
  idempotencyKeys.add(changeKey);
  const changeBody = { current_password: input.password, new_password: newPassword };
  const changed = await call('/auth/change-password', {
    method: 'POST', body: changeBody,
    headers: { Authorization: `Bearer ${nativeLogin.body.access_token}`, 'Idempotency-Key': changeKey },
  });
  assert.equal(changed.status, 204, JSON.stringify(changed.body));
  const changeReplay = await call('/auth/change-password', {
    method: 'POST', body: changeBody,
    headers: { Authorization: `Bearer ${nativeLogin.body.access_token}`, 'Idempotency-Key': changeKey },
  });
  assert.equal(changeReplay.status, 204);
  const changeConflict = await call('/auth/change-password', {
    method: 'POST', body: { ...changeBody, new_password: `Another safe account ${randomBytes(5).toString('hex')}!` },
    headers: { Authorization: `Bearer ${nativeLogin.body.access_token}`, 'Idempotency-Key': changeKey },
  });
  expectError(changeConflict, 409, 'IDEMPOTENCY_KEY_REUSED');
  const oldPasswordLogin = await call('/auth/login', {
    method: 'POST', body: { username: input.username, password: input.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  expectError(oldPasswordLogin, 401, 'INVALID_CREDENTIALS');
  const rotatedLogin = await call('/auth/login', {
    method: 'POST', body: { username: input.username, password: newPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  assert.equal(rotatedLogin.status, 200, JSON.stringify(rotatedLogin.body));

  const raceClaims = tokenClaims(rotatedLogin.body.access_token);
  familyIds.add(raceClaims.sid);
  const refreshBody = { refresh_token: rotatedLogin.body.refresh_token };
  const parallel = await Promise.all([
    call('/auth/refresh', { method: 'POST', body: refreshBody, headers: { 'X-Forwarded-For': ip() } }),
    call('/auth/refresh', { method: 'POST', body: refreshBody, headers: { 'X-Forwarded-For': ip() } }),
  ]);
  assert.equal(parallel.filter((result) => result.status === 200).length, 1, JSON.stringify(parallel.map((result) => [result.status, result.body])));
  assert.equal(parallel.filter((result) => result.status === 409 && result.body?.code === 'REFRESH_RACE').length, 1);
  const familyAfterRace = await database.query(
    `SELECT sf.revoked_at,
            count(*) FILTER (WHERE rs.rotated_at IS NULL) AS live_tokens,
            count(*) AS token_count
       FROM session_family sf JOIN refresh_session rs ON rs.family_id = sf.id
      WHERE sf.id = $1 GROUP BY sf.id`,
    [raceClaims.sid],
  );
  assert.equal(familyAfterRace.rows[0].revoked_at, null);
  assert.equal(Number(familyAfterRace.rows[0].live_tokens), 1);
  assert.equal(Number(familyAfterRace.rows[0].token_count), 2);
  await database.query("UPDATE refresh_session SET rotated_at = now() - interval '11 seconds' WHERE family_id = $1 AND rotated_at IS NOT NULL", [raceClaims.sid]);
  const reused = await call('/auth/refresh', { method: 'POST', body: refreshBody, headers: { 'X-Forwarded-For': ip() } });
  expectError(reused, 401, 'REFRESH_REUSED');
  const reusedFamily = await database.query('SELECT revoked_at, revoke_reason FROM session_family WHERE id = $1', [raceClaims.sid]);
  assert.ok(reusedFamily.rows[0].revoked_at);
  assert.equal(reusedFamily.rows[0].revoke_reason, 'REUSE_DETECTED');

  const barrierLogin = await call('/auth/login', {
    method: 'POST', body: { username: input.username, password: newPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  assert.equal(barrierLogin.status, 200, JSON.stringify(barrierLogin.body));
  const barrierClaims = tokenClaims(barrierLogin.body.access_token);
  familyIds.add(barrierClaims.sid);
  await database.query('BEGIN');
  let committed = false;
  try {
    await database.query("UPDATE app_user SET status = 'DISABLED', authz_version = authz_version + 1 WHERE id = $1", [userId]);
    let settled = false;
    const pendingRefresh = call('/auth/refresh', {
      method: 'POST', body: { refresh_token: barrierLogin.body.refresh_token }, headers: { 'X-Forwarded-For': ip() },
    }).then((result) => { settled = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(settled, false, 'refresh must wait behind the user authz-version lock');
    await database.query('COMMIT');
    committed = true;
    const refused = await pendingRefresh;
    expectError(refused, 401, 'SESSION_EXPIRED');
  } finally {
    if (!committed) await database.query('ROLLBACK').catch(() => undefined);
  }
  const barrierFamily = await database.query('SELECT revoked_at, revoke_reason FROM session_family WHERE id = $1', [barrierClaims.sid]);
  assert.ok(barrierFamily.rows[0].revoked_at);
  assert.equal(barrierFamily.rows[0].revoke_reason, 'DISABLED');
  const activeTokens = await database.query(
    'SELECT count(*)::int AS count FROM refresh_session rs JOIN session_family sf ON sf.id = rs.family_id WHERE sf.id = $1 AND sf.revoked_at IS NULL AND rs.rotated_at IS NULL',
    [barrierClaims.sid],
  );
  assert.equal(activeTokens.rows[0].count, 0);

  const statementKey = randomUUID();
  idempotencyKeys.add(statementKey);
  const statementHash = canonicalRequestHash({ action: 'statement-timeout-smoke', user_id: userId });
  let statementAttempts = 0;
  const statementCommand = (execute) => ({
    scopeKey: `user:${userId}`,
    command: 'identity.auth.statement-timeout-smoke',
    key: statementKey,
    requestHash: statementHash,
    execute,
    replay: async (manager, resource) => {
      const rows = await manager.query('SELECT id FROM app_user WHERE id = $1', [resource.id]);
      return { id: rows[0].id };
    },
  });
  let statementFailure;
  try {
    await idempotency.execute(appDatabase, statementCommand(async (manager) => {
      statementAttempts++;
      await manager.query("SET LOCAL statement_timeout = '100ms'");
      await manager.query('SELECT pg_sleep(0.2)');
      return { status: 200, value: { id: userId }, resource: { type: 'app_user', id: userId } };
    }));
  } catch (error) { statementFailure = error; }
  assert.equal(statementFailure?.code, 'LOCK_TIMEOUT');
  assert.equal(statementFailure?.status, 503);
  assert.equal(statementAttempts, 3);
  let successfulEffects = 0;
  const afterStatementTimeout = await idempotency.execute(appDatabase, statementCommand(async () => {
    successfulEffects++;
    return { status: 200, value: { id: userId }, resource: { type: 'app_user', id: userId } };
  }));
  const afterStatementReplay = await idempotency.execute(appDatabase, statementCommand(async () => {
    successfulEffects++;
    throw new Error('a completed retry must not execute twice');
  }));
  assert.equal(afterStatementTimeout.replay, false);
  assert.equal(afterStatementReplay.replay, true);
  assert.equal(successfulEffects, 1);

  const lockKey = randomUUID();
  idempotencyKeys.add(lockKey);
  const lockHash = canonicalRequestHash({ action: 'lock-timeout-smoke', user_id: userId });
  const versionBefore = await database.query('SELECT version FROM app_user WHERE id = $1', [userId]);
  const lockCommand = (execute) => ({
    scopeKey: `user:${userId}`,
    command: 'identity.auth.lock-timeout-smoke',
    key: lockKey,
    requestHash: lockHash,
    execute,
    replay: async (manager, resource) => {
      const rows = await manager.query('SELECT id FROM app_user WHERE id = $1', [resource.id]);
      return { id: rows[0].id };
    },
  });
  await database.query('BEGIN');
  let lockCommitted = false;
  try {
    await database.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    await database.query('SELECT id FROM app_user WHERE id = $1 FOR UPDATE', [userId]);
    let lockFinished = false;
    const pendingLock = idempotency.execute(appDatabase, lockCommand(async (manager) => {
      await manager.query('UPDATE app_user SET version = version + 1 WHERE id = $1 RETURNING id', [userId]);
      return { status: 200, value: { id: userId }, resource: { type: 'app_user', id: userId } };
    })).then((result) => { lockFinished = true; return { result }; }, (error) => { lockFinished = true; return { error }; });
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    assert.equal(lockFinished, true, 'three lock_timeout attempts must finish before releasing the lock');
    const timedOut = await pendingLock;
    assert.equal(timedOut.error?.code, 'LOCK_TIMEOUT');
    await database.query('COMMIT');
    lockCommitted = true;
  } finally {
    if (!lockCommitted) await database.query('ROLLBACK').catch(() => undefined);
  }
  let lockEffects = 0;
  const afterLockTimeout = await idempotency.execute(appDatabase, lockCommand(async (manager) => {
    lockEffects++;
    const rows = (await manager.query('UPDATE app_user SET version = version + 1 WHERE id = $1 RETURNING id', [userId]))[0];
    return { status: 200, value: { id: rows[0].id }, resource: { type: 'app_user', id: rows[0].id } };
  }));
  const afterLockReplay = await idempotency.execute(appDatabase, lockCommand(async () => {
    lockEffects++;
    throw new Error('a lock-timeout retry must not execute twice');
  }));
  assert.equal(afterLockTimeout.replay, false);
  assert.equal(afterLockReplay.replay, true);
  assert.equal(lockEffects, 1);
  const versionAfter = await database.query('SELECT version FROM app_user WHERE id = $1', [userId]);
  assert.equal(versionAfter.rows[0].version, versionBefore.rows[0].version + 1);

  const disabledInput = userInput();
  const disabledRegister = await register(disabledInput);
  assert.equal(disabledRegister.status, 201, JSON.stringify(disabledRegister.body));
  userIds.add(disabledRegister.body.user.id);
  await database.query("UPDATE app_user SET status = 'DISABLED', authz_version = authz_version + 1 WHERE id = $1", [disabledRegister.body.user.id]);
  const disabledLogin = await call('/auth/login', {
    method: 'POST', body: { username: disabledInput.username, password: disabledInput.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  expectError(disabledLogin, 401, 'INVALID_CREDENTIALS');
  const unknownLogin = await call('/auth/login', {
    method: 'POST', body: { username: 'missinguser', password: disabledInput.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  expectError(unknownLogin, 401, 'INVALID_CREDENTIALS');

  console.log('PASS Identity register, cookies/CSRF, native transport, password change, replay/reuse, and authz-version refresh barrier on PostgreSQL');
} finally {
  await database.query('ROLLBACK').catch(() => undefined);
  if (userIds.size) {
    const ids = [...userIds];
    await database.query('DELETE FROM refresh_session WHERE family_id = ANY(SELECT id FROM session_family WHERE user_id = ANY($1::uuid[]))', [ids]).catch(() => undefined);
    await database.query('DELETE FROM session_family WHERE user_id = ANY($1::uuid[])', [ids]).catch(() => undefined);
    await database.query('DELETE FROM role_grant WHERE user_id = ANY($1::uuid[])', [ids]).catch(() => undefined);
    await database.query('DELETE FROM app_user WHERE id = ANY($1::uuid[])', [ids]).catch(() => undefined);
  }
  if (idempotencyKeys.size) {
    await database.query('DELETE FROM idempotency_record WHERE idempotency_key = ANY($1::uuid[])', [[...idempotencyKeys]]).catch(() => undefined);
  }
  if (appDatabase.isInitialized) await appDatabase.destroy();
  await database.end();
}
