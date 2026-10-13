import assert from 'node:assert/strict';
import { randomBytes, randomUUID, sign } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const db = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
const baseUrl = process.env.C48_RESPONSE_BASE_URL;
const proxyBaseUrl = process.env.C48_RESPONSE_PROXY_BASE_URL;
const privateKey = Buffer.from(process.env.JWT_PRIVATE_KEY ?? '', 'base64');
const origin = process.env.C48_SMOKE_ORIGIN;
const organizationId = '40000000-0000-4000-8000-000000000004';
const userId = '40000000-0000-4000-8000-000000000001';
const fixtureTrigger = 't4_test_fail_subject';
const fixtureFunction = 't4_test_fail_subject_fn';

function key() { return randomUUID(); }
function secret() { return randomBytes(32).toString('base64url'); }

function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: process.env.JWT_ISSUER, aud: process.env.JWT_AUDIENCE, sub: userId,
    sid: randomUUID(), iat: now, exp: now + 300, jti: randomUUID(),
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function gpsLocation(coordinates = [106.5, 10.5]) {
  return {
    type: 'Point', coordinates, source: 'GPS', accuracy_m: 7.5,
    captured_at: new Date().toISOString(),
  };
}

function body(overrides = {}) {
  return {
    incident_category_code: 'T4_FLOOD',
    description: 'Nước ngập trong nhà.',
    people_affected: 2,
    reporter_name: 'Nguyễn An',
    reporter_contact_phone: '+84 912 345 678',
    reporter_declared_danger: true,
    location: gpsLocation(),
    ...overrides,
  };
}

function proxyBody(overrides = {}) {
  return {
    ...body(),
    relationship: 'Người thân',
    information_source: 'Người dân báo tin',
    last_known_situation_at: new Date().toISOString(),
    contactability: 'UNKNOWN',
    ...overrides,
  };
}

