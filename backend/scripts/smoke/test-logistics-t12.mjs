import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const identityDown = process.argv.includes('--identity-down');
const logisticsUrl = requiredEnv('C48_LOGISTICS_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const responseUrl = requiredEnv('C48_RESPONSE_BASE_URL').replace(/\/+$/u, '');
const logisticsDb = new Client({ connectionString: requiredEnv('C48_LOGISTICS_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const responseDb = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function key() { return randomUUID(); }

async function call(base, path, { method = 'GET', body, actor, headers: extraHeaders = {}, idempotencyKey } = {}) {
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

async function callMultipart(base, path, { file, actor, headers: extraHeaders = {}, idempotencyKey } = {}) {
  const boundary = `c48-t12-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const headers = {
    ...extraHeaders,
    ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(body.length),
  };
  const response = await fetch(`${base}/${path}`, { method: 'POST', headers, body });
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

async function registerAndLogin(label, organizationId, roles) {
  const suffix = randomBytes(5).toString('hex');
  const credentials = {
    username: `t12${label}${suffix}`,
    display_name: `Người dùng kiểm thử T12 ${label} ${suffix}`,
    password: `Logistics T12 test ${suffix}!`,
  };
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials, idempotencyKey: key(),
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
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: registered.value.user.id, token: login.value.access_token };
}

async function createGuestDelivery(driveId, itemId, donorName, phone, secret, idempotencyKey = key()) {
  const body = { donor_name: donorName, donor_phone: phone, lines: [{ item_id: itemId, declared_quantity: '3.00' }] };
  const headers = { 'X-Donation-Secret': secret };
  const result = await call(logisticsUrl, `public/donation-drives/${driveId}/deliveries`, {
    method: 'POST', body, headers, idempotencyKey,
  });
  return { result, body, headers, idempotencyKey };
}

async function checkIdentityDownGuestFlow() {
  const rows = await logisticsDb.query(
    `SELECT d.id AS drive_id,di.item_id FROM donation_drive d JOIN drive_item di ON di.drive_id=d.id
      WHERE d.title LIKE 'T12_PUBLIC_%' AND d.status='OPEN' ORDER BY d.created_at DESC LIMIT 1`,
  );
  assert.ok(rows.rows[0], 'the T12 public drive fixture must remain open');
  const secret = randomBytes(32).toString('base64url');
  const created = await createGuestDelivery(rows.rows[0].drive_id, rows.rows[0].item_id,
    'Người quyên góp khi Identity tắt', '0901234567', secret);
  expectSuccess(created.result, 201);
  const tracked = await call(logisticsUrl, `public/donations/${created.result.value.id}`, {
    headers: created.headers,
  });
  expectSuccess(tracked);
  assert.equal(tracked.value.status, 'DECLARED');
  assert.equal(Object.hasOwn(tracked.value, 'donor_phone'), false);
}

await logisticsDb.connect();
if (!identityDown) await Promise.all([identityDb.connect(), responseDb.connect()]);
try {
  if (identityDown) {
    await checkIdentityDownGuestFlow();
    console.log('PASS Logistics T12 guest declarations and tracking with Identity stopped');
  } else {
    const organizationId = randomUUID();
    const regionCode = `T12_${randomBytes(5).toString('hex').toUpperCase()}`;
    await identityDb.query('INSERT INTO organization (id,name,organization_kind) VALUES ($1,$2,\'COORDINATION\')',
      [organizationId, `T12 test ${organizationId}`]);
    await identityDb.query('INSERT INTO region (code,name) VALUES ($1,$2)', [regionCode, 'Khu vực kiểm thử T12']);
    await responseDb.query(
      `INSERT INTO region_boundary (region_code,geom)
       VALUES ($1,ST_Multi(ST_GeomFromText('POLYGON((104 14,106 14,106 16,104 16,104 14))',4326)))`,
      [regionCode],
    );

    const manager = await registerAndLogin('manager', organizationId, ['OPERATIONS_MANAGER', 'INTAKE_STAFF', 'CAMPAIGN_MANAGER']);
    const intakeOnly = await registerAndLogin('intake_only', organizationId, ['INTAKE_STAFF']);
    const donor = await registerAndLogin('donor', organizationId, []);
    const suffix = randomBytes(5).toString('hex').toUpperCase();
    const itemType = await call(logisticsUrl, 'item-types', {
      method: 'POST', actor: manager, idempotencyKey: key(), body: { code: `T12_${suffix}`, display_name: 'Thực phẩm kiểm thử T12' },
    });
    expectSuccess(itemType, 201);
    const unit = await call(logisticsUrl, 'units', {
      method: 'POST', actor: manager, idempotencyKey: key(), body: { code: `T12_U_${suffix}`, display_name: 'Thùng T12', scale: 2 },
    });
    expectSuccess(unit, 201);
    const item = await call(logisticsUrl, 'items', {
      method: 'POST', actor: manager, idempotencyKey: key(),
      body: { item_type_code: itemType.value.code, unit_code: unit.value.code, name: `Thực phẩm T12 ${suffix}` },
    });
    expectSuccess(item, 201);
    const warehouse = await call(logisticsUrl, 'warehouses', {
      method: 'POST', actor: manager, idempotencyKey: key(),
      body: { organization_id: organizationId, region_code: regionCode, name: `Kho T12 ${suffix}` },
    });
    expectSuccess(warehouse, 201);

    const intakeOnlyPublish = await call(logisticsUrl, 'donation-drives', {
      method: 'POST', actor: intakeOnly, idempotencyKey: key(),
      body: { title: `Không được phép T12 ${suffix}`, intake_warehouse_id: warehouse.value.id,
        items: [{ item_id: item.value.id, target_quantity: '20.00' }] },
    });
    expectVietnameseError(intakeOnlyPublish, 403, 'FORBIDDEN');

    const campaign = await call(responseUrl, 'campaigns', {
      method: 'POST', actor: manager, idempotencyKey: key(),
      body: { name: `Chiến dịch T12 ${suffix}`, objective: 'Kiểm tra liên kết dịch vụ.', region_code: regionCode },
    });
    expectSuccess(campaign, 201);
    const activatedCampaign = await call(responseUrl, `campaigns/${campaign.value.id}/activate`, {
      method: 'POST', actor: manager, idempotencyKey: key(), body: { expected_version: campaign.value.version },
    });
    expectSuccess(activatedCampaign, 200);

    async function createDrive(title, campaignId) {
      const created = await call(logisticsUrl, 'donation-drives', {
        method: 'POST', actor: manager, idempotencyKey: key(),
        body: { title, intake_warehouse_id: warehouse.value.id, ...(campaignId ? { campaign_id: campaignId } : {}),
          items: [{ item_id: item.value.id, target_quantity: '20.00', acceptance_note: 'Còn nguyên bao bì.' }] },
      });
      expectSuccess(created, 201);
      const opened = await call(logisticsUrl, `donation-drives/${created.value.id}/open`, {
        method: 'POST', actor: manager, idempotencyKey: key(), body: { expected_version: created.value.version },
      });
      expectSuccess(opened, 200);
      return { ...created.value, ...opened.value };
    }

    const publicDrive = await createDrive(`T12_PUBLIC_${suffix}`);
    const linkedDrive = await createDrive(`T12_CAMPAIGN_${suffix}`, campaign.value.id);
    assert.equal(linkedDrive.campaign_status, 'ACTIVE');
    assert.ok(linkedDrive.campaign_status_at);
    const linkedDetail = await call(logisticsUrl, `public/donation-drives/${linkedDrive.id}`);
    expectSuccess(linkedDetail);
    assert.equal(linkedDetail.value.campaign_status, 'ACTIVE');
    assert.ok(linkedDetail.value.campaign_status_at);
    const listed = await call(logisticsUrl, 'public/donation-drives?limit=50');
    expectSuccess(listed);
    assert.ok(listed.value.items.some((drive) => drive.id === publicDrive.id));
    const detail = await call(logisticsUrl, `public/donation-drives/${publicDrive.id}`);
    expectSuccess(detail);
    assert.equal(detail.value.status, 'OPEN');
    assert.equal(detail.value.campaign_status_at, null);
    assert.equal(detail.value.intake_location.location, null);
    assert.equal(detail.value.items[0].accepted_total, '0');

    const signedInDelivery = await call(logisticsUrl, `public/donation-drives/${publicDrive.id}/deliveries`, {
      method: 'POST', actor: donor, idempotencyKey: key(),
      body: { donor_name: 'Người quyên góp đã đăng nhập', donor_phone: '09033334444',
        lines: [{ item_id: item.value.id, declared_quantity: '2.00' }] },
    });
    expectSuccess(signedInDelivery, 201);
    expectSuccess(await call(logisticsUrl, `public/donations/${signedInDelivery.value.id}`, { actor: donor }));

    const lifecycle = await createDrive(`T12_LIFECYCLE_${suffix}`);
    for (const [action, body, expectedStatus] of [
      ['pause', { expected_version: 2, reason: 'Tạm dừng kiểm tra.' }, 'PAUSED'],
      ['resume', { expected_version: 3 }, 'OPEN'],
      ['close', { expected_version: 4, reason: 'Đã hoàn tất tiếp nhận.' }, 'CLOSED'],
    ]) {
      const result = await call(logisticsUrl, `donation-drives/${lifecycle.id}/${action}`, {
        method: 'POST', actor: manager, idempotencyKey: key(), body,
      });
      expectSuccess(result, 200);
      assert.equal(result.value.status, expectedStatus);
    }

    const secret = randomBytes(32).toString('base64url');
    const first = await createGuestDelivery(publicDrive.id, item.value.id, 'Người quyên góp T12', '09011112222', secret);
    expectSuccess(first.result, 201);
    const replay = await call(logisticsUrl, `public/donation-drives/${publicDrive.id}/deliveries`, {
      method: 'POST', body: first.body, headers: first.headers, idempotencyKey: first.idempotencyKey,
    });
    expectSuccess(replay, 201);
    assert.equal(replay.headers.get('idempotent-replay'), 'true');
    assert.equal(replay.value.id, first.result.value.id);

    const invalidTrack = await call(logisticsUrl, `public/donations/${first.result.value.id}`, {
      headers: { 'X-Donation-Secret': randomBytes(32).toString('base64url') },
    });
    expectVietnameseError(invalidTrack, 400, 'DONATION_SECRET_INVALID');
    const tracked = await call(logisticsUrl, `public/donations/${first.result.value.id}`, { headers: first.headers });
    expectSuccess(tracked);
    assert.equal(tracked.value.declaration.revision, 1);
    assert.equal(Object.hasOwn(tracked.value, 'donor_name'), false);
    assert.equal(Object.hasOwn(tracked.value, 'donor_phone'), false);

    const revised = await call(logisticsUrl, `public/donations/${first.result.value.id}/declarations`, {
      method: 'POST', actor: undefined, idempotencyKey: key(), headers: first.headers,
      body: { expected_version: 1, lines: [{ item_id: item.value.id, declared_quantity: '4.00' }] },
    });
    expectSuccess(revised, 200);
    assert.equal(revised.value.declaration_revision, 2);
    const dispute = await call(logisticsUrl, `public/donations/${first.result.value.id}/disputes`, {
      method: 'POST', idempotencyKey: key(), headers: first.headers, body: { reason: 'Tôi muốn bổ sung thông tin.' },
    });
    expectSuccess(dispute, 201);
    assert.equal(dispute.value.status, 'OPEN');

    const claimed = await call(logisticsUrl, `public/donations/${first.result.value.id}/claim`, {
      method: 'POST', actor: donor, idempotencyKey: key(), headers: first.headers,
    });
    expectSuccess(claimed, 200);
    assert.equal(claimed.value.donor_user_id, donor.id);
    expectSuccess(await call(logisticsUrl, `public/donations/${first.result.value.id}`, { actor: donor }));
    expectVietnameseError(await call(logisticsUrl, `public/donations/${first.result.value.id}`, {
      headers: first.headers,
    }), 400, 'DONATION_SECRET_INVALID');
    expectVietnameseError(await call(logisticsUrl, `public/donations/${first.result.value.id}`, {
      actor: manager,
    }), 400, 'DONATION_SECRET_INVALID');

    const staffSecret = randomBytes(32).toString('base64url');
    const staffDelivery = await createGuestDelivery(publicDrive.id, item.value.id, 'Người quyên góp hỗ trợ', '09022223333', staffSecret);
    expectSuccess(staffDelivery.result, 201);
    const assisted = await call(logisticsUrl, `donation-deliveries/${staffDelivery.result.value.id}/assisted-declaration`, {
      method: 'POST', actor: manager, idempotencyKey: key(),
      body: { expected_version: 1, lines: [{ item_id: item.value.id, declared_quantity: '5.00' }] },
    });
    expectSuccess(assisted, 201);
    assert.equal(assisted.value.created_by_kind, 'STAFF_ASSISTED');
    const revoked = await call(logisticsUrl, `donation-deliveries/${staffDelivery.result.value.id}/capability/revoke`, {
      method: 'POST', actor: manager, idempotencyKey: key(),
    });
    expectSuccess(revoked, 200);
    const revokedTrack = await call(logisticsUrl, `public/donations/${staffDelivery.result.value.id}`, {
      headers: staffDelivery.headers,
    });
    expectVietnameseError(revokedTrack, 400, 'DONATION_SECRET_INVALID');

    const recoveryKey = key();
    const recoveryBody = {
      expected_version: revoked.value.version,
      reason: 'Người quyên góp báo mất mã theo dõi.',
      confirmation_basis: 'Đối chiếu lại số điện thoại đã đăng ký.',
      source_note: 'Gọi lại số điện thoại trong hồ sơ.',
    };
    const issued = await call(logisticsUrl, `donation-deliveries/${staffDelivery.result.value.id}/recovery`, {
      method: 'POST', actor: manager, idempotencyKey: recoveryKey, body: recoveryBody,
    });
    expectSuccess(issued, 201);
    assert.equal(typeof issued.value.recovery_code, 'string');
    const issuedReplay = await call(logisticsUrl, `donation-deliveries/${staffDelivery.result.value.id}/recovery`, {
      method: 'POST', actor: manager, idempotencyKey: recoveryKey, body: recoveryBody,
    });
    expectSuccess(issuedReplay, 201);
    assert.equal(issuedReplay.headers.get('idempotent-replay'), 'true');
    assert.equal(Object.hasOwn(issuedReplay.value, 'recovery_code'), false);

    const recoveryRequest = { public_code: staffDelivery.result.value.public_code };
    const wrongCode = await call(logisticsUrl, 'public/donations/recover', {
      method: 'POST', actor: donor, idempotencyKey: key(), body: recoveryRequest,
      headers: { 'X-Recovery-Code': randomBytes(32).toString('base64url') },
    });
    expectVietnameseError(wrongCode, 404, 'NOT_FOUND');
    const recovered = await call(logisticsUrl, 'public/donations/recover', {
      method: 'POST', actor: donor, idempotencyKey: key(), body: recoveryRequest,
      headers: { 'X-Recovery-Code': issued.value.recovery_code },
    });
    expectSuccess(recovered, 200);
    assert.equal(recovered.value.donor_user_id, donor.id);
    assert.equal(recovered.value.capability_revoked, true);

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('T12 evidence')]);
    const evidence = await callMultipart(logisticsUrl, `public/donations/${staffDelivery.result.value.id}/evidence`, {
      actor: donor, file: png, idempotencyKey: key(),
    });
    if (evidence.status === 503 && evidence.value?.code === 'STORAGE_UNAVAILABLE') {
      throw new Error('Logistics T12 attachment integration returned STORAGE_UNAVAILABLE; verify AIStor configuration/availability and the attachment READY update');
    }
    expectSuccess(evidence, 201);
    assert.equal(evidence.value.state, 'READY');
    assert.equal(evidence.value.detected_mime, 'image/png');
    const download = await call(logisticsUrl, `evidence/${evidence.value.id}/download`, { actor: donor });
    expectSuccess(download, 200);
    assert.equal(download.value.expires_in, 60);
    assert.equal(typeof download.value.url, 'string');

    console.log('PASS Logistics T12 public drives, lifecycle, declarations, revisions, disputes, claim, assisted entry, recovery, and capability revocation');
  }
} finally {
  await logisticsDb.end();
  if (!identityDown) await Promise.all([identityDb.end(), responseDb.end()]);
}
