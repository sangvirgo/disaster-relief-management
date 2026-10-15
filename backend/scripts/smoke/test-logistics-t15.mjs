import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const logisticsUrl = requiredEnv('C48_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const responseUrl = requiredEnv('C48_RESPONSE_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const logisticsDb = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const responseDb = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const organizationId = requiredEnv('DEMO_INTAKE_ORGANIZATION_ID');
const suffix = randomBytes(5).toString('hex').toUpperCase();
const regionCode = `T15_${suffix}`;
const categoryCode = `T15_FLOOD_${suffix}`;
let identityIp = 20 + randomBytes(1)[0] % 200;
let requestIp = 120;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function key() { return randomUUID(); }

async function waitForLockWait(relation, label, previousWaiter = 0) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await logisticsDb.query(
      `SELECT DISTINCT pid FROM pg_locks
        WHERE relation=$1::regclass AND pid<>pg_backend_pid() AND pid<>$2
          AND pg_blocking_pids(pid) && ARRAY[pg_backend_pid(),$2]::int[] LIMIT 1`,
      [relation, previousWaiter],
    );
    if (waiting.rowCount) return waiting.rows[0].pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${label} database lock`);
}

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

async function callMultipart(base, path, { file, actor, idempotencyKey = key() }) {
  const boundary = `c48-t15-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="handoff-evidence.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${actor.token}`,
      'Idempotency-Key': idempotencyKey,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
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

async function login(account) {
  const result = await call(identityUrl, 'auth/login', {
    method: 'POST',
    body: { username: account.username, password: account.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': account.sourceIp },
  });
  assert.equal(result.status, 200, JSON.stringify(result.value));
  account.token = result.value.access_token;
  return account;
}

async function registerAndLogin(label, roles = []) {
  const accountSuffix = randomBytes(5).toString('hex');
  const account = {
    username: `t15${label}${accountSuffix}`,
    password: `Logistics T15 test ${accountSuffix}!`,
    sourceIp: `198.51.100.${identityIp++}`,
  };
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST',
    body: {
      username: account.username,
      display_name: `Người dùng kiểm thử T15 ${label} ${accountSuffix}`,
      password: account.password,
    },
    idempotencyKey: key(),
    headers: { 'X-Forwarded-For': account.sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  account.id = registered.value.user.id;
  for (const role of roles) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
       VALUES ($1,$2,'ORGANIZATION',$3)`,
      [account.id, role, organizationId],
    );
  }
  return login(account);
}

async function cloneAndLogin(label, roles, template) {
  const accountSuffix = randomBytes(5).toString('hex');
  const account = {
    username: `t15${label}${accountSuffix}`,
    password: template.password,
    sourceIp: `198.51.100.${identityIp++}`,
  };
  const templateRows = await identityDb.query('SELECT password_hash FROM app_user WHERE id=$1', [template.id]);
  assert.equal(templateRows.rowCount, 1);
  const inserted = await identityDb.query(
    'INSERT INTO app_user (username,display_name,password_hash) VALUES ($1,$2,$3) RETURNING id',
    [account.username, `Người dùng kiểm thử T15 ${label} ${accountSuffix}`, templateRows.rows[0].password_hash],
  );
  assert.equal(inserted.rowCount, 1);
  account.id = inserted.rows[0].id;
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ($1,'CITIZEN','SYSTEM')`, [account.id],
  );
  for (const role of roles) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
       VALUES ($1,$2,'ORGANIZATION',$3)`,
      [account.id, role, organizationId],
    );
  }
  return login(account);
}

async function createRequest(reporter) {
  const result = await command(responseUrl, 'requests', reporter, {
    incident_category_code: categoryCode,
    description: 'Nước dâng sát khu dân cư, cần kiểm tra điểm an toàn.',
    people_affected: 2,
    reporter_name: 'Nguyễn An T15',
    reporter_contact_phone: '+84912345678',
    reporter_declared_danger: false,
    location: {
      type: 'Point', coordinates: [-120, -20], source: 'GPS', accuracy_m: 8,
      captured_at: new Date().toISOString(),
    },
  }, key(), 'POST');
  assert.equal(result.status, 201, JSON.stringify(result.value));
  return result.value;
}

async function verifyRequest(request, coordinator) {
  const started = await command(responseUrl, `requests/${request.id}/start-verification`, coordinator, { expected_version: 1 });
  assert.equal(started.status, 200, JSON.stringify(started.value));
  const contact = await command(responseUrl, `requests/${request.id}/contact-attempts`, coordinator, {
    contact_target: 'REPORTER', outcome: 'REACHED', note: 'Đã xác nhận thông tin và vị trí.',
  });
  assert.equal(contact.status, 201, JSON.stringify(contact.value));
  const verified = await command(responseUrl, `requests/${request.id}/verify`, coordinator, {
    expected_version: 3, basis: 'CONTACT_CONFIRMED', source_refs: { contact_attempt_ids: [contact.value.id] },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.value));
}

async function createDistribution(actor, warehouseId, itemId, quantity, reliefPointId = null, commitmentId = null, vehicleId = null) {
  const body = {
    warehouse_id: warehouseId,
    ...(reliefPointId ? { relief_point_id: reliefPointId } : {}),
    ...(vehicleId ? { vehicle_id: vehicleId } : {}),
    purpose: commitmentId ? 'REQUEST_AID' : 'POINT_REPLENISHMENT',
    lines: [{ item_id: itemId, quantity, ...(commitmentId ? { commitment_id: commitmentId } : {}) }],
  };
  const result = await command(logisticsUrl, 'distributions', actor, body);
  expectSuccess(result, 201);
  return result.value;
}

async function approveAndDispatch(distribution, approver, dispatcher, version = 1) {
  const approved = await command(logisticsUrl, `distributions/${distribution.id}/approve`, approver, { expected_version: version });
  expectSuccess(approved);
  const dispatched = await command(logisticsUrl, `distributions/${distribution.id}/dispatch`, dispatcher, { expected_version: version });
  expectSuccess(dispatched);
  return dispatched.value;
}

async function handoff(distributionId, actor, body, idempotencyKey = key()) {
  const result = await command(logisticsUrl, `distributions/${distributionId}/handoffs`, actor, body, idempotencyKey);
  return { result, idempotencyKey };
}

async function distributionDetail(id, actor) {
  const result = await call(logisticsUrl, `distributions/${id}`, { actor });
  expectSuccess(result);
  return result.value;
}

await Promise.all([logisticsDb.connect(), responseDb.connect(), identityDb.connect()]);
try {
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind)
     VALUES ($1,'T15 test organization','COORDINATION') ON CONFLICT (id) DO NOTHING`, [organizationId],
  );
  await identityDb.query('INSERT INTO region (code,name) VALUES ($1,$2)', [regionCode, 'Khu vực kiểm thử T15']);
  await responseDb.query('INSERT INTO incident_category (code,display_name) VALUES ($1,$2)', [categoryCode, 'Lũ lụt']);
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom) VALUES
      ($1,ST_Multi(ST_GeomFromText('POLYGON((-121 -21,-119 -21,-119 -19,-121 -19,-121 -21))',4326)))`,
    [regionCode],
  );

  const staff = await registerAndLogin('staff', ['COORDINATOR', 'OPERATIONS_MANAGER']);
  const approver = await cloneAndLogin('approver', ['COORDINATOR', 'REVIEWER'], staff);
  const dispatcher = await cloneAndLogin('dispatcher', ['DISTRIBUTION_STAFF'], staff);
  const fieldRecorder = await cloneAndLogin('field', ['COORDINATOR', 'DISTRIBUTION_STAFF'], staff);
  const secondRecorder = await cloneAndLogin('field2', ['DISTRIBUTION_STAFF'], staff);
  const returner = await cloneAndLogin('returner', ['INTAKE_STAFF'], staff);
  const secondReviewer = await cloneAndLogin('reviewer2', ['COORDINATOR', 'REVIEWER'], staff);
  const reporter = await cloneAndLogin('reporter', [], staff);

  const itemType = await command(logisticsUrl, 'item-types', staff, {
    code: `T15_${suffix}`, display_name: 'Vật tư kiểm thử T15',
  });
  expectSuccess(itemType, 201);
  const unit = await command(logisticsUrl, 'units', staff, {
    code: `T15_U_${suffix}`, display_name: 'Thùng T15', scale: 2,
  });
  expectSuccess(unit, 201);
  const item = await command(logisticsUrl, 'items', staff, {
    item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư phân phối T15 ${suffix}`,
  });
  expectSuccess(item, 201);
  const warehouse = await command(logisticsUrl, 'warehouses', staff, {
    organization_id: organizationId, region_code: regionCode, name: `Kho phân phối T15 ${suffix}`,
  });
  expectSuccess(warehouse, 201);
  const lowCapacityVehicle = await command(logisticsUrl, 'vehicles', staff, {
    organization_id: organizationId,
    region_code: regionCode,
    identifier: `T15-${suffix}`,
    vehicle_type: 'Xe tải kiểm thử',
    capacity: '1.00',
    capacity_unit: unit.value.code,
  });
  expectSuccess(lowCapacityVehicle, 201);
  const opening = await command(logisticsUrl, 'stock/opening', staff, {
    warehouse_id: warehouse.value.id,
    lines: [{ item_id: item.value.id, quantity: '25.00' }],
    note: 'Tồn đầu kỳ kiểm thử phân phối T15.',
  });
  expectSuccess(opening, 201);
  const reliefPoint = await command(logisticsUrl, 'relief-points', staff, {
    organization_id: organizationId,
    region_code: regionCode,
    name: `Điểm cứu trợ T15 ${suffix}`,
    location: { type: 'Point', coordinates: [107.6, 16.0] },
  });
  expectSuccess(reliefPoint, 201);

  for (const approved of [false, true]) {
    const candidate = await createDistribution(staff, warehouse.value.id, item.value.id, '1.00', reliefPoint.value.id);
    if (approved) {
      expectSuccess(await command(logisticsUrl, `distributions/${candidate.id}/approve`, approver, { expected_version: 1 }));
    }
    const cancelled = await command(logisticsUrl, `distributions/${candidate.id}/cancel`, approved ? approver : staff, { expected_version: 1 });
    expectSuccess(cancelled);
    assert.equal(cancelled.value.status, 'CANCELLED');
    assert.equal(cancelled.value.version, 2);
    const movements = await logisticsDb.query(
      'SELECT id FROM stock_movement WHERE distribution_line_id=ANY($1::uuid[])',
      [candidate.lines.map((line) => line.id)],
    );
    assert.equal(movements.rowCount, 0);
  }

  const request = await createRequest(reporter);
  await verifyRequest(request, staff);
  const requestState = await responseDb.query('SELECT work_cycle FROM assistance_request WHERE id=$1', [request.id]);
  assert.equal(requestState.rowCount, 1);
  const needResult = await command(logisticsUrl, 'needs', staff, {
    request_id: request.id,
    work_cycle: Number(requestState.rows[0].work_cycle),
    item_id: item.value.id,
    quantity: '10.00',
  });
  expectSuccess(needResult, 201);
  const need = needResult.value;
  const commitmentResult = await command(logisticsUrl, `needs/${need.id}/commitments`, staff, {
    warehouse_id: warehouse.value.id, quantity: '10.00',
  });
  expectSuccess(commitmentResult, 201);
  const commitmentId = commitmentResult.value.id;

  const underCapacity = await createDistribution(
    staff, warehouse.value.id, item.value.id, '1.00', null, commitmentId, lowCapacityVehicle.value.id,
  );
  assert.equal((await distributionDetail(underCapacity.id, staff)).vehicle_capacity_exceeded, false);
  expectSuccess(await command(logisticsUrl, `distributions/${underCapacity.id}/cancel`, staff, { expected_version: 1 }));

  const frozenCandidate = await createDistribution(staff, warehouse.value.id, item.value.id, '5.00', null, commitmentId);
  const frozenCandidateApproval = await command(logisticsUrl, `distributions/${frozenCandidate.id}/approve`, approver, { expected_version: 1 });
  expectSuccess(frozenCandidateApproval);

  const requestAid = await createDistribution(
    staff, warehouse.value.id, item.value.id, '1.00', null, commitmentId, lowCapacityVehicle.value.id,
  );
  const prepared = await command(logisticsUrl, `distributions/${requestAid.id}/prepare-from-commitments`, staff, { expected_version: 1 });
  expectSuccess(prepared);
  assert.equal(prepared.value.vehicle_capacity_exceeded, true, 'capacity is reported as a warning during preparation');
  assert.equal(prepared.value.lines.length, 1);
  assert.equal(Number(prepared.value.lines[0].quantity), 10);
  const reducedPreparation = await command(logisticsUrl, `distributions/${requestAid.id}/lines`, staff, {
    expected_version: 2,
    lines: [{ item_id: item.value.id, commitment_id: commitmentId, quantity: '5.00' }],
  }, key(), 'PUT');
  expectSuccess(reducedPreparation);
  assert.equal(Number(reducedPreparation.value.lines[0].quantity), 5);
  const issued = await approveAndDispatch(reducedPreparation.value, approver, dispatcher, 3);
  assert.equal(issued.vehicle_capacity_exceeded, true, 'capacity is reported as a warning after dispatch');
  const requestAidLineId = issued.lines[0].id;
  const overCapacityStock = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, item.value.id],
  );
  assert.deepEqual(overCapacityStock.rows, [{ on_hand: '20.000', reserved: '5.000' }], 'over-capacity dispatch still issues the reserved stock');
  const directHandoffBody = {
    handoff_kind: 'DIRECT_HOUSEHOLD',
    receiver_label: 'Hộ dân kiểm thử T15',
    confirmation_basis: 'Người nhận xác nhận đã nhận đủ hàng.',
    occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: requestAidLineId, quantity: '5.00' }],
  };
  const needCycle = await logisticsDb.query('SELECT cycle_id FROM relief_need WHERE id=$1', [need.id]);
  assert.equal(needCycle.rowCount, 1);
  await logisticsDb.query("UPDATE fulfillment_cycle SET state='FROZEN' WHERE id=$1", [needCycle.rows[0].cycle_id]);
  const issueCountBeforeFreezeAttempt = await logisticsDb.query(
    "SELECT count(*)::int AS count FROM stock_movement WHERE commitment_id=$1 AND movement_type='ISSUE'", [commitmentId],
  );
  const issuedBeforeFreezeAttempt = await logisticsDb.query(
    'SELECT issued_quantity::text FROM commitment WHERE id=$1', [commitmentId],
  );
  const frozenDispatch = await command(
    logisticsUrl, `distributions/${frozenCandidate.id}/dispatch`, dispatcher, { expected_version: 1 },
  );
  expectVietnameseError(frozenDispatch, 409, 'CYCLE_FROZEN');
  const issueCountAfterFreezeAttempt = await logisticsDb.query(
    "SELECT count(*)::int AS count FROM stock_movement WHERE commitment_id=$1 AND movement_type='ISSUE'", [commitmentId],
  );
  const issuedAfterFreezeAttempt = await logisticsDb.query(
    'SELECT issued_quantity::text FROM commitment WHERE id=$1', [commitmentId],
  );
  assert.deepEqual(issueCountAfterFreezeAttempt.rows, issueCountBeforeFreezeAttempt.rows);
  assert.deepEqual(issuedAfterFreezeAttempt.rows, issuedBeforeFreezeAttempt.rows);

  const recorded = await handoff(requestAid.id, fieldRecorder, directHandoffBody);
  expectSuccess(recorded.result, 201);
  assert.equal(recorded.result.value.status, 'RECORDED');

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`T15 handoff evidence ${suffix}`),
  ]);
  const uploadedEvidence = await callMultipart(
    logisticsUrl,
    `distributions/${requestAid.id}/handoffs/${recorded.result.value.id}/evidence`,
    { file: png, actor: fieldRecorder },
  );
  if (uploadedEvidence.status === 503 && uploadedEvidence.value?.code === 'STORAGE_UNAVAILABLE') {
    throw new Error('Logistics T15 handoff evidence upload returned STORAGE_UNAVAILABLE; start/configure the primary AIStor service before running this smoke');
  }
  expectSuccess(uploadedEvidence, 201);
  assert.equal(uploadedEvidence.value.state, 'READY');
  assert.equal(uploadedEvidence.value.detected_mime, 'image/png');
  assert.equal(Object.hasOwn(uploadedEvidence.value, 'object_key'), false);

  const handoffDetail = await call(
    logisticsUrl, `distributions/${requestAid.id}/handoffs/${recorded.result.value.id}`, { actor: staff },
  );
  expectSuccess(handoffDetail);
  assert.ok(handoffDetail.value.evidence.some((file) => file.id === uploadedEvidence.value.id && file.state === 'READY'));
  assert.equal(JSON.stringify(handoffDetail.value.evidence).includes('object_key'), false);
  assert.equal(JSON.stringify(handoffDetail.value.evidence).includes('signed'), false);

  const evidenceDownload = await call(logisticsUrl, `evidence/${uploadedEvidence.value.id}/download`, { actor: fieldRecorder });
  if (evidenceDownload.status === 503 && evidenceDownload.value?.code === 'STORAGE_UNAVAILABLE') {
    throw new Error('Logistics T15 handoff evidence download returned STORAGE_UNAVAILABLE; verify the primary AIStor service before running this smoke');
  }
  expectSuccess(evidenceDownload);
  assert.equal(evidenceDownload.value.expires_in, 60);
  assert.equal(new URL(evidenceDownload.value.url).searchParams.get('X-Amz-Expires'), '60');
  const deniedEvidenceDownload = await call(logisticsUrl, `evidence/${uploadedEvidence.value.id}/download`, { actor: reporter });
  expectVietnameseError(deniedEvidenceDownload, 403, 'FORBIDDEN');

  const replay = await handoff(requestAid.id, fieldRecorder, directHandoffBody, recorded.idempotencyKey);
  expectSuccess(replay.result, 201);
  assert.equal(replay.result.headers.get('idempotent-replay'), 'true');

  const revokedRecorderGrant = await identityDb.query(
    `UPDATE role_grant SET revoked_at=now()
      WHERE user_id=$1 AND role_code='DISTRIBUTION_STAFF' AND revoked_at IS NULL RETURNING id`, [fieldRecorder.id],
  );
  assert.equal(revokedRecorderGrant.rowCount, 1);
  await identityDb.query('UPDATE app_user SET authz_version=authz_version+1 WHERE id=$1', [fieldRecorder.id]);
  await login(fieldRecorder);
  const revokedReplay = await handoff(requestAid.id, fieldRecorder, directHandoffBody, recorded.idempotencyKey);
  expectVietnameseError(revokedReplay.result, 403, 'FORBIDDEN');

  await logisticsDb.query("UPDATE fulfillment_cycle SET state='OPEN' WHERE id=$1", [needCycle.rows[0].cycle_id]);
  const remainingDispatch = await command(
    logisticsUrl, `distributions/${frozenCandidate.id}/dispatch`, dispatcher, { expected_version: 1 },
  );
  expectSuccess(remainingDispatch);
  const finalHandoff = await handoff(frozenCandidate.id, secondRecorder, {
    ...directHandoffBody,
    lines: [{ distribution_line_id: remainingDispatch.value.lines[0].id, quantity: '5.00' }],
  });
  expectSuccess(finalHandoff.result, 201);

  const fulfilledNeed = await logisticsDb.query(
    `SELECT n.status,COALESCE(sum(cm.delivered_quantity),0)::text AS delivered_quantity
       FROM relief_need n LEFT JOIN commitment cm ON cm.relief_need_id=n.id
      WHERE n.id=$1 GROUP BY n.id,n.status`, [need.id],
  );
  assert.deepEqual(fulfilledNeed.rows, [{ status: 'FULFILLED', delivered_quantity: '10.000' }]);
  const settlementMismatch = await logisticsDb.query(
    'SELECT commitment_id FROM commitment_counter_mismatch WHERE commitment_id=$1', [commitmentId],
  );
  assert.equal(settlementMismatch.rowCount, 0);
  const autoReconcileAudit = await logisticsDb.query(
    `SELECT id FROM audit_log WHERE entity_type='distribution' AND entity_id=$1 AND action='DISTRIBUTION_AUTO_RECONCILED'`,
    [requestAid.id],
  );
  assert.equal(autoReconcileAudit.rowCount, 1);

  const pointDistribution = await createDistribution(staff, warehouse.value.id, item.value.id, '6.00', reliefPoint.value.id);
  const pointIssued = await approveAndDispatch(pointDistribution, approver, dispatcher);
  const pointLineId = pointIssued.lines[0].id;
  const beforeCancellation = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, item.value.id],
  );
  const movementsBeforeCancellation = await logisticsDb.query(
    'SELECT id,movement_type FROM stock_movement WHERE distribution_line_id=$1 ORDER BY id', [pointLineId],
  );
  assert.equal(movementsBeforeCancellation.rows.filter((row) => row.movement_type === 'ISSUE').length, 1);
  const rejectedCancellation = await command(logisticsUrl, `distributions/${pointDistribution.id}/cancel`, staff, {
    expected_version: pointIssued.version,
  });
  expectVietnameseError(rejectedCancellation, 409, 'ALREADY_DISPATCHED');
  const afterCancellation = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, item.value.id],
  );
  const movementsAfterCancellation = await logisticsDb.query(
    'SELECT id,movement_type FROM stock_movement WHERE distribution_line_id=$1 ORDER BY id', [pointLineId],
  );
  assert.deepEqual(afterCancellation.rows, beforeCancellation.rows);
  assert.deepEqual(movementsAfterCancellation.rows, movementsBeforeCancellation.rows);
  assert.equal((await distributionDetail(pointDistribution.id, staff)).status, 'DISPATCHED');
  const receiptBody = {
    handoff_kind: 'POINT_RECEIPT',
    receiver_label: 'Nhân viên điểm cứu trợ T15',
    confirmation_basis: 'Điểm cứu trợ xác nhận số hàng thực nhận.',
    occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: pointLineId, quantity: '4.00' }],
  };
  const receiptKeys = [key(), key()];
  const receiptRace = await Promise.all(receiptKeys.map((idempotencyKey) =>
    handoff(pointDistribution.id, secondRecorder, receiptBody, idempotencyKey)));
  assert.equal(receiptRace.filter(({ result }) => result.status === 201).length, 1, JSON.stringify(receiptRace.map(({ result }) => result.value)));
  const rejectedReceipt = receiptRace.find(({ result }) => result.status !== 201);
  expectVietnameseError(rejectedReceipt.result, 409, 'HANDOFF_EXCEEDS_BALANCE');
  let pointState = await distributionDetail(pointDistribution.id, staff);
  assert.equal(Number(pointState.lines[0].in_transit), 2);
  assert.equal(Number(pointState.lines[0].at_point), 4);

  const overBalanceHandout = await handoff(pointDistribution.id, secondRecorder, {
    handoff_kind: 'HOUSEHOLD_HANDOUT',
    receiver_label: 'Hộ dân T15',
    confirmation_basis: 'Kiểm thử số lượng vượt tồn tại điểm.',
    occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: pointLineId, quantity: '5.00' }],
  });
  expectVietnameseError(overBalanceHandout.result, 409, 'HANDOFF_EXCEEDS_BALANCE');

  const returnResult = await handoff(pointDistribution.id, returner, {
    handoff_kind: 'RETURN',
    source_stage: 'IN_TRANSIT',
    receiver_label: `Kho ${suffix}`,
    confirmation_basis: 'Kho đã nhận lại hàng và kiểm đếm.',
    occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: pointLineId, quantity: '1.00' }],
  });
  expectSuccess(returnResult.result, 201);
  const returnedLineId = returnResult.result.value.lines[0].id;
  const returnMovements = await logisticsDb.query(
    `SELECT movement_type,delta_on_hand::text FROM stock_movement WHERE handoff_line_id=$1`, [returnedLineId],
  );
  assert.deepEqual(returnMovements.rows, [{ movement_type: 'RETURN', delta_on_hand: '1.000' }]);

  const finalReceipt = await handoff(pointDistribution.id, secondRecorder, {
    ...receiptBody,
    lines: [{ distribution_line_id: pointLineId, quantity: '1.00' }],
  });
  expectSuccess(finalReceipt.result, 201);
  const handout = await handoff(pointDistribution.id, secondRecorder, {
    handoff_kind: 'HOUSEHOLD_HANDOUT',
    receiver_label: 'Hộ dân T15',
    confirmation_basis: 'Hộ dân xác nhận đã nhận hàng tại điểm.',
    occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: pointLineId, quantity: '5.00' }],
  });
  expectSuccess(handout.result, 201);
  pointState = await distributionDetail(pointDistribution.id, staff);
  assert.equal(pointState.status, 'RECONCILED');
  assert.equal(Number(pointState.lines[0].in_transit), 0);
  assert.equal(Number(pointState.lines[0].at_point), 0);
  const manualReconcile = await command(logisticsUrl, `distributions/${pointDistribution.id}/reconcile`, approver, {
    expected_version: pointState.version,
  });
  expectSuccess(manualReconcile);
  assert.equal(manualReconcile.value.status, 'RECONCILED');

  const staleDistribution = await createDistribution(staff, warehouse.value.id, item.value.id, '1.00', reliefPoint.value.id);
  const staleApproval = await command(logisticsUrl, `distributions/${staleDistribution.id}/approve`, approver, { expected_version: 1 });
  expectSuccess(staleApproval);
  const edited = await command(logisticsUrl, `distributions/${staleDistribution.id}/lines`, staff, {
    expected_version: 1,
    lines: [{ item_id: item.value.id, quantity: '2.00' }],
  }, key(), 'PUT');
  expectSuccess(edited);
  assert.equal(edited.value.status, 'DRAFT');
  assert.equal(edited.value.version, 2);
  const staleDispatch = await command(logisticsUrl, `distributions/${staleDistribution.id}/dispatch`, dispatcher, { expected_version: 2 });
  expectVietnameseError(staleDispatch, 409, 'APPROVAL_STALE');

  const competingDistributions = await Promise.all([
    createDistribution(staff, warehouse.value.id, item.value.id, '7.00', reliefPoint.value.id),
    createDistribution(staff, warehouse.value.id, item.value.id, '7.00', reliefPoint.value.id),
  ]);
  const competingApprovals = await Promise.all(competingDistributions.map((distribution) =>
    command(logisticsUrl, `distributions/${distribution.id}/approve`, approver, { expected_version: 1 })));
  competingApprovals.forEach((result) => expectSuccess(result));
  const dispatchRace = await Promise.all(competingDistributions.map((distribution) =>
    command(logisticsUrl, `distributions/${distribution.id}/dispatch`, dispatcher, { expected_version: 1 })));
  assert.equal(dispatchRace.filter((result) => result.status === 200).length, 1, JSON.stringify(dispatchRace.map((result) => result.value)));
  expectVietnameseError(dispatchRace.find((result) => result.status !== 200), 409, 'INSUFFICIENT_STOCK');
  const stockAfterDispatchRace = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, item.value.id],
  );
  assert.deepEqual(stockAfterDispatchRace.rows, [{ on_hand: '3.000', reserved: '0.000' }]);

  const lossDistribution = await createDistribution(staff, warehouse.value.id, item.value.id, '2.00', reliefPoint.value.id);
  const lossIssued = await approveAndDispatch(lossDistribution, approver, dispatcher);
  const lossLineId = lossIssued.lines[0].id;
  const pendingLoss = await handoff(lossDistribution.id, secondRecorder, {
    handoff_kind: 'LOSS',
    source_stage: 'IN_TRANSIT',
    confirmation_basis: 'Báo mất hàng, chờ người có thẩm quyền xem xét.',
    occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: lossLineId, quantity: '2.00' }],
  });
  expectSuccess(pendingLoss.result, 201);
  assert.equal(pendingLoss.result.value.status, 'PENDING_LOSS');
  let lossState = await distributionDetail(lossDistribution.id, staff);
  assert.equal(Number(lossState.lines[0].in_transit), 2);
  assert.equal(Number(lossState.lines[0].lost), 0);
  assert.equal(Number(lossState.lines[0].pending_loss_count), 1);
  const blockedReconcile = await command(logisticsUrl, `distributions/${lossDistribution.id}/reconcile`, approver, {
    expected_version: lossState.version,
  });
  expectVietnameseError(blockedReconcile, 409, 'LOSS_REVIEW_REQUIRED');

  const reviewBody = { expected_version: 1, decision: 'APPROVE', reason: 'Đã xác minh mất hàng và vị trí phát sinh.' };
  const reviewKeys = [key(), key()];
  const reviews = await Promise.all([
    command(logisticsUrl, `distributions/${lossDistribution.id}/handoffs/${pendingLoss.result.value.id}/review-loss`, approver, reviewBody, reviewKeys[0]),
    command(logisticsUrl, `distributions/${lossDistribution.id}/handoffs/${pendingLoss.result.value.id}/review-loss`, secondReviewer, reviewBody, reviewKeys[1]),
  ]);
  assert.equal(reviews.filter((result) => result.status === 200).length, 1, JSON.stringify(reviews.map((result) => result.value)));
  const reviewWinnerIndex = reviews.findIndex((result) => result.status === 200);
  const reviewLoser = reviews[1 - reviewWinnerIndex];
  expectVietnameseError(reviewLoser, 409, 'STATE_TRANSITION_INVALID');
  const reviewWinner = reviewWinnerIndex === 0 ? approver : secondReviewer;
  const reviewWinnerKey = reviewKeys[reviewWinnerIndex];
  lossState = await distributionDetail(lossDistribution.id, staff);
  assert.equal(lossState.status, 'RECONCILED');
  assert.equal(Number(lossState.lines[0].in_transit), 0);
  assert.equal(Number(lossState.lines[0].lost), 2);
  const revokedReviewerGrant = await identityDb.query(
    `UPDATE role_grant SET revoked_at=now()
      WHERE user_id=$1 AND role_code='REVIEWER' AND revoked_at IS NULL RETURNING id`, [reviewWinner.id],
  );
  assert.equal(revokedReviewerGrant.rowCount, 1);
  await identityDb.query('UPDATE app_user SET authz_version=authz_version+1 WHERE id=$1', [reviewWinner.id]);
  await login(reviewWinner);
  const revokedReviewReplay = await command(
    logisticsUrl,
    `distributions/${lossDistribution.id}/handoffs/${pendingLoss.result.value.id}/review-loss`,
    reviewWinner,
    reviewBody,
    reviewWinnerKey,
  );
  expectVietnameseError(revokedReviewReplay, 403, 'FORBIDDEN');
  await identityDb.query(
    `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
     VALUES ($1,'REVIEWER','ORGANIZATION',$2)`, [reviewWinner.id, organizationId],
  );
  await identityDb.query('UPDATE app_user SET authz_version=authz_version+1 WHERE id=$1', [reviewWinner.id]);
  await login(reviewWinner);

  const targetItem = await command(logisticsUrl, 'items', staff, {
    item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư giao tại điểm T15 ${suffix}`,
  });
  expectSuccess(targetItem, 201);
  expectSuccess(await command(logisticsUrl, 'stock/opening', staff, {
    warehouse_id: warehouse.value.id,
    lines: [{ item_id: targetItem.value.id, quantity: '3.00' }],
    note: 'Tồn kiểm thử giao tại điểm và đối soát sau niêm phong.',
  }), 201);
  const targetRequest = await createRequest(reporter);
  await verifyRequest(targetRequest, staff);
  const targetRequestState = await responseDb.query(
    'SELECT version,work_cycle FROM assistance_request WHERE id=$1', [targetRequest.id],
  );
  expectSuccess(await command(responseUrl, `requests/${targetRequest.id}/triage`, staff, {
    expected_version: Number(targetRequestState.rows[0].version), priority: 'P3', priority_basis: 'COMPLETE',
  }));
  const targetNeed = await command(logisticsUrl, 'needs', staff, {
    request_id: targetRequest.id, work_cycle: Number(targetRequestState.rows[0].work_cycle),
    item_id: targetItem.value.id, quantity: '3.00', designated_point_id: reliefPoint.value.id,
    reason: 'Điểm cứu trợ tiếp nhận hàng cho khu dân cư.',
  });
  expectSuccess(targetNeed, 201);
  assert.equal(targetNeed.value.delivery_target_kind, 'RELIEF_POINT');
  const targetCommitment = await command(logisticsUrl, `needs/${targetNeed.value.id}/commitments`, staff, {
    warehouse_id: warehouse.value.id, quantity: '3.00',
  });
  expectSuccess(targetCommitment, 201);
  const targetDistribution = await createDistribution(
    staff, warehouse.value.id, targetItem.value.id, '3.00', reliefPoint.value.id, targetCommitment.value.id,
  );
  const targetIssued = await approveAndDispatch(targetDistribution, approver, dispatcher);
  const targetLineId = targetIssued.lines[0].id;
  const targetReceipt = await handoff(targetDistribution.id, secondRecorder, {
    handoff_kind: 'POINT_RECEIPT', receiver_label: 'Nhân viên điểm cứu trợ T15',
    confirmation_basis: 'Điểm cứu trợ đã kiểm đếm đủ hàng.', occurred_at: new Date().toISOString(),
    lines: [{ distribution_line_id: targetLineId, quantity: '3.00' }],
  });
  expectSuccess(targetReceipt.result, 201);
  const targetFulfillment = await call(logisticsUrl, `requests/${targetRequest.id}/fulfillment`, { actor: staff });
  expectSuccess(targetFulfillment);
  assert.equal(targetFulfillment.value.needs[0].status, 'FULFILLED');
  assert.equal(Number(targetFulfillment.value.needs[0].delivered), 3);
  const settlementBeforeCustody = await logisticsDb.query(
    'SELECT handoff_line_id,commitment_id,settlement_type FROM issued_line_settlement WHERE commitment_id=$1 ORDER BY handoff_line_id',
    [targetCommitment.value.id],
  );
  assert.deepEqual(settlementBeforeCustody.rows, [{
    handoff_line_id: targetReceipt.result.value.lines[0].id,
    commitment_id: targetCommitment.value.id, settlement_type: 'DELIVERED',
  }]);
  const countersBeforeCustody = await logisticsDb.query(
    'SELECT issued_quantity::text,delivered_quantity::text,returned_quantity::text,lost_quantity::text,version FROM commitment WHERE id=$1',
    [targetCommitment.value.id],
  );
  assert.equal(Number(countersBeforeCustody.rows[0].issued_quantity), 3);
  assert.equal(Number(countersBeforeCustody.rows[0].delivered_quantity), 3);
  const beforeResolve = await responseDb.query('SELECT version FROM assistance_request WHERE id=$1', [targetRequest.id]);
  const targetResolution = await command(responseUrl, `requests/${targetRequest.id}/resolve`, staff, {
    expected_version: Number(beforeResolve.rows[0].version), outcome_basis: 'SUPPLY_ONLY',
    resolution_reason: 'Điểm cứu trợ đã tiếp nhận đủ nhu cầu được giao.',
  });
  expectSuccess(targetResolution, 202);
  const targetOperation = await call(responseUrl, `operations/${targetResolution.value.operation_id}`, { actor: staff });
  expectSuccess(targetOperation);
  assert.equal(targetOperation.value.state, 'COMPLETED');
  const targetCycle = await logisticsDb.query('SELECT state FROM fulfillment_cycle WHERE request_id=$1', [targetRequest.id]);
  assert.deepEqual(targetCycle.rows, [{ state: 'SEALED' }]);

  for (const [kind, actor] of [['HOUSEHOLD_HANDOUT', secondRecorder], ['RETURN', returner], ['LOSS', secondRecorder]]) {
    const custody = await handoff(targetDistribution.id, actor, {
      handoff_kind: kind,
      ...(kind === 'HOUSEHOLD_HANDOUT' ? {} : { source_stage: 'AT_POINT' }),
      ...(kind === 'LOSS' ? {} : { receiver_label: kind === 'RETURN' ? `Kho ${suffix}` : 'Hộ dân tại điểm T15' }),
      confirmation_basis: 'Xác nhận biến động hàng thực tế tại điểm sau khi hoàn thành nhu cầu.',
      occurred_at: new Date().toISOString(),
      lines: [{ distribution_line_id: targetLineId, quantity: '1.00' }],
    });
    expectSuccess(custody.result, 201);
    if (kind === 'LOSS') {
      assert.equal(custody.result.value.status, 'PENDING_LOSS');
      expectSuccess(await command(logisticsUrl, `distributions/${targetDistribution.id}/handoffs/${custody.result.value.id}/review-loss`, approver, {
        expected_version: 1, decision: 'APPROVE', reason: 'Đã kiểm tra và xác nhận mất hàng tại điểm.',
      }));
    }
    const countersAfterCustody = await logisticsDb.query(
      'SELECT issued_quantity::text,delivered_quantity::text,returned_quantity::text,lost_quantity::text,version FROM commitment WHERE id=$1',
      [targetCommitment.value.id],
    );
    assert.deepEqual(countersAfterCustody.rows, countersBeforeCustody.rows);
    const settlementsAfterCustody = await logisticsDb.query(
      'SELECT handoff_line_id,commitment_id,settlement_type FROM issued_line_settlement WHERE commitment_id=$1 ORDER BY handoff_line_id',
      [targetCommitment.value.id],
    );
    assert.deepEqual(settlementsAfterCustody.rows, settlementBeforeCustody.rows);
  }
  const targetFinalState = await distributionDetail(targetDistribution.id, staff);
  assert.equal(targetFinalState.status, 'RECONCILED');
  assert.equal(Number(targetFinalState.lines[0].in_transit), 0);
  assert.equal(Number(targetFinalState.lines[0].at_point), 0);
  assert.equal(Number(targetFinalState.lines[0].lost), 1);
  const targetStock = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, targetItem.value.id],
  );
  assert.deepEqual(targetStock.rows, [{ on_hand: '1.000', reserved: '0.000' }]);

  const raceItem = await command(logisticsUrl, 'items', staff, {
    item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư đua ngừng hoạt động T15 ${suffix}`,
  });
  expectSuccess(raceItem, 201);
  const raceOpening = await command(logisticsUrl, 'stock/opening', staff, {
    warehouse_id: warehouse.value.id,
    lines: [{ item_id: raceItem.value.id, quantity: '1.00' }],
    note: 'Tồn đầu kỳ kiểm thử khóa vật tư T15.',
  });
  expectSuccess(raceOpening, 201);
  const itemRaceDistribution = await createDistribution(staff, warehouse.value.id, raceItem.value.id, '1.00', reliefPoint.value.id);
  const itemRaceApproval = await command(logisticsUrl, `distributions/${itemRaceDistribution.id}/approve`, approver, { expected_version: 1 });
  expectSuccess(itemRaceApproval);
  await logisticsDb.query('BEGIN');
  let deactivateRace;
  let itemDispatchRace;
  try {
    await logisticsDb.query('SELECT id FROM item WHERE id=$1 FOR UPDATE', [raceItem.value.id]);
    deactivateRace = command(logisticsUrl, `items/${raceItem.value.id}/deactivate`, staff, { expected_version: 1 });
    const deactivationWaiter = await waitForLockWait('item', 'item deactivation');
    itemDispatchRace = command(
      logisticsUrl,
      `distributions/${itemRaceDistribution.id}/dispatch`,
      dispatcher,
      { expected_version: 1 },
    );
    await waitForLockWait('item', 'catalog item', deactivationWaiter);
    await logisticsDb.query('COMMIT');
    expectSuccess(await deactivateRace);
    expectVietnameseError(await itemDispatchRace, 400, 'VALIDATION_FAILED');
  } catch (error) {
    await logisticsDb.query('ROLLBACK').catch(() => undefined);
    await Promise.allSettled([deactivateRace, itemDispatchRace].filter(Boolean));
    throw error;
  }
  const raceItemBalance = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, raceItem.value.id],
  );
  assert.deepEqual(raceItemBalance.rows, [{ on_hand: '1.000', reserved: '0.000' }]);
  const raceItemMovements = await logisticsDb.query(
    `SELECT count(*)::int AS count FROM stock_movement m JOIN stock_balance b ON b.id=m.balance_id
      WHERE b.item_id=$1 AND m.movement_type='ISSUE'`, [raceItem.value.id],
  );
  assert.equal(raceItemMovements.rows[0].count, 0);

  const assetRaceDistribution = await createDistribution(staff, warehouse.value.id, item.value.id, '1.00', reliefPoint.value.id);
  const assetRaceApproval = await command(logisticsUrl, `distributions/${assetRaceDistribution.id}/approve`, approver, { expected_version: 1 });
  expectSuccess(assetRaceApproval);
  await logisticsDb.query('BEGIN');
  let assetDispatchRace;
  try {
    const inactive = await logisticsDb.query("UPDATE relief_point SET status='INACTIVE' WHERE id=$1", [reliefPoint.value.id]);
    assert.equal(inactive.rowCount, 1);
    assetDispatchRace = command(
      logisticsUrl,
      `distributions/${assetRaceDistribution.id}/dispatch`,
      dispatcher,
      { expected_version: 1 },
    );
    await waitForLockWait('relief_point', 'relief point');
    await logisticsDb.query('COMMIT');
    const rejectedDispatch = await assetDispatchRace;
    expectVietnameseError(rejectedDispatch, 409, 'POINT_INACTIVE');
  } catch (error) {
    await logisticsDb.query('ROLLBACK').catch(() => undefined);
    if (assetDispatchRace) await assetDispatchRace.catch(() => undefined);
    throw error;
  }
  const remainingStock = await logisticsDb.query(
    'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
    [warehouse.value.id, item.value.id],
  );
  assert.deepEqual(remainingStock.rows, [{ on_hand: '1.000', reserved: '0.000' }]);

  const distributionList = await call(logisticsUrl, 'distributions?status=RECONCILED&limit=10', { actor: dispatcher });
  expectSuccess(distributionList);
  assert.ok(distributionList.value.items.some((row) => row.id === requestAid.id));
  const needAudit = await logisticsDb.query(
    `SELECT id FROM audit_log WHERE entity_type='relief_need' AND entity_id=$1 AND action='NEED_AUTO_FULFILLED'`, [need.id],
  );
  assert.equal(needAudit.rowCount, 1);
  console.log('Logistics T15 distribution and handoff database tests passed.');
} finally {
  await Promise.all([logisticsDb.end(), responseDb.end(), identityDb.end()]);
}
