import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const logisticsUrl = requiredEnv('TEST_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('TEST_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const logisticsDb = new Client({ connectionString: requiredEnv('TEST_LOGISTICS_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('TEST_IDENTITY_DATABASE_URL') });
const organizationId = randomUUID();
const regionCode = `T11_${randomBytes(5).toString('hex').toUpperCase()}`;
let identityIp = 200;

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
  const sourceIp = `198.51.100.${identityIp++}`;
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials,
    idempotencyKey: key(),
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  const userId = registered.value.user.id;
  for (const role of roles) {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
       VALUES ($1,$2,'ORGANIZATION',$3)`,
      [userId, role, organizationId],
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
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind) VALUES ($1,$2,'COORDINATION')`,
    [organizationId, `T11 test ${organizationId}`],
  );
  await identityDb.query(
    'INSERT INTO region (code,name) VALUES ($1,$2)',
    [regionCode, 'Khu vực kiểm thử T11'],
  );

  const operator = await registerAndLogin('ops', ['OPERATIONS_MANAGER']);
  const requester = await registerAndLogin('requester', ['INTAKE_STAFF', 'REVIEWER']);
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
    body: { organization_id: organizationId, region_code: regionCode, name: `Kho T11 ${suffix}` },
  });
  expectSuccess(warehouse, 201);
  const point = await call(logisticsUrl, 'relief-points', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: {
      organization_id: organizationId, region_code: regionCode, name: `Điểm cứu trợ T11 ${suffix}`,
      location: { type: 'Point', coordinates: [105.85, 21.03] },
    },
  });
  expectSuccess(point, 201);
  const vehicle = await call(logisticsUrl, 'vehicles', {
    method: 'POST', actor: operator, idempotencyKey: key(),
    body: {
      organization_id: organizationId, region_code: regionCode,
      identifier: `T11-${suffix}`, vehicle_type: 'Xe tải kiểm thử',
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

  console.log('PASS Logistics T11 catalog, assets, stock opening, independent adjustment review race, and ledger reads');
} finally {
  await Promise.all([logisticsDb.end(), identityDb.end()]);
}
