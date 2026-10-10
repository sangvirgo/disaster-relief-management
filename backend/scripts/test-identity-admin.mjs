import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const argon2 = require('argon2');
const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = new URL(process.env.IDENTITY_ADMIN_TEST_BASE_URL ?? 'http://127.0.0.1:3001/api/v1/identity');
const clientId = process.env.TEST_SERVICE_CLIENT_ID;
const clientSecret = process.env.TEST_SERVICE_CLIENT_SECRET;
if (!databaseUrl || !clientId || !clientSecret) throw new Error('TEST_DATABASE_URL and test service credentials are required');

const database = new Client({ connectionString: databaseUrl });
const userIds = [];
const familyIds = [];
const createdIds = [];
const regionCodes = [];
const keys = [];
let ipSequence = 1;
const adminPassword = `Admin field account ${randomBytes(6).toString('hex')}!`;
const adminUsername = `admin${randomBytes(5).toString('hex')}`;

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(new URL(`${baseUrl.pathname.replace(/\/$/, '')}${path}`, baseUrl.origin), {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
}

function expectError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body?.code, code, JSON.stringify(result.body));
  assert.ok(result.body?.correlation_id);
  assert.match(result.body?.message ?? '', /[ăâđêôơưáàảãạằắẳẵặầấẩẫậèéẻẽẹềếểệìíỉịòóỏọồốổỗộờớởỡợùúứửựỳýỷỹỵ]/i);
}

function idem() {
  const key = randomUUID();
  keys.push(key);
  return key;
}

function nextIp() {
  return `198.51.100.${ipSequence++}`;
}

function jwtClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

