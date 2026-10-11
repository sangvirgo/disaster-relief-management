import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = process.env.TEST_RESPONSE_BASE_URL;
const identityUrl = process.env.TEST_IDENTITY_BASE_URL;
const responseDb = new Client({ connectionString: process.env.TEST_RESPONSE_DATABASE_URL });
const identityDb = new Client({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL });
const organizationId = '40000000-0000-4000-8000-000000000004';
let ipSequence = 80;

function key() { return randomUUID(); }
function ip() { return `198.51.100.${ipSequence++}`; }

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
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected a Vietnamese user-facing message');
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

async function registerAndLogin(label) {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t6${label}${suffix}`,
    display_name: `Người dùng kiểm thử ${label} ${suffix}`,
    password: `Proxy test password ${suffix}!`,
  };
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials,
    headers: { 'Idempotency-Key': key(), 'X-Forwarded-For': ip() },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': ip() },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: registered.value.user.id, token: login.value.access_token };
}

function proxyBody(coordinates, overrides = {}) {
  return {
    incident_category_code: 'T6_FLOOD',
    description: 'Nước đang dâng trong nhà.',
    people_affected: 2,
    reporter_name: 'Nguyễn An',
    reporter_contact_phone: '+84 912 345 678',
    reporter_declared_danger: false,
    location: {
      type: 'Point', coordinates, source: 'GPS', accuracy_m: 8,
      captured_at: new Date().toISOString(),
    },
    relationship: 'Người thân',
    beneficiary_contact_phone: null,
    alternate_contact: { name: 'Nguyễn Lan', phone: '0912 111 222' },
    information_source: 'Người dân báo tin',
    last_known_situation_at: new Date().toISOString(),
    contactability: 'UNKNOWN',
    ...overrides,
  };
}

function selfBody(coordinates) {
  return {
    incident_category_code: 'T6_FLOOD',
    description: 'Nước đang dâng trong nhà.',
    people_affected: 2,
    reporter_name: 'Nguyễn An',
    reporter_contact_phone: null,
    reporter_declared_danger: false,
    location: {
      type: 'Point', coordinates, source: 'GPS', accuracy_m: 8,
      captured_at: new Date().toISOString(),
    },
  };
}

async function createSelf(reporter, payload) {
  return call(responseUrl, 'requests', {
    method: 'POST', body: payload,
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key(), 'X-Forwarded-For': ip() },
  });
}

async function createProxy(reporter, payload, idempotencyKey = key()) {
  const result = await call(responseUrl, 'requests/proxy', {
    method: 'POST', body: payload,
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': idempotencyKey, 'X-Forwarded-For': ip() },
  });
  return { ...result, idempotencyKey };
}

await Promise.all([responseDb.connect(), identityDb.connect()]);
try {
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind) VALUES ($1,'T6 test organization','COORDINATION') ON CONFLICT (id) DO NOTHING`,
    [organizationId],
  );
  await responseDb.query("INSERT INTO incident_category (code,display_name) VALUES ('T6_FLOOD','Lũ lụt') ON CONFLICT (code) DO NOTHING");
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ('T6_REGION_B',ST_Multi(ST_GeomFromText('POLYGON((108 12,110 12,110 14,108 14,108 12))',4326)))
     ON CONFLICT (region_code) DO NOTHING`,
  );

  const missingSessionKey = key();
  const missingSession = await call(responseUrl, 'requests/proxy', {
    method: 'POST', body: proxyBody([108.5, 12.5]), headers: { 'Idempotency-Key': missingSessionKey },
  });
  assertVietnameseError(missingSession, 401, 'UNAUTHENTICATED');
  assert.equal((await responseDb.query("SELECT 1 FROM idempotency_record WHERE command='response.requests.create-proxy' AND idempotency_key=$1", [missingSessionKey])).rowCount, 0);

  const reporter = await registerAndLogin('cap');
  const missingTimezoneKey = key();
  const missingTimezone = await createProxy(reporter, proxyBody([108.2, 12.2], {
    last_known_situation_at: '2026-10-11T08:30:00',
  }), missingTimezoneKey);
  assertVietnameseError(missingTimezone, 400, 'VALIDATION_FAILED');
  assert.equal((await responseDb.query("SELECT 1 FROM idempotency_record WHERE command='response.requests.create-proxy' AND idempotency_key=$1", [missingTimezoneKey])).rowCount, 0);
  const impossibleDateKey = key();
  const impossibleDate = await createProxy(reporter, proxyBody([108.2, 12.2], {
    last_known_situation_at: '2026-02-30T08:30:00Z',
  }), impossibleDateKey);
  assertVietnameseError(impossibleDate, 400, 'VALIDATION_FAILED');
  assert.equal((await responseDb.query("SELECT 1 FROM idempotency_record WHERE command='response.requests.create-proxy' AND idempotency_key=$1", [impossibleDateKey])).rowCount, 0);

  const firstPayload = proxyBody([108.2, 12.2]);
  const first = await createProxy(reporter, firstPayload);
  const second = await createProxy(reporter, proxyBody([108.4, 12.2]));
  for (const result of [first, second]) {
    assert.equal(result.status, 201, JSON.stringify(result.value));
    assert.equal(result.value.status, 'SUBMITTED');
    assert.equal(result.value.review_lane, 'NORMAL');
  }

  const third = await createProxy(reporter, proxyBody([108.6, 12.2]));
  const fourth = await createProxy(reporter, proxyBody([108.8, 12.2]));
  assert.equal(third.status, 201, JSON.stringify(third.value));
  assert.equal(third.value.review_lane, 'NORMAL');
  assert.equal(fourth.status, 201, JSON.stringify(fourth.value));
  assert.equal(fourth.value.review_lane, 'PROXY_QUOTA_REVIEW', 'the fourth sequential open proxy is retained for review');

  const rows = await responseDb.query(
    `SELECT r.id,r.report_mode,r.reporter_user_id,r.tracking_secret_hash,r.region_code,r.status,r.priority,r.review_lane,
            r.reporter_contact_phone,r.source_ip_hash,s.reporter_relationship,s.beneficiary_contact_phone,
            s.alternate_contact_name,s.alternate_contact_phone,s.information_source,s.last_known_situation_at,
            s.contactability,s.location_source,s.location_accuracy_m,
            ST_X(s.location::geometry) AS longitude,ST_Y(s.location::geometry) AS latitude
       FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
      WHERE r.reporter_user_id=$1 AND r.report_mode='PROXY' ORDER BY r.received_at,r.id`,
    [reporter.id],
  );
  assert.equal(rows.rowCount, 4);
  assert.ok(rows.rows.every((row) => row.report_mode === 'PROXY' && row.reporter_user_id === reporter.id));
  assert.ok(rows.rows.every((row) => row.tracking_secret_hash === null && row.status === 'SUBMITTED' && row.priority === null));
  assert.ok(rows.rows.every((row) => row.region_code === 'T6_REGION_B'), 'the affected household pin determines the stored region');
  assert.equal(rows.rows[0].reporter_relationship, 'Người thân');
  assert.equal(rows.rows[0].beneficiary_contact_phone, null, 'the affected person needs no phone');
  assert.equal(rows.rows[0].alternate_contact_name, 'Nguyễn Lan');
  assert.equal(rows.rows[0].alternate_contact_phone, '0912111222');
  assert.equal(rows.rows[0].information_source, 'Người dân báo tin');
  assert.equal(new Date(rows.rows[0].last_known_situation_at).toISOString(), firstPayload.last_known_situation_at);
  assert.equal(rows.rows[0].contactability, 'UNKNOWN');
  assert.equal(rows.rows[0].location_source, 'GPS');
  assert.equal(Number(rows.rows[0].location_accuracy_m), 8);
  assert.ok(Math.abs(Number(rows.rows[0].longitude) - 108.2) < 0.000001);
  assert.ok(Math.abs(Number(rows.rows[0].latitude) - 12.2) < 0.000001);
  assert.ok(rows.rows.every((row) => row.source_ip_hash.startsWith('v1:') && !row.source_ip_hash.includes('198.51.100.')));

  const flaggedRequestId = third.value.id;
  const flag = await responseDb.query(
    `SELECT visibility,payload FROM request_event WHERE request_id=$1 AND event_type='PROXY_ACTIVITY_FLAG'`,
    [flaggedRequestId],
  );
  assert.equal(flag.rowCount, 1);
  assert.equal(flag.rows[0].visibility, 'STAFF');
  assert.ok(flag.rows[0].payload.flags.includes('MULTIPLE_REPORTED_LOCATIONS'));
  assert.ok(flag.rows[0].payload.distinct_locations_approx_100m >= 3);
  assert.ok(flag.rows[0].payload.recent_request_ids.includes(flaggedRequestId));
  assert.equal(JSON.stringify(third.value).includes('PROXY_ACTIVITY_FLAG'), false, 'staff flags are not returned to the reporter');

  const selfOnlyReporter = await registerAndLogin('selfonly');
  for (const coordinates of [[109.1, 13.1], [109.3, 13.1], [109.5, 13.1]]) {
    const result = await createSelf(selfOnlyReporter, selfBody(coordinates));
    assert.equal(result.status, 201, JSON.stringify(result.value));
  }
  const selfOnlyProxy = await createProxy(selfOnlyReporter, proxyBody([109.1, 13.1], { reporter_contact_phone: null }));
  assert.equal(selfOnlyProxy.status, 201, JSON.stringify(selfOnlyProxy.value));
  assert.equal((await responseDb.query(
    "SELECT 1 FROM request_event WHERE request_id=$1 AND event_type='PROXY_ACTIVITY_FLAG' AND payload->'flags' ? 'MULTIPLE_REPORTED_LOCATIONS'",
    [selfOnlyProxy.value.id],
  )).rowCount, 0, 'SELF locations alone do not trigger a PROXY household flag');

  // Replay uses the exact body and key captured by the request, so retry the first flag-free command as a stable replay check.
  const replay = await createProxy(reporter, firstPayload, first.idempotencyKey);
  assert.equal(replay.status, 201, JSON.stringify(replay.value));
  assert.equal(replay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(replay.value, first.value);
  assert.equal((await responseDb.query("SELECT count(*)::int AS count FROM request_event WHERE request_id=$1 AND event_type='REQUEST_SUBMITTED'", [first.value.id])).rows[0].count, 1);
  const changedReplay = await createProxy(reporter, { ...firstPayload, description: 'Nội dung đã thay đổi.' }, first.idempotencyKey);
  assertVietnameseError(changedReplay, 409, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await responseDb.query('SELECT count(*)::int AS count FROM assistance_request WHERE reporter_user_id=$1 AND report_mode=\'PROXY\'', [reporter.id])).rows[0].count, 4);
  assert.equal(JSON.stringify(fourth.value).includes('tracking_secret'), false);

  const dailyReporter = await registerAndLogin('daily');
  const dailyIds = [];
  for (let index = 0; index < 10; index++) {
    const result = await createProxy(dailyReporter, proxyBody([106.5, 10.5]));
    assert.equal(result.status, 201, JSON.stringify(result.value));
    assert.equal(result.value.review_lane, 'NORMAL', `daily report ${index + 1} should remain below the soft threshold`);
    dailyIds.push(result.value.id);
    await responseDb.query("UPDATE assistance_request SET status='REJECTED' WHERE id=$1", [result.value.id]);
  }
  const eleventh = await createProxy(dailyReporter, proxyBody([106.5, 10.5]));
  assert.equal(eleventh.status, 201, JSON.stringify(eleventh.value));
  assert.equal(eleventh.value.review_lane, 'PROXY_QUOTA_REVIEW', 'the daily soft threshold retains the report for review');
  assert.equal(eleventh.value.status, 'SUBMITTED');
  const rejectionFlag = await responseDb.query(
    `SELECT payload FROM request_event WHERE request_id=$1 AND event_type='PROXY_ACTIVITY_FLAG'`, [eleventh.value.id],
  );
  assert.equal(rejectionFlag.rowCount, 1);
  assert.ok(rejectionFlag.rows[0].payload.flags.includes('PRIOR_REJECTIONS'));
  assert.ok(rejectionFlag.rows[0].payload.rejected_count >= 1);
  assert.ok(dailyIds.length === 10);

  const revokedReporter = await registerAndLogin('revoked');
  await identityDb.query(
    `UPDATE session_family SET revoked_at=now(),revoke_reason='LOGOUT' WHERE user_id=$1 AND revoked_at IS NULL`,
    [revokedReporter.id],
  );
  const revokedKey = key();
  const revoked = await call(responseUrl, 'requests/proxy', {
    method: 'POST', body: proxyBody([108.5, 12.5]),
    headers: { Authorization: `Bearer ${revokedReporter.token}`, 'Idempotency-Key': revokedKey },
  });
  assertVietnameseError(revoked, 401, 'SESSION_EXPIRED');
  assert.equal((await responseDb.query("SELECT 1 FROM idempotency_record WHERE command='response.requests.create-proxy' AND idempotency_key=$1", [revokedKey])).rowCount, 0);

  const massAssignmentKey = key();
  const massAssignment = await createProxy(reporter, proxyBody([108.5, 12.5], { organization_id: organizationId, reporter_user_id: reporter.id } ), massAssignmentKey);
  assertVietnameseError(massAssignment, 400, 'VALIDATION_FAILED');
  assert.equal((await responseDb.query("SELECT 1 FROM idempotency_record WHERE command='response.requests.create-proxy' AND idempotency_key=$1", [massAssignmentKey])).rowCount, 0);

  console.log('Response T6 proxy intake integration passed (live Identity, provenance, idempotency, open/daily soft limits, staff flags).');
} finally {
  await Promise.all([responseDb.end().catch(() => {}), identityDb.end().catch(() => {})]);
}
