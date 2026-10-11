import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = process.env.TEST_RESPONSE_BASE_URL;
const identityUrl = process.env.TEST_IDENTITY_BASE_URL;
const failedStorageUrl = process.env.TEST_RESPONSE_FAIL_BASE_URL;
const responseDb = new Client({ connectionString: process.env.TEST_RESPONSE_DATABASE_URL });
const identityDb = new Client({ connectionString: process.env.TEST_IDENTITY_DATABASE_URL });
const intakeOrganizationId = '40000000-0000-4000-8000-000000000004';
let ipSequence = 40;

function key() { return randomUUID(); }
function secret() { return randomBytes(32).toString('base64url'); }
function ip() { return `198.51.100.${ipSequence++}`; }

async function call(base, path, { method = 'GET', body, headers = {}, rawBody } = {}) {
  const requestHeaders = { ...headers };
  let requestBody = rawBody;
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: requestHeaders,
    ...(requestBody === undefined ? {} : { body: requestBody }),
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

function cookieHeader(setCookies) {
  return setCookies.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

async function registerAndLogin(label, clientKind = 'NATIVE') {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t5${label}${suffix}`,
    display_name: `Người dùng kiểm thử ${label} ${suffix}`,
    password: `Fields remain private ${suffix}!`,
  };
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials,
    headers: { 'Idempotency-Key': key(), 'X-Forwarded-For': ip() },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  const origin = 'https://c48.test';
  const csrf = clientKind === 'WEB' ? await call(identityUrl, 'auth/csrf', { headers: { Origin: origin } }) : undefined;
  const csrfCookies = csrf?.headers.getSetCookie() ?? [];
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: clientKind },
    headers: {
      'X-Forwarded-For': ip(),
      ...(csrf ? { Origin: origin, Cookie: cookieHeader(csrfCookies), 'X-CSRF-Token': csrf.headers.get('x-csrf-token') } : {}),
    },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  if (clientKind === 'NATIVE') assert.equal(typeof login.value?.access_token, 'string', 'Identity must return a bearer access token');
  return {
    id: registered.value.user.id,
    token: login.value?.access_token,
    cookies: login.headers.getSetCookie(),
  };
}

async function createGuestRequest(trackingSecret, coordinates = [106.5, 10.5]) {
  const result = await call(responseUrl, 'requests', {
    method: 'POST',
    body: {
      incident_category_code: 'T5_FLOOD', description: 'Nước ngập tại nơi ở.', people_affected: 2,
      reporter_name: 'Nguyễn An', reporter_contact_phone: null, reporter_declared_danger: false,
      location: { type: 'Point', coordinates, source: 'GPS', accuracy_m: 8, captured_at: new Date().toISOString() },
    },
    headers: { 'Idempotency-Key': key(), 'X-Tracking-Secret': trackingSecret, 'X-Forwarded-For': ip() },
  });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  assert.equal(result.value.status, 'SUBMITTED');
  assert.equal(result.value.review_lane, 'NORMAL', 'T5 behavioral checks need an eligible request lane');
  return result.value;
}

function multipart(file) {
  const boundary = `----c48-${randomBytes(8).toString('hex')}`;
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.png"\r\nContent-Type: image/png\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([prefix, file, suffix]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(base, request, trackingSecret, form, idempotencyKey = key()) {
  return call(base, `requests/${request.id}/evidence`, {
    method: 'POST', rawBody: form.body,
    headers: {
      'Content-Type': form.contentType, 'Content-Length': String(form.body.length),
      'Idempotency-Key': idempotencyKey, 'X-Tracking-Code': request.tracking_code,
      'X-Tracking-Secret': trackingSecret, 'X-Forwarded-For': ip(),
    },
  });
}

await Promise.all([responseDb.connect(), identityDb.connect()]);
try {
  await responseDb.query("INSERT INTO incident_category (code,display_name) VALUES ('T5_FLOOD','Lũ lụt') ON CONFLICT (code) DO NOTHING");
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind) VALUES ($1,'T5 test organization','COORDINATION') ON CONFLICT (id) DO NOTHING`,
    [intakeOrganizationId],
  );

  const reporter = await registerAndLogin('reporter');
  const recoveringReporter = await registerAndLogin('recoverer');
  const coordinator = await registerAndLogin('coordinator');
  const webReporter = await registerAndLogin('web', 'WEB');
  const webMine = await call(responseUrl, 'requests/mine', { headers: { Cookie: cookieHeader(webReporter.cookies) } });
  assert.equal(webMine.status, 200, JSON.stringify(webMine.value));
  assert.deepEqual(webMine.value.items, [], 'cookie-authenticated safe reads do not require CSRF headers');
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id) VALUES ($1,'COORDINATOR','ORGANIZATION',$2)`,
    [coordinator.id, intakeOrganizationId],
  );
  // The coordinator's live Identity session is introspected on every request, so its grant is immediately visible.

  const claimSecret = secret();
  const claimRequest = await createGuestRequest(claimSecret, [106.2, 10.5]);
  const invalidTrack = await call(responseUrl, 'requests/track', {
    headers: { 'X-Tracking-Code': claimRequest.tracking_code, 'X-Tracking-Secret': secret() },
  });
  assertVietnameseError(invalidTrack, 404, 'NOT_FOUND');
  const wrongCode = await call(responseUrl, 'requests/track', {
    headers: { 'X-Tracking-Code': '0000000000', 'X-Tracking-Secret': claimSecret },
  });
  assertVietnameseError(wrongCode, 404, 'NOT_FOUND');
  assert.equal(wrongCode.value.message, invalidTrack.value.message, 'tracking credentials must fail with the same response');
  await identityDb.query(
    "UPDATE session_family SET revoked_at=now(),revoke_reason='LOGOUT' WHERE user_id=$1 AND revoked_at IS NULL",
    [webReporter.id],
  );
  const staleCookieTrack = await call(responseUrl, 'requests/track', {
    headers: { Cookie: cookieHeader(webReporter.cookies), 'X-Tracking-Code': claimRequest.tracking_code, 'X-Tracking-Secret': claimSecret },
  });
  assert.equal(staleCookieTrack.status, 200, JSON.stringify(staleCookieTrack.value));

  const supplementKey = key();
  const initialRegion = await responseDb.query('SELECT region_code FROM assistance_request WHERE id=$1', [claimRequest.id]);
  assert.equal(initialRegion.rows[0].region_code, 'R1');
  const supplementBody = {
    expected_version: 1, description: 'Nước đã dâng thêm.', reporter_declared_danger: true,
    location: { type: 'Point', coordinates: [120.5, 10.5], source: 'MANUAL_PIN' },
  };
  const supplementHeaders = { 'Idempotency-Key': supplementKey, 'X-Tracking-Code': claimRequest.tracking_code, 'X-Tracking-Secret': claimSecret };
  const supplement = await call(responseUrl, `requests/${claimRequest.id}/supplements`, { method: 'POST', body: supplementBody, headers: supplementHeaders });
  assert.equal(supplement.status, 201, JSON.stringify(supplement.value));
  assert.equal(supplement.value.version, 2);
  const correctedRegion = await responseDb.query('SELECT region_code FROM assistance_request WHERE id=$1', [claimRequest.id]);
  assert.equal(correctedRegion.rows[0].region_code, null, 'a corrected point outside every region must leave the request unassigned');
  assert.equal(supplement.headers.get('cache-control'), 'no-store');
  const supplementReplay = await call(responseUrl, `requests/${claimRequest.id}/supplements`, { method: 'POST', body: supplementBody, headers: supplementHeaders });
  assert.equal(supplementReplay.status, 201);
  assert.equal(supplementReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(supplementReplay.value, supplement.value);
  const stale = await call(responseUrl, `requests/${claimRequest.id}/supplements`, {
    method: 'POST', body: { expected_version: 1, people_affected: 3 },
    headers: { ...supplementHeaders, 'Idempotency-Key': key() },
  });
  assertVietnameseError(stale, 409, 'VERSION_CONFLICT');
  const invalidNullSupplement = await call(responseUrl, `requests/${claimRequest.id}/supplements`, {
    method: 'POST', body: { expected_version: 2, description: null },
    headers: { ...supplementHeaders, 'Idempotency-Key': key() },
  });
  assertVietnameseError(invalidNullSupplement, 400, 'VALIDATION_FAILED');
  const track = await call(responseUrl, 'requests/track', {
    headers: { 'X-Tracking-Code': claimRequest.tracking_code, 'X-Tracking-Secret': claimSecret },
  });
  assert.equal(track.status, 200, JSON.stringify(track.value));
  assert.equal(track.value.version, 2);
  assert.equal(track.value.timeline[0].event_type, 'REPORTER_SUPPLEMENT');
  assert.equal(track.value.can_supplement, true);
  const timeline = await call(responseUrl, `requests/${claimRequest.id}/events`, {
    headers: { 'X-Tracking-Code': claimRequest.tracking_code, 'X-Tracking-Secret': claimSecret },
  });
  assert.equal(timeline.status, 200, JSON.stringify(timeline.value));
  assert.equal(timeline.value.items[0].event_type, 'REPORTER_SUPPLEMENT');

  const mineBeforeClaim = await call(responseUrl, 'requests/mine', { headers: { Authorization: `Bearer ${reporter.token}` } });
  assert.equal(mineBeforeClaim.status, 200, JSON.stringify(mineBeforeClaim.value));
  assert.deepEqual(mineBeforeClaim.value.items, []);
  const claimKey = key();
  const claimHeaders = { Authorization: `Bearer ${reporter.token}`, 'X-Tracking-Secret': claimSecret, 'Idempotency-Key': claimKey };
  const claim = await call(responseUrl, 'requests/claim', { method: 'POST', body: { tracking_code: claimRequest.tracking_code }, headers: claimHeaders });
  assert.equal(claim.status, 200, JSON.stringify(claim.value));
  const claimReplay = await call(responseUrl, 'requests/claim', { method: 'POST', body: { tracking_code: claimRequest.tracking_code }, headers: claimHeaders });
  assert.equal(claimReplay.status, 200);
  assert.equal(claimReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(claimReplay.value, claim.value);
  const claimEvent = await responseDb.query("SELECT actor_user_id FROM request_event WHERE request_id=$1 AND event_type='REQUEST_CLAIMED'", [claimRequest.id]);
  assert.equal(claimEvent.rows[0]?.actor_user_id, reporter.id);
  const claimed = await responseDb.query('SELECT reporter_user_id,tracking_secret_hash FROM assistance_request WHERE id=$1', [claimRequest.id]);
  assert.equal(claimed.rows[0].reporter_user_id, reporter.id);
  assert.equal(claimed.rows[0].tracking_secret_hash, null);
  const mineAfterClaim = await call(responseUrl, 'requests/mine', { headers: { Authorization: `Bearer ${reporter.token}` } });
  assert.equal(mineAfterClaim.value.items[0].id, claimRequest.id);
  const sessionTracking = await call(responseUrl, 'requests/track', {
    headers: { Authorization: `Bearer ${reporter.token}`, 'X-Tracking-Code': claimRequest.tracking_code },
  });
  assert.equal(sessionTracking.status, 200, JSON.stringify(sessionTracking.value));
  assert.equal(sessionTracking.value.id, claimRequest.id);
  assertVietnameseError(await call(responseUrl, 'requests/track', {
    headers: { 'X-Tracking-Code': claimRequest.tracking_code, 'X-Tracking-Secret': claimSecret },
  }), 404, 'NOT_FOUND');
  const unauthenticatedMine = await call(responseUrl, 'requests/mine');
  assertVietnameseError(unauthenticatedMine, 401, 'UNAUTHENTICATED');

  const recoverySecret = secret();
  const recoveryRequest = await createGuestRequest(recoverySecret);
  const contactAttemptId = randomUUID();
  await responseDb.query(
    `INSERT INTO contact_attempt (id,request_id,actor_user_id,contact_target,outcome,note)
     VALUES ($1,$2,$3,'REPORTER','REACHED','Liên hệ độc lập đã xác minh.')`,
    [contactAttemptId, recoveryRequest.id, randomUUID()],
  );
  const issueKey = key();
  const issueHeaders = { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': issueKey };
  const issueBody = { expected_version: 1, reason: 'Đã xác minh người báo tin.', contact_attempt_id: contactAttemptId, source_note: 'Cuộc gọi đến số đã đăng ký.' };
  const issue = await call(responseUrl, `requests/${recoveryRequest.id}/recovery`, { method: 'POST', body: issueBody, headers: issueHeaders });
  assert.equal(issue.status, 201, JSON.stringify(issue.value));
  assert.match(issue.value.recovery_code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issue.headers.get('cache-control'), 'no-store');
  const issueReplay = await call(responseUrl, `requests/${recoveryRequest.id}/recovery`, { method: 'POST', body: issueBody, headers: issueHeaders });
  assert.equal(issueReplay.status, 201);
  assert.equal(issueReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(Object.hasOwn(issueReplay.value, 'recovery_code'), false, 'a recovery replay must not expose the one-time plaintext');
  const recoveryRow = await responseDb.query('SELECT code_hash,expires_at,consumed_at FROM capability_recovery WHERE id=$1', [issue.value.issuance_id]);
  assert.equal(recoveryRow.rows[0].consumed_at, null);
  assert.equal(recoveryRow.rows[0].code_hash.includes(issue.value.recovery_code), false);
  const recover = await call(responseUrl, 'requests/recover', {
    method: 'POST', body: { tracking_code: recoveryRequest.tracking_code },
    headers: { Authorization: `Bearer ${recoveringReporter.token}`, 'X-Recovery-Code': issue.value.recovery_code, 'Idempotency-Key': key() },
  });
  assert.equal(recover.status, 200, JSON.stringify(recover.value));
  const redeemed = await responseDb.query('SELECT reporter_user_id,tracking_secret_hash FROM assistance_request WHERE id=$1', [recoveryRequest.id]);
  assert.equal(redeemed.rows[0].reporter_user_id, recoveringReporter.id);
  assert.equal(redeemed.rows[0].tracking_secret_hash, null);
  const recoveredEvent = await responseDb.query("SELECT actor_user_id FROM request_event WHERE request_id=$1 AND event_type='REQUEST_RECOVERED'", [recoveryRequest.id]);
  assert.equal(recoveredEvent.rows[0]?.actor_user_id, recoveringReporter.id);
  const recoveryReplayed = await call(responseUrl, 'requests/recover', {
    method: 'POST', body: { tracking_code: recoveryRequest.tracking_code },
    headers: { Authorization: `Bearer ${reporter.token}`, 'X-Recovery-Code': issue.value.recovery_code, 'Idempotency-Key': key() },
  });
  assertVietnameseError(recoveryReplayed, 404, 'NOT_FOUND');

  const revokeSecret = secret();
  const revokeRequest = await createGuestRequest(revokeSecret);
  const revokeKey = key();
  const revoked = await call(responseUrl, `requests/${revokeRequest.id}/tracking-secret/revoke`, {
    method: 'POST', body: { expected_version: 1 },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': revokeKey },
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.value));
  assert.equal(revoked.value.tracking_secret_revoked, true);
  const revokedEvent = await responseDb.query("SELECT actor_user_id FROM request_event WHERE request_id=$1 AND event_type='TRACKING_SECRET_REVOKED'", [revokeRequest.id]);
  assert.equal(revokedEvent.rows[0]?.actor_user_id, coordinator.id);
  assertVietnameseError(await call(responseUrl, 'requests/track', {
    headers: { 'X-Tracking-Code': revokeRequest.tracking_code, 'X-Tracking-Secret': revokeSecret },
  }), 404, 'NOT_FOUND');
  const revokeDenied = await call(responseUrl, `requests/${revokeRequest.id}/tracking-secret/revoke`, {
    method: 'POST', body: { expected_version: 2 },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(revokeDenied, 403, 'FORBIDDEN');

  const evidenceSecret = secret();
  const evidenceRequest = await createGuestRequest(evidenceSecret);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('c48-t5-evidence')]);
  const evidenceForm = multipart(png);
  const uploadKey = key();
  const evidence = await upload(responseUrl, evidenceRequest, evidenceSecret, evidenceForm, uploadKey);
  assert.equal(evidence.status, 201, JSON.stringify(evidence.value));
  assert.equal(evidence.value.state, 'READY');
  assert.equal(evidence.value.detected_mime, 'image/png');
  assert.equal(evidence.value.size_bytes, png.length);
  const evidenceRow = await responseDb.query('SELECT state,size_bytes,detected_mime,checksum,upload_source_ip_hash FROM evidence_metadata WHERE id=$1', [evidence.value.id]);
  assert.equal(evidenceRow.rows[0].state, 'READY');
  assert.equal(Number(evidenceRow.rows[0].size_bytes), png.length);
  assert.equal(evidenceRow.rows[0].detected_mime, 'image/png');
  assert.match(evidenceRow.rows[0].upload_source_ip_hash, /^v1:/);
  const download = await call(responseUrl, `evidence/${evidence.value.id}/download`, {
    headers: { 'X-Tracking-Code': evidenceRequest.tracking_code, 'X-Tracking-Secret': evidenceSecret },
  });
  assert.equal(download.status, 200, JSON.stringify(download.value));
  assert.equal(download.value.expires_in, 60);
  assert.match(download.value.url, /memory-storage\.test/u);
  const evidenceReplay = await upload(responseUrl, evidenceRequest, evidenceSecret, evidenceForm, uploadKey);
  assert.equal(evidenceReplay.status, 201, JSON.stringify(evidenceReplay.value));
  assert.equal(evidenceReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(evidenceReplay.value, evidence.value);
  const alteredReplay = await upload(responseUrl, evidenceRequest, evidenceSecret, multipart(Buffer.from([...png, 1])), uploadKey);
  assertVietnameseError(alteredReplay, 409, 'IDEMPOTENCY_KEY_REUSED');
  const unauthorizedDownload = await call(responseUrl, `evidence/${evidence.value.id}/download`, {
    headers: { 'X-Tracking-Code': evidenceRequest.tracking_code, 'X-Tracking-Secret': secret() },
  });
  assertVietnameseError(unauthorizedDownload, 404, 'NOT_FOUND');
  const spoofed = await upload(responseUrl, evidenceRequest, evidenceSecret, multipart(Buffer.from('<svg/>')));
  assertVietnameseError(spoofed, 415, 'UNSUPPORTED_MEDIA');
  const evidenceCount = await responseDb.query('SELECT count(*)::int AS count FROM evidence_metadata WHERE request_id=$1', [evidenceRequest.id]);
  assert.equal(evidenceCount.rows[0].count, 1, 'unsupported media must not reserve evidence quota');

  const beforeFailure = await responseDb.query('SELECT status,version,reporter_declared_danger FROM assistance_request WHERE id=$1', [evidenceRequest.id]);
  const identityOfflineTrack = await call(failedStorageUrl, 'requests/track', {
    headers: { Authorization: `Bearer ${reporter.token}`, 'X-Tracking-Code': evidenceRequest.tracking_code, 'X-Tracking-Secret': evidenceSecret },
  });
  assert.equal(identityOfflineTrack.status, 200, JSON.stringify(identityOfflineTrack.value));
  const failedUpload = await upload(failedStorageUrl, evidenceRequest, evidenceSecret, evidenceForm);
  assertVietnameseError(failedUpload, 503, 'STORAGE_UNAVAILABLE');
  const failedRow = await responseDb.query('SELECT state FROM evidence_metadata WHERE request_id=$1 ORDER BY created_at,id', [evidenceRequest.id]);
  assert.deepEqual(failedRow.rows.map((row) => row.state), ['READY', 'FAILED']);
  const afterFailure = await responseDb.query('SELECT status,version,reporter_declared_danger FROM assistance_request WHERE id=$1', [evidenceRequest.id]);
  assert.deepEqual(afterFailure.rows[0], beforeFailure.rows[0], 'storage outage must leave the SOS request unchanged');

  for (let index = 0; index < 4; index++) {
    const accepted = await upload(responseUrl, evidenceRequest, evidenceSecret, evidenceForm);
    assert.equal(accepted.status, 201, JSON.stringify(accepted.value));
  }
  const overQuota = await upload(responseUrl, evidenceRequest, evidenceSecret, evidenceForm);
  assertVietnameseError(overQuota, 409, 'EVIDENCE_LIMIT_REACHED');
  const finalCount = await responseDb.query('SELECT count(*)::int AS count FROM evidence_metadata WHERE request_id=$1 AND state IN (\'READY\',\'PENDING\')', [evidenceRequest.id]);
  assert.equal(finalCount.rows[0].count, 5);

  const orphanId = randomUUID();
  await responseDb.query(
    `INSERT INTO evidence_metadata (id,request_id,object_key,state,declared_bytes,uploader_user_id,created_at)
     VALUES ($1,$2,$3,'PENDING',1,$4,now()-interval '16 minutes')`,
    [orphanId, evidenceRequest.id, `req/${evidenceRequest.id}/${orphanId}`, reporter.id],
  );
  const reconcileDeadline = Date.now() + 50_000;
  let orphanState;
  while (Date.now() < reconcileDeadline) {
    const orphan = await responseDb.query('SELECT state FROM evidence_metadata WHERE id=$1', [orphanId]);
    orphanState = orphan.rows[0]?.state;
    if (orphanState === 'FAILED') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(orphanState, 'FAILED', 'the scheduler must fail stale PENDING evidence');

  console.log('Response T5 integration passed (Identity sessions, tracking, supplements, claim, recovery, revocation, evidence quotas/download, storage failure, and reconciliation).');
} finally {
  await Promise.all([responseDb.end(), identityDb.end()]);
}