await database.connect();
try {
  const adminHash = await argon2.hash(adminPassword, { type: argon2.argon2id, memoryCost: 8_192, timeCost: 1, parallelism: 1 });
  const admin = await database.query(
    `INSERT INTO app_user (username, display_name, password_hash)
     VALUES ($1, 'Quản trị thử nghiệm', $2) RETURNING id`,
    [adminUsername, adminHash],
  );
  const adminId = admin.rows[0].id;
  userIds.push(adminId);
  await database.query("INSERT INTO role_grant (user_id, role_code, scope_type) VALUES ($1, 'ADMIN', 'SYSTEM')", [adminId]);

  const login = await call('/auth/login', { method: 'POST', body: { username: adminUsername, password: adminPassword, client_kind: 'NATIVE' }, headers: { 'X-Forwarded-For': nextIp() } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const adminToken = login.body.access_token;
  const adminClaims = jwtClaims(adminToken);
  familyIds.push(adminClaims.sid);

  const unauthorized = await call('/internal/introspect', { method: 'POST', body: { sid: adminClaims.sid, sub: adminId } });
  expectError(unauthorized, 401, 'UNAUTHENTICATED');
  const serviceToken = await call('/internal/token', {
    method: 'POST',
    body: { client_id: clientId, client_secret: clientSecret, audience: 'identity' },
  });
  assert.equal(serviceToken.status, 200, JSON.stringify(serviceToken.body));
  assert.equal(serviceToken.body.expires_in, 300);
  const introspected = await call('/internal/introspect', {
    method: 'POST', token: serviceToken.body.access_token, body: { sid: adminClaims.sid, sub: adminId },
  });
  assert.equal(introspected.status, 200, JSON.stringify(introspected.body));
  assert.equal(introspected.body.active, true);
  assert.equal(introspected.body.user_id, adminId);
  assert.equal(introspected.body.grants[0].role_code, 'ADMIN');

  const organizationPayload = { name: `Đội điều phối ${randomBytes(4).toString('hex')}`, organization_kind: 'COORDINATION' };
  const organization = await call('/organizations', {
    method: 'POST', token: adminToken, body: organizationPayload, headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(organization.status, 201, JSON.stringify(organization.body));
  const organizationId = organization.body.id;
  createdIds.push(organizationId);
  const duplicateOrganization = await call('/organizations', {
    method: 'POST', token: adminToken, body: organizationPayload, headers: { 'Idempotency-Key': idem() },
  });
  expectError(duplicateOrganization, 409, 'ORGANIZATION_NAME_TAKEN');

  const temporaryPassword = `Temporary field password ${randomBytes(6).toString('hex')}!`;
  const userPayload = {
    username: `staff${randomBytes(5).toString('hex')}`,
    display_name: 'Nhân viên cứu trợ',
    temporary_password: temporaryPassword,
    organization_id: organizationId,
  };
  const createUserKey = idem();
  const createdUser = await call('/users', {
    method: 'POST', token: adminToken, body: userPayload, headers: { 'Idempotency-Key': createUserKey },
  });
  assert.equal(createdUser.status, 201, JSON.stringify(createdUser.body));
  const userId = createdUser.body.id;
  userIds.push(userId);
  assert.equal(createdUser.body.must_change_password, true);
  assert.ok(!JSON.stringify(createdUser.body).includes(temporaryPassword));
  const createReplay = await call('/users', {
    method: 'POST', token: adminToken, body: userPayload, headers: { 'Idempotency-Key': createUserKey },
  });
  assert.equal(createReplay.status, 201);
  assert.equal(createReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(createReplay.body.id, userId);
  const userDetail = await call(`/users/${userId}`, { token: adminToken });
  assert.equal(userDetail.status, 200, JSON.stringify(userDetail.body));
  assert.ok(userDetail.body.memberships.some((membership) => membership.organization_id === organizationId));
  assert.ok(!Object.hasOwn(userDetail.body, 'password_hash'));

  const selfGrant = await call(`/users/${adminId}/grants`, {
    method: 'POST', token: adminToken,
    body: { role_code: 'VOLUNTEER', scope_type: 'ORGANIZATION', organization_id: organizationId, reason: 'Không được tự cấp quyền' },
    headers: { 'Idempotency-Key': idem() },
  });
  expectError(selfGrant, 403, 'FORBIDDEN');

  const grantPayload = { role_code: 'VOLUNTEER', scope_type: 'ORGANIZATION', organization_id: organizationId, reason: 'Thử nghiệm quyền' };
  const grant = await call(`/users/${userId}/grants`, {
    method: 'POST', token: adminToken, body: grantPayload, headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  const duplicateGrant = await call(`/users/${userId}/grants`, {
    method: 'POST', token: adminToken, body: grantPayload, headers: { 'Idempotency-Key': idem() },
  });
  expectError(duplicateGrant, 409, 'GRANT_EXISTS');

  const regionCode = `T${randomBytes(3).toString('hex').toUpperCase()}`;
  regionCodes.push(regionCode);
  const region = await call('/regions', {
    method: 'POST', token: adminToken, body: { code: regionCode, name: 'Khu vực thử nghiệm' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(region.status, 201, JSON.stringify(region.body));
  const regionList = await call('/regions?limit=100', { token: adminToken });
  assert.ok(regionList.body.items.some((item) => item.code === regionCode));
  const regionGrant = await call(`/users/${userId}/grants`, {
    method: 'POST', token: adminToken,
    body: { role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationId, region_code: regionCode, reason: 'Phạm vi khu vực thử nghiệm' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(regionGrant.status, 201, JSON.stringify(regionGrant.body));
  assert.equal(regionGrant.body.region_code, regionCode);

  const staffLogin = await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: temporaryPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  });
  assert.equal(staffLogin.status, 200, JSON.stringify(staffLogin.body));
  const staffClaims = jwtClaims(staffLogin.body.access_token);
  familyIds.push(staffClaims.sid);

  const secondGrant = await call(`/users/${userId}/grants`, {
    method: 'POST', token: adminToken,
    body: { ...grantPayload, role_code: 'COORDINATOR', reason: 'Thay đổi quyền thử nghiệm' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(secondGrant.status, 201, JSON.stringify(secondGrant.body));
  const revokedSession = await call('/me', { token: staffLogin.body.access_token });
  expectError(revokedSession, 401, 'SESSION_EXPIRED');
  const revokedFamily = await database.query('SELECT revoked_at, revoke_reason FROM session_family WHERE id = $1', [staffClaims.sid]);
  assert.ok(revokedFamily.rows[0].revoked_at);
  assert.equal(revokedFamily.rows[0].revoke_reason, 'ROLE_CHANGE');

  const freshLogin = await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: temporaryPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  });
  assert.equal(freshLogin.status, 200, JSON.stringify(freshLogin.body));
  const freshClaims = jwtClaims(freshLogin.body.access_token);
  familyIds.push(freshClaims.sid);
  const currentGrants = await call(`/users/${userId}/grants?limit=1`, { token: adminToken });
  assert.equal(currentGrants.status, 200, JSON.stringify(currentGrants.body));
  assert.ok(currentGrants.body.next_cursor);
  const nextGrantPage = await call(`/users/${userId}/grants?limit=1&cursor=${encodeURIComponent(currentGrants.body.next_cursor)}`, { token: adminToken });
  assert.equal(nextGrantPage.status, 200, JSON.stringify(nextGrantPage.body));
  assert.notEqual(nextGrantPage.body.items[0].id, currentGrants.body.items[0].id);

  const revokedGrant = await call(`/grants/${grant.body.id}/revoke`, {
    method: 'POST', token: adminToken, body: { reason: 'Thu hồi quyền thử nghiệm' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(revokedGrant.status, 200, JSON.stringify(revokedGrant.body));
  expectError(await call('/me', { token: freshLogin.body.access_token }), 401, 'SESSION_EXPIRED');

  const membershipLogin = await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: temporaryPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  });
  assert.equal(membershipLogin.status, 200, JSON.stringify(membershipLogin.body));
  const membershipClaims = jwtClaims(membershipLogin.body.access_token);
  familyIds.push(membershipClaims.sid);
  const removeMembership = await call(`/organizations/${organizationId}/members/${userId}/remove`, {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(removeMembership.status, 204, JSON.stringify(removeMembership.body));
  expectError(await call('/me', { token: membershipLogin.body.access_token }), 401, 'SESSION_EXPIRED');
  const liveOrganizationGrants = await database.query(
    "SELECT count(*)::int AS count FROM role_grant WHERE user_id = $1 AND organization_id = $2 AND revoked_at IS NULL",
    [userId, organizationId],
  );
  assert.equal(liveOrganizationGrants.rows[0].count, 0);
  const readdedMember = await call(`/organizations/${organizationId}/members`, {
    method: 'POST', token: adminToken, body: { user_id: userId }, headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(readdedMember.status, 201, JSON.stringify(readdedMember.body));
  const organizationInUse = await call(`/organizations/${organizationId}/deactivate`, {
    method: 'POST', token: adminToken, body: { expected_version: 1, reason: 'Không thể đóng khi còn thành viên' },
    headers: { 'Idempotency-Key': idem() },
  });
  expectError(organizationInUse, 409, 'ORGANIZATION_IN_USE');
  const removeReaddedMember = await call(`/organizations/${organizationId}/members/${userId}/remove`, {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(removeReaddedMember.status, 204, JSON.stringify(removeReaddedMember.body));

  const grantsWithHistory = await call(`/users/${userId}/grants?include_revoked=true&limit=1`, { token: adminToken });
  assert.equal(grantsWithHistory.status, 200, JSON.stringify(grantsWithHistory.body));
  assert.equal(grantsWithHistory.body.items[0].revoked_at !== null, true);
  assert.ok(grantsWithHistory.body.next_cursor);

  const organizationDeactivate = await call(`/organizations/${organizationId}/deactivate`, {
    method: 'POST', token: adminToken, body: { expected_version: 1, reason: 'Đóng tổ chức thử nghiệm' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(organizationDeactivate.status, 200, JSON.stringify(organizationDeactivate.body));
  const regionDeactivate = await call(`/regions/${regionCode}/deactivate`, {
    method: 'POST', token: adminToken, body: { expected_version: 1, reason: 'Đóng khu vực thử nghiệm' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(regionDeactivate.status, 200, JSON.stringify(regionDeactivate.body));

  const lastAdmin = await call(`/users/${adminId}/disable`, {
    method: 'POST', token: adminToken,
    body: { expected_version: 1, reason: 'Kiểm tra quản trị viên cuối cùng' },
    headers: { 'Idempotency-Key': idem() },
  });
  expectError(lastAdmin, 409, 'LAST_ADMIN');
  const ownAdminGrant = await database.query("SELECT id FROM role_grant WHERE user_id = $1 AND role_code = 'ADMIN' AND revoked_at IS NULL", [adminId]);
  const revokeLastAdmin = await call(`/grants/${ownAdminGrant.rows[0].id}/revoke`, {
    method: 'POST', token: adminToken, body: { reason: 'Kiểm tra thu hồi quản trị viên cuối cùng' },
    headers: { 'Idempotency-Key': idem() },
  });
  expectError(revokeLastAdmin, 409, 'LAST_ADMIN');

  const users = await call('/users?limit=1', { token: adminToken });
  assert.equal(users.status, 200, JSON.stringify(users.body));
  assert.equal(users.body.items.length, 1);
  assert.ok(users.body.next_cursor);
  const audit = await call(`/audit-logs?entity_type=app_user&entity_id=${userId}&limit=100`, { token: adminToken });
  assert.equal(audit.status, 200, JSON.stringify(audit.body));
  assert.ok(audit.body.items.some((item) => item.action === 'USER_CREATED'));
  assert.ok(!JSON.stringify(audit.body).includes(temporaryPassword));
  const grantAudit = await call(`/audit-logs?entity_type=role_grant&entity_id=${grant.body.id}&limit=100`, { token: adminToken });
  assert.ok(grantAudit.body.items.some((item) => item.action === 'GRANT_CREATED'));

  const internalOrganization = await call(`/internal/organizations/${organizationId}`, { token: serviceToken.body.access_token });
  assert.equal(internalOrganization.status, 200, JSON.stringify(internalOrganization.body));
  assert.equal(internalOrganization.body.status, 'INACTIVE');

  const beforeDisable = await call(`/users/${userId}`, { token: adminToken });
  const disabled = await call(`/users/${userId}/disable`, {
    method: 'POST', token: adminToken,
    body: { expected_version: beforeDisable.body.version, reason: 'Kiểm tra khóa tài khoản' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
  assert.equal(disabled.body.status, 'DISABLED');
  expectError(await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: temporaryPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  }), 401, 'INVALID_CREDENTIALS');
  const enabled = await call(`/users/${userId}/enable`, {
    method: 'POST', token: adminToken,
    body: { expected_version: disabled.body.version, reason: 'Kiểm tra mở khóa tài khoản' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  const enabledLogin = await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: temporaryPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  });
  assert.equal(enabledLogin.status, 200, JSON.stringify(enabledLogin.body));
  const enabledClaims = jwtClaims(enabledLogin.body.access_token);
  familyIds.push(enabledClaims.sid);
  const resetPassword = `New temporary password ${randomBytes(6).toString('hex')}!`;
  const reset = await call(`/users/${userId}/reset-password`, {
    method: 'POST', token: adminToken,
    body: { expected_version: enabled.body.version, temporary_password: resetPassword, reason: 'Kiểm tra đặt lại mật khẩu' },
    headers: { 'Idempotency-Key': idem() },
  });
  assert.equal(reset.status, 204, JSON.stringify(reset.body));
  expectError(await call('/me', { token: enabledLogin.body.access_token }), 401, 'SESSION_EXPIRED');
  expectError(await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: temporaryPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  }), 401, 'INVALID_CREDENTIALS');
  const resetLogin = await call('/auth/login', {
    method: 'POST', body: { username: userPayload.username, password: resetPassword, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': nextIp() },
  });
  assert.equal(resetLogin.status, 200, JSON.stringify(resetLogin.body));
  familyIds.push(jwtClaims(resetLogin.body.access_token).sid);

  const lookedUp = await call('/internal/users:lookup', {
    method: 'POST', token: serviceToken.body.access_token, body: { ids: [userId, randomUUID()] },
  });
  assert.equal(lookedUp.status, 200, JSON.stringify(lookedUp.body));
  assert.deepEqual(lookedUp.body.items, [{ id: userId, display_name: 'Nhân viên cứu trợ' }]);

  console.log('PASS Identity admin grants/revocation, last-admin guard, audit, keyset users, and service-only introspection/lookup on PostgreSQL');
} finally {
  if (familyIds.length) await database.query('DELETE FROM refresh_session WHERE family_id = ANY($1::uuid[])', [familyIds]).catch(() => undefined);
  if (userIds.length) {
    await database.query('DELETE FROM session_family WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => undefined);
    await database.query('DELETE FROM role_grant WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => undefined);
    await database.query('DELETE FROM membership WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => undefined);
    await database.query('DELETE FROM app_user WHERE id = ANY($1::uuid[])', [userIds]).catch(() => undefined);
  }
  if (createdIds.length) {
    await database.query('DELETE FROM organization WHERE id = ANY($1::uuid[])', [createdIds]).catch(() => undefined);
  }
  if (regionCodes.length) await database.query('DELETE FROM region WHERE code = ANY($1::text[])', [regionCodes]).catch(() => undefined);
  if (keys.length) await database.query('DELETE FROM idempotency_record WHERE idempotency_key = ANY($1::uuid[])', [keys]).catch(() => undefined);
  await database.end();
}
