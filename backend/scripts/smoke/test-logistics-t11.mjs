import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { activateEmailRegistration, withEmail } from './lib/email-registration.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const logisticsUrl = requiredEnv('C48_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const logisticsDb = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const identityNetwork = randomBytes(2);
let identityIp = 10;

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

async function registerAndLogin(label, roles) {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t11${label}${suffix}`,
    display_name: `Người dùng kiểm thử T11 ${label} ${suffix}`,
    password: `Logistics T11 test ${suffix}!`,
  };
  const sourceIp = `10.${identityNetwork.readUInt8(0)}.${identityNetwork.readUInt8(1)}.${identityIp++}`;
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: withEmail(credentials),
    idempotencyKey: key(),
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  await activateEmailRegistration(identityDb, registered);
  const userId = registered.value.user.id;
  for (const role of roles) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type)
       VALUES ($1,$2,'SYSTEM')`,
      [userId, role],
    );
  }
  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: userId, token: login.value.access_token };
}

function quantityMilli(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, '0'));
}

await Promise.all([logisticsDb.connect(), identityDb.connect()]);
try {
  const operator = await registerAndLogin('ops', ['OPERATIONS_MANAGER']);
  const requester = await registerAndLogin('requester', ['OPERATIONS_MANAGER', 'REVIEWER']);
  const reviewers = await Promise.all([
    registerAndLogin('reviewer_a', ['REVIEWER']),
    registerAndLogin('reviewer_b', ['REVIEWER']),
  ]);
  const suffix = randomBytes(5).toString('hex').toUpperCase();
  const typeCode = `T11_${suffix}`;
  const unitCode = `T11_U_${suffix}`;

  const itemType = await call(logisticsUrl, 'item-types', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { code: typeCode, display_name: 'Vật tư kiểm thử T11' },
  });
  expectSuccess(itemType, 201);
  const unit = await call(logisticsUrl, 'units', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { code: unitCode, display_name: 'Đơn vị kiểm thử T11', scale: 2 },
  });
  expectSuccess(unit, 201);
  const item = await call(logisticsUrl, 'items', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { item_type_code: typeCode, unit_code: unitCode, name: `Vật tư T11 ${suffix}` },
  });
  expectSuccess(item, 201);
  const itemTypes = await call(logisticsUrl, 'item-types?limit=100', { actor: operator });
  const units = await call(logisticsUrl, 'units?limit=100', { actor: operator });
  const items = await call(logisticsUrl, `items?type=${typeCode}&limit=100`, { actor: operator });
  expectSuccess(itemTypes);
  expectSuccess(units);
  expectSuccess(items);
  assert.ok(itemTypes.value.items.some((row) => row.code === typeCode));
  assert.ok(units.value.items.some((row) => row.code === unitCode));
  assert.ok(items.value.items.some((row) => row.id === item.value.id));

  const warehouse = await call(logisticsUrl, 'warehouses', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { name: `Kho T11 ${suffix}` },
  });
  expectSuccess(warehouse, 201);
  const point = await call(logisticsUrl, 'relief-points', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: {
      name: `Điểm cứu trợ T11 ${suffix}`,
      location: { type: 'Point', coordinates: [105.85, 21.03] },
    },
  });
  expectSuccess(point, 201);
  const vehicle = await call(logisticsUrl, 'vehicles', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: {
      identifier: `T11-${suffix}`, vehicle_type: 'Xe tải kiểm thử', capacity: '100.00', capacity_unit: unitCode,
    },
  });
  expectSuccess(vehicle, 201);
  for (const [path, id] of [
    ['warehouses?limit=100', warehouse.value.id],
    ['relief-points?limit=100', point.value.id],
    ['vehicles?limit=100', vehicle.value.id],
  ]) {
    const listed = await call(logisticsUrl, path, { actor: operator });
    expectSuccess(listed);
    assert.ok(listed.value.items.some((row) => row.id === id));
  }
  const pointDetail = await call(logisticsUrl, `relief-points/${point.value.id}`, { actor: operator });
  expectSuccess(pointDetail);
  assert.equal(pointDetail.value.id, point.value.id);

  const invalidPointPatch = await call(logisticsUrl, `relief-points/${point.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, location: { type: 'Point', coordinates: [181, 21.03] } },
  });
  expectVietnameseError(invalidPointPatch, 400, 'VALIDATION_FAILED');

  const updatedWarehouse = await call(logisticsUrl, `warehouses/${warehouse.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, name: `Kho T11 cập nhật ${suffix}`, location_public: true },
  });
  expectSuccess(updatedWarehouse);
  assert.equal(updatedWarehouse.value.version, 2);
  assert.equal(updatedWarehouse.value.location_public, true);

  // Warehouse service area: location and service_radius_m are set and cleared together. A separate warehouse keeps the
  // version sequence of the main warehouse above unchanged for the deactivation step.
  const areaLocation = { type: 'Point', coordinates: [105.85, 21.03] };
  const areaWarehouse = await call(logisticsUrl, 'warehouses', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { name: `Kho vùng phục vụ T11 ${suffix}`, location: areaLocation, service_radius_m: 5000 },
  });
  expectSuccess(areaWarehouse, 201);
  assert.deepEqual(areaWarehouse.value.location, areaLocation);
  assert.equal(areaWarehouse.value.service_radius_m, 5000);

  const radiusWithoutLocation = await call(logisticsUrl, 'warehouses', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { name: `Kho T11 thiếu vị trí ${suffix}`, service_radius_m: 5000 },
  });
  expectVietnameseError(radiusWithoutLocation, 400, 'VALIDATION_FAILED');
  assert.ok(radiusWithoutLocation.value.field_errors?.service_radius_m, JSON.stringify(radiusWithoutLocation.value));

  for (const radius of [0, 200001]) {
    const invalidRadius = await call(logisticsUrl, 'warehouses', {
      method: 'POST', actor: operator, idempotencyKey: key(),
      body: { name: `Kho T11 bán kính sai ${suffix}`, location: areaLocation, service_radius_m: radius },
    });
    expectVietnameseError(invalidRadius, 400, 'VALIDATION_FAILED');
    assert.ok(invalidRadius.value.field_errors?.service_radius_m, JSON.stringify(invalidRadius.value));
  }

  const clearLocationOnly = await call(logisticsUrl, `warehouses/${areaWarehouse.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, location: null },
  });
  expectVietnameseError(clearLocationOnly, 400, 'VALIDATION_FAILED');

  const radiusPatched = await call(logisticsUrl, `warehouses/${areaWarehouse.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, service_radius_m: 8000 },
  });
  expectSuccess(radiusPatched);
  assert.equal(radiusPatched.value.version, 2);
  assert.equal(radiusPatched.value.service_radius_m, 8000);
  assert.deepEqual(radiusPatched.value.location, areaLocation);

  const areaListed = await call(logisticsUrl, 'warehouses?limit=100', { actor: operator });
  expectSuccess(areaListed);
  const areaRow = areaListed.value.items.find((row) => row.id === areaWarehouse.value.id);
  assert.equal(areaRow?.service_radius_m, 8000);
  assert.deepEqual(areaRow?.location, areaLocation);

  const areaCleared = await call(logisticsUrl, `warehouses/${areaWarehouse.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 2, location: null, service_radius_m: null },
  });
  expectSuccess(areaCleared);
  assert.equal(areaCleared.value.service_radius_m, null);
  assert.equal(areaCleared.value.location, null);

  const updatedPoint = await call(logisticsUrl, `relief-points/${point.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, operating_note: `T11 cập nhật ${suffix}` },
  });
  expectSuccess(updatedPoint);
  assert.equal(updatedPoint.value.version, 2);
  assert.equal(updatedPoint.value.operating_note, `T11 cập nhật ${suffix}`);

  const stalePointPatch = await call(logisticsUrl, `relief-points/${point.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, name: `Điểm cũ ${suffix}` },
  });
  expectVietnameseError(stalePointPatch, 409, 'VERSION_CONFLICT');

  const updatedVehicle = await call(logisticsUrl, `vehicles/${vehicle.value.id}`, {
    method: 'PATCH', actor: operator, idempotencyKey: key(),
    body: { expected_version: 1, identifier: `T11-${suffix}-UPDATED`, capacity: '120.00', capacity_unit: unitCode },
  });
  expectSuccess(updatedVehicle);
  assert.equal(updatedVehicle.value.version, 2);
  assert.equal(updatedVehicle.value.capacity, '120.000');

  const opening = await call(logisticsUrl, 'stock/opening', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { warehouse_id: warehouse.value.id, lines: [{ item_id: item.value.id, quantity: '10.00' }], note: 'Tồn đầu kỳ T11' },
  });
  expectSuccess(opening, 201);
  const balanceId = opening.value.items[0]?.balance_id;
  assert.ok(balanceId);

  const adjustment = await call(logisticsUrl, 'stock/adjustments', {
    method: 'POST', actor: requester, idempotencyKey: key(),
    body: { balance_id: balanceId, delta_on_hand: '2.50', reason: 'Điều chỉnh kiểm kê T11' },
  });
  expectSuccess(adjustment, 201);
  assert.equal(adjustment.value.status, 'PENDING');
  const adjustmentId = adjustment.value.id;

  const selfReview = await call(logisticsUrl, `stock/adjustments/${adjustmentId}/review`, {
    method: 'POST', actor: requester, idempotencyKey: key(), body: { decision: 'APPROVE' },
  });
  expectVietnameseError(selfReview, 403, 'FORBIDDEN');

  const reviews = await Promise.all(reviewers.map((actor) => call(logisticsUrl, `stock/adjustments/${adjustmentId}/review`, {
    method: 'POST', actor, idempotencyKey: key(), body: { decision: 'APPROVE' },
  })));
  assert.equal(reviews.filter((result) => result.status === 200).length, 1, JSON.stringify(reviews.map((result) => result.value)));
  const conflict = reviews.find((result) => result.status !== 200);
  expectVietnameseError(conflict, 409, 'STATE_TRANSITION_INVALID');

  const balance = await call(logisticsUrl, `stock?warehouse_id=${warehouse.value.id}&item_id=${item.value.id}`, { actor: requester });
  expectSuccess(balance);
  assert.equal(balance.value.items.length, 1);
  assert.equal(quantityMilli(balance.value.items[0].on_hand), 12_500n);
  assert.equal(quantityMilli(balance.value.items[0].reserved), 0n);
  assert.equal(quantityMilli(balance.value.items[0].available), 12_500n);

  const movements = await call(logisticsUrl, `stock/${balanceId}/movements?limit=100`, { actor: requester });
  expectSuccess(movements);
  assert.equal(movements.value.items.filter((row) => row.movement_type === 'OPENING').length, 1);
  assert.equal(movements.value.items.filter((row) => row.movement_type === 'ADJUSTMENT').length, 1);
  const pending = await call(logisticsUrl, 'stock/adjustments?status=APPROVED&limit=100', { actor: requester });
  expectSuccess(pending);
  assert.ok(pending.value.items.some((row) => row.id === adjustmentId && row.status === 'APPROVED'));

  const ledger = await logisticsDb.query(
    `SELECT b.on_hand = coalesce(sum(m.delta_on_hand),0) AS balanced,
            count(m.id) FILTER (WHERE m.adjustment_id=$2) AS adjustment_movements
       FROM stock_balance b JOIN stock_movement m ON m.balance_id=b.id
      WHERE b.id=$1 GROUP BY b.id`,
    [balanceId, adjustmentId],
  );
  assert.equal(ledger.rows[0]?.balanced, true, 'stock balance must equal the append-only movement sum');
  assert.equal(Number(ledger.rows[0]?.adjustment_movements), 1, 'approval race must post exactly one movement');

  const deactivatedItem = await call(logisticsUrl, `items/${item.value.id}/deactivate`, {
    method: 'POST', actor: operator, idempotencyKey: key(), body: { expected_version: item.value.version },
  });
  expectSuccess(deactivatedItem);
  assert.equal(deactivatedItem.value.status, 'INACTIVE');
  assert.equal(deactivatedItem.value.version, item.value.version + 1);
  const inactiveItems = await call(logisticsUrl, `items?type=${typeCode}&status=INACTIVE&limit=100`, { actor: operator });
  expectSuccess(inactiveItems);
  const retainedItem = inactiveItems.value.items.find((row) => row.id === item.value.id);
  assert.equal(retainedItem?.status, 'INACTIVE');
  assert.equal(retainedItem?.version, deactivatedItem.value.version);
  const openingWithInactiveItem = await call(logisticsUrl, 'stock/opening', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: { warehouse_id: warehouse.value.id, lines: [{ item_id: item.value.id, quantity: '1.00' }], note: 'Không thể nhập hàng cho vật tư đã ngừng sử dụng.' },
  });
  expectVietnameseError(openingWithInactiveItem, 400, 'VALIDATION_FAILED');

  for (const [path, asset] of [
    ['warehouses', warehouse.value],
    ['relief-points', point.value],
    ['vehicles', vehicle.value],
  ]) {
    const deactivated = await call(logisticsUrl, `${path}/${asset.id}/deactivate`, {
      method: 'POST', actor: operator, idempotencyKey: key(), body: { expected_version: 2 },
    });
    expectSuccess(deactivated);
    assert.equal(deactivated.value.status, 'INACTIVE');
    assert.equal(deactivated.value.version, 3);

    const historical = await call(logisticsUrl, `${path}?status=INACTIVE&limit=100`, { actor: operator });
    expectSuccess(historical);
    const retained = historical.value.items.find((row) => row.id === asset.id);
    assert.equal(retained?.status, 'INACTIVE');
    assert.equal(retained?.version, 3);
  }

  const assetHistory = await logisticsDb.query(
    `SELECT action,entity_id,before_state,after_state FROM audit_log
      WHERE entity_type=ANY($1::text[]) AND entity_id=ANY($2::text[]) AND action=ANY($3::text[])`,
    [
      ['warehouse', 'relief_point', 'vehicle'],
      [warehouse.value.id, point.value.id, vehicle.value.id],
      ['WAREHOUSE_CREATED', 'WAREHOUSE_UPDATED', 'WAREHOUSE_DEACTIVATED', 'RELIEF_POINT_CREATED', 'RELIEF_POINT_UPDATED',
        'RELIEF_POINT_DEACTIVATED', 'VEHICLE_CREATED', 'VEHICLE_UPDATED', 'VEHICLE_DEACTIVATED'],
    ],
  );
  assert.equal(assetHistory.rowCount, 9, 'asset create, update and deactivation audit history must be retained');
  for (const [asset, prefix] of [
    [warehouse.value, 'WAREHOUSE'],
    [point.value, 'RELIEF_POINT'],
    [vehicle.value, 'VEHICLE'],
  ]) {
    const history = assetHistory.rows.filter((row) => row.entity_id === asset.id);
    assert.equal(history.length, 3, `expected create, update and deactivation history for ${prefix}`);
    const created = history.find((row) => row.action === `${prefix}_CREATED`);
    const updated = history.find((row) => row.action === `${prefix}_UPDATED`);
    const deactivated = history.find((row) => row.action === `${prefix}_DEACTIVATED`);
    assert.equal(created?.before_state, null);
    assert.equal(created?.after_state.version, 1);
    assert.equal(updated?.before_state.version, 1);
    assert.equal(updated?.after_state.version, 2);
    assert.equal(deactivated?.before_state.version, 2);
    assert.equal(deactivated?.after_state.version, 3);
  }

  console.log('PASS Logistics T11 catalog, asset CRUD/scope/history, stock opening, independent adjustment review race, and ledger reads');
} finally {
  await Promise.all([logisticsDb.end(), identityDb.end()]);
}
