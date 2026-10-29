import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { runTeamCandidatesSmoke } from './test-response-t8-team-candidates.mjs';
import { runMissionSmoke } from './test-response-t9-missions.mjs';
import { activateEmailRegistration, withEmail } from './lib/email-registration.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = process.env.C48_RESPONSE_BASE_URL;
const identityUrl = process.env.C48_IDENTITY_BASE_URL;
const responseDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
const identityDb = new Client({ connectionString: process.env.C48_IDENTITY_DATABASE_URL });
const organizationId = process.env.DEMO_INTAKE_ORGANIZATION_ID;
assert.ok(organizationId, 'DEMO_INTAKE_ORGANIZATION_ID is required');
const runSuffix = randomBytes(5).toString('hex').toUpperCase();
const regionCode = `T8_${runSuffix}`;
const otherRegionCode = `T8_OTHER_${runSuffix}`;
let identityIpSequence = 32 + randomBytes(1)[0] % 160;

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

async function waitForTeamRowLockWaits(database, blockerPid, minimum, pendingCommands) {
  const waiters = (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await database.query(
        `SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>$1`,
        [blockerPid],
      );
      const directWaiters = new Set(
        result.rows.filter(({ blockers }) => blockers.includes(blockerPid)).map(({ pid }) => pid),
      );
      const queuedWaiters = new Set(
        result.rows.filter(({ pid, blockers }) => blockers.some((blockedBy) => directWaiters.has(blockedBy))).map(({ pid }) => pid),
      );
      const blocked = new Set([...directWaiters, ...queuedWaiters]);
      if (blocked.size >= minimum) return blocked;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(`Timed out waiting for ${minimum} team command(s) on the locked rescue_team row`);
  })();
  const completed = Promise.race(pendingCommands.map((pending) => pending.then(
    (result) => ({ result }), (error) => ({ error }),
  )));
  const outcome = await Promise.race([waiters.then((blocked) => ({ blocked })), completed]);
  if (outcome.blocked) return outcome.blocked;
  if (outcome.error) throw outcome.error;
  assert.fail(`Team command completed before ${minimum} lock waiters appeared: HTTP ${outcome.result.status} ${JSON.stringify(outcome.result.value)}`);
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
    method: 'POST', body: withEmail(credentials), headers: { 'Idempotency-Key': key(), 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  await activateEmailRegistration(identityDb, registered);
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
      name, organization_id: organizationId, operating_region_code: regionCode,
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
    `INSERT INTO region (code,name) VALUES ($1,$2),($3,$4) ON CONFLICT (code) DO NOTHING`,
    [regionCode, 'Khu vực T8', otherRegionCode, 'Khu vực khác T8'],
  );
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ($1,ST_Multi(ST_GeomFromText('POLYGON((104 14,106 14,106 16,104 16,104 14))',4326))),
      ($2,ST_Multi(ST_GeomFromText('POLYGON((107 14,109 14,109 16,107 16,107 14))',4326)))
     ON CONFLICT (region_code) DO NOTHING`, [regionCode, otherRegionCode],
  );
  await responseDb.query(
    `INSERT INTO skill (code,display_name) VALUES ('T8_A','Kỹ năng A'),('T8_B','Kỹ năng B'),('T8_C','Kỹ năng C') ON CONFLICT (code) DO NOTHING`,
  );

  const reporter = await registerAndLogin('reporter');
  const coordinator = await registerAndLogin('coordinator');
  const otherRegionCoordinator = await registerAndLogin('other', otherRegionCode);
  const overdueReader = await registerAndLogin('overdue-reader', regionCode);
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
    operating_region_code: regionCode,
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

  const teamPage = await call(responseUrl, `teams?region_code=${regionCode}&limit=10`, {
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
  const { captured_at: capturedBeforeStay, ...stayBefore } = beforeDistanceSuppression.rows[0];
  const { captured_at: capturedAfterStay, ...stayAfter } = afterDistanceSuppression.rows[0];
  assert.deepEqual(stayAfter, stayBefore, 'a move under 25 m must not change the stored location, accuracy, source or owner');
  assert.ok(capturedAfterStay > capturedBeforeStay, 'a move under 25 m must refresh captured_at so the fix does not go stale');
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

  const outOfScope = await call(responseUrl, `teams?region_code=${regionCode}&limit=10`, {
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
  await runTeamCandidatesSmoke({
    responseDb, responseUrl, reporter, coordinator, otherRegionCoordinator, organizationId, regionCode, otherRegionCode, appTeam, call, key,
  });
  await runMissionSmoke({
    responseDb, responseUrl, reporter, coordinator, otherRegionCoordinator, overdueReader, appTeam,
    coordinatorTeam: created, organizationId, regionCode, call, key, assertVietnameseError,
  });

  const activeMember = await registerAndLogin('active-member-without-grants');
  const addMemberKey = key();
  const addMemberHeaders = {
    Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': addMemberKey,
  };
  const addedMember = await call(responseUrl, `teams/${appTeam.value.id}/members`, {
    method: 'POST', body: { user_id: activeMember.id }, headers: addMemberHeaders,
  });
  assert.equal(addedMember.status, 201, JSON.stringify(addedMember.value));
  assert.equal(addedMember.headers.get('cache-control'), 'no-store');
  assert.deepEqual(addedMember.value, {
    team_id: appTeam.value.id,
    user_id: activeMember.id,
    member_role: 'MEMBER',
    joined_at: addedMember.value.joined_at,
  });
  assert.ok(Number.isFinite(Date.parse(addedMember.value.joined_at)));
  const immediateAddReplay = await call(responseUrl, `teams/${appTeam.value.id}/members`, {
    method: 'POST', body: { user_id: activeMember.id }, headers: addMemberHeaders,
  });
  assert.equal(immediateAddReplay.status, 201, JSON.stringify(immediateAddReplay.value));
  assert.equal(immediateAddReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(immediateAddReplay.value, addedMember.value);

  const memberOnOtherTeam = await call(responseUrl, `teams/${created.value.id}/members`, {
    method: 'POST', body: { user_id: activeMember.id },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(memberOnOtherTeam, 409, 'USER_IN_OTHER_TEAM');
  const coordinatorTeamMemberCount = await responseDb.query(
    'SELECT count(*)::int AS count FROM team_member WHERE team_id=$1', [created.value.id],
  );
  assert.equal(coordinatorTeamMemberCount.rows[0].count, 0);

  const coordinatorModeMember = await registerAndLogin('coordinator-mode-member');
  const coordinatorModeAdd = await call(responseUrl, `teams/${created.value.id}/members`, {
    method: 'POST', body: { user_id: coordinatorModeMember.id },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(coordinatorModeAdd.status, 201, JSON.stringify(coordinatorModeAdd.value));
  assert.deepEqual(Object.keys(coordinatorModeAdd.value).sort(), ['joined_at', 'member_role', 'team_id', 'user_id']);
  assert.equal(coordinatorModeAdd.value.team_id, created.value.id);
  assert.equal(coordinatorModeAdd.value.user_id, coordinatorModeMember.id);
  assert.equal(coordinatorModeAdd.value.member_role, 'MEMBER');
  assert.ok(Number.isFinite(Date.parse(coordinatorModeAdd.value.joined_at)));

  const crossTeamRaceMember = await registerAndLogin('cross-team-race');
  const crossTeamAdds = await Promise.all([
    call(responseUrl, `teams/${appTeam.value.id}/members`, {
      method: 'POST', body: { user_id: crossTeamRaceMember.id },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    }),
    call(responseUrl, `teams/${created.value.id}/members`, {
      method: 'POST', body: { user_id: crossTeamRaceMember.id },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    }),
  ]);
  assert.equal(
    crossTeamAdds.filter(({ status }) => status === 201).length,
    1,
    JSON.stringify(crossTeamAdds.map(({ status, value }) => ({ status, value }))),
  );
  assertVietnameseError(crossTeamAdds.find(({ status }) => status !== 201), 409, 'USER_IN_OTHER_TEAM');
  const crossTeamMembership = await responseDb.query(
    'SELECT team_id FROM team_member WHERE user_id=$1 AND left_at IS NULL', [crossTeamRaceMember.id],
  );
  assert.equal(crossTeamMembership.rowCount, 1, 'concurrent adds must leave one active team membership');
  assert.ok([appTeam.value.id, created.value.id].includes(crossTeamMembership.rows[0].team_id));

  const removedMember = await call(responseUrl, `teams/${appTeam.value.id}/members/${activeMember.id}/remove`, {
    method: 'POST', headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(removedMember.status, 204, JSON.stringify(removedMember.value));
  assert.equal(removedMember.headers.get('cache-control'), 'no-store');
  const historicalMembership = await responseDb.query(
    'SELECT member_role,left_at FROM team_member WHERE team_id=$1 AND user_id=$2', [appTeam.value.id, activeMember.id],
  );
  assert.equal(historicalMembership.rowCount, 1, 'removal must preserve the historical membership row');
  assert.ok(historicalMembership.rows[0].left_at);

  const rejoinedMember = await call(responseUrl, `teams/${appTeam.value.id}/members`, {
    method: 'POST', body: { user_id: activeMember.id },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(rejoinedMember.status, 201, JSON.stringify(rejoinedMember.value));
  assert.equal(rejoinedMember.value.member_role, 'MEMBER');
  const activeMembershipRows = await responseDb.query(
    'SELECT member_role,left_at FROM team_member WHERE team_id=$1 AND user_id=$2', [appTeam.value.id, activeMember.id],
  );
  assert.equal(activeMembershipRows.rowCount, 1, 'rejoining must reactivate the existing historical row');
  assert.deepEqual(activeMembershipRows.rows[0], { member_role: 'MEMBER', left_at: null });
  const membershipAudit = await responseDb.query(
    `SELECT action,created_at FROM audit_log
      WHERE entity_type='team_member' AND entity_id=$1 ORDER BY created_at,id`,
    [`${appTeam.value.id}:${activeMember.id}`],
  );
  assert.deepEqual(membershipAudit.rows.map(({ action }) => action), [
    'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_REMOVED', 'TEAM_MEMBER_ADDED',
  ]);
  assert.equal(rejoinedMember.value.joined_at, membershipAudit.rows[2].created_at.toISOString());

  const replayAfterMembershipChanged = await call(responseUrl, `teams/${appTeam.value.id}/members`, {
    method: 'POST', body: { user_id: activeMember.id }, headers: addMemberHeaders,
  });
  assert.equal(replayAfterMembershipChanged.status, 201, JSON.stringify(replayAfterMembershipChanged.value));
  assert.equal(replayAfterMembershipChanged.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(replayAfterMembershipChanged.value, addedMember.value);

  const cannotRemoveOnlyLeader = await call(
    responseUrl, `teams/${appTeam.value.id}/members/${reporter.id}/remove`, {
      method: 'POST', headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    },
  );
  assertVietnameseError(cannotRemoveOnlyLeader, 409, 'LEADER_REQUIRED');
  const preservedLeader = await responseDb.query(
    'SELECT member_role,left_at FROM team_member WHERE team_id=$1 AND user_id=$2', [appTeam.value.id, reporter.id],
  );
  assert.deepEqual(preservedLeader.rows[0], { member_role: 'LEADER', left_at: null });

  const eligibleLeader = await registerAndLogin('membership-leader');
  await identityDb.query(
    `INSERT INTO membership (user_id,organization_id) VALUES ($1,$2)`, [eligibleLeader.id, organizationId],
  );
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
     VALUES ($1,'VOLUNTEER','ORGANIZATION',$2)`, [eligibleLeader.id, organizationId],
  );
  const leaderMember = await call(responseUrl, `teams/${appTeam.value.id}/members`, {
    method: 'POST', body: { user_id: eligibleLeader.id },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(leaderMember.status, 201, JSON.stringify(leaderMember.value));

  const beforeTransfer = await responseDb.query('SELECT version FROM rescue_team WHERE id=$1', [appTeam.value.id]);
  const expectedVersion = Number(beforeTransfer.rows[0].version);
  const transferKey = key();
  const transferHeaders = { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': transferKey };
  const transferBody = { user_id: eligibleLeader.id, expected_version: expectedVersion };
  const transferred = await call(responseUrl, `teams/${appTeam.value.id}/leader`, {
    method: 'POST', body: transferBody, headers: transferHeaders,
  });
  assert.equal(transferred.status, 200, JSON.stringify(transferred.value));
  assert.equal(transferred.headers.get('cache-control'), 'no-store');
  assert.deepEqual(transferred.value, {
    team_id: appTeam.value.id, leader_user_id: eligibleLeader.id, version: expectedVersion + 1,
  });
  const transferReplay = await call(responseUrl, `teams/${appTeam.value.id}/leader`, {
    method: 'POST', body: transferBody, headers: transferHeaders,
  });
  assert.equal(transferReplay.status, 200, JSON.stringify(transferReplay.value));
  assert.equal(transferReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(transferReplay.value, transferred.value);

  const staleTransfer = await call(responseUrl, `teams/${appTeam.value.id}/leader`, {
    method: 'POST', body: transferBody,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(staleTransfer, 409, 'VERSION_CONFLICT');

  const transferBack = await call(responseUrl, `teams/${appTeam.value.id}/leader`, {
    method: 'POST', body: { user_id: reporter.id, expected_version: expectedVersion + 1 },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(transferBack.status, 200, JSON.stringify(transferBack.value));
  assert.equal(transferBack.value.leader_user_id, reporter.id);
  assert.equal(transferBack.value.version, expectedVersion + 2);
  const transferReplayAfterChange = await call(responseUrl, `teams/${appTeam.value.id}/leader`, {
    method: 'POST', body: transferBody, headers: transferHeaders,
  });
  assert.equal(transferReplayAfterChange.status, 200, JSON.stringify(transferReplayAfterChange.value));
  assert.equal(transferReplayAfterChange.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(transferReplayAfterChange.value, transferred.value);

  const finalLeadership = await responseDb.query(
    `SELECT t.version,m.user_id,m.member_role FROM rescue_team t
      JOIN team_member m ON m.team_id=t.id AND m.left_at IS NULL AND m.member_role='LEADER'
     WHERE t.id=$1`, [appTeam.value.id],
  );
  assert.deepEqual(finalLeadership.rows, [{
    version: expectedVersion + 2, user_id: reporter.id, member_role: 'LEADER',
  }]);

  const concurrentLeader = await registerAndLogin('concurrent-leader');
  await identityDb.query(
    'INSERT INTO membership (user_id,organization_id) VALUES ($1,$2)', [concurrentLeader.id, organizationId],
  );
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
     VALUES ($1,'VOLUNTEER','ORGANIZATION',$2)`, [concurrentLeader.id, organizationId],
  );
  const concurrentLeaderMember = await call(responseUrl, `teams/${appTeam.value.id}/members`, {
    method: 'POST', body: { user_id: concurrentLeader.id },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(concurrentLeaderMember.status, 201, JSON.stringify(concurrentLeaderMember.value));

  const beforeConcurrentTransfers = await responseDb.query(
    'SELECT version FROM rescue_team WHERE id=$1', [appTeam.value.id],
  );
  const concurrentExpectedVersion = Number(beforeConcurrentTransfers.rows[0].version);
  const concurrentTransfers = await Promise.all([eligibleLeader.id, concurrentLeader.id].map((userId) =>
    call(responseUrl, `teams/${appTeam.value.id}/leader`, {
      method: 'POST', body: { user_id: userId, expected_version: concurrentExpectedVersion },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    })),
  );
  assert.equal(
    concurrentTransfers.filter(({ status }) => status === 200).length,
    1,
    JSON.stringify(concurrentTransfers.map(({ status, value }) => ({ status, value }))),
  );
  const concurrentTransferConflict = concurrentTransfers.find(({ status }) => status !== 200);
  assertVietnameseError(concurrentTransferConflict, 409, 'VERSION_CONFLICT');
  const concurrentTransferWinner = concurrentTransfers.find(({ status }) => status === 200);
  const concurrentLeadership = await responseDb.query(
    `SELECT t.version,m.user_id,m.member_role FROM rescue_team t
      JOIN team_member m ON m.team_id=t.id AND m.left_at IS NULL AND m.member_role='LEADER'
     WHERE t.id=$1`, [appTeam.value.id],
  );
  assert.deepEqual(concurrentLeadership.rows, [{
    version: concurrentExpectedVersion + 1,
    user_id: concurrentTransferWinner.value.leader_user_id,
    member_role: 'LEADER',
  }]);
  assert.ok([eligibleLeader.id, concurrentLeader.id].includes(concurrentLeadership.rows[0].user_id));

  const beforeRemovalTransfer = await responseDb.query(
    `SELECT t.version,m.user_id AS leader_user_id FROM rescue_team t
      JOIN team_member m ON m.team_id=t.id AND m.left_at IS NULL AND m.member_role='LEADER'
     WHERE t.id=$1`, [appTeam.value.id],
  );
  assert.equal(beforeRemovalTransfer.rows.length, 1);
  const removalTransferVersion = Number(beforeRemovalTransfer.rows[0].version);
  const removalTransferTarget = await responseDb.query(
    `SELECT user_id FROM team_member
      WHERE team_id=$1 AND user_id=ANY($2::uuid[]) AND member_role='MEMBER' AND left_at IS NULL
      ORDER BY user_id LIMIT 1`, [appTeam.value.id, [eligibleLeader.id, concurrentLeader.id]],
  );
  assert.equal(removalTransferTarget.rows.length, 1);
  const targetUserId = removalTransferTarget.rows[0].user_id;
  const lockDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
  await lockDb.connect();
  let transactionOpen = false;
  let pendingRace;
  let racedTransfer;
  let racedRemoval;
  try {
    await lockDb.query('BEGIN');
    transactionOpen = true;
    await lockDb.query('SELECT id FROM rescue_team WHERE id=$1 FOR UPDATE', [appTeam.value.id]);
    const blockerPid = (await lockDb.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const transferPending = call(responseUrl, `teams/${appTeam.value.id}/leader`, {
      method: 'POST', body: { user_id: targetUserId, expected_version: removalTransferVersion },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    const removalPending = call(responseUrl, `teams/${appTeam.value.id}/members/${targetUserId}/remove`, {
      method: 'POST', headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    pendingRace = Promise.allSettled([transferPending, removalPending]);
    await waitForTeamRowLockWaits(responseDb, blockerPid, 2, [transferPending, removalPending]);
    await lockDb.query('COMMIT');
    transactionOpen = false;
    const raceResults = await pendingRace;
    if (raceResults[0].status === 'rejected') throw raceResults[0].reason;
    if (raceResults[1].status === 'rejected') throw raceResults[1].reason;
    [racedTransfer, racedRemoval] = raceResults.map(({ value }) => value);
  } finally {
    if (transactionOpen) await lockDb.query('ROLLBACK');
    if (pendingRace) await pendingRace.catch(() => undefined);
    await lockDb.end();
  }
  if (racedRemoval.status === 204) {
    assertVietnameseError(racedTransfer, 404, 'NOT_FOUND');
  } else {
    assertVietnameseError(racedRemoval, 409, 'LEADER_REQUIRED');
    assert.equal(racedTransfer.status, 200, JSON.stringify(racedTransfer.value));
    assert.deepEqual(racedTransfer.value, {
      team_id: appTeam.value.id, leader_user_id: targetUserId, version: removalTransferVersion + 1,
    });
  }
  const afterRemovalTransfer = await responseDb.query(
    `SELECT t.version,m.user_id,m.member_role FROM rescue_team t
      JOIN team_member m ON m.team_id=t.id AND m.left_at IS NULL AND m.member_role='LEADER'
     WHERE t.id=$1`, [appTeam.value.id],
  );
  assert.equal(afterRemovalTransfer.rows.length, 1, 'APP team must retain one active leader');
  assert.deepEqual(afterRemovalTransfer.rows[0], {
    version: removalTransferVersion + (racedTransfer.status === 200 ? 1 : 0),
    user_id: racedTransfer.status === 200 ? targetUserId : beforeRemovalTransfer.rows[0].leader_user_id,
    member_role: 'LEADER',
  });
  const racedMember = await responseDb.query(
    'SELECT member_role,left_at FROM team_member WHERE team_id=$1 AND user_id=$2',
    [appTeam.value.id, targetUserId],
  );
  assert.equal(racedMember.rows.length, 1);
  assert.equal(racedMember.rows[0].member_role, racedTransfer.status === 200 ? 'LEADER' : 'MEMBER');
  if (racedTransfer.status === 200) assert.equal(racedMember.rows[0].left_at, null);
  else assert.ok(racedMember.rows[0].left_at);

  assert.ok(reporter.id);
  console.log('T8 response team and skill catalog smoke checks passed.');
} finally {
  await Promise.all([responseDb.end(), identityDb.end()]);
}
