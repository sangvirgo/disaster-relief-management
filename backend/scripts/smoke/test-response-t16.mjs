import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

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

function command(base, path, actor, body, idempotencyKey = key(), method = 'POST') {
  return call(base, path, { method, actor, body, idempotencyKey });
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

await Promise.all([responseDb.connect(), logisticsDb.connect(), identityDb.connect()]);
try {
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

  console.log('T16 Response resolution/cancellation HTTP and PostgreSQL smoke passed.');
} finally {
  await Promise.all([responseDb.end(), logisticsDb.end(), identityDb.end()]);
}
