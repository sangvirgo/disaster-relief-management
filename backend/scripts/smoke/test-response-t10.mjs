import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = requiredEnv('C48_RESPONSE_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const responseDb = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const organizationId = randomUUID();
const regionCode = `T10_${randomBytes(5).toString('hex').toUpperCase()}`;
const users = [];
const notices = [randomUUID(), randomUUID(), randomUUID()];
const requestId = randomUUID();
const unverifiedRequestId = randomUUID();
let campaignId;
let secondCampaignId;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function key() { return randomUUID(); }

async function call(base, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
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

async function registerAndLogin(label) {
  const suffix = randomBytes(6).toString('hex');
  const credentials = {
    username: `t10${label}${suffix}`,
    display_name: `Người dùng kiểm thử T10 ${label} ${suffix}`,
    password: `Response T10 test ${suffix}!`,
  };
  const sourceIp = `198.51.100.${10 + users.length}`;
  const registered = await call(identityUrl, 'auth/register', {
    method: 'POST', body: credentials,
    headers: { 'Idempotency-Key': key(), 'X-Forwarded-For': sourceIp },
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.value));
  const userId = registered.value.user.id;
  users.push(userId);

  if (label === 'coordinator') {
    await identityDb.query(
      `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id,region_code)
       VALUES ($1,'COORDINATOR','REGION',$2,$3)`,
      [userId, organizationId, regionCode],
    );
  }

  const login = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username: credentials.username, password: credentials.password, client_kind: 'NATIVE' },
    headers: { 'X-Forwarded-For': sourceIp },
  });
  assert.equal(login.status, 200, JSON.stringify(login.value));
  return { id: userId, token: login.value.access_token };
}

async function createServiceToken(clientId, clientSecret, audience) {
  const result = await call(identityUrl, 'internal/token', {
    method: 'POST', body: { client_id: clientId, client_secret: clientSecret, audience },
  });
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  return result.value.access_token;
}

function bearer(token) { return { Authorization: `Bearer ${token}` }; }

