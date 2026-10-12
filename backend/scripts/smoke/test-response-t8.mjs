import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { runTeamCandidatesSmoke } from './test-response-t8-team-candidates.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = process.env.TEST_RESPONSE_BASE_URL;
const identityUrl = process.env.TEST_IDENTITY_BASE_URL;
const responseDb = new Client({ connectionString: process.env.TEST_RESPONSE_DATABASE_URL });
const identityDb = new Client({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL });
const organizationId = '40000000-0000-4000-8000-000000000004';
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

async function createAppTeam(coordinatorToken, leaderUserId, name = `Đội ứng dụng ${randomBytes(4).toString('hex')}`) {
  return call(responseUrl, 'teams', {
    method: 'POST',
    body: {
      name, organization_id: organizationId, operating_region_code: 'T8_REGION',
      team_kind: 'VOLUNTEER', reporting_mode: 'APP', leader_user_id: leaderUserId, skill_codes: ['T8_A'],
    },
    headers: { Authorization: `Bearer ${coordinatorToken}`, 'Idempotency-Key': key() },
  });
}

async function setPosition(teamId, token, body) {
  return call(responseUrl, `teams/${teamId}/position`, {
    method: 'PUT', body, headers: { Authorization: `Bearer ${token}` },
  });
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
    `INSERT INTO membership (user_id,organization_id) VALUES ($1,$2)
     ON CONFLICT (user_id,organization_id) DO UPDATE SET status='ACTIVE'`,
    [reporter.id, organizationId],
  );
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

  const appTeam = await createAppTeam(coordinator.token, reporter.id);
  assert.equal(appTeam.status, 201, JSON.stringify(appTeam.value));
  const appLeader = await responseDb.query(
    `SELECT user_id,member_role,left_at FROM team_member WHERE team_id=$1`, [appTeam.value.id],
  );
  assert.deepEqual(appLeader.rows, [{ user_id: reporter.id, member_role: 'LEADER', left_at: null }]);

  const leaderNote = 'Vị trí do trưởng đội gửi';
  const leaderPositionBody = {
    location: { type: 'Point', coordinates: [104.5, 14.5], source: 'GPS' },
    accuracy_m: 6.5, captured_at: new Date().toISOString(), note: leaderNote,
  };
  const outOfRangePosition = await setPosition(appTeam.value.id, reporter.token, {
    ...leaderPositionBody,
    location: { ...leaderPositionBody.location, coordinates: [181, 14.5] },
  });
  assertVietnameseError(outOfRangePosition, 400, 'VALIDATION_FAILED');
  assert.equal(outOfRangePosition.value.field_errors['location.coordinates'][0], 'COORDINATES_OUT_OF_RANGE');

  const leaderPosition = await setPosition(appTeam.value.id, reporter.token, leaderPositionBody);
  assert.equal(leaderPosition.status, 204, JSON.stringify(leaderPosition.value));
  assert.equal(leaderPosition.headers.get('cache-control'), 'no-store');
  const storedLeaderPosition = await responseDb.query(
    `SELECT ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            accuracy_m,source,captured_at,set_by_user_id
       FROM team_position WHERE team_id=$1`, [appTeam.value.id],
  );
  assert.equal(storedLeaderPosition.rows.length, 1);
  assert.equal(Number(storedLeaderPosition.rows[0].longitude), 104.5);
  assert.equal(Number(storedLeaderPosition.rows[0].latitude), 14.5);
  assert.equal(Number(storedLeaderPosition.rows[0].accuracy_m), 6.5);
  assert.equal(storedLeaderPosition.rows[0].source, 'GPS');
  assert.equal(storedLeaderPosition.rows[0].set_by_user_id, reporter.id);
  const leaderPositionAudit = await responseDb.query(
    `SELECT after_state FROM audit_log
      WHERE entity_type='rescue_team' AND entity_id=$1 AND action='TEAM_POSITION_SET'`, [appTeam.value.id],
  );
  assert.equal(leaderPositionAudit.rows.length, 1);
  assert.equal(leaderPositionAudit.rows[0].after_state.note, leaderNote);

  const leaderCannotReportForCoordinator = await setPosition(appTeam.value.id, reporter.token, {
    ...leaderPositionBody,
    location: { ...leaderPositionBody.location, source: 'COORDINATOR_REPORTED' },
  });
  assertVietnameseError(leaderCannotReportForCoordinator, 403, 'FORBIDDEN');

  const beforeSuppressedPosition = storedLeaderPosition.rows[0];
  const suppressedPosition = await setPosition(appTeam.value.id, reporter.token, {
    location: { type: 'Point', coordinates: [104.5, 14.5], source: 'MANUAL_PIN' },
    captured_at: new Date().toISOString(), note: 'Không ghi lần cập nhật quá gần',
  });
  assert.equal(suppressedPosition.status, 204, JSON.stringify(suppressedPosition.value));
  const afterSuppressedPosition = await responseDb.query(
    `SELECT ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            accuracy_m,source,captured_at,set_by_user_id
       FROM team_position WHERE team_id=$1`, [appTeam.value.id],
  );
  assert.deepEqual(afterSuppressedPosition.rows[0], beforeSuppressedPosition, 'suppressed position must not write');
  const auditAfterSuppression = await responseDb.query(
    `SELECT count(*)::int AS count FROM audit_log
      WHERE entity_type='rescue_team' AND entity_id=$1 AND action='TEAM_POSITION_SET'`, [appTeam.value.id],
  );
  assert.equal(auditAfterSuppression.rows[0].count, 1, 'suppressed position must not audit');

  await responseDb.query(
    `UPDATE team_position SET captured_at=clock_timestamp() - interval '16 seconds' WHERE team_id=$1`, [appTeam.value.id],
  );
  const beforeDistanceSuppression = await responseDb.query(
    `SELECT ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            accuracy_m,source,captured_at,set_by_user_id
       FROM team_position WHERE team_id=$1`, [appTeam.value.id],
  );
  const distanceSuppressedPosition = await setPosition(appTeam.value.id, reporter.token, {
    location: { type: 'Point', coordinates: [104.5001, 14.5], source: 'MANUAL_PIN' },
    captured_at: new Date().toISOString(), note: 'Không ghi lần cập nhật dưới 25 m',
  });
  assert.equal(distanceSuppressedPosition.status, 204, JSON.stringify(distanceSuppressedPosition.value));
  const afterDistanceSuppression = await responseDb.query(
    `SELECT ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            accuracy_m,source,captured_at,set_by_user_id
       FROM team_position WHERE team_id=$1`, [appTeam.value.id],
  );
  assert.deepEqual(afterDistanceSuppression.rows[0], beforeDistanceSuppression.rows[0], 'a move under 25 m must not write');
  const auditAfterDistanceSuppression = await responseDb.query(
    `SELECT count(*)::int AS count FROM audit_log
      WHERE entity_type='rescue_team' AND entity_id=$1 AND action='TEAM_POSITION_SET'`, [appTeam.value.id],
  );
  assert.equal(auditAfterDistanceSuppression.rows[0].count, 1, 'a move under 25 m must not audit');

  const movedPosition = await setPosition(appTeam.value.id, reporter.token, {
    location: { type: 'Point', coordinates: [104.51, 14.5], source: 'MANUAL_PIN' },
    captured_at: new Date().toISOString(), note: 'Trưởng đội cập nhật vị trí',
  });
  assert.equal(movedPosition.status, 204, JSON.stringify(movedPosition.value));
  const storedMovedPosition = await responseDb.query(
    `SELECT ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            accuracy_m,source,set_by_user_id
       FROM team_position WHERE team_id=$1`, [appTeam.value.id],
  );
  assert.equal(Number(storedMovedPosition.rows[0].longitude), 104.51);
  assert.equal(Number(storedMovedPosition.rows[0].latitude), 14.5);
  assert.equal(storedMovedPosition.rows[0].accuracy_m, null);
  assert.equal(storedMovedPosition.rows[0].source, 'MANUAL_PIN');
  assert.equal(storedMovedPosition.rows[0].set_by_user_id, reporter.id);
  const leaderPositionAuditAfterMove = await responseDb.query(
    `SELECT after_state FROM audit_log
      WHERE entity_type='rescue_team' AND entity_id=$1 AND action='TEAM_POSITION_SET' ORDER BY id`, [appTeam.value.id],
  );
  assert.equal(leaderPositionAuditAfterMove.rows.length, 2, 'source change should audit');
  assert.equal(leaderPositionAuditAfterMove.rows[1].after_state.note, 'Trưởng đội cập nhật vị trí');

  const coordinatorPositionBody = {
    location: { type: 'Point', coordinates: [105.5, 15.5], source: 'COORDINATOR_REPORTED' },
    captured_at: new Date().toISOString(), note: 'Điều phối viên xác nhận vị trí',
  };
  assertVietnameseError(
    await setPosition(created.value.id, otherRegionCoordinator.token, coordinatorPositionBody), 403, 'FORBIDDEN',
  );
  const coordinatorCannotSetGps = await setPosition(created.value.id, coordinator.token, {
    ...coordinatorPositionBody,
    location: { ...coordinatorPositionBody.location, source: 'GPS' },
  });
  assertVietnameseError(coordinatorCannotSetGps, 403, 'FORBIDDEN');
  const coordinatorPosition = await setPosition(created.value.id, coordinator.token, coordinatorPositionBody);
  assert.equal(coordinatorPosition.status, 204, JSON.stringify(coordinatorPosition.value));
  const storedCoordinatorPosition = await responseDb.query(
    `SELECT ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
            accuracy_m,source,set_by_user_id
       FROM team_position WHERE team_id=$1`, [created.value.id],
  );
  assert.equal(Number(storedCoordinatorPosition.rows[0].longitude), 105.5);
  assert.equal(Number(storedCoordinatorPosition.rows[0].latitude), 15.5);
  assert.equal(storedCoordinatorPosition.rows[0].accuracy_m, null);
  assert.equal(storedCoordinatorPosition.rows[0].source, 'COORDINATOR_REPORTED');
  assert.equal(storedCoordinatorPosition.rows[0].set_by_user_id, coordinator.id);
  const coordinatorPositionAudit = await responseDb.query(
    `SELECT after_state FROM audit_log
      WHERE entity_type='rescue_team' AND entity_id=$1 AND action='TEAM_POSITION_SET'`, [created.value.id],
  );
  assert.equal(coordinatorPositionAudit.rows.length, 1);
  assert.equal(coordinatorPositionAudit.rows[0].after_state.note, coordinatorPositionBody.note);

  const systemVolunteer = await registerAndLogin('system-volunteer');
  await identityDb.query('INSERT INTO membership (user_id,organization_id) VALUES ($1,$2)', [systemVolunteer.id, organizationId]);
  await identityDb.query("INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ($1,'VOLUNTEER','SYSTEM')", [systemVolunteer.id]);
  const systemScopeTeam = await createAppTeam(coordinator.token, systemVolunteer.id);
  assert.equal(systemScopeTeam.status, 201, JSON.stringify(systemScopeTeam.value));

  const activeNonmember = await registerAndLogin('active-nonmember');
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
     VALUES ($1,'VOLUNTEER','ORGANIZATION',$2)`,
    [activeNonmember.id, organizationId],
  );
  assertVietnameseError(await createAppTeam(coordinator.token, activeNonmember.id), 409, 'LEADER_REQUIRED');

  const disabledUser = await registerAndLogin('disabled');
  await identityDb.query('INSERT INTO membership (user_id,organization_id) VALUES ($1,$2)', [disabledUser.id, organizationId]);
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
     VALUES ($1,'VOLUNTEER','ORGANIZATION',$2)`,
    [disabledUser.id, organizationId],
  );
  await identityDb.query("UPDATE app_user SET status='DISABLED' WHERE id=$1", [disabledUser.id]);
  const disabledLeader = await createAppTeam(coordinator.token, disabledUser.id);
  assertVietnameseError(disabledLeader, 409, 'TEAM_NOT_ELIGIBLE');
  assert.equal(disabledLeader.value.details?.reason, 'INACTIVE');

  const activeNonvolunteer = await registerAndLogin('active-nonvolunteer');
  await identityDb.query('INSERT INTO membership (user_id,organization_id) VALUES ($1,$2)', [activeNonvolunteer.id, organizationId]);
  assertVietnameseError(await createAppTeam(coordinator.token, activeNonvolunteer.id), 409, 'LEADER_REQUIRED');

  const nonexistentLeaderId = randomUUID();
  const nonexistentLeaderName = `Đội thiếu người dùng ${randomBytes(4).toString('hex')}`;
  assertVietnameseError(
    await createAppTeam(coordinator.token, nonexistentLeaderId, nonexistentLeaderName), 404, 'NOT_FOUND',
  );
  const nonexistentLeaderTeam = await responseDb.query('SELECT id FROM rescue_team WHERE name=$1', [nonexistentLeaderName]);
  assert.equal(nonexistentLeaderTeam.rowCount, 0, 'a nonexistent leader must not create a team');

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
  await runTeamCandidatesSmoke({ responseDb, responseUrl, reporter, coordinator, otherRegionCoordinator, organizationId, appTeam, call, key });
  assert.ok(reporter.id);
  console.log('T8 response team and skill catalog smoke checks passed.');
} finally {
  await Promise.all([responseDb.end(), identityDb.end()]);
}
