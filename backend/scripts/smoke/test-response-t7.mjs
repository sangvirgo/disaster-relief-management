import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = process.env.C48_RESPONSE_BASE_URL;
const identityUrl = process.env.C48_IDENTITY_BASE_URL;
const responseDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
const identityDb = new Client({ connectionString: process.env.C48_IDENTITY_DATABASE_URL });
const organizationId = '40000000-0000-4000-8000-000000000004';
const requestIds = [];
let identityIpSequence = 1;

function identityIp() { return `203.0.113.${identityIpSequence++}`; }

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
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected a Vietnamese user-facing message');
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

async function registerAndLogin(label, role = 'CITIZEN', scope = 'ORGANIZATION', regionCode = 'T7_OTHER') {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t7${label}${suffix}`,
    display_name: `Người dùng kiểm thử ${label} ${suffix}`,
    password: `Response test password ${suffix}!`,
  };
  const sourceIp = identityIp();
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials, headers: { 'Idempotency-Key': key(), 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  const userId = registered.value.user.id;
  if (role === 'COORDINATOR') {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,region_code)
       VALUES ($1,'COORDINATOR',$2,$3,$4)`,
      [userId, scope, organizationId, scope === 'REGION' ? regionCode : null],
    );
  }
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: userId, token: login.value.access_token };
}

function selfBody(coordinates, phone = null) {
  return {
    incident_category_code: 'T7_FLOOD',
    description: 'Nước đang dâng trong nhà.',
    people_affected: 2,
    reporter_name: 'Nguyễn An',
    reporter_contact_phone: phone,
    reporter_declared_danger: false,
    location: { type: 'Point', coordinates, source: 'GPS', accuracy_m: 8, captured_at: new Date().toISOString() },
  };
}

function proxyBody(coordinates) {
  return {
    ...selfBody(coordinates, '+84911112222'),
    relationship: 'Người thân',
    beneficiary_contact_phone: null,
    alternate_contact: { name: 'Nguyễn Lan', phone: '0912 111 222' },
    information_source: 'Người dân báo tin',
    last_known_situation_at: new Date().toISOString(),
    contactability: 'UNKNOWN',
  };
}

