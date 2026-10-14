import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = requiredEnv('C48_RESPONSE_BASE_URL').replace(/\/+$/u, '');
const logisticsUrl = requiredEnv('C48_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const responseDb = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const logisticsDb = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const organizationId = requiredEnv('DEMO_INTAKE_ORGANIZATION_ID');
const suffix = randomBytes(5).toString('hex').toUpperCase();
const regionCode = `T16_${suffix}`;
const categoryCode = `T16_FLOOD_${suffix}`;
let identityIp = 1 + randomBytes(1)[0] % 250;
const recoveryLock = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const responseLock = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const logisticsLock = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const operationActors = new Map();
let logisticsStopped = false;

function mainCompose(args, env = process.env) {
  return execFileSync('docker', ['compose', '-p', 'c48', '--env-file', fileURLToPath(new URL('../../.env', import.meta.url)),
    '-f', fileURLToPath(new URL('../../infra/compose.yaml', import.meta.url)), ...args], { stdio: 'pipe', env, encoding: 'utf8' });
}

function responseService(schedulerEnabled) {
  mainCompose(['up', '-d', '--no-deps', '--force-recreate', '--wait', 'response-api'],
    { ...process.env, SCHEDULER_ENABLED: String(schedulerEnabled) });
}

function logisticsService(action) {
  mainCompose([action, ...(action === 'start' ? ['--wait'] : []), 'logistics-api']);
}

async function waitFor(check, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out: ${label}`);
}

async function recoveryFence(locked) {
  await recoveryLock.query(locked
    ? "SELECT pg_advisory_lock(hashtext('response-resolution-recovery'))"
    : "SELECT pg_advisory_unlock(hashtext('response-resolution-recovery'))");
}

async function waitForBlocked(database, blocker, minimum = 1) {
  await waitFor(async () => {
    const result = await database.query(
      `WITH RECURSIVE blocked AS (
         SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
         UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
       ) SELECT count(*)::int AS count FROM blocked`, [blocker]);
    return result.rows[0].count >= minimum;
  }, `${minimum} primary API transaction(s) blocked`, 40_000);
}

async function cycleCommand(action, requestId, workCycle, operationId) {
  const issued = await call(identityUrl, 'internal/token', { method: 'POST', body: {
    client_id: requiredEnv('RESPONSE_SERVICE_CLIENT_ID'), client_secret: requiredEnv('RESPONSE_SERVICE_CLIENT_SECRET'), audience: 'logistics',
  } });
  expectSuccess(issued);
  return call(logisticsUrl, `internal/requests/${requestId}/cycles/${workCycle}/${action}`, {
    method: 'POST', actor: { token: issued.value.access_token }, body: {
      intent_id: operationId, ...(action === 'seal' ? { outcome_basis: 'NO_ACTION_REQUIRED' } : {}),
    },
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function key() { return randomUUID(); }

async function call(base, path, { method = 'GET', body, actor, idempotencyKey, headers: extraHeaders = {} } = {}) {
  const headers = {
    ...extraHeaders,
    ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
  const response = await fetch(`${base}/${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
  return { status: response.status, headers: response.headers, value };
}

async function command(base, path, actor, body, idempotencyKey = key(), method = 'POST') {
  const result = await call(base, path, { method, actor, body, idempotencyKey });
  if (base === responseUrl && /\/(resolve|cancel)$/u.test(path) && result.value?.operation_id) {
    operationActors.set(result.value.operation_id, actor);
  }
  return result;
}

function expectSuccess(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.value));
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

function expectVietnameseError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.value));
  assert.equal(result.value?.code, code, JSON.stringify(result.value));
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese user-facing copy');
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