await Promise.all([responseDb.connect(), identityDb.connect()]);
try {
  await identityDb.query(
    `INSERT INTO organization (id,name,organization_kind)
     VALUES ($1,$2,'COORDINATION')`,
    [organizationId, `T10 smoke ${organizationId}`],
  );
  await identityDb.query(
    'INSERT INTO region (code,name) VALUES ($1,$2)',
    [regionCode, 'Khu vực kiểm thử T10'],
  );
  await responseDb.query(
    `INSERT INTO region_boundary (region_code,geom)
     VALUES ($1,ST_Multi(ST_GeomFromText('POLYGON((104 14,106 14,106 16,104 16,104 14))',4326)))`,
    [regionCode],
  );

  const coordinator = await registerAndLogin('coordinator');
  const otherRecipient = await registerAndLogin('recipient');
  const coordinatorAuth = bearer(coordinator.token);

  const unauthenticatedNotices = await call(responseUrl, 'notices');
  expectVietnameseError(unauthenticatedNotices, 401, 'UNAUTHENTICATED');

  await responseDb.query(
    `INSERT INTO notice (id,recipient_user_id,source_id,source_version,notice_type,payload,read_at)
     VALUES ($1,$2,$4,1,'T10_SMOKE', $5::jsonb, now()),
            ($3,$2,$6,1,'T10_SMOKE', $5::jsonb, NULL),
            ($7,$8,$9,1,'T10_SMOKE', $5::jsonb, NULL)`,
    [notices[0], coordinator.id, notices[1], randomUUID(), JSON.stringify({ code: 'T10_SMOKE', request_id: requestId }),
      randomUUID(), notices[2], otherRecipient.id, randomUUID()],
  );
  const unreadNotices = await call(responseUrl, 'notices?unread=true', { headers: coordinatorAuth });
  expectSuccess(unreadNotices);
  assert.deepEqual(unreadNotices.value.items.map((notice) => notice.id), [notices[1]]);
  assert.equal(unreadNotices.value.items[0].read_at, null);

  const readNotices = await call(responseUrl, 'notices?unread=false', { headers: coordinatorAuth });
  expectSuccess(readNotices);
  assert.deepEqual(readNotices.value.items.map((notice) => notice.id), [notices[0]]);
  assert.equal(readNotices.value.items.some((notice) => notice.id === notices[2]), false, 'notice must stay private to its recipient');

  const markedRead = await call(responseUrl, `notices/${notices[1]}/read`, { method: 'POST', headers: coordinatorAuth });
  expectSuccess(markedRead);
  assert.equal(markedRead.value.id, notices[1]);
  const readAt = markedRead.value.read_at;
  const markedReadAgain = await call(responseUrl, `notices/${notices[1]}/read`, { method: 'POST', headers: coordinatorAuth });
  expectSuccess(markedReadAgain);
  assert.equal(markedReadAgain.value.read_at, readAt, 'reading an already-read notice must preserve its first read_at');
  const foreignNotice = await call(responseUrl, `notices/${notices[2]}/read`, { method: 'POST', headers: coordinatorAuth });
  expectVietnameseError(foreignNotice, 404, 'NOT_FOUND');
  assert.equal(foreignNotice.headers.get('cache-control'), 'no-store');

  const campaignCreateBody = {
    name: 'Chiến dịch kiểm thử T10',
    objective: 'Kiểm tra API chiến dịch và báo cáo',
    region_code: regionCode,
    starts_at: new Date(Date.now() - 60_000).toISOString(),
    ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const campaignCreateKey = key();
  const createCampaign = await call(responseUrl, 'campaigns', {
    method: 'POST',
    body: campaignCreateBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': campaignCreateKey },
  });
  campaignId = createCampaign.value?.id;
  expectSuccess(createCampaign, 201);
  assert.equal(createCampaign.value.status, 'DRAFT');
  assert.equal(createCampaign.value.version, 1);

  const campaignReplay = await call(responseUrl, 'campaigns', {
    method: 'POST', body: campaignCreateBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': campaignCreateKey },
  });
  expectSuccess(campaignReplay, 201);
  assert.equal(campaignReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(campaignReplay.value.id, campaignId);

  const campaignKeyConflict = await call(responseUrl, 'campaigns', {
    method: 'POST', body: { ...campaignCreateBody, name: 'Tên chiến dịch khác' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': campaignCreateKey },
  });
  expectVietnameseError(campaignKeyConflict, 409, 'IDEMPOTENCY_KEY_REUSED');

  const patchedCampaign = await call(responseUrl, `campaigns/${campaignId}`, {
    method: 'PATCH',
    body: { expected_version: 1, objective: 'Kiểm thử cập nhật chiến dịch T10' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(patchedCampaign);
  assert.equal(patchedCampaign.value.objective, 'Kiểm thử cập nhật chiến dịch T10');
  assert.equal(patchedCampaign.value.version, 2);

  const staleCampaignPatch = await call(responseUrl, `campaigns/${campaignId}`, {
    method: 'PATCH',
    body: { expected_version: 1, name: 'Tên không được ghi đè' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectVietnameseError(staleCampaignPatch, 409, 'VERSION_CONFLICT');

  const secondCampaign = await call(responseUrl, 'campaigns', {
    method: 'POST',
    body: { ...campaignCreateBody, name: 'Chiến dịch kiểm thử phân trang T10' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  secondCampaignId = secondCampaign.value?.id;
  expectSuccess(secondCampaign, 201);

  const firstCampaignPage = await call(responseUrl, 'campaigns?limit=1', { headers: coordinatorAuth });
  expectSuccess(firstCampaignPage);
  assert.equal(firstCampaignPage.value.items.length, 1);
  assert.equal(firstCampaignPage.value.more, true);
  assert.ok(firstCampaignPage.value.cursor);
  const secondCampaignPage = await call(
    responseUrl,
    `campaigns?limit=1&cursor=${encodeURIComponent(firstCampaignPage.value.cursor)}`,
    { headers: coordinatorAuth },
  );
  expectSuccess(secondCampaignPage);
  assert.equal(secondCampaignPage.value.items.length, 1);
  assert.notEqual(secondCampaignPage.value.items[0].id, firstCampaignPage.value.items[0].id);
  assert.deepEqual(
    [firstCampaignPage.value.items[0].id, secondCampaignPage.value.items[0].id].sort(),
    [campaignId, secondCampaignId].sort(),
  );

  const campaignDetail = await call(responseUrl, `campaigns/${campaignId}`, { headers: coordinatorAuth });
  expectSuccess(campaignDetail);
  assert.equal(campaignDetail.value.id, campaignId);
  assert.equal(campaignDetail.value.version, 2);

  const activated = await call(responseUrl, `campaigns/${campaignId}/activate`, {
    method: 'POST', body: { expected_version: 2 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(activated);
  assert.equal(activated.value.status, 'ACTIVE');
  assert.equal(activated.value.version, 3);

  const secondActivated = await call(responseUrl, `campaigns/${secondCampaignId}/activate`, {
    method: 'POST', body: { expected_version: 1 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(secondActivated);
  assert.equal(secondActivated.value.status, 'ACTIVE');

  const firstPublicCampaignPage = await call(responseUrl, 'public/campaigns?limit=1');
  expectSuccess(firstPublicCampaignPage);
  assert.equal(firstPublicCampaignPage.value.items.length, 1);
  assert.equal(firstPublicCampaignPage.value.more, true);
  assert.ok(firstPublicCampaignPage.value.cursor);
  const secondPublicCampaignPage = await call(
    responseUrl,
    `public/campaigns?limit=1&cursor=${encodeURIComponent(firstPublicCampaignPage.value.cursor)}`,
  );
  expectSuccess(secondPublicCampaignPage);
  assert.equal(secondPublicCampaignPage.value.items.length, 1);
  const publicCampaigns = [firstPublicCampaignPage.value.items[0], secondPublicCampaignPage.value.items[0]];
  assert.deepEqual(publicCampaigns.map((item) => item.id).sort(), [campaignId, secondCampaignId].sort());
  const publicCampaign = publicCampaigns.find((item) => item.id === campaignId);
  assert.ok(publicCampaign, 'active campaign should be publicly listed');
  assert.deepEqual(Object.keys(publicCampaign).sort(), ['ends_at', 'id', 'objective', 'region_name', 'starts_at', 'status', 'title'].sort());
  assert.equal(publicCampaign.region_name, 'Khu vực kiểm thử T10');

  const responseToken = await createServiceToken(requiredEnv('RESPONSE_SERVICE_CLIENT_ID'), requiredEnv('RESPONSE_SERVICE_CLIENT_SECRET'), 'identity');
  const unauthenticatedRegionLookup = await call(identityUrl, 'internal/regions:lookup', {
    method: 'POST', body: { codes: [regionCode] },
  });
  assert.equal(unauthenticatedRegionLookup.status, 401, JSON.stringify(unauthenticatedRegionLookup.value));
  assert.equal(unauthenticatedRegionLookup.value?.code, 'UNAUTHENTICATED');
  assert.match(unauthenticatedRegionLookup.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese user-facing copy');
  const regionLookup = await call(identityUrl, 'internal/regions:lookup', {
    method: 'POST', body: { codes: [regionCode] }, headers: bearer(responseToken),
  });
  expectSuccess(regionLookup);
  assert.deepEqual(regionLookup.value.items, [{ code: regionCode, name: 'Khu vực kiểm thử T10' }]);

  const identityToken = await createServiceToken(requiredEnv('IDENTITY_SERVICE_CLIENT_ID'), requiredEnv('IDENTITY_SERVICE_CLIENT_SECRET'), 'response');
  const internalCampaign = await call(responseUrl, `internal/campaigns/${campaignId}`, { headers: bearer(identityToken) });
  expectSuccess(internalCampaign);
  assert.deepEqual(Object.keys(internalCampaign.value).sort(), ['id', 'organization_id', 'region_code', 'status', 'version'].sort());
  assert.equal(internalCampaign.value.organization_id, organizationId);
  assert.equal(internalCampaign.value.region_code, regionCode);

  const paused = await call(responseUrl, `campaigns/${campaignId}/pause`, {
    method: 'POST', body: { expected_version: 3, reason: 'Hoàn tất kiểm tra trạng thái' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(paused);
  assert.equal(paused.value.status, 'PAUSED');
  assert.equal(paused.value.version, 4);

  await responseDb.query(
    `INSERT INTO assistance_request
       (id,tracking_code,campaign_id,incident_category_code,report_mode,reporter_user_id,organization_id,region_code,status,priority,priority_basis,received_at)
     VALUES ($1,$2,$3,'UNKNOWN','SELF',$4,$5,$6,'VERIFIED','P2','COMPLETE',now()-interval '10 minutes')`,
    [requestId, `T10${randomBytes(5).toString('hex').toUpperCase()}`, campaignId, coordinator.id, organizationId, regionCode],
  );
  await responseDb.query(
    `INSERT INTO request_subject (request_id,location,location_source)
     VALUES ($1,ST_GeogFromText('SRID=4326;POINT(105 15)'),'MANUAL_PIN')`,
    [requestId],
  );
  await responseDb.query(
    `INSERT INTO assistance_request
       (id,tracking_code,campaign_id,incident_category_code,report_mode,reporter_user_id,organization_id,region_code,status,received_at)
     VALUES ($1,$2,$3,'UNKNOWN','SELF',$4,$5,$6,'SUBMITTED',now()-interval '5 minutes')`,
    [unverifiedRequestId, `T10${randomBytes(5).toString('hex').toUpperCase()}`, campaignId, coordinator.id, organizationId, regionCode],
  );
  await responseDb.query(
    `INSERT INTO request_subject (request_id,location,location_source)
     VALUES ($1,ST_GeogFromText('SRID=4326;POINT(105.01 15.01)'),'MANUAL_PIN')`,
    [unverifiedRequestId],
  );
  const from = new Date(Date.now() - 3_600_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const filter = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&region_code=${encodeURIComponent(regionCode)}&campaign_id=${campaignId}`;
  const heatmap = await call(responseUrl, `map/heatmap?${filter}&status_layer=confirmed&cell_m=1000`, { headers: coordinatorAuth });
  expectSuccess(heatmap);
  assert.equal(heatmap.value.items.length, 1, JSON.stringify(heatmap.value));
  assert.equal(heatmap.value.items[0].cell.type, 'Polygon');
  assert.equal(heatmap.value.items[0].center.type, 'Point');
  assert.equal(heatmap.value.items[0].count, 1);
  const [longitude, latitude] = heatmap.value.items[0].center.coordinates;
  assert.ok(longitude >= -180 && longitude <= 180, 'GeoJSON center must use WGS 84 longitude');
  assert.ok(latitude >= -90 && latitude <= 90, 'GeoJSON center must use WGS 84 latitude');
  const ring = heatmap.value.items[0].cell.coordinates[0];
  const signedArea = ring.slice(0, -1).reduce((area, [x1, y1], index) => {
    const [x2, y2] = ring[index + 1];
    return area + (x1 * y2) - (x2 * y1);
  }, 0);
  assert.ok(signedArea > 0, 'RFC 7946 exterior polygon ring must be counter-clockwise');
  assert.equal(JSON.stringify(heatmap.value).includes(requestId), false, 'heatmap must not expose request identifiers');

  const unverifiedHeatmap = await call(responseUrl, `map/heatmap?${filter}&status_layer=unverified&cell_m=1000`, { headers: coordinatorAuth });
  expectSuccess(unverifiedHeatmap);
  assert.equal(unverifiedHeatmap.value.items.length, 1, JSON.stringify(unverifiedHeatmap.value));
  assert.equal(unverifiedHeatmap.value.items[0].count, 1);
  assert.equal(unverifiedHeatmap.value.items[0].cell.type, 'Polygon');
  assert.equal(unverifiedHeatmap.value.items[0].center.type, 'Point');
  assert.equal(JSON.stringify(unverifiedHeatmap.value).includes(unverifiedRequestId), false, 'unverified heatmap must not expose request identifiers');

  const summary = await call(responseUrl, `reports/summary?${filter}`, { headers: coordinatorAuth });
  expectSuccess(summary);
  assert.equal(summary.value.status_counts.VERIFIED, 1);
  assert.equal(summary.value.priority_counts.P2, 1);
  assert.equal(summary.value.active_missions, 0);
  assert.equal(summary.value.overdue_missions, 0);
  assert.equal(summary.value.median_seconds.receipt_to_verification, null);
  assert.equal(summary.value.median_seconds.receipt_to_assignment, null);

  await responseDb.query('DELETE FROM request_subject WHERE request_id=ANY($1::uuid[])', [[requestId, unverifiedRequestId]]);
  await responseDb.query('DELETE FROM assistance_request WHERE id=ANY($1::uuid[])', [[requestId, unverifiedRequestId]]);
  const resumed = await call(responseUrl, `campaigns/${campaignId}/resume`, {
    method: 'POST', body: { expected_version: 4 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(resumed);
  assert.equal(resumed.value.status, 'ACTIVE');
  assert.equal(resumed.value.version, 5);
  const closed = await call(responseUrl, `campaigns/${campaignId}/close`, {
    method: 'POST', body: { expected_version: 5, reason: 'Hoàn tất kiểm thử vòng đời' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(closed);
  assert.equal(closed.value.status, 'CLOSED');
  assert.equal(closed.value.version, 6);
} finally {
  try {
    await responseDb.query('DELETE FROM notice WHERE id = ANY($1::uuid[])', [notices]);
    await responseDb.query('DELETE FROM request_subject WHERE request_id=ANY($1::uuid[])', [[requestId, unverifiedRequestId]]);
    await responseDb.query('DELETE FROM assistance_request WHERE id=ANY($1::uuid[])', [[requestId, unverifiedRequestId]]);
    if (campaignId) {
      await responseDb.query('DELETE FROM campaign WHERE id=$1', [campaignId]);
    }
    if (secondCampaignId) {
      await responseDb.query('DELETE FROM campaign WHERE id=$1', [secondCampaignId]);
    }
    if (users[0]) {
      await responseDb.query("DELETE FROM idempotency_record WHERE scope_key=$1 AND command LIKE 'response.campaign.%'", [`user:${users[0]}`]);
    }
    if (users.length) {
      await identityDb.query('DELETE FROM refresh_session WHERE family_id IN (SELECT id FROM session_family WHERE user_id=ANY($1::uuid[]))', [users]);
      await identityDb.query('DELETE FROM session_family WHERE user_id=ANY($1::uuid[])', [users]);
      await identityDb.query('DELETE FROM role_grant WHERE user_id=ANY($1::uuid[])', [users]);
      await identityDb.query('DELETE FROM membership WHERE user_id=ANY($1::uuid[])', [users]);
      await identityDb.query('DELETE FROM app_user WHERE id=ANY($1::uuid[])', [users]);
    }
    await responseDb.query('DELETE FROM region_boundary WHERE region_code=$1', [regionCode]);
    await identityDb.query('DELETE FROM region WHERE code=$1', [regionCode]);
    await identityDb.query('DELETE FROM organization WHERE id=$1', [organizationId]);
  } finally {
    await Promise.allSettled([responseDb.end(), identityDb.end()]);
  }
}

console.log('Response T10 HTTP smoke passed.');