async function createRequest(reporter, mode, body, forwardedIp) {
  const result = await call(responseUrl, mode === 'PROXY' ? 'requests/proxy' : 'requests', {
    method: 'POST', body,
    headers: {
      Authorization: `Bearer ${reporter.token}`,
      'Idempotency-Key': key(),
      ...(forwardedIp ? { 'X-Forwarded-For': forwardedIp } : {}),
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  requestIds.push(result.value.id);
  return result.value;
}

async function command(path, user, body, idempotencyKey = key()) {
  const result = await call(responseUrl, path, {
    method: 'POST', body,
    headers: { Authorization: `Bearer ${user.token}`, 'Idempotency-Key': idempotencyKey },
  });
  return { ...result, idempotencyKey };
}

async function waitForRequestRowLockWaits(database, blockerPid, minimum) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await database.query(
      `SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid<>$1 AND wait_event_type='Lock'
          AND $1=ANY(pg_blocking_pids(pid))
          AND query ILIKE '%FROM assistance_request WHERE id=$1 FOR UPDATE%'`,
      [blockerPid],
    );
    if (result.rows[0].count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${minimum} verification command(s) on the locked assistance_request row`);
}

await Promise.all([responseDb.connect(), identityDb.connect()]);
try {
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind) VALUES ($1,'T7 test organization','COORDINATION') ON CONFLICT (id) DO NOTHING`,
    [organizationId],
  );
  await identityDb.query("INSERT INTO region (code,name) VALUES ('T7_OTHER','Khu vực khác'),('T7_REGION','Khu vực thử nghiệm') ON CONFLICT (code) DO NOTHING");
  await responseDb.query("INSERT INTO incident_category (code,display_name) VALUES ('T7_FLOOD','Lũ lụt') ON CONFLICT (code) DO NOTHING");
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ('T7_REGION',ST_Multi(ST_GeomFromText('POLYGON((104 14,106 14,106 16,104 16,104 14))',4326))),
      ('T7_OTHER',ST_Multi(ST_GeomFromText('POLYGON((107 14,109 14,109 16,107 16,107 14))',4326)))
     ON CONFLICT (region_code) DO NOTHING`,
  );

  const reporter = await registerAndLogin('reporter');
  const coordinator = await registerAndLogin('coord1', 'COORDINATOR');
  const secondCoordinator = await registerAndLogin('coord2', 'COORDINATOR');
  const outOfScopeCoordinator = await registerAndLogin('other', 'COORDINATOR', 'REGION');
  const regionCoordinator = await registerAndLogin('region', 'COORDINATOR', 'REGION', 'T7_REGION');

  const self = await createRequest(reporter, 'SELF', selfBody([105.1, 15.1], '+84912345678'));
  const denied = await call(responseUrl, `requests/${self.id}`, { headers: { Authorization: `Bearer ${outOfScopeCoordinator.token}` } });
  assertVietnameseError(denied, 403, 'FORBIDDEN');

  const queue = await call(responseUrl, 'requests?category=T7_FLOOD&limit=100', { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assert.equal(queue.status, 200, JSON.stringify(queue.value));
  const queueItem = queue.value.items.find((item) => item.id === self.id);
  assert.ok(queueItem, 'scoped request appears in the coordinator queue');
  assert.equal(queueItem.reporter_contact_phone, '******5678');
  assert.deepEqual(queueItem.approx_location, { longitude: 105.1, latitude: 15.1 });
  assert.equal(JSON.stringify(queueItem).includes('coordinates'), false, 'queue never exposes exact location fields');

  const outOfScopeRequest = await createRequest(reporter, 'SELF', selfBody([108.1, 15.1]));
  const firstQueuePage = await call(responseUrl, 'requests?category=T7_FLOOD&limit=1', { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assert.equal(firstQueuePage.status, 200, JSON.stringify(firstQueuePage.value));
  assert.equal(firstQueuePage.value.more, true);
  const secondQueuePage = await call(responseUrl, `requests?category=T7_FLOOD&limit=1&cursor=${encodeURIComponent(firstQueuePage.value.cursor)}`, {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(secondQueuePage.status, 200, JSON.stringify(secondQueuePage.value));
  assert.notEqual(secondQueuePage.value.items[0]?.id, firstQueuePage.value.items[0]?.id, 'queue cursor advances with the same filters');

  await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,payload)
     VALUES ($1,$2,'STAFF_SCOPE_FIXTURE','STAFF',$3::jsonb)`,
    [self.id, coordinator.id, JSON.stringify({ canonical_request_id: outOfScopeRequest.id })],
  );
  const scopedEvents = await call(responseUrl, `requests/${self.id}/events?limit=10`, {
    headers: { Authorization: `Bearer ${regionCoordinator.token}` },
  });
  assert.equal(scopedEvents.status, 200, JSON.stringify(scopedEvents.value));
  const scopedFixture = scopedEvents.value.items.find((event) => event.event_type === 'STAFF_SCOPE_FIXTURE');
  assert.ok(scopedFixture, 'region-scoped coordinator can read an in-scope event');
  assert.equal(Object.hasOwn(scopedFixture.payload, 'canonical_request_id'), false, 'out-of-scope request references are removed from event payloads');

  const detail = await call(responseUrl, `requests/${self.id}`, { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assert.equal(detail.status, 200, JSON.stringify(detail.value));
  assert.equal(detail.value.reporter.contact_phone, '+84912345678');
  assert.ok(detail.value.timeline.items.some((event) => event.event_type === 'REQUEST_SUBMITTED'));

  const missingAuth = await call(responseUrl, `requests/${self.id}/start-verification`, { method: 'POST', body: { expected_version: 1 }, headers: { 'Idempotency-Key': key() } });
  assertVietnameseError(missingAuth, 401, 'UNAUTHENTICATED');
  const started = await command(`requests/${self.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(started.status, 200, JSON.stringify(started.value));
  assert.equal(started.value.status, 'VERIFYING');
  assert.equal(started.value.version, 2);

  const noContact = await command(`requests/${self.id}/verify`, coordinator, { expected_version: 2, basis: 'CONTACT_CONFIRMED' });
  assertVietnameseError(noContact, 409, 'NO_CONTACT_ATTEMPT');
  const attempt = await command(`requests/${self.id}/contact-attempts`, coordinator, {
    contact_target: 'REPORTER', outcome: 'REACHED', note: 'Đã xác nhận vị trí.',
  });
  assert.equal(attempt.status, 201, JSON.stringify(attempt.value));
  assert.equal(attempt.value.outcome, 'REACHED');
  const verified = await command(`requests/${self.id}/verify`, coordinator, {
    expected_version: 3, basis: 'CONTACT_CONFIRMED', source_refs: { contact_attempt_ids: [attempt.value.id] },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.value));
  assert.equal(verified.value.status, 'VERIFIED');
  const snapshot = await responseDb.query(
    `SELECT r.verification_revision,e.event_type,e.payload,d.basis
       FROM assistance_request r JOIN request_event e ON e.id=r.verification_revision AND e.request_id=r.id
       JOIN verification_decision d ON d.request_id=r.id AND d.outcome='VERIFIED'
      WHERE r.id=$1`, [self.id],
  );
  assert.equal(snapshot.rowCount, 1);
  assert.equal(snapshot.rows[0].event_type, 'REQUEST_VERIFIED');
  assert.equal(snapshot.rows[0].basis, 'CONTACT_CONFIRMED');
  assert.equal(snapshot.rows[0].payload.approved_facts.description, 'Nước đang dâng trong nhà.');

  const concurrentVerificationRequest = await createRequest(reporter, 'SELF', selfBody([105.16, 15.16]));
  const concurrentVerificationStart = await command(`requests/${concurrentVerificationRequest.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(concurrentVerificationStart.status, 200, JSON.stringify(concurrentVerificationStart.value));
  const concurrentVerificationAttempt = await command(`requests/${concurrentVerificationRequest.id}/contact-attempts`, coordinator, {
    contact_target: 'REPORTER', outcome: 'REACHED', note: 'Đã xác nhận thông tin.',
  });
  assert.equal(concurrentVerificationAttempt.status, 201, JSON.stringify(concurrentVerificationAttempt.value));
  const lockDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
  await lockDb.connect();
  let transactionOpen = false;
  let pendingVerificationRace;
  let verificationRace;
  try {
    await lockDb.query('BEGIN');
    transactionOpen = true;
    await lockDb.query('SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE', [concurrentVerificationRequest.id]);
    const blockerPid = (await lockDb.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pendingVerificationRace = Promise.all([
      command(`requests/${concurrentVerificationRequest.id}/verify`, coordinator, {
        expected_version: 3, basis: 'CONTACT_CONFIRMED', source_refs: { contact_attempt_ids: [concurrentVerificationAttempt.value.id] },
      }),
      command(`requests/${concurrentVerificationRequest.id}/verify`, secondCoordinator, {
        expected_version: 3, basis: 'CONTACT_CONFIRMED', source_refs: { contact_attempt_ids: [concurrentVerificationAttempt.value.id] },
      }),
    ]);
    await waitForRequestRowLockWaits(responseDb, blockerPid, 2);
    await lockDb.query('COMMIT');
    transactionOpen = false;
    verificationRace = await pendingVerificationRace;
  } finally {
    if (transactionOpen) await lockDb.query('ROLLBACK');
    if (pendingVerificationRace) await pendingVerificationRace.catch(() => undefined);
    await lockDb.end();
  }
  const verificationWinners = verificationRace.filter((result) => result.status === 200);
  const verificationLosers = verificationRace.filter((result) => result.status === 409);
  assert.equal(verificationWinners.length, 1, JSON.stringify(verificationRace.map((result) => result.value)));
  assert.equal(verificationLosers.length, 1, JSON.stringify(verificationRace.map((result) => result.value)));
  assert.equal(verificationWinners[0].value.status, 'VERIFIED');
  assert.equal(verificationWinners[0].value.version, 4);
  assertVietnameseError(verificationLosers[0], 409, 'VERSION_CONFLICT');
  const concurrentVerificationState = await responseDb.query(
    `SELECT r.status,r.version::int AS version,
            (SELECT count(*)::int FROM verification_decision d WHERE d.request_id=r.id AND d.outcome='VERIFIED') AS decisions,
            (SELECT count(*)::int FROM request_event e WHERE e.request_id=r.id AND e.event_type='REQUEST_VERIFIED') AS verification_events
       FROM assistance_request r WHERE r.id=$1`, [concurrentVerificationRequest.id],
  );
  assert.deepEqual(concurrentVerificationState.rows[0], {
    status: 'VERIFIED', version: 4, decisions: 1, verification_events: 1,
  }, 'concurrent verification commits one decision and one event');

  const supplementRequest = await createRequest(reporter, 'SELF', selfBody([105.12, 15.12]));
  const supplementStart = await command(`requests/${supplementRequest.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(supplementStart.status, 200, JSON.stringify(supplementStart.value));
  const [supplementEvent] = (await responseDb.query(
    `INSERT INTO request_event (request_id,event_type,payload)
     VALUES ($1,'REPORTER_SUPPLEMENT',$2::jsonb) RETURNING id`,
    [supplementRequest.id, JSON.stringify({ pending_review: true, reported_facts: { description: 'Thông tin bổ sung đã được duyệt.' } })],
  )).rows;
  const blockedBySupplement = await command(`requests/${supplementRequest.id}/verify`, coordinator, {
    expected_version: 2, basis: 'CORROBORATED', reason: 'Đang chờ duyệt thông tin bổ sung.', source_note: 'Nguồn đang được rà soát.',
  });
  assertVietnameseError(blockedBySupplement, 409, 'PENDING_SUPPLEMENT_REVIEW');
  const supplementReview = await command(`requests/${supplementRequest.id}/supplements/${supplementEvent.id}/review`, coordinator, {
    expected_version: 2, decision: 'ACCEPT', reason: 'Đã đối chiếu thông tin bổ sung.', source_refs: {},
  });
  assert.equal(supplementReview.status, 200, JSON.stringify(supplementReview.value));
  assert.equal(supplementReview.value.version, 3);
  assert.equal(supplementReview.value.verification_revision, supplementReview.value.event_id);
  const approvedSupplement = await responseDb.query(
    `SELECT r.description,e.payload FROM assistance_request r JOIN request_event e ON e.id=r.verification_revision WHERE r.id=$1`,
    [supplementRequest.id],
  );
  assert.equal(approvedSupplement.rows[0].description, 'Thông tin bổ sung đã được duyệt.');
  assert.equal(approvedSupplement.rows[0].payload.decision, 'ACCEPT');
  const supplementVerified = await command(`requests/${supplementRequest.id}/verify`, coordinator, {
    expected_version: 3, basis: 'CORROBORATED', reason: 'Đã rà soát thông tin.', source_note: 'Thông tin bổ sung đã được đối chiếu.',
  });
  assert.equal(supplementVerified.status, 200, JSON.stringify(supplementVerified.value));

  const rejectedSupplementRequest = await createRequest(reporter, 'SELF', selfBody([105.13, 15.13]));
  const rejectedSupplementStart = await command(`requests/${rejectedSupplementRequest.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(rejectedSupplementStart.status, 200, JSON.stringify(rejectedSupplementStart.value));
  const [rejectedSupplementEvent] = (await responseDb.query(
    `INSERT INTO request_event (request_id,event_type,payload)
     VALUES ($1,'REPORTER_SUPPLEMENT',$2::jsonb) RETURNING id`,
    [rejectedSupplementRequest.id, JSON.stringify({ pending_review: true, reported_facts: { description: 'Thông tin chưa được chấp nhận.' } })],
  )).rows;
  const rejectedSupplementReview = await command(`requests/${rejectedSupplementRequest.id}/supplements/${rejectedSupplementEvent.id}/review`, coordinator, {
    expected_version: 2, decision: 'REJECT', reason: 'Thông tin bổ sung chưa được xác minh.', source_refs: {},
  });
  assert.equal(rejectedSupplementReview.status, 200, JSON.stringify(rejectedSupplementReview.value));
  const unchangedRejectedFacts = await responseDb.query('SELECT description,verification_revision FROM assistance_request WHERE id=$1', [rejectedSupplementRequest.id]);
  assert.equal(unchangedRejectedFacts.rows[0].description, 'Nước đang dâng trong nhà.');
  assert.equal(unchangedRejectedFacts.rows[0].verification_revision, null);

  const unreachableRequest = await createRequest(reporter, 'SELF', selfBody([105.14, 15.14]));
  await responseDb.query(
    `INSERT INTO contact_attempt (request_id,actor_user_id,contact_target,outcome,attempted_at) VALUES
      ($1,$2,'REPORTER','NO_ANSWER',now()-interval '40 minutes'),
      ($1,$2,'BENEFICIARY','NO_ANSWER',now()-interval '20 minutes'),
      ($1,$2,'ALTERNATE','WRONG_NUMBER',now()-interval '10 minutes')`,
    [unreachableRequest.id, coordinator.id],
  );
  const belowThreshold = await command(`requests/${unreachableRequest.id}/reject`, coordinator, {
    expected_version: 1, reason_kind: 'UNREACHABLE', reason: 'Chưa đạt ngưỡng liên hệ thất bại.',
  });
  assertVietnameseError(belowThreshold, 409, 'REJECT_THRESHOLD_NOT_MET');
  await responseDb.query(
    `INSERT INTO contact_attempt (request_id,actor_user_id,contact_target,outcome,attempted_at)
     VALUES ($1,$2,'REPORTER','NO_ANSWER',now()-interval '40 minutes')`,
    [unreachableRequest.id, coordinator.id],
  );
  const rejectedUnreachable = await command(`requests/${unreachableRequest.id}/reject`, coordinator, {
    expected_version: 1, reason_kind: 'UNREACHABLE', reason: 'Không liên hệ được sau nhiều lần thử.',
  });
  assert.equal(rejectedUnreachable.status, 200, JSON.stringify(rejectedUnreachable.value));
  assert.equal(rejectedUnreachable.value.status, 'REJECTED');

  const reporterTimeline = await call(responseUrl, `requests/${self.id}/events?limit=10`, {
    headers: { Authorization: `Bearer ${reporter.token}`, 'X-Tracking-Code': self.tracking_code },
  });
  assert.equal(reporterTimeline.status, 200, JSON.stringify(reporterTimeline.value));
  assert.ok(reporterTimeline.value.items.some((item) => item.public_text_code === 'REQUEST_VERIFIED'));
  assert.equal(JSON.stringify(reporterTimeline.value).includes('Đã xác nhận vị trí'), false, 'staff contact notes stay private');

  const unassigned = await createRequest(reporter, 'SELF', selfBody([150, 50]));
  const secondUnassigned = await createRequest(reporter, 'SELF', selfBody([151, 51]));
  const seenUnassignedIds = new Set();
  let unassignedCursor;
  while (!seenUnassignedIds.has(unassigned.id) || !seenUnassignedIds.has(secondUnassigned.id)) {
    const cursorParam = unassignedCursor ? `&cursor=${encodeURIComponent(unassignedCursor)}` : '';
    const unassignedPage = await call(responseUrl, `requests/unassigned?limit=1${cursorParam}`, {
      headers: { Authorization: `Bearer ${coordinator.token}` },
    });
    assert.equal(unassignedPage.status, 200, JSON.stringify(unassignedPage.value));
    const id = unassignedPage.value.items[0]?.id;
    assert.ok(id);
    assert.ok(!seenUnassignedIds.has(id), 'unassigned cursor advances to a different request');
    seenUnassignedIds.add(id);
    if (seenUnassignedIds.has(unassigned.id) && seenUnassignedIds.has(secondUnassigned.id)) break;
    assert.equal(unassignedPage.value.more, true, 'both T7 fixtures appear before the unassigned queue ends');
    assert.ok(unassignedPage.value.cursor);
    unassignedCursor = unassignedPage.value.cursor;
  }
  const corrected = await command(`requests/${unassigned.id}/correct-region`, coordinator, {
    expected_version: 1, region_code: 'T7_REGION', reason: 'Đối chiếu lại địa bàn.',
  });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.value));
  assert.equal(corrected.value.region_code, 'T7_REGION');

  const attributionLocked = await createRequest(reporter, 'SELF', selfBody([105.18, 15.18]));
  await responseDb.query('UPDATE assistance_request SET attribution_locked_at=clock_timestamp() WHERE id=$1', [attributionLocked.id]);
  const lockedCorrection = await command(`requests/${attributionLocked.id}/correct-region`, coordinator, {
    expected_version: 1, region_code: 'T7_REGION', reason: 'Đối chiếu lại địa bàn.',
  });
  assertVietnameseError(lockedCorrection, 409, 'ATTRIBUTION_LOCKED');

  const proxyReporter = await registerAndLogin('proxy');
  const proxyRequests = [];
  for (const coordinates of [[105.11, 15.1], [105.25, 15.1], [105.4, 15.1], [105.6, 15.1]]) {
    proxyRequests.push(await createRequest(proxyReporter, 'PROXY', proxyBody(coordinates)));
  }
  const quotaQueue = await call(responseUrl, 'requests?category=T7_FLOOD&review_lane=PROXY_QUOTA_REVIEW&limit=100', {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(quotaQueue.status, 200, JSON.stringify(quotaQueue.value));
  assert.ok(quotaQueue.value.items.some((item) => item.id === proxyRequests[3].id), 'proxy quota lane is visible in its own queue');
  const flaggedDetail = await call(responseUrl, `requests/${proxyRequests[2].id}`, { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assert.equal(flaggedDetail.status, 200, JSON.stringify(flaggedDetail.value));
  assert.ok(flaggedDetail.value.proxy_activity_flags.some((flag) => flag.flags.includes('MULTIPLE_REPORTED_LOCATIONS')));

  const proxyStarted = await command(`requests/${proxyRequests[0].id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(proxyStarted.status, 200, JSON.stringify(proxyStarted.value));
  const noIndependentSource = await command(`requests/${proxyRequests[0].id}/verify`, coordinator, {
    expected_version: 2, basis: 'CORROBORATED', reason: 'Thông tin chưa có nguồn độc lập.', source_note: 'Chưa xác định được nguồn độc lập.',
  });
  assertVietnameseError(noIndependentSource, 409, 'SECOND_COORDINATOR_REQUIRED');

  const candidate = await createRequest(reporter, 'SELF', selfBody([105.115, 15.1], '+84987654321'), '198.51.100.77');
  const candidates = await call(responseUrl, `requests/${proxyRequests[0].id}/verification-candidates`, {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(candidates.status, 200, JSON.stringify(candidates.value));
  assert.ok(candidates.value.items.some((item) => item.id === candidate.id), 'independent nearby request is suggested for corroboration');
  const corroborated = await command(`requests/${proxyRequests[0].id}/verify`, coordinator, {
    expected_version: 2, basis: 'CORROBORATED', reason: 'Đối chiếu với yêu cầu độc lập.',
    source_refs: { request_ids: [candidate.id] },
  });
  assert.equal(corroborated.status, 200, JSON.stringify(corroborated.value));

  const concurrenceReporter = await registerAndLogin('concurproxy');
  const concurrenceRequest = await createRequest(concurrenceReporter, 'PROXY', proxyBody([105.2, 15.25]));
  const concurrenceStart = await command(`requests/${concurrenceRequest.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(concurrenceStart.status, 200, JSON.stringify(concurrenceStart.value));
  const concurrence = await command(`requests/${concurrenceRequest.id}/concur`, secondCoordinator, { expected_version: 2, note: 'Đã rà soát độc lập.' });
  assert.equal(concurrence.status, 200, JSON.stringify(concurrence.value));
  const noteSupplement = await call(responseUrl, `requests/${concurrenceRequest.id}/supplements`, {
    method: 'POST', body: { expected_version: 3, description: 'Bổ sung ghi chú không làm thay đổi dữ kiện.' },
    headers: {
      Authorization: `Bearer ${concurrenceReporter.token}`, 'X-Tracking-Code': concurrenceRequest.tracking_code,
      'Idempotency-Key': key(),
    },
  });
  assert.equal(noteSupplement.status, 201, JSON.stringify(noteSupplement.value));
  assert.equal(noteSupplement.value.version, 4);
  const concurrenceVerify = await command(`requests/${concurrenceRequest.id}/verify`, coordinator, {
    expected_version: 4, basis: 'TWO_COORDINATOR_JUDGMENT', reason: 'Hai điều phối viên đã rà soát.',
    concurrence_event_id: concurrence.value.event_id,
  });
  assert.equal(concurrenceVerify.status, 200, JSON.stringify(concurrenceVerify.value));
  assert.equal(concurrenceVerify.value.status, 'VERIFIED');
  const decision = await responseDb.query('SELECT reviewer_user_id,concurring_user_id FROM verification_decision WHERE request_id=$1', [concurrenceRequest.id]);
  assert.equal(decision.rows[0].reviewer_user_id, coordinator.id);
  assert.equal(decision.rows[0].concurring_user_id, secondCoordinator.id);

  const materialConcurrenceRequest = await createRequest(concurrenceReporter, 'PROXY', proxyBody([105.3, 15.3]));
  const materialStart = await command(`requests/${materialConcurrenceRequest.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(materialStart.status, 200, JSON.stringify(materialStart.value));
  const materialConcurrence = await command(`requests/${materialConcurrenceRequest.id}/concur`, secondCoordinator, { expected_version: 2, note: 'Đã đối chiếu dữ kiện ban đầu.' });
  assert.equal(materialConcurrence.status, 200, JSON.stringify(materialConcurrence.value));
  const materialSupplement = await call(responseUrl, `requests/${materialConcurrenceRequest.id}/supplements`, {
    method: 'POST', body: { expected_version: 3, people_affected: 4 },
    headers: {
      Authorization: `Bearer ${concurrenceReporter.token}`, 'X-Tracking-Code': materialConcurrenceRequest.tracking_code,
      'Idempotency-Key': key(),
    },
  });
  assert.equal(materialSupplement.status, 201, JSON.stringify(materialSupplement.value));
  const staleConcurrence = await command(`requests/${materialConcurrenceRequest.id}/verify`, coordinator, {
    expected_version: 4, basis: 'TWO_COORDINATOR_JUDGMENT', reason: 'Đang thử concurrence cũ.',
    concurrence_event_id: materialConcurrence.value.event_id,
  });
  assertVietnameseError(staleConcurrence, 409, 'SECOND_COORDINATOR_REQUIRED');

  const triaged = await command(`requests/${self.id}/triage`, coordinator, {
    expected_version: 4, priority: 'P2', priority_basis: 'INCOMPLETE_INFO', reason: 'Cần hỗ trợ sớm.',
  });
  assert.equal(triaged.status, 200, JSON.stringify(triaged.value));
  assert.equal(triaged.value.status, 'TRIAGED');
  const lowerPriorityWithoutReason = await command(`requests/${self.id}/triage`, coordinator, {
    expected_version: 5, priority: 'P3', priority_basis: 'INCOMPLETE_INFO', reason: '',
  });
  assertVietnameseError(lowerPriorityWithoutReason, 400, 'REASON_REQUIRED');

  const referral = await command(`requests/${self.id}/authority-referrals`, coordinator, {
    referred_body: 'Cơ quan phòng chống thiên tai', note: 'Đã chuyển thông tin qua điện thoại.',
  });
  assert.equal(referral.status, 201, JSON.stringify(referral.value));
  assert.equal(referral.value.status, 'TRIAGED', 'referral records audit evidence without changing request status');

  const duplicates = await Promise.all([
    command(`requests/${proxyRequests[1].id}/duplicate`, coordinator, {
      expected_version: 1, canonical_request_id: proxyRequests[2].id, reason: 'Cùng một hộ gia đình.',
    }),
    command(`requests/${proxyRequests[2].id}/duplicate`, secondCoordinator, {
      expected_version: 1, canonical_request_id: proxyRequests[3].id, reason: 'Cùng một hộ gia đình.',
    }),
  ]);
  assert.equal(duplicates.filter((result) => result.status === 200).length, 1, JSON.stringify(duplicates.map((item) => item.value)));
  assert.ok(duplicates.some((result) => [409].includes(result.status) && ['CANONICAL_INVALID', 'CANONICAL_HAS_DUPLICATES'].includes(result.value?.code)));
  const links = await responseDb.query(
    `SELECT id,canonical_request_id FROM assistance_request WHERE id=ANY($1::uuid[]) AND status='DUPLICATE'`,
    [[proxyRequests[1].id, proxyRequests[2].id]],
  );
  assert.equal(links.rowCount, 1, 'the A→B vs B→C race cannot create a duplicate chain');

  const canonical = await createRequest(reporter, 'SELF', selfBody([105.7, 15.4]));
  const duplicateOne = await createRequest(reporter, 'SELF', selfBody([105.71, 15.4]));
  const duplicateTwo = await createRequest(reporter, 'SELF', selfBody([105.72, 15.4]));
  for (const child of [duplicateOne, duplicateTwo]) {
    const linked = await command(`requests/${child.id}/duplicate`, coordinator, {
      expected_version: 1, canonical_request_id: canonical.id, reason: 'Cùng một hộ gia đình.',
    });
    assert.equal(linked.status, 200, JSON.stringify(linked.value));
  }
  const rejectCanonical = await command(`requests/${canonical.id}/reject`, coordinator, {
    expected_version: 1, reason_kind: 'OTHER', reason: 'Yêu cầu trùng không cần xử lý riêng.',
  });
  assert.equal(rejectCanonical.status, 200, JSON.stringify(rejectCanonical.value));
  assert.deepEqual(rejectCanonical.value.orphaned_duplicates.items.map((item) => item.id).sort(), [duplicateOne.id, duplicateTwo.id].sort());
  assert.equal(rejectCanonical.value.orphaned_duplicates.more, false);
  const orphanState = await responseDb.query(
    `SELECT id,status,canonical_request_id,version FROM assistance_request WHERE id=ANY($1::uuid[]) ORDER BY id`,
    [[duplicateOne.id, duplicateTwo.id]],
  );
  assert.equal(orphanState.rowCount, 2);
  assert.ok(
    orphanState.rows.every((child) => child.status === 'VERIFYING' && child.canonical_request_id === null && Number(child.version) === 3),
    JSON.stringify({ expected: 'VERIFYING, canonical_request_id=null, version=3', actual: orphanState.rows }),
  );
  const orphanEvents = await responseDb.query(
    `SELECT e.actor_user_id,e.payload FROM request_event e WHERE e.request_id=ANY($1::uuid[]) AND e.event_type='DUPLICATE_ORPHANED'`,
    [[duplicateOne.id, duplicateTwo.id]],
  );
  assert.equal(orphanEvents.rowCount, 2);
  assert.ok(orphanEvents.rows.every((event) => event.actor_user_id === null && event.payload.canonical_request_id === canonical.id));
  const orphanNotices = await responseDb.query(
    `SELECT source_id,notice_type FROM notice WHERE source_id=ANY($1::uuid[]) AND notice_type='DUPLICATE_ORPHANED'`,
    [[duplicateOne.id, duplicateTwo.id]],
  );
  assert.ok(orphanNotices.rowCount >= 2, 'orphaned duplicate notifies its reporter and scoped coordinators');
  const replayedReject = await command(`requests/${canonical.id}/reject`, coordinator, {
    expected_version: 1, reason_kind: 'OTHER', reason: 'Yêu cầu trùng không cần xử lý riêng.',
  }, rejectCanonical.idempotencyKey);
  assert.equal(replayedReject.status, 200, JSON.stringify(replayedReject.value));
  assert.equal(replayedReject.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(replayedReject.value.orphaned_duplicates.items.map((item) => item.id).sort(), [duplicateOne.id, duplicateTwo.id].sort());

  const staleCursor = await call(responseUrl, 'requests?category=T7_FLOOD&cursor=eyJmb28iOiJiYXIifQ&limit=1', { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assertVietnameseError(staleCursor, 400, 'CURSOR_INVALID');

  const overdueRequest = await createRequest(reporter, 'SELF', selfBody([105.15, 15.3]));
  await responseDb.query("UPDATE assistance_request SET received_at=now()-interval '16 minutes' WHERE id=$1", [overdueRequest.id]);
  const noticeDeadline = Date.now() + 70_000;
  let notices = { rowCount: 0, rows: [] };
  while (Date.now() < noticeDeadline && notices.rowCount === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    notices = await responseDb.query(
      `SELECT recipient_user_id,notice_type,payload FROM notice WHERE source_id=$1 AND notice_type='REQUEST_OVERDUE'`, [overdueRequest.id],
    );
  }
  assert.ok(notices.rowCount > 0, 'scheduled overdue scan writes an in-app notice');
  assert.ok(notices.rows.some((notice) => notice.recipient_user_id === coordinator.id));
  assert.ok(notices.rows.every((notice) => Object.keys(notice.payload).every((field) => ['text_code', 'request_id'].includes(field))));

  const repeated = await command(`requests/${self.id}/triage`, coordinator, {
    expected_version: 4, priority: 'P2', priority_basis: 'INCOMPLETE_INFO', reason: 'Cần hỗ trợ sớm.',
  }, triaged.idempotencyKey);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.headers.get('idempotent-replay'), 'true');

  console.log('Response T7 verification, queue, detail, supplement review, rejection threshold, duplicate, priority, and overdue notice integration passed.');
} finally {
  if (requestIds.length) await responseDb.query('DELETE FROM idempotency_record WHERE resource_type IN (\'assistance_request\',\'verification_decision\',\'contact_attempt\') AND resource_id=ANY($1::uuid[])', [requestIds]).catch(() => undefined);
  await Promise.all([responseDb.end(), identityDb.end()]);
}
