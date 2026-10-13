import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const logisticsUrl = requiredEnv('C48_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const responseUrl = requiredEnv('C48_RESPONSE_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const responseServiceClientId = requiredEnv('RESPONSE_SERVICE_CLIENT_ID');
const responseServiceClientSecret = requiredEnv('RESPONSE_SERVICE_CLIENT_SECRET');
const logisticsDb = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const responseDb = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const organizationId = '40000000-0000-4000-8000-000000000004';
const suffix = randomBytes(5).toString('hex').toUpperCase();
const regionCode = `T14_${suffix}`;
let identityIp = 230;
let requestIp = 240;

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
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
  return { status: response.status, headers: response.headers, value };
}

function command(base, path, actor, body, idempotencyKey = key(), headers = {}) {
  return call(base, path, { method: 'POST', actor, body, idempotencyKey, headers });
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
    username: `t14${label}${accountSuffix}`,
    display_name: `Người dùng kiểm thử T14 ${label} ${accountSuffix}`,
    password: `Logistics T14 test ${accountSuffix}!`,
  };
  const sourceIp = `198.51.100.${identityIp++}`;
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials, idempotencyKey: key(), headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  for (const role of roles) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
       VALUES ($1,$2,'ORGANIZATION',$3)`,
      [registered.value.user.id, role, organizationId],
    );
  }
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: registered.value.user.id, token: login.value.access_token };
}

async function responseServiceToken() {
  const result = await call(identityUrl, 'internal/token', {
    method: 'POST',
    body: { client_id: responseServiceClientId, client_secret: responseServiceClientSecret, audience: 'logistics' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal(typeof result.value?.access_token, 'string');
  return result.value.access_token;
}

async function createRequest(reporter) {
  const result = await command(responseUrl, 'requests', reporter, {
    incident_category_code: 'T14_FLOOD',
    description: 'Nước đang dâng gần khu dân cư.',
    people_affected: 2,
    reporter_name: 'Nguyễn An T14',
    reporter_contact_phone: '+84912345678',
    reporter_declared_danger: false,
    location: {
      type: 'Point', coordinates: [-120, -20], source: 'GPS', accuracy_m: 8, captured_at: new Date().toISOString(),
    },
  }, key(), { 'X-Forwarded-For': `198.51.100.${requestIp++}` });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  return result.value;
}

async function verifyRequest(request, coordinator) {
  const started = await command(responseUrl, `requests/${request.id}/start-verification`, coordinator, { expected_version: 1 });
  expectSuccess(started);
  assert.equal(started.value.status, 'VERIFYING');
  const contact = await command(responseUrl, `requests/${request.id}/contact-attempts`, coordinator, {
    contact_target: 'REPORTER', outcome: 'REACHED', note: 'Đã xác nhận vị trí.',
  });
  expectSuccess(contact, 201);
  const verified = await command(responseUrl, `requests/${request.id}/verify`, coordinator, {
    expected_version: 3, basis: 'CONTACT_CONFIRMED', source_refs: { contact_attempt_ids: [contact.value.id] },
  });
  expectSuccess(verified);
  assert.equal(verified.value.status, 'VERIFIED');
}

async function requestState(requestId) {
  const result = await responseDb.query(
    `SELECT status,work_cycle,organization_id,region_code,logistics_admitted_at,attribution_locked_at
       FROM assistance_request WHERE id=$1`, [requestId],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

await Promise.all([logisticsDb.connect(), responseDb.connect(), identityDb.connect()]);
try {
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind)
     VALUES ($1,'T14 test organization','COORDINATION') ON CONFLICT (id) DO NOTHING`, [organizationId],
  );
  await identityDb.query('INSERT INTO region (code,name) VALUES ($1,$2)', [regionCode, 'Khu vực kiểm thử T14']);
  await responseDb.query("INSERT INTO incident_category (code,display_name) VALUES ('T14_FLOOD','Lũ lụt') ON CONFLICT (code) DO NOTHING");
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ($1,ST_Multi(ST_GeomFromText('POLYGON((-121 -21,-119 -21,-119 -19,-121 -19,-121 -21))',4326)))
     ON CONFLICT (region_code) DO NOTHING`, [regionCode],
  );

  const [staff, reporter] = await Promise.all([
    registerAndLogin('staff', ['COORDINATOR', 'OPERATIONS_MANAGER']),
    registerAndLogin('reporter'),
  ]);
  const responseToken = await responseServiceToken();
  const itemType = await command(logisticsUrl, 'item-types', staff, {
    code: `T14_${suffix}`, display_name: 'Vật tư kiểm thử T14',
  });
  expectSuccess(itemType, 201);
  const unit = await command(logisticsUrl, 'units', staff, {
    code: `T14_U_${suffix}`, display_name: 'Thùng T14', scale: 2,
  });
  expectSuccess(unit, 201);
  assert.equal(Number(unit.value.scale), 2);
  const item = await command(logisticsUrl, 'items', staff, {
    item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư T14 ${suffix}`,
  });
  expectSuccess(item, 201);
  assert.equal(Number(item.value.unit.scale), 2);
  const sealedItem = await command(logisticsUrl, 'items', staff, {
    item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư T14 niêm phong ${suffix}`,
  });
  expectSuccess(sealedItem, 201);
  const warehouse = await command(logisticsUrl, 'warehouses', staff, {
    organization_id: organizationId, region_code: regionCode, name: `Kho T14 ${suffix}`,
  });
  expectSuccess(warehouse, 201);
  const opening = await command(logisticsUrl, 'stock/opening', staff, {
    warehouse_id: warehouse.value.id, lines: [{ item_id: item.value.id, quantity: '20.00' }], note: 'Tồn đầu kỳ T14',
  });
  expectSuccess(opening, 201);
  const balanceId = opening.value.items[0]?.balance_id;
  assert.ok(balanceId);

  const pendingRequest = await createRequest(reporter);
  const pendingState = await requestState(pendingRequest.id);
  assert.equal(pendingState.status, 'SUBMITTED');
  const rejectedNeed = await command(logisticsUrl, 'needs', staff, {
    request_id: pendingRequest.id, work_cycle: Number(pendingState.work_cycle), item_id: item.value.id, quantity: '2.00',
  });
  expectVietnameseError(rejectedNeed, 409, 'REQUEST_NOT_VERIFIED');
  const rejectedState = await requestState(pendingRequest.id);
  assert.equal(rejectedState.status, 'SUBMITTED');
  assert.equal(rejectedState.logistics_admitted_at, null);
  assert.equal(rejectedState.attribution_locked_at, null);
  const pendingCycle = await logisticsDb.query('SELECT id FROM fulfillment_cycle WHERE request_id=$1', [pendingRequest.id]);
  assert.equal(pendingCycle.rowCount, 0, 'an unverified request cannot create a Logistics cycle');

  const request = await createRequest(reporter);
  await verifyRequest(request, staff);
  const verifiedState = await requestState(request.id);
  assert.equal(verifiedState.status, 'VERIFIED');
  assert.equal(verifiedState.organization_id, organizationId);
  assert.equal(verifiedState.region_code, regionCode);
  assert.equal(verifiedState.logistics_admitted_at, null);
  const createBody = {
    request_id: request.id, work_cycle: Number(verifiedState.work_cycle), item_id: item.value.id, quantity: '10.00',
  };
  const createKeys = [key(), key()];
  const creates = await Promise.all(createKeys.map((idempotencyKey) =>
    command(logisticsUrl, 'needs', staff, createBody, idempotencyKey)));
  assert.equal(creates.filter((result) => result.status === 201).length, 1, JSON.stringify(creates.map((result) => result.value)));
  const conflict = creates.find((result) => result.status !== 201);
  expectVietnameseError(conflict, 409, 'NEED_EXISTS');
  const created = creates.find((result) => result.status === 201);
  expectSuccess(created, 201);
  const need = created.value;
  assert.equal(need.status, 'OPEN');
  assert.equal(Number(need.version), 1);
  assert.equal(Number(need.item.unit.scale), 2);

  const admittedState = await requestState(request.id);
  assert.ok(admittedState.logistics_admitted_at);
  assert.ok(admittedState.attribution_locked_at);
  const singleCycle = await logisticsDb.query(
    'SELECT id,state FROM fulfillment_cycle WHERE request_id=$1 AND work_cycle=$2', [request.id, createBody.work_cycle],
  );
  assert.equal(singleCycle.rowCount, 1);
  assert.equal(singleCycle.rows[0].id, need.cycle_id);
  const liveNeeds = await logisticsDb.query(
    `SELECT id FROM relief_need WHERE cycle_id=$1 AND item_id=$2 AND status <> 'CANCELLED'`, [need.cycle_id, item.value.id],
  );
  assert.deepEqual(liveNeeds.rows.map((row) => row.id), [need.id]);
  const sealedNeedResult = await command(logisticsUrl, 'needs', staff, {
    request_id: request.id, work_cycle: createBody.work_cycle, item_id: sealedItem.value.id, quantity: '4.00',
  });
  expectSuccess(sealedNeedResult, 201);
  const sealedNeed = sealedNeedResult.value;
  assert.equal(sealedNeed.cycle_id, need.cycle_id);

  const increased = await command(logisticsUrl, `needs/${need.id}/increase`, staff, {
    expected_version: 1, quantity: '15.00', reason: 'Nhu cầu tăng sau khi rà soát.',
  });
  expectSuccess(increased);
  assert.equal(increased.value.requested_quantity, '15.000');
  const reduced = await command(logisticsUrl, `needs/${need.id}/reduce`, staff, {
    expected_version: 2, quantity: '12.00', reason: 'Điều chỉnh theo số liệu mới.',
  });
  expectSuccess(reduced);
  assert.equal(reduced.value.requested_quantity, '12.000');
  const adjustedRow = await logisticsDb.query(
    'SELECT original_quantity::text,requested_quantity::text,status,version FROM relief_need WHERE id=$1', [need.id],
  );
  assert.deepEqual(adjustedRow.rows, [{ original_quantity: '10.000', requested_quantity: '12.000', status: 'OPEN', version: 3 }]);

  const commitmentKeys = [key(), key()];
  const commitmentResults = await Promise.all(commitmentKeys.map((idempotencyKey) =>
    command(logisticsUrl, `needs/${need.id}/commitments`, staff, {
      warehouse_id: warehouse.value.id, quantity: '7.00',
    }, idempotencyKey)));
  assert.equal(commitmentResults.filter((result) => result.status === 201).length, 1);
  const commitmentIndex = commitmentResults.findIndex((result) => result.status === 201);
  const commitment = commitmentResults[commitmentIndex];
  expectSuccess(commitment, 201);
  const overCommit = commitmentResults.find((result) => result.status !== 201);
  expectVietnameseError(overCommit, 409, 'NEED_OVER_COMMITTED');
  const commitmentId = commitment.value.id;
  const commitmentReplay = await command(logisticsUrl, `needs/${need.id}/commitments`, staff, {
    warehouse_id: warehouse.value.id, quantity: '7.00',
  }, commitmentKeys[commitmentIndex]);
  expectSuccess(commitmentReplay, 201);
  assert.equal(commitmentReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(commitmentReplay.value.id, commitmentId);

  const openReleaseKey = key();
  const openReleaseBody = { expected_version: 1, quantity: '2.00', reason: 'Điều chỉnh lượng hàng dự trữ.' };
  const openRelease = await command(logisticsUrl, `commitments/${commitmentId}/release`, staff, openReleaseBody, openReleaseKey);
  expectSuccess(openRelease);
  const openReleaseReplay = await command(logisticsUrl, `commitments/${commitmentId}/release`, staff, openReleaseBody, openReleaseKey);
  expectSuccess(openReleaseReplay);
  assert.equal(openReleaseReplay.headers.get('idempotent-replay'), 'true');

  const needList = await call(logisticsUrl,
    `needs?request_id=${request.id}&work_cycle=${createBody.work_cycle}&limit=10`, { actor: staff });
  expectSuccess(needList);
  const listedNeed = needList.value.items.find((entry) => entry.id === need.id);
  assert.equal(listedNeed.requested, '12.00');
  assert.equal(listedNeed.committed_reserved, '5.00');
  assert.equal(listedNeed.outstanding, '12.00');

  const fulfillmentPath = `requests/${request.id}/fulfillment?work_cycle=${createBody.work_cycle}`;
  const board = await call(logisticsUrl, fulfillmentPath, { actor: staff });
  expectSuccess(board);
  const boardNeed = board.value.needs.find((entry) => entry.id === need.id);
  assert.equal(boardNeed.committed_reserved, '5.00');
  assert.equal(boardNeed.contributions.items.length, 1);
  assert.equal(boardNeed.contributions.items[0].reserved_remaining, '5.00');
  assert.equal(boardNeed.contributions.more, false);
  assert.equal(board.value.cycle_state, 'OPEN');
  assert.ok(board.value.generated_at);

  const fullContributions = await call(logisticsUrl, `needs/${need.id}/contributions?limit=10`, { actor: staff });
  expectSuccess(fullContributions);
  assert.equal(fullContributions.value.items.length, 1);
  assert.equal(fullContributions.value.items[0].created_by_user_id, staff.id);
  assert.equal(fullContributions.value.items[0].reserved_remaining, '5.00');

  const internalWithoutActor = await call(logisticsUrl, `internal/${fulfillmentPath}`, {
    headers: { Authorization: `Bearer ${responseToken}` },
  });
  expectVietnameseError(internalWithoutActor, 401, 'UNAUTHENTICATED');
  const internalBoard = await call(logisticsUrl, `internal/${fulfillmentPath}`, {
    headers: {
      Authorization: `Bearer ${responseToken}`,
      'X-Actor-Authorization': `Bearer ${staff.token}`,
    },
  });
  expectSuccess(internalBoard);
  assert.equal(internalBoard.value.needs.find((entry) => entry.id === need.id).committed_reserved, '5.00');

  const beforeCancelBalance = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE id=$1', [balanceId],
  );
  assert.deepEqual(beforeCancelBalance.rows, [{ on_hand: '20.000', reserved: '5.000' }]);

  const freezeIntentId = randomUUID();
  await logisticsDb.query(
    `INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES ($1,$2,'CANCELLATION','FROZEN')`,
    [freezeIntentId, need.cycle_id],
  );
  await logisticsDb.query("UPDATE fulfillment_cycle SET state='FROZEN' WHERE id=$1", [need.cycle_id]);
  const frozenMismatch = await logisticsDb.query(
    'SELECT cycle_id FROM check_cycle_state_matches_intent() WHERE cycle_id=$1', [need.cycle_id],
  );
  assert.equal(frozenMismatch.rowCount, 0);
  const frozenRelease = await command(logisticsUrl, `commitments/${commitmentId}/release`, staff, {
    expected_version: 2, quantity: '1.00', reason: 'Điều chỉnh dự trữ trong chu kỳ tạm dừng.',
  });
  expectSuccess(frozenRelease);
  const cancelled = await command(logisticsUrl, `needs/${need.id}/cancel`, staff, {
    expected_version: 3, reason: 'Hủy phần hỗ trợ chưa được cấp phát.',
  });
  expectSuccess(cancelled);
  assert.equal(cancelled.value.status, 'CANCELLED');
  assert.equal(cancelled.value.cancelled_remaining, '12.000');
  const cancelledRow = await logisticsDb.query(
    'SELECT status,requested_quantity::text,cancelled_remaining::text,version FROM relief_need WHERE id=$1', [need.id],
  );
  assert.deepEqual(cancelledRow.rows, [{ status: 'CANCELLED', requested_quantity: '12.000', cancelled_remaining: '12.000', version: 4 }]);
  const releasedCommitment = await logisticsDb.query(
    'SELECT released_quantity::text,version FROM commitment WHERE id=$1', [commitmentId],
  );
  assert.deepEqual(releasedCommitment.rows, [{ released_quantity: '7.000', version: 4 }]);
  const balanceAfterCancel = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE id=$1', [balanceId],
  );
  assert.deepEqual(balanceAfterCancel.rows, [{ on_hand: '20.000', reserved: '0.000' }]);
  const movements = await logisticsDb.query(
    `SELECT movement_type,delta_reserved::text
       FROM stock_movement WHERE commitment_id=$1`, [commitmentId],
  );
  assert.deepEqual(movements.rows.map((row) => `${row.movement_type}:${row.delta_reserved}`).sort(), [
    'RELEASE:-1.000', 'RELEASE:-2.000', 'RELEASE:-4.000', 'RESERVE:7.000',
  ]);
  const terminalCancel = await command(logisticsUrl, `needs/${need.id}/cancel`, staff, {
    expected_version: 4, reason: 'Không được hủy nhu cầu đã hủy lần nữa.',
  });
  expectVietnameseError(terminalCancel, 409, 'STATE_TRANSITION_INVALID');
  const frozenSecondCancel = await command(logisticsUrl, `needs/${sealedNeed.id}/cancel`, staff, {
    expected_version: 1, reason: 'Hủy nhu cầu thứ hai trước khi niêm phong chu kỳ.',
  });
  expectSuccess(frozenSecondCancel);
  assert.equal(frozenSecondCancel.value.status, 'CANCELLED');

  await logisticsDb.query("UPDATE cycle_intent SET state='ABORTED' WHERE intent_id=$1", [freezeIntentId]);
  await logisticsDb.query("UPDATE fulfillment_cycle SET state='OPEN' WHERE id=$1", [need.cycle_id]);
  await logisticsDb.query(
    `INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES ($1,$2,'RESOLUTION','SEALED')`,
    [randomUUID(), need.cycle_id],
  );
  await logisticsDb.query("UPDATE fulfillment_cycle SET state='SEALED' WHERE id=$1", [need.cycle_id]);
  const sealedMismatch = await logisticsDb.query(
    'SELECT cycle_id FROM check_cycle_state_matches_intent() WHERE cycle_id=$1', [need.cycle_id],
  );
  assert.equal(sealedMismatch.rowCount, 0);
  const sealedCancel = await command(logisticsUrl, `needs/${sealedNeed.id}/cancel`, staff, {
    expected_version: 1, reason: 'Thử chặn thao tác trên chu kỳ đã niêm phong.',
  });
  expectVietnameseError(sealedCancel, 409, 'CYCLE_SEALED');
  const sealedRelease = await command(logisticsUrl, `commitments/${commitmentId}/release`, staff, {
    expected_version: 4, quantity: '1.00', reason: 'Không được giải phóng trong chu kỳ đã niêm phong.',
  });
  expectVietnameseError(sealedRelease, 409, 'CYCLE_SEALED');
  const unchangedSealedNeed = await logisticsDb.query(
    'SELECT status,version FROM relief_need WHERE id=$1', [sealedNeed.id],
  );
  assert.deepEqual(unchangedSealedNeed.rows, [{ status: 'CANCELLED', version: 2 }]);

  await verifyRequest(pendingRequest, staff);
  const issuedRequestState = await requestState(pendingRequest.id);
  const issuedNeedResult = await command(logisticsUrl, 'needs', staff, {
    request_id: pendingRequest.id, work_cycle: Number(issuedRequestState.work_cycle), item_id: item.value.id, quantity: '2.00',
  });
  expectSuccess(issuedNeedResult, 201);
  const issuedNeed = issuedNeedResult.value;
  const issuedCommitmentId = randomUUID();
  await logisticsDb.query(
    `INSERT INTO commitment (id,relief_need_id,item_id,warehouse_id,quantity,issued_quantity,created_by_user_id)
     VALUES ($1,$2,$3,$4,2.00,1.00,$5)`, [issuedCommitmentId, issuedNeed.id, item.value.id, warehouse.value.id, staff.id],
  );
  await logisticsDb.query(
    `INSERT INTO stock_movement
       (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
     VALUES ($1,'RESERVE',0,2.00,$2,$3,$4)`, [balanceId, issuedCommitmentId, `T14_RESERVE:${issuedCommitmentId}`, staff.id],
  );
  await logisticsDb.query(
    `INSERT INTO stock_movement
       (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
     VALUES ($1,'ISSUE',-1.00,-1.00,$2,$3,$4)`, [balanceId, issuedCommitmentId, `T14_ISSUE:${issuedCommitmentId}`, staff.id],
  );
  const unsettledCancel = await command(logisticsUrl, `needs/${issuedNeed.id}/cancel`, staff, {
    expected_version: 1, reason: 'Thử chặn hủy khi hàng đã cấp phát nhưng chưa quyết toán.',
  });
  expectVietnameseError(unsettledCancel, 409, 'UNSETTLED_ISSUED_GOODS');
  const unchangedIssuedNeed = await logisticsDb.query(
    'SELECT status,version FROM relief_need WHERE id=$1', [issuedNeed.id],
  );
  assert.deepEqual(unchangedIssuedNeed.rows, [{ status: 'OPEN', version: 1 }]);
  const unsettledCommitment = await logisticsDb.query(
    'SELECT released_quantity::text,issued_quantity::text FROM commitment WHERE id=$1', [issuedCommitmentId],
  );
  assert.deepEqual(unsettledCommitment.rows, [{ released_quantity: '0.000', issued_quantity: '1.000' }]);
  const unsettledBalance = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE id=$1', [balanceId],
  );
  assert.deepEqual(unsettledBalance.rows, [{ on_hand: '19.000', reserved: '1.000' }]);

  console.log('PASS Logistics T14 request admission, create race, quantity changes, cancel/release, unsettled-issued guard and sealed-cycle guard');
} finally {
  await Promise.all([logisticsDb.end(), responseDb.end(), identityDb.end()]);
}
