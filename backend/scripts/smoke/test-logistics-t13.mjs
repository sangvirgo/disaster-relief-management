import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const logisticsUrl = requiredEnv('C48_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const logisticsDb = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const organizationId = randomUUID();
const regionCode = `T13_${randomBytes(5).toString('hex').toUpperCase()}`;
let identityIp = 210;

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
  assert.ok((Array.isArray(code) ? code : [code]).includes(result.value?.code), JSON.stringify(result.value));
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese user-facing copy');
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

async function registerAndLogin(label, roles) {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t13${label}${suffix}`,
    display_name: `Người dùng kiểm thử T13 ${label} ${suffix}`,
    password: `Logistics T13 test ${suffix}!`,
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

function addDays(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

await Promise.all([logisticsDb.connect(), identityDb.connect()]);
try {
  await identityDb.query('INSERT INTO organization (id,name,organization_kind) VALUES ($1,$2,\'COORDINATION\')',
    [organizationId, `T13 test ${organizationId}`]);
  await identityDb.query('INSERT INTO region (code,name) VALUES ($1,$2)', [regionCode, 'Khu vực kiểm thử T13']);

  const manager = await registerAndLogin('manager', ['OPERATIONS_MANAGER', 'INTAKE_STAFF', 'CAMPAIGN_MANAGER']);
  const counter = await registerAndLogin('counter', ['INTAKE_STAFF', 'REVIEWER']);
  const reviewer = await registerAndLogin('reviewer', ['REVIEWER']);
  const donor = await registerAndLogin('donor', []);
  const suffix = randomBytes(5).toString('hex').toUpperCase();
  const itemType = await call(logisticsUrl, 'item-types', {
    method: 'POST', actor: manager, idempotencyKey: key(), body: { code: `T13_${suffix}`, display_name: 'Vật tư kiểm thử T13' },
  });
  expectSuccess(itemType, 201);
  const unit = await call(logisticsUrl, 'units', {
    method: 'POST', actor: manager, idempotencyKey: key(), body: { code: `T13_U_${suffix}`, display_name: 'Thùng T13', scale: 2 },
  });
  expectSuccess(unit, 201);
  const item = await call(logisticsUrl, 'items', {
    method: 'POST', actor: manager, idempotencyKey: key(),
    body: { item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Vật tư T13 ${suffix}` },
  });
  expectSuccess(item, 201);
  const warehouse = await call(logisticsUrl, 'warehouses', {
    method: 'POST', actor: manager, idempotencyKey: key(),
    body: { organization_id: organizationId, region_code: regionCode, name: `Kho T13 ${suffix}` },
  });
  expectSuccess(warehouse, 201);
  const drive = await call(logisticsUrl, 'donation-drives', {
    method: 'POST', actor: manager, idempotencyKey: key(),
    body: { title: `Đợt quyên góp T13 ${suffix}`, intake_warehouse_id: warehouse.value.id,
      items: [{ item_id: item.value.id, target_quantity: '20.00' }] },
  });
  expectSuccess(drive, 201);
  const opened = await call(logisticsUrl, `donation-drives/${drive.value.id}/open`, {
    method: 'POST', actor: manager, idempotencyKey: key(), body: { expected_version: drive.value.version },
  });
  expectSuccess(opened, 200);

  const delivery = await call(logisticsUrl, `public/donation-drives/${drive.value.id}/deliveries`, {
    method: 'POST', actor: donor, idempotencyKey: key(),
    body: { donor_name: 'Người quyên góp T13', donor_phone: '09033334444', lines: [{ item_id: item.value.id, declared_quantity: '10.00' }] },
  });
  expectSuccess(delivery, 201);
  const createKey = key();
  const receiptBody = { delivery_id: delivery.value.id, warehouse_id: warehouse.value.id };
  const created = await call(logisticsUrl, 'donation-receipts', {
    method: 'POST', actor: counter, idempotencyKey: createKey, body: receiptBody,
  });
  expectSuccess(created, 201);
  const createReplay = await call(logisticsUrl, 'donation-receipts', {
    method: 'POST', actor: counter, idempotencyKey: createKey, body: receiptBody,
  });
  expectSuccess(createReplay, 201);
  assert.equal(createReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(createReplay.value.id, created.value.id);
  const receiptId = created.value.id;

  const queue = await call(logisticsUrl, `donation-deliveries?drive_id=${drive.value.id}&limit=10`, { actor: manager });
  expectSuccess(queue);
  assert.equal(queue.value.items.find((row) => row.id === delivery.value.id)?.donor_phone, '09*******44');
  const invalidSplit = await call(logisticsUrl, `donation-receipts/${receiptId}/counts`, {
    method: 'POST', actor: counter, idempotencyKey: key(),
    body: { expected_version: 1, lines: [{ item_id: item.value.id, counted_quantity: '8.00', accepted_quantity: '5.00', held_quantity: '2.00', rejected_quantity: '0.00' }] },
  });
  expectVietnameseError(invalidSplit, 400, 'COUNT_SPLIT_MISMATCH');

  const firstCountBody = { expected_version: 1, note: 'Kiểm đếm lần đầu.', lines: [{
    item_id: item.value.id, counted_quantity: '8.00', accepted_quantity: '5.00', held_quantity: '2.00', rejected_quantity: '1.00',
    condition_note: 'Bao bì móp.', expiry_date: addDays(10),
  }] };
  const counted = await call(logisticsUrl, `donation-receipts/${receiptId}/counts`, {
    method: 'POST', actor: counter, idempotencyKey: key(), body: firstCountBody,
  });
  expectSuccess(counted);
  assert.equal(counted.value.count.revision, 1);
  assert.deepEqual(counted.value.count.lines[0].flags.sort(), ['EXPIRING_SOON', 'SHORT']);
  assert.equal(counted.value.count.lines[0].declared_quantity, '10.000');
  const donorTracking = await call(logisticsUrl, `public/donations/${delivery.value.id}`, { actor: donor });
  expectSuccess(donorTracking);
  assert.equal(donorTracking.value.receipt.count_revision, 1);
  assert.deepEqual(Object.keys(donorTracking.value.receipt.lines[0]).sort(), [
    'accepted_quantity', 'condition_note', 'counted_quantity', 'declared_quantity', 'held_quantity', 'item_id', 'rejected_quantity',
  ]);
  assert.equal(Object.hasOwn(donorTracking.value.receipt, 'note'), false);

  const staleCount = await call(logisticsUrl, `donation-receipts/${receiptId}/counts`, {
    method: 'POST', actor: counter, idempotencyKey: key(), body: firstCountBody,
  });
  expectVietnameseError(staleCount, 409, 'VERSION_CONFLICT');

  const selfReview = await call(logisticsUrl, `donation-receipts/${receiptId}/review`, {
    method: 'POST', actor: counter, idempotencyKey: key(),
    body: { expected_version: 2, count_revision: 1, declaration_revision: 1, decision: 'APPROVE' },
  });
  expectVietnameseError(selfReview, 403, 'SELF_REVIEW_FORBIDDEN');
  const approved = await call(logisticsUrl, `donation-receipts/${receiptId}/review`, {
    method: 'POST', actor: reviewer, idempotencyKey: key(),
    body: { expected_version: 2, count_revision: 1, declaration_revision: 1, decision: 'APPROVE' },
  });
  expectSuccess(approved);
  assert.equal(approved.value.delivery.status, 'APPROVED');

  const selfPost = await call(logisticsUrl, `donation-receipts/${receiptId}/post`, {
    method: 'POST', actor: counter, idempotencyKey: key(), body: { expected_version: 3 },
  });
  expectVietnameseError(selfPost, 403, 'SELF_REVIEW_FORBIDDEN');
  const postKeys = [key(), key()];
  const postResults = await Promise.all(postKeys.map((postKey) => call(logisticsUrl, `donation-receipts/${receiptId}/post`, {
    method: 'POST', actor: reviewer, idempotencyKey: postKey, body: { expected_version: 3 },
  })));
  assert.equal(postResults.filter((result) => result.status === 200).length, 1, JSON.stringify(postResults.map((result) => result.value)));
  const failedPost = postResults.find((result) => result.status !== 200);
  expectVietnameseError(failedPost, 409, ['VERSION_CONFLICT', 'ALREADY_POSTED']);
  const winningPostKey = postKeys[postResults.findIndex((result) => result.status === 200)];
  const postReplay = await call(logisticsUrl, `donation-receipts/${receiptId}/post`, {
    method: 'POST', actor: reviewer, idempotencyKey: winningPostKey, body: { expected_version: 3 },
  });
  expectSuccess(postReplay);
  assert.equal(postReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(postReplay.value.delivery.status, 'POSTED');
  const alreadyPosted = await call(logisticsUrl, `donation-receipts/${receiptId}/post`, {
    method: 'POST', actor: reviewer, idempotencyKey: key(), body: { expected_version: 4 },
  });
  expectVietnameseError(alreadyPosted, 409, 'ALREADY_POSTED');
  let ledger = await logisticsDb.query(
    `SELECT count(*)::int AS movement_count,COALESCE(sum(delta_on_hand),0)::text AS quantity
       FROM stock_movement WHERE receipt_id=$1`, [receiptId],
  );
  assert.equal(ledger.rows[0].movement_count, 1);
  assert.equal(ledger.rows[0].quantity, '5.000');

  const invalidHeldCount = await call(logisticsUrl, `donation-receipts/${receiptId}/counts`, {
    method: 'POST', actor: counter, idempotencyKey: key(),
    body: { expected_version: 4, lines: [{
      item_id: item.value.id, counted_quantity: '8.00', accepted_quantity: '6.00', held_quantity: '2.00', rejected_quantity: '0.00',
    }] },
  });
  expectVietnameseError(invalidHeldCount, 400, 'VALIDATION_FAILED');

  const secondCount = await call(logisticsUrl, `donation-receipts/${receiptId}/counts`, {
    method: 'POST', actor: counter, idempotencyKey: key(),
    body: { expected_version: 4, note: 'Chuyển một phần hàng giữ lại sang chấp nhận.', lines: [{
      item_id: item.value.id, counted_quantity: '8.00', accepted_quantity: '6.00', held_quantity: '1.00', rejected_quantity: '1.00',
      condition_note: 'Đã kiểm tra bổ sung.', expiry_date: addDays(10),
    }] },
  });
  expectSuccess(secondCount);
  assert.equal(secondCount.value.count.revision, 2);
  assert.equal(secondCount.value.delivery.status, 'POSTED');
  const secondApproval = await call(logisticsUrl, `donation-receipts/${receiptId}/review`, {
    method: 'POST', actor: reviewer, idempotencyKey: key(),
    body: { expected_version: 5, count_revision: 2, declaration_revision: 1, decision: 'APPROVE' },
  });
  expectSuccess(secondApproval);
  const releaseBody = { expected_version: 6, count_revision: 2, declaration_revision: 1, reason: 'Đã xác minh chất lượng hàng giữ lại.' };
  const releaseKey = key();
  const released = await call(logisticsUrl, `donation-receipts/${receiptId}/release-held`, {
    method: 'POST', actor: reviewer, idempotencyKey: releaseKey, body: releaseBody,
  });
  expectSuccess(released);
  const releaseReplay = await call(logisticsUrl, `donation-receipts/${receiptId}/release-held`, {
    method: 'POST', actor: reviewer, idempotencyKey: releaseKey, body: releaseBody,
  });
  expectSuccess(releaseReplay);
  assert.equal(releaseReplay.headers.get('idempotent-replay'), 'true');
  ledger = await logisticsDb.query(
    `SELECT count(*)::int AS movement_count,COALESCE(sum(delta_on_hand),0)::text AS quantity,
            count(*) FILTER (WHERE movement_type='RECEIPT_HELD_RELEASE')::int AS held_release_count
       FROM stock_movement WHERE receipt_id=$1`, [receiptId],
  );
  assert.equal(ledger.rows[0].movement_count, 2);
  assert.equal(ledger.rows[0].held_release_count, 1);
  assert.equal(ledger.rows[0].quantity, '6.000');

  const detail = await call(logisticsUrl, `donation-receipts/${receiptId}`, { actor: manager });
  expectSuccess(detail);
  assert.equal(detail.value.delivery.donor_phone, '09033334444');
  const dispute = await call(logisticsUrl, `public/donations/${delivery.value.id}/disputes`, {
    method: 'POST', actor: donor, idempotencyKey: key(), body: { reason: 'Tôi muốn trao đổi về kết quả kiểm đếm.' },
  });
  expectSuccess(dispute, 201);
  const disputePage = await call(logisticsUrl, 'donation-disputes?status=OPEN&limit=10', { actor: reviewer });
  expectSuccess(disputePage);
  assert.ok(disputePage.value.items.some((row) => row.id === dispute.value.id));
  const resolved = await call(logisticsUrl, `donation-disputes/${dispute.value.id}/resolve`, {
    method: 'POST', actor: reviewer, idempotencyKey: key(), body: { resolution_note: 'Đã giải thích kết quả và cập nhật xử lý.' },
  });
  expectSuccess(resolved);
  assert.equal(resolved.value.status, 'RESOLVED');

  const notices = await logisticsDb.query(
    `SELECT source_id,notice_type,payload FROM notice WHERE recipient_user_id=$1 AND source_id=ANY($2::uuid[])`,
    [donor.id, [receiptId, dispute.value.id]],
  );
  const payloads = notices.rows.map((row) => row.payload);
  assert.ok(notices.rows.some((row) => row.notice_type === 'DONATION_RECEIPT_DIFFERENCE'));
  assert.ok(notices.rows.some((row) => row.notice_type === 'DONATION_DISPUTE_RESOLVED'));
  assert.ok(payloads.every((payload) => /[\u0102-\u01b0\u1ea0-\u1ef9]/u.test(payload.message)));
  console.log('PASS Logistics T13 receipt revisions, independent review, exact-once posting, held release, notices and dispute resolution');
} finally {
  await Promise.all([logisticsDb.end(), identityDb.end()]);
}