async function registerAndLogin(label, roles = []) {
  const accountSuffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t16${label}${accountSuffix}`,
    display_name: `Người dùng kiểm thử T16 ${label} ${accountSuffix}`,
    password: `Response T16 test ${accountSuffix}!`,
  };
  const sourceIp = `198.51.100.${identityIp++}`;
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials, idempotencyKey: key(), headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  for (const role of roles) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
       VALUES ($1,$2,'ORGANIZATION',$3)`, [registered.value.user.id, role, organizationId],
    );
  }
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: registered.value.user.id, token: login.value.access_token };
}

async function createRequest(reporter, coordinator) {
  const created = await command(responseUrl, 'requests', reporter, {
    incident_category_code: categoryCode,
    description: 'Nước dâng gần khu dân cư, cần xác minh hỗ trợ.',
    people_affected: 2,
    reporter_name: 'Nguyễn An T16',
    reporter_contact_phone: '+84912345678',
    reporter_declared_danger: false,
    location: { type: 'Point', coordinates: [-120, -20], source: 'GPS', accuracy_m: 8, captured_at: new Date().toISOString() },
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  const started = await command(responseUrl, `requests/${created.value.id}/start-verification`, coordinator, { expected_version: 1 });
  expectSuccess(started);
  const contact = await command(responseUrl, `requests/${created.value.id}/contact-attempts`, coordinator, {
    contact_target: 'REPORTER', outcome: 'REACHED', note: 'Đã xác nhận vị trí và nhu cầu.',
  });
  expectSuccess(contact, 201);
  const verified = await command(responseUrl, `requests/${created.value.id}/verify`, coordinator, {
    expected_version: 3, basis: 'CONTACT_CONFIRMED', source_refs: { contact_attempt_ids: [contact.value.id] },
  });
  expectSuccess(verified);
  assert.equal(verified.value.status, 'VERIFIED');
  const verifiedState = await requestState(created.value.id);
  const triaged = await command(responseUrl, `requests/${created.value.id}/triage`, coordinator, {
    expected_version: Number(verifiedState.version), priority: 'P3', priority_basis: 'COMPLETE',
  });
  expectSuccess(triaged);
  assert.equal(triaged.value.status, 'TRIAGED');
  return created.value;
}

async function requestState(id) {
  const result = await responseDb.query(
    `SELECT status,version,work_cycle,logistics_admitted_at,resolution_seal_id,resolved_at
       FROM assistance_request WHERE id=$1`, [id],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function createNeed(coordinator, request, itemId) {
  const state = await requestState(request.id);
  const created = await command(logisticsUrl, 'needs', coordinator, {
    request_id: request.id, work_cycle: Number(state.work_cycle), item_id: itemId, quantity: '2.00',
  });
  expectSuccess(created, 201);
  assert.ok((await requestState(request.id)).logistics_admitted_at);
  return created.value;
}

async function settledRequest(reporter, coordinator, itemId) {
  const request = await createRequest(reporter, coordinator);
  const need = await createNeed(coordinator, request, itemId);
  expectSuccess(await command(logisticsUrl, `needs/${need.id}/cancel`, coordinator, {
    expected_version: 1, reason: 'Không còn nhu cầu sau khi xác minh.',
  }));
  return request;
}

async function pendingResolution(request, coordinator) {
  await logisticsLock.query('BEGIN');
  try {
    await logisticsLock.query('SELECT id FROM fulfillment_cycle WHERE request_id=$1 FOR UPDATE', [request.id]);
    const state = await requestState(request.id);
    const result = await command(responseUrl, `requests/${request.id}/resolve`, coordinator, {
      expected_version: Number(state.version), resolution_reason: 'Đã rà soát và không cần hỗ trợ thêm.', outcome_basis: 'NO_ACTION_REQUIRED',
    });
    expectSuccess(result, 202);
    const operation = await call(responseUrl, `operations/${result.value.operation_id}`, { actor: coordinator });
    expectSuccess(operation);
    assert.equal(operation.value.state, 'PENDING');
    assert.equal(operation.value.request_status, 'RESOLVING');
    return operation.value;
  } finally {
    await logisticsLock.query('ROLLBACK');
  }
}

await Promise.all([responseDb.connect(), logisticsDb.connect(), identityDb.connect(), recoveryLock.connect(), responseLock.connect(), logisticsLock.connect()]);
try {
  await recoveryFence(true);
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind)
     VALUES ($1,$2,'COORDINATION') ON CONFLICT (id) DO NOTHING`, [organizationId, `T16 test organization ${suffix}`],
  );
  await identityDb.query('INSERT INTO region (code,name) VALUES ($1,$2)', [regionCode, 'Khu vực kiểm thử T16']);
  await responseDb.query('INSERT INTO incident_category (code,display_name) VALUES ($1,$2)', [categoryCode, 'Lũ lụt']);
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ($1,ST_Multi(ST_GeomFromText('POLYGON((-121 -21,-119 -21,-119 -19,-121 -19,-121 -21))',4326)))`, [regionCode],
  );

  const coordinator = await registerAndLogin('coordinator', ['COORDINATOR', 'OPERATIONS_MANAGER']);
  const reporter = await registerAndLogin('reporter');
  const itemType = await command(logisticsUrl, 'item-types', coordinator, {
    code: `T16_${suffix}`, display_name: 'Vật tư kiểm thử T16',
  });
  expectSuccess(itemType, 201);
  const unit = await command(logisticsUrl, 'units', coordinator, { code: `T16_U_${suffix}`, display_name: 'Thùng T16', scale: 2 });
  expectSuccess(unit, 201);
  const item = await command(logisticsUrl, 'items', coordinator, {
    item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư T16 ${suffix}`,
  });
  expectSuccess(item, 201);

  // An empty, admitted cycle can resolve and seal; replay keeps the first 202 after the request is terminal.
  const resolutionRequest = await createRequest(reporter, coordinator);
  const settledNeed = await createNeed(coordinator, resolutionRequest, item.value.id);
  const cancelledNeed = await command(logisticsUrl, `needs/${settledNeed.id}/cancel`, coordinator, {
    expected_version: 1, reason: 'Không còn cần mặt hàng này.',
  });
  expectSuccess(cancelledNeed);
  const resolutionState = await requestState(resolutionRequest.id);
  const resolveKey = key();
  const resolveBody = {
    expected_version: Number(resolutionState.version),
    resolution_reason: 'Không còn nhu cầu cứu trợ sau khi rà soát.',
    outcome_basis: 'NO_ACTION_REQUIRED',
  };
  const resolved = await command(responseUrl, `requests/${resolutionRequest.id}/resolve`, coordinator, resolveBody, resolveKey);
  expectSuccess(resolved, 202);
  assert.deepEqual(Object.keys(resolved.value).sort(), ['operation_id', 'state']);
  const operation = await call(responseUrl, `operations/${resolved.value.operation_id}`, { actor: coordinator });
  expectSuccess(operation);
  assert.equal(operation.value.state, 'COMPLETED');
  const resolvedState = await requestState(resolutionRequest.id);
  assert.equal(resolvedState.status, 'RESOLVED');
  assert.equal(resolvedState.resolution_seal_id, resolved.value.operation_id);
  const sealedCycle = await logisticsDb.query(
    'SELECT state FROM fulfillment_cycle WHERE request_id=$1 AND work_cycle=$2',
    [resolutionRequest.id, Number(resolvedState.work_cycle)],
  );
  assert.deepEqual(sealedCycle.rows, [{ state: 'SEALED' }]);
  const replay = await command(responseUrl, `requests/${resolutionRequest.id}/resolve`, coordinator, resolveBody, resolveKey);
  expectSuccess(replay, 202);
  assert.equal(replay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(replay.value, resolved.value);

  const close = await command(responseUrl, `requests/${resolutionRequest.id}/close`, coordinator, {
    expected_version: Number(resolvedState.version),
  });
  expectSuccess(close);
  const closedState = await requestState(resolutionRequest.id);
  assert.equal(closedState.status, 'CLOSED');
  const reopened = await command(responseUrl, `requests/${resolutionRequest.id}/reopen`, coordinator, {
    expected_version: Number(closedState.version), reason: 'Mở lại để tiếp tục theo dõi tình hình.',
  });
  expectSuccess(reopened);
  const reopenedState = await requestState(resolutionRequest.id);
  assert.equal(reopenedState.status, 'TRIAGED');
  assert.equal(Number(reopenedState.work_cycle), Number(closedState.work_cycle) + 1);
  assert.equal(reopenedState.logistics_admitted_at, null);
  assert.equal(reopenedState.resolution_seal_id, null);
  assert.equal(reopenedState.resolved_at, null);

  // Cancellation freezes an active fulfillment cycle and prevents increased commitments to its needs.
  const cancellationRequest = await createRequest(reporter, coordinator);
  const openNeed = await createNeed(coordinator, cancellationRequest, item.value.id);
  const beforeCancel = await requestState(cancellationRequest.id);
  const cancellationKey = key();
  const cancellationBody = {
    expected_version: Number(beforeCancel.version), reason: 'Không thể tiếp tục xử lý yêu cầu này.',
  };
  const cancelled = await command(responseUrl, `requests/${cancellationRequest.id}/cancel`, coordinator, cancellationBody, cancellationKey);
  expectSuccess(cancelled, 202);
  assert.deepEqual(Object.keys(cancelled.value).sort(), ['operation_id', 'state']);
  const cancellationOperation = await call(responseUrl, `operations/${cancelled.value.operation_id}`, { actor: coordinator });
  expectSuccess(cancellationOperation);
  assert.equal(cancellationOperation.value.state, 'COMPLETED');
  assert.equal((await requestState(cancellationRequest.id)).status, 'CANCELLED');
  const frozenCycle = await logisticsDb.query(
    'SELECT state FROM fulfillment_cycle WHERE request_id=$1 AND work_cycle=$2',
    [cancellationRequest.id, Number(beforeCancel.work_cycle)],
  );
  assert.deepEqual(frozenCycle.rows, [{ state: 'FROZEN' }]);
  const cancellationReplay = await command(
    responseUrl, `requests/${cancellationRequest.id}/cancel`, coordinator, cancellationBody, cancellationKey,
  );
  expectSuccess(cancellationReplay, 202);
  assert.equal(cancellationReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(cancellationReplay.value, cancelled.value);
  const increase = await command(logisticsUrl, `needs/${openNeed.id}/increase`, coordinator, {
    expected_version: 1, quantity: '3.00', reason: 'Kiểm tra chu kỳ đã đóng băng.',
  });
  expectVietnameseError(increase, 409, 'CYCLE_FROZEN');

  // TC-BE-07: an outage is visible, cannot resolve, and a retry/replay has one terminal effect.
  const outageRequest = await settledRequest(reporter, coordinator, item.value.id);
  const outageState = await requestState(outageRequest.id);
  const outageKey = key();
  const outageBody = { expected_version: Number(outageState.version), resolution_reason: 'Không còn nhu cầu hỗ trợ.', outcome_basis: 'NO_ACTION_REQUIRED' };
  logisticsStopped = true;
  logisticsService('stop');
  try {
    expectVietnameseError(await command(responseUrl, `requests/${outageRequest.id}/resolve`, coordinator, outageBody, outageKey), 503, 'LOGISTICS_UNAVAILABLE');
    assert.notEqual((await requestState(outageRequest.id)).status, 'RESOLVED');
    const failedKey = await responseDb.query('SELECT count(*)::int AS count FROM idempotency_record WHERE idempotency_key=$1', [outageKey]);
    assert.equal(failedKey.rows[0].count, 0);
  } finally {
    logisticsService('start');
    logisticsStopped = false;
  }
  // The existing client breaker may briefly remain open after the service returns.
  let retried;
  await waitFor(async () => {
    retried = await command(responseUrl, `requests/${outageRequest.id}/resolve`, coordinator, outageBody, outageKey);
    if (retried.status === 503) { expectVietnameseError(retried, 503, 'LOGISTICS_UNAVAILABLE'); return false; }
    expectSuccess(retried, 202);
    return true;
  }, 'Logistics outage recovery');
  const outageReplay = await command(responseUrl, `requests/${outageRequest.id}/resolve`, coordinator, outageBody, outageKey);
  expectSuccess(outageReplay, 202);
  assert.equal(outageReplay.headers.get('idempotent-replay'), 'true');
  assert.deepEqual(outageReplay.value, retried.value);
  const outageEffects = await responseDb.query(
    `SELECT count(*)::int AS intents,(SELECT count(*)::int FROM request_event WHERE request_id=$1 AND event_type='REQUEST_RESOLVED') AS resolved_events
       FROM resolution_intent WHERE request_id=$1`, [outageRequest.id]);
  assert.deepEqual(outageEffects.rows, [{ intents: 1, resolved_events: 1 }]);

  // R-03: kill the real Response process after seal while its first finalizer CAS is blocked.
  const crashRequest = await settledRequest(reporter, coordinator, item.value.id);
  const crashOperation = await pendingResolution(crashRequest, coordinator);
  await responseLock.query('BEGIN');
  try {
    await responseLock.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
    await responseLock.query('SELECT id FROM resolution_intent WHERE id=$1 FOR UPDATE', [crashOperation.operation_id]);
    const lockPid = (await responseLock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    expectSuccess(await cycleCommand('seal', crashRequest.id, crashOperation.work_cycle, crashOperation.operation_id));
    await recoveryFence(false);
    await waitForBlocked(responseDb, lockPid);
    const blockedCas = mainCompose(['exec', '-T', 'postgres', 'psql', '-X', '-At', '-U', 'postgres', '-d', 'c48_response', '-c',
      `SELECT count(*) FROM pg_stat_activity WHERE application_name='c48_response' AND wait_event_type='Lock'
        AND query LIKE 'UPDATE resolution_intent SET state=''COMPLETED''%'
        AND ${Number(lockPid)}=ANY(pg_blocking_pids(pid))`]);
    assert.equal(Number(blockedCas.trim()), 1, 'Response finalizer must be blocked on its first CAS after seal');
    assert.deepEqual((await logisticsDb.query('SELECT state FROM fulfillment_cycle WHERE request_id=$1', [crashRequest.id])).rows, [{ state: 'SEALED' }]);
    const crashBoundary = await call(responseUrl, `operations/${crashOperation.operation_id}`, { actor: coordinator });
    expectSuccess(crashBoundary);
    assert.equal(crashBoundary.value.state, 'PENDING');
    assert.equal(crashBoundary.value.request_status, 'RESOLVING');
    mainCompose(['kill', '-s', 'SIGKILL', 'response-api']);
    const killed = JSON.parse(mainCompose(['ps', '--all', '--format', 'json', 'response-api']).trim());
    assert.equal(killed.State, 'exited');
    assert.equal(killed.ExitCode, 137, 'the existing Response process must actually be SIGKILLed');
    await recoveryFence(true);
  } finally {
    await responseLock.query('ROLLBACK');
  }
  responseService(true);
  assert.equal((await requestState(crashRequest.id)).status, 'RESOLVING');
  assert.equal((await responseDb.query('SELECT state FROM resolution_intent WHERE id=$1', [crashOperation.operation_id])).rows[0].state, 'PENDING');
  await recoveryFence(false);
  await waitFor(async () => (await requestState(crashRequest.id)).status === 'RESOLVED', 'restarted worker commits the same sealed pending intent');
  await recoveryFence(true);
  const recovered = await call(responseUrl, `operations/${crashOperation.operation_id}`, { actor: coordinator });
  expectSuccess(recovered);
  assert.equal(recovered.value.state, 'COMPLETED');
  assert.equal((await requestState(crashRequest.id)).resolution_seal_id, crashOperation.operation_id);
  assert.equal((await responseDb.query("SELECT count(*)::int AS count FROM request_event WHERE request_id=$1 AND event_type='REQUEST_RESOLVED'", [crashRequest.id])).rows[0].count, 1);
  console.log('T16 R-03 SIGKILL after seal and before blocked Response commit: passed.');

  // Abort installs a durable fence; delayed seal/unseal calls cannot affect a newer intent.
  const abortRequest = await settledRequest(reporter, coordinator, item.value.id);
  const abortOperation = await pendingResolution(abortRequest, coordinator);
  const abort = await command(responseUrl, `operations/${abortOperation.operation_id}/abort`, coordinator, {
    expected_version: Number((await requestState(abortRequest.id)).version), reason: 'Cần kiểm tra lại trước khi hoàn tất.',
  });
  expectSuccess(abort, 202);
  assert.equal((await call(responseUrl, `operations/${abortOperation.operation_id}`, { actor: coordinator })).value.state, 'ABORTED');
  expectVietnameseError(await cycleCommand('seal', abortRequest.id, abortOperation.work_cycle, abortOperation.operation_id), 409, 'STATE_TRANSITION_INVALID');
  const afterAbort = await requestState(abortRequest.id);
  expectSuccess(await command(responseUrl, `requests/${abortRequest.id}/resolve`, coordinator, {
    expected_version: Number(afterAbort.version), resolution_reason: 'Đã kiểm tra lại đầy đủ.', outcome_basis: 'NO_ACTION_REQUIRED',
  }), 202);
  expectVietnameseError(await cycleCommand('unseal', abortRequest.id, abortOperation.work_cycle, abortOperation.operation_id), 409, 'STATE_TRANSITION_INVALID');
  assert.deepEqual((await logisticsDb.query('SELECT state FROM fulfillment_cycle WHERE request_id=$1', [abortRequest.id])).rows, [{ state: 'SEALED' }]);

  // Prevalidated needs resume only after the real cancel/freeze or resolve/seal has committed.
  for (const action of ['cancel', 'resolve']) {
    const delayedRequest = action === 'resolve'
      ? await settledRequest(reporter, coordinator, item.value.id)
      : await createRequest(reporter, coordinator);
    if (action === 'cancel') await createNeed(coordinator, delayedRequest, item.value.id);
    const delayedState = await requestState(delayedRequest.id);
    const delayedKey = key();
    await logisticsLock.query('BEGIN');
    let delayedNeed;
    try {
      await logisticsLock.query(`INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash)
        VALUES ($1,'logistics.needs.create',$2,'t16-rolled-back-lock')`, [`user:${coordinator.id}`, delayedKey]);
      const lockPid = (await logisticsLock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      delayedNeed = command(logisticsUrl, 'needs', coordinator, {
        request_id: delayedRequest.id, work_cycle: Number(delayedState.work_cycle), item_id: item.value.id, quantity: '2.00',
      }, delayedKey);
      await waitForBlocked(logisticsDb, lockPid);
      expectSuccess(await command(responseUrl, `requests/${delayedRequest.id}/${action}`, coordinator, {
        expected_version: Number((await requestState(delayedRequest.id)).version),
        ...(action === 'cancel' ? { reason: 'Không tiếp tục yêu cầu sau khi xác minh.' }
          : { resolution_reason: 'Không còn nhu cầu sau khi xác minh.', outcome_basis: 'NO_ACTION_REQUIRED' }),
      }), 202);
      assert.equal((await requestState(delayedRequest.id)).status, action === 'cancel' ? 'CANCELLED' : 'RESOLVED');
      assert.deepEqual((await logisticsDb.query('SELECT state FROM fulfillment_cycle WHERE request_id=$1', [delayedRequest.id])).rows,
        [{ state: action === 'cancel' ? 'FROZEN' : 'SEALED' }]);
    } finally {
      await logisticsLock.query('ROLLBACK');
    }
    const rejectedNeed = await delayedNeed;
    expectVietnameseError(rejectedNeed, 409, action === 'cancel' ? 'CYCLE_FROZEN' : 'CYCLE_SEALED');
    if (action === 'resolve') assert.equal(rejectedNeed.value.message, 'Chu kỳ xử lý đã được niêm phong.');
    assert.equal((await logisticsDb.query(`SELECT count(*)::int AS count FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE c.request_id=$1`, [delayedRequest.id])).rows[0].count, 1);
  }
  console.log('T16 TC-BE-17 delayed admitted need after RESOLVED/SEALED: passed.');

  // The real finalizer owns the intent CAS before abort starts; exactly its terminal event wins.
  const raceRequest = await settledRequest(reporter, coordinator, item.value.id);
  const raceOperation = await pendingResolution(raceRequest, coordinator);
  expectSuccess(await cycleCommand('seal', raceRequest.id, raceOperation.work_cycle, raceOperation.operation_id));
  await responseLock.query('BEGIN');
  let racedAbort;
  try {
    await responseLock.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
    await responseLock.query('SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE', [raceRequest.id]);
    const lockPid = (await responseLock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await recoveryFence(false);
    await waitForBlocked(responseDb, lockPid);
    racedAbort = command(responseUrl, `operations/${raceOperation.operation_id}/abort`, coordinator, {
      expected_version: Number((await requestState(raceRequest.id)).version), reason: 'Thử hủy đồng thời khi hoàn tất.',
    });
    await waitForBlocked(responseDb, lockPid, 2);
  } finally {
    await responseLock.query('ROLLBACK');
  }
  expectVietnameseError(await racedAbort, 409, 'VERSION_CONFLICT');
  await recoveryFence(true);
  assert.equal((await requestState(raceRequest.id)).status, 'RESOLVED');
  const raceEvents = await responseDb.query(`SELECT event_type,count(*)::int AS count FROM request_event WHERE request_id=$1
    AND event_type IN ('REQUEST_RESOLVED','RESOLUTION_ABORT_REQUESTED','RESOLUTION_ABORTED') GROUP BY event_type`, [raceRequest.id]);
  assert.deepEqual(raceEvents.rows, [{ event_type: 'REQUEST_RESOLVED', count: 1 }]);

  console.log('T16 Response resolution/cancellation HTTP and PostgreSQL smoke passed.');
} finally {
  try {
    if (logisticsStopped) logisticsService('start');
    responseService(false);
    await Promise.all([responseLock.query('ROLLBACK').catch(() => undefined), logisticsLock.query('ROLLBACK').catch(() => undefined)]);
    for (const [operationId, actor] of operationActors) {
      const operation = await call(responseUrl, `operations/${operationId}`, { actor });
      if (['PENDING', 'ABORTING'].includes(operation.value?.state)) {
        const state = await requestState(operation.value.request_id);
        expectSuccess(await command(responseUrl, `operations/${operationId}/abort`, actor, {
          expected_version: Number(state.version), reason: 'Dọn thao tác kiểm thử chưa hoàn tất.',
        }), 202);
        assert.equal((await call(responseUrl, `operations/${operationId}`, { actor })).value.state, 'ABORTED');
      }
    }
    assert.equal((await responseDb.query(`SELECT count(*)::int AS count FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id
      WHERE i.state IN ('PENDING','ABORTING') AND r.incident_category_code=$1`, [categoryCode])).rows[0].count, 0);
  } finally {
    await recoveryLock.end();
    await Promise.all([responseDb.end(), logisticsDb.end(), identityDb.end(), responseLock.end(), logisticsLock.end()]);
  }
}