async function post(base, { payload, idempotencyKey = key(), trackingSecret, token, cookie, origin, csrf, forwardedIp, path = 'requests' }) {
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey };
  if (trackingSecret) headers['X-Tracking-Secret'] = trackingSecret;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (forwardedIp) headers['X-Forwarded-For'] = forwardedIp;
  const response = await fetch(`${base}/${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  return { status: response.status, headers: response.headers, value, idempotencyKey };
}

function assertVietnameseError(response, status, code) {
  assert.equal(response.status, status, JSON.stringify(response.value));
  assert.equal(response.value.code, code);
  assert.match(response.value.message, /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected a Vietnamese user-facing message');
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

async function assertNoIdempotency(idempotencyKey) {
  const result = await db.query(
    `SELECT 1 FROM idempotency_record WHERE scope_key = 'response.requests.self'
      AND command = 'response.requests.create-self' AND idempotency_key = $1`,
    [idempotencyKey],
  );
  assert.equal(result.rowCount, 0, `unexpected idempotency record for ${idempotencyKey}`);
}

async function assertNoProxyIdempotency(idempotencyKey) {
  const result = await db.query(
    `SELECT 1 FROM idempotency_record WHERE command = 'response.requests.create-proxy' AND idempotency_key = $1`,
    [idempotencyKey],
  );
  assert.equal(result.rowCount, 0, `unexpected proxy idempotency record for ${idempotencyKey}`);
}

async function main() {
  await db.connect();
  await db.query("INSERT INTO incident_category (code, display_name) VALUES ('T4_FLOOD', 'Lũ lụt') ON CONFLICT (code) DO NOTHING");

  const invalidKey = key();
  const missingSecret = await post(baseUrl, { payload: body(), idempotencyKey: invalidKey });
  assertVietnameseError(missingSecret, 400, 'TRACKING_SECRET_INVALID');
  await assertNoIdempotency(invalidKey);

  const coordinatesKey = key();
  const badCoordinates = await post(baseUrl, {
    payload: body({ location: gpsLocation([181, 10.5]) }), idempotencyKey: coordinatesKey, trackingSecret: secret(),
  });
  assertVietnameseError(badCoordinates, 400, 'VALIDATION_FAILED');
  assert.equal(badCoordinates.value.field_errors['location.coordinates'][0], 'COORDINATES_OUT_OF_RANGE');
  await assertNoIdempotency(coordinatesKey);

  const accuracyKey = key();
  const { accuracy_m: _, captured_at: __, ...missingAccuracyLocation } = gpsLocation();
  const missingAccuracy = await post(baseUrl, {
    payload: body({ location: missingAccuracyLocation }), idempotencyKey: accuracyKey, trackingSecret: secret(),
  });
  assertVietnameseError(missingAccuracy, 400, 'VALIDATION_FAILED');
  assert.equal(missingAccuracy.value.field_errors.location[0], 'ACCURACY_REQUIRED');
  await assertNoIdempotency(accuracyKey);

  const captureTimeKey = key();
  const { captured_at: _capturedAt, ...missingCaptureTimeLocation } = gpsLocation();
  const missingCaptureTime = await post(baseUrl, {
    payload: body({ location: missingCaptureTimeLocation }), idempotencyKey: captureTimeKey, trackingSecret: secret(),
  });
  assertVietnameseError(missingCaptureTime, 400, 'VALIDATION_FAILED');
  assert.equal(missingCaptureTime.value.field_errors.location[0], 'ACCURACY_REQUIRED');
  await assertNoIdempotency(captureTimeKey);

  const categoryKey = key();
  const unknownCategory = await post(baseUrl, {
    payload: body({ incident_category_code: 'T4_NOT_A_CATEGORY' }), idempotencyKey: categoryKey, trackingSecret: secret(),
  });
  assertVietnameseError(unknownCategory, 400, 'VALIDATION_FAILED');
  assert.equal(unknownCategory.value.field_errors.incident_category_code[0], 'CATEGORY_UNKNOWN');
  await assertNoIdempotency(categoryKey);

  const massAssignmentKey = key();
  const massAssignment = await post(baseUrl, {
    payload: body({ organization_id: '00000000-0000-4000-8000-000000000099', status: 'RESOLVED', region_code: 'T4_TEST_R1' }),
    idempotencyKey: massAssignmentKey, trackingSecret: secret(),
  });
  assertVietnameseError(massAssignment, 400, 'VALIDATION_FAILED');
  await assertNoIdempotency(massAssignmentKey);

  const firstKey = key();
  const firstSecret = secret();
  const firstBody = body();
  const concurrent = await Promise.all([
    post(baseUrl, { payload: firstBody, idempotencyKey: firstKey, trackingSecret: firstSecret }),
    post(baseUrl, { payload: firstBody, idempotencyKey: firstKey, trackingSecret: firstSecret }),
  ]);
  for (const response of concurrent) {
    assert.equal(response.status, 201, JSON.stringify(response.value));
    assert.equal(response.value.status, 'SUBMITTED');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(response.value).includes(firstSecret), false);
  }
  assert.deepEqual(concurrent[0].value, concurrent[1].value);
  assert.equal(concurrent.filter((response) => response.headers.get('idempotent-replay') === 'true').length, 1);
  const firstId = concurrent[0].value.id;
  assert.match(concurrent[0].value.tracking_code, /^[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.equal(concurrent[0].value.review_lane, 'NORMAL');

  const stored = await db.query(
    `SELECT r.*, s.people_affected, s.location_source, s.location_accuracy_m,
            ST_X(s.location::geometry) AS longitude, ST_Y(s.location::geometry) AS latitude
       FROM assistance_request r JOIN request_subject s ON s.request_id = r.id WHERE r.id = $1`,
    [firstId],
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].reporter_contact_phone, '+84912345678');
  assert.equal(stored.rows[0].reporter_user_id, null);
  assert.equal(stored.rows[0].tracking_secret_hash.startsWith('v1:'), true);
  assert.notEqual(stored.rows[0].tracking_secret_hash, firstSecret);
  assert.equal(stored.rows[0].source_ip_hash.startsWith('v1:'), true);
  assert.equal(stored.rows[0].region_code, 'R1');
  assert.equal(stored.rows[0].organization_id, organizationId);
  assert.equal(stored.rows[0].status, 'SUBMITTED');
  assert.equal(stored.rows[0].review_lane, 'NORMAL');
  assert.equal(stored.rows[0].people_affected, 2);
  assert.equal(stored.rows[0].location_source, 'GPS');
  assert.equal(Number(stored.rows[0].location_accuracy_m), 7.5);
  assert.ok(Math.abs(Number(stored.rows[0].longitude) - 106.5) < 0.000001);
  assert.ok(Math.abs(Number(stored.rows[0].latitude) - 10.5) < 0.000001);
  assert.ok(Math.abs(Date.now() - new Date(stored.rows[0].received_at).getTime()) < 30_000);
  const firstEvent = await db.query(
    `SELECT actor_user_id, event_type, visibility, from_status, to_status, payload
       FROM request_event WHERE request_id = $1`, [firstId],
  );
  assert.equal(firstEvent.rowCount, 1);
  assert.equal(firstEvent.rows[0].event_type, 'REQUEST_SUBMITTED');
  assert.equal(firstEvent.rows[0].visibility, 'REPORTER');
  assert.equal(firstEvent.rows[0].to_status, 'SUBMITTED');
  assert.deepEqual(firstEvent.rows[0].payload, { public_text_code: 'RECEIVED', review_lane: 'NORMAL' });

  const replay = await post(baseUrl, { payload: firstBody, idempotencyKey: firstKey, trackingSecret: firstSecret });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(replay.value, concurrent[0].value);

  await db.query(
    "UPDATE assistance_request SET status='VERIFYING', verifying_since=now(), version=version+1 WHERE id=$1",
    [firstId],
  );
  const transitionedReplay = await post(baseUrl, { payload: firstBody, idempotencyKey: firstKey, trackingSecret: firstSecret });
  assert.equal(transitionedReplay.status, 201, JSON.stringify(transitionedReplay.value));
  assert.equal(transitionedReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(transitionedReplay.value, concurrent[0].value);

  const changedBody = await post(baseUrl, {
    payload: body({ description: 'Đã đổi nội dung.' }), idempotencyKey: firstKey, trackingSecret: firstSecret,
  });
  assertVietnameseError(changedBody, 409, 'IDEMPOTENCY_KEY_REUSED');
  const changedSecret = await post(baseUrl, {
    payload: firstBody, idempotencyKey: firstKey, trackingSecret: secret(),
  });
  assertVietnameseError(changedSecret, 409, 'IDEMPOTENCY_KEY_REUSED');
  const reusedSecret = await post(baseUrl, {
    payload: firstBody, idempotencyKey: key(), trackingSecret: firstSecret,
  });
  assertVietnameseError(reusedSecret, 409, 'TRACKING_SECRET_IN_USE');
  const firstRows = await db.query('SELECT count(*)::int AS count FROM assistance_request WHERE organization_id=$1', [organizationId]);
  assert.equal(firstRows.rows[0].count, 1);

  const secondPhone = secret();
  const second = await post(baseUrl, { payload: body(), trackingSecret: secondPhone, forwardedIp: '198.51.100.10' });
  assert.equal(second.status, 201);
  assert.equal(second.value.review_lane, 'NORMAL');
  const thirdPhone = secret();
  const third = await post(baseUrl, { payload: body(), trackingSecret: thirdPhone, forwardedIp: '198.51.100.10' });
  assert.equal(third.status, 201);
  assert.equal(third.value.review_lane, 'RATE_LIMITED_REVIEW');

  const bearer = accessToken();
  const unauthenticatedProxyKey = key();
  const unauthenticatedProxy = await post(baseUrl, {
    payload: proxyBody(), idempotencyKey: unauthenticatedProxyKey, path: 'requests/proxy',
  });
  assertVietnameseError(unauthenticatedProxy, 401, 'UNAUTHENTICATED');
  await assertNoProxyIdempotency(unauthenticatedProxyKey);

  const identityDownProxyKey = key();
  const identityDownProxy = await post(baseUrl, {
    payload: proxyBody(), idempotencyKey: identityDownProxyKey, token: bearer, path: 'requests/proxy',
  });
  assertVietnameseError(identityDownProxy, 503, 'IDENTITY_UNAVAILABLE');
  await assertNoProxyIdempotency(identityDownProxyKey);

  const manualBody = body({
    reporter_contact_phone: null,
    location: { type: 'Point', coordinates: [108, 12], source: 'MANUAL_PIN' },
  });
  const signedIn = await post(baseUrl, { payload: manualBody, token: bearer, forwardedIp: '198.51.100.20' });
  assert.equal(signedIn.status, 201, JSON.stringify(signedIn.value));
  const signedRow = await db.query('SELECT reporter_user_id, tracking_secret_hash, region_code FROM assistance_request WHERE id=$1', [signedIn.value.id]);
  assert.equal(signedRow.rows[0].reporter_user_id, userId);
  assert.equal(signedRow.rows[0].tracking_secret_hash, null);
  assert.equal(signedRow.rows[0].region_code, null);
  const signedSubject = await db.query('SELECT location_source, location_accuracy_m, location_captured_at FROM request_subject WHERE request_id=$1', [signedIn.value.id]);
  assert.equal(signedSubject.rows[0].location_source, 'MANUAL_PIN');
  assert.equal(signedSubject.rows[0].location_accuracy_m, null);
  assert.equal(signedSubject.rows[0].location_captured_at, null);

  await db.query(
    `INSERT INTO region_boundary (region_code, geom) VALUES
       ('T4_AMBIG_A', ST_Multi(ST_GeomFromText('POLYGON((106.4 10.4,106.6 10.4,106.6 10.6,106.4 10.6,106.4 10.4))',4326))),
       ('T4_AMBIG_B', ST_Multi(ST_GeomFromText('POLYGON((106.4 10.4,106.6 10.4,106.6 10.6,106.4 10.6,106.4 10.4))',4326)))`,
  );
  const ambiguous = await post(baseUrl, {
    payload: body({ location: gpsLocation([106.5, 10.5]), reporter_contact_phone: null }),
    trackingSecret: secret(), forwardedIp: '198.51.100.30',
  });
  assert.equal(ambiguous.status, 201, JSON.stringify(ambiguous.value));
  const ambiguousRegion = await db.query('SELECT region_code FROM assistance_request WHERE id=$1', [ambiguous.value.id]);
  assert.equal(ambiguousRegion.rows[0].region_code, null, 'overlapping administrative boundaries must be routed as unassigned');

  const csrfToken = randomBytes(24).toString('base64url');
  const cookieRequest = await post(baseUrl, {
    payload: body({ reporter_contact_phone: null }), token: undefined,
    cookie: `c48_pre=preflight; c48_csrf=${csrfToken}; c48_access=${bearer}`,
    origin, csrf: csrfToken,
    forwardedIp: '198.51.100.21',
  });
  assert.equal(cookieRequest.status, 201, JSON.stringify(cookieRequest.value));
  assert.equal(cookieRequest.value.review_lane, 'RATE_LIMITED_REVIEW', 'the global SOS threshold must retain, but flag, the next request');
  const cookieRow = await db.query('SELECT reporter_user_id FROM assistance_request WHERE id=$1', [cookieRequest.value.id]);
  assert.equal(cookieRow.rows[0].reporter_user_id, userId);

  const csrfKey = key();
  const missingCsrf = await post(baseUrl, {
    payload: body({ reporter_contact_phone: null }), idempotencyKey: csrfKey,
    cookie: `c48_pre=preflight; c48_csrf=${csrfToken}; c48_access=${bearer}`,
    origin: 'https://attacker.test', csrf: csrfToken,
  });
  assertVietnameseError(missingCsrf, 403, 'CSRF_INVALID');
  await assertNoIdempotency(csrfKey);

  const bearerOriginKey = key();
  const bearerOrigin = await post(baseUrl, {
    payload: body({ reporter_contact_phone: null }), idempotencyKey: bearerOriginKey,
    token: bearer, origin,
  });
  assertVietnameseError(bearerOrigin, 403, 'FORBIDDEN');
  await assertNoIdempotency(bearerOriginKey);

  const beforeRollback = await db.query('SELECT count(*)::int AS count FROM assistance_request WHERE organization_id=$1', [organizationId]);
  const secretsBeforeRollback = await db.query('SELECT count(*)::int AS count FROM assistance_request WHERE tracking_secret_hash IS NOT NULL AND organization_id=$1', [organizationId]);
  await db.query(`CREATE OR REPLACE FUNCTION ${fixtureFunction}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ST_X(NEW.location::geometry) BETWEEN 106.7765 AND 106.7775 THEN
        RAISE EXCEPTION 'T4 integration rollback probe';
      END IF;
      RETURN NEW;
    END $$`);
  await db.query(`CREATE TRIGGER ${fixtureTrigger} BEFORE INSERT ON request_subject FOR EACH ROW EXECUTE FUNCTION ${fixtureFunction}()`);
  const rollbackKey = key();
  const rollbackSecret = secret();
  let rollback;
  try {
    rollback = await post(baseUrl, {
      payload: body({ location: { type: 'Point', coordinates: [106.777, 10.555], source: 'MANUAL_PIN' } }),
      idempotencyKey: rollbackKey, trackingSecret: rollbackSecret,
    });
  } finally {
    await db.query(`DROP TRIGGER IF EXISTS ${fixtureTrigger} ON request_subject`);
    await db.query(`DROP FUNCTION IF EXISTS ${fixtureFunction}()`);
  }
  assertVietnameseError(rollback, 500, 'INTERNAL_ERROR');
  await assertNoIdempotency(rollbackKey);
  const afterRollback = await db.query('SELECT count(*)::int AS count FROM assistance_request WHERE organization_id=$1', [organizationId]);
  assert.equal(afterRollback.rows[0].count, beforeRollback.rows[0].count);
  const secretsAfterRollback = await db.query('SELECT count(*)::int AS count FROM assistance_request WHERE tracking_secret_hash IS NOT NULL AND organization_id=$1', [organizationId]);
  assert.equal(secretsAfterRollback.rows[0].count, secretsBeforeRollback.rows[0].count);

  await db.query('UPDATE assistance_request SET received_at = clock_timestamp() - interval \'2 minutes\' WHERE organization_id = $1', [organizationId]);
  await db.query(
    `UPDATE idempotency_record SET created_at = clock_timestamp() - interval '2 minutes'
      WHERE scope_key='response.requests.self' AND command='response.requests.create-self'`,
  );
  let throttled = false;
  let hardRejected;
  const acceptedProxyResponses = [];
  for (let attempt = 0; attempt < 10 && !hardRejected; attempt++) {
    const response = await post(proxyBaseUrl, {
      payload: body({ reporter_contact_phone: null }), trackingSecret: secret(),
    });
    if (response.status === 429) hardRejected = response;
    else {
      assert.equal(response.status, 201, JSON.stringify(response.value));
      acceptedProxyResponses.push(response.value);
      if (response.value.review_lane === 'RATE_LIMITED_REVIEW') throttled = true;
    }
  }
  assert.equal(throttled, true, 'expected Nginx or global soft throttling to put an accepted SOS in review');
  assert.equal(acceptedProxyResponses[0]?.review_lane, 'NORMAL');
  assert.equal(acceptedProxyResponses[1]?.review_lane, 'NORMAL');
  assert.equal(acceptedProxyResponses[2]?.review_lane, 'RATE_LIMITED_REVIEW', 'the per-IP soft threshold must flag the third accepted SOS');
  assert.ok(hardRejected, 'expected the per-IP hard ceiling to reject a burst');
  assert.equal(hardRejected.value.code, 'SOS_RATE_CEILING');
  assert.match(hardRejected.value.message, /113\/114\/115/u);
  assert.ok(hardRejected.value.correlation_id);
  assert.equal(hardRejected.headers.get('cache-control'), 'no-store');
  await assertNoIdempotency(hardRejected.idempotencyKey);
  for (const path of ['REQUESTS', 'requests/']) {
    const alias = await post(proxyBaseUrl, {
      payload: body({ reporter_contact_phone: null }), trackingSecret: secret(), path,
    });
    assertVietnameseError(alias, 429, 'SOS_RATE_CEILING');
    await assertNoIdempotency(alias.idempotencyKey);
  }
  let proxyCeiling;
  for (let attempt = 0; attempt < 8 && !proxyCeiling; attempt++) {
    const response = await post(proxyBaseUrl, {
      payload: proxyBody(), path: 'requests/proxy',
    });
    if (response.status === 429) proxyCeiling = response;
    else assertVietnameseError(response, 401, 'UNAUTHENTICATED');
  }
  assert.ok(proxyCeiling, 'the PROXY intake path must use the SOS hard per-IP ceiling');
  assertVietnameseError(proxyCeiling, 429, 'SOS_RATE_CEILING');
  await assertNoProxyIdempotency(proxyCeiling.idempotencyKey);
  const proxyKeys = await db.query(
    `SELECT count(*)::int AS count FROM idempotency_record WHERE scope_key='response.requests.self'
      AND command='response.requests.create-self' AND created_at >= now() - interval '2 minutes'`,
  );
  const acceptedProxyCount = await db.query(
    `SELECT count(*)::int AS count FROM assistance_request WHERE organization_id=$1
      AND received_at >= now() - interval '2 minutes'`, [organizationId],
  );
  assert.equal(proxyKeys.rows[0].count, acceptedProxyCount.rows[0].count);

  console.log('Response SELF intake integration passed (guest, signed-in without Identity, CSRF, replay, transaction, throttle).');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await db.end().catch(() => {});
});
