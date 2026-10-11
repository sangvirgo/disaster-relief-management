import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = process.env.TEST_RESPONSE_BASE_URL;
const identityUrl = process.env.TEST_IDENTITY_BASE_URL;
const responseDb = new Client({ connectionString: process.env.TEST_RESPONSE_DATABASE_URL });
const identityDb = new Client({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL });
const organizationId = '40000000-0000-4000-8000-000000000008';
let identityIpSequence = 1;

function identityIp() { return `198.51.100.${identityIpSequence++}`; }
function key() { return randomUUID(); }

async function call(base, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
  return { status: response.status, headers: response.headers, value };
}

function assertVietnameseError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.value));
  assert.equal(result.value?.code, code, JSON.stringify(result.value));
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese user-facing copy');
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

async function registerAndLogin(label, regionCode) {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t8${label}${suffix}`,
    display_name: `Người dùng kiểm thử ${label} ${suffix}`,
    password: `Response test password ${suffix}!`,
  };
  const sourceIp = identityIp();
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials, headers: { 'Idempotency-Key': key(), 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  const userId = registered.value.user.id;
  if (regionCode !== undefined) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,region_code)
       VALUES ($1,'COORDINATOR','REGION',$2,$3)`,
      [userId, organizationId, regionCode],
    );
  } else if (label === 'coordinator') {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
       VALUES ($1,'COORDINATOR','ORGANIZATION',$2)`,
      [userId, organizationId],
    );
  }
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: userId, token: login.value.access_token };
}

await Promise.all([responseDb.connect(), identityDb.connect()]);
try {
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind) VALUES ($1,'T8 test organization','COORDINATION') ON CONFLICT (id) DO NOTHING`,
    [organizationId],
  );
  await identityDb.query(
    `INSERT INTO region (code,name) VALUES ('T8_REGION','Khu vực T8'),('T8_OTHER','Khu vực khác T8') ON CONFLICT (code) DO NOTHING`,
  );
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ('T8_REGION',ST_Multi(ST_GeomFromText('POLYGON((104 14,106 14,106 16,104 16,104 14))',4326))),
      ('T8_OTHER',ST_Multi(ST_GeomFromText('POLYGON((107 14,109 14,109 16,107 16,107 14))',4326)))
     ON CONFLICT (region_code) DO NOTHING`,
  );
  await responseDb.query(
    `INSERT INTO skill (code,display_name) VALUES ('T8_A','Kỹ năng A'),('T8_B','Kỹ năng B'),('T8_C','Kỹ năng C') ON CONFLICT (code) DO NOTHING`,
  );

  const reporter = await registerAndLogin('reporter');
  const coordinator = await registerAndLogin('coordinator');
  const otherRegionCoordinator = await registerAndLogin('other', 'T8_OTHER');
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
     VALUES ($1,'VOLUNTEER','ORGANIZATION',$2)`,
    [reporter.id, organizationId],
  );

  const unauthenticatedSkills = await call(responseUrl, 'skills');
  assertVietnameseError(unauthenticatedSkills, 401, 'UNAUTHENTICATED');

  const skillCatalog = await call(responseUrl, 'skills', { headers: { Authorization: `Bearer ${reporter.token}` } });
  assert.equal(skillCatalog.status, 200, JSON.stringify(skillCatalog.value));
  assert.equal(skillCatalog.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(skillCatalog.value), ['items']);
  assert.ok(Array.isArray(skillCatalog.value.items));
  assert.deepEqual(
    skillCatalog.value.items.map((item) => item.code).filter((code) => code.startsWith('T8_')).sort(),
    ['T8_A', 'T8_B', 'T8_C'],
  );

  const externalContact = 'Số điện thoại chỉ lưu nội bộ: 0900 123 456';
  const createBody = {
    name: 'Đội cứu hộ không dùng ứng dụng',
    organization_id: organizationId,
    operating_region_code: 'T8_REGION',
    team_kind: 'GOVERNMENT',
    reporting_mode: 'COORDINATOR',
    external_contact_note: externalContact,
    skill_codes: ['T8_A', 'T8_C'],
  };
  const createKey = key();
  const created = await call(responseUrl, 'teams', {
    method: 'POST', body: createBody,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': createKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.ok(created.value.id);
  assert.equal(created.value.version, 1);
  assert.equal(JSON.stringify(created.value).includes(externalContact), false, 'team response must not expose commander contact PII');

  const replayed = await call(responseUrl, 'teams', {
    method: 'POST', body: createBody,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': createKey },
  });
  assert.equal(replayed.status, 201, JSON.stringify(replayed.value));
  assert.equal(replayed.headers.get('idempotent-replay'), 'true');
  assert.equal(replayed.value.id, created.value.id);

  const teamPage = await call(responseUrl, 'teams?region_code=T8_REGION&limit=10', {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(teamPage.status, 200, JSON.stringify(teamPage.value));
  assert.equal(teamPage.headers.get('cache-control'), 'no-store');
  assert.equal(teamPage.value.items.length, 1);
  assert.equal(teamPage.value.items[0].id, created.value.id);
  assert.deepEqual(teamPage.value.items[0].skills, ['T8_A', 'T8_C']);
  assert.equal(teamPage.value.items[0].position, null);
  assert.equal(JSON.stringify(teamPage.value).includes(externalContact), false, 'team list must not expose commander contact PII');

  const detail = await call(responseUrl, `teams/${created.value.id}`, {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.value));
  assert.equal(detail.value.id, created.value.id);
  assert.deepEqual(detail.value.skills, ['T8_A', 'T8_C']);
  assert.equal(JSON.stringify(detail.value).includes(externalContact), false, 'team detail must not expose commander contact PII');

  const patchBody = { expected_version: 1, name: 'Đội điều phối khu vực T8', skill_codes: ['T8_B'], availability: 'UNAVAILABLE' };
  const patchKey = key();
  const updated = await call(responseUrl, `teams/${created.value.id}`, {
    method: 'PATCH', body: patchBody,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': patchKey },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.value));
  assert.equal(updated.value.name, patchBody.name);
  assert.equal(updated.value.version, 2);
  assert.equal(updated.value.availability, 'UNAVAILABLE');
  assert.deepEqual(updated.value.skills, ['T8_B']);
  assert.equal(JSON.stringify(updated.value).includes(externalContact), false);
  const updateReplay = await call(responseUrl, `teams/${created.value.id}`, {
    method: 'PATCH', body: patchBody,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': patchKey },
  });
  assert.equal(updateReplay.status, 200, JSON.stringify(updateReplay.value));
  assert.equal(updateReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(updateReplay.value.version, 2);
  const staleUpdate = await call(responseUrl, `teams/${created.value.id}`, {
    method: 'PATCH', body: { expected_version: 1, availability: 'AVAILABLE' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(staleUpdate, 409, 'VERSION_CONFLICT');

  const appTeam = await call(responseUrl, 'teams', {
    method: 'POST',
    body: {
      name: 'Đội tình nguyện có ứng dụng', organization_id: organizationId, operating_region_code: 'T8_REGION',
      team_kind: 'VOLUNTEER', reporting_mode: 'APP', leader_user_id: reporter.id, skill_codes: ['T8_A'],
    },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(appTeam.status, 201, JSON.stringify(appTeam.value));
  const appLeader = await responseDb.query(
    `SELECT user_id,member_role,left_at FROM team_member WHERE team_id=$1`, [appTeam.value.id],
  );
  assert.deepEqual(appLeader.rows, [{ user_id: reporter.id, member_role: 'LEADER', left_at: null }]);

  const disabledUser = await registerAndLogin('disabled');
  await identityDb.query("UPDATE app_user SET status='DISABLED' WHERE id=$1", [disabledUser.id]);
  const disabledLeader = await call(responseUrl, 'teams', {
    method: 'POST',
    body: {
      name: 'Đội không đủ điều kiện', organization_id: organizationId, operating_region_code: 'T8_REGION',
      team_kind: 'VOLUNTEER', reporting_mode: 'APP', leader_user_id: disabledUser.id, skill_codes: [],
    },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(disabledLeader, 409, 'TEAM_NOT_ELIGIBLE');

  const outOfScope = await call(responseUrl, 'teams?region_code=T8_REGION&limit=10', {
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` },
  });
  assert.equal(outOfScope.status, 200, JSON.stringify(outOfScope.value));
  assert.deepEqual(outOfScope.value.items, []);
  const outOfScopeDetail = await call(responseUrl, `teams/${created.value.id}`, {
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` },
  });
  assertVietnameseError(outOfScopeDetail, 403, 'FORBIDDEN');

  const memberCount = await responseDb.query('SELECT count(*)::int AS count FROM team_member WHERE team_id=$1', [created.value.id]);
  assert.equal(memberCount.rows[0].count, 0, 'COORDINATOR teams must not create fake user accounts or memberships');
  const storedContact = await responseDb.query('SELECT external_contact_note FROM rescue_team WHERE id=$1', [created.value.id]);
  assert.equal(storedContact.rows[0].external_contact_note, externalContact);
  assert.ok(reporter.id);
  console.log('T8 response team and skill catalog smoke checks passed.');
} finally {
  await Promise.all([responseDb.end(), identityDb.end()]);
}
