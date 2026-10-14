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
const duplicateRequestId = randomUUID();
const outOfScopeRequestId = randomUUID();
const otherOrganizationId = randomUUID();
const missionTeamIds = [randomUUID(), randomUUID()];
const missionIds = [randomUUID(), randomUUID()];
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
    `INSERT INTO organization (id,name,organization_kind)
     VALUES ($1,$2,'COORDINATION')`,
    [otherOrganizationId, `T10 scope fixture ${otherOrganizationId}`],
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

  const draftToClose = await call(responseUrl, 'campaigns', {
    method: 'POST', body: { ...campaignCreateBody, name: 'Chiến dịch đóng từ bản nháp T10' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(draftToClose, 201);
  const draftCloseReason = 'Đóng chiến dịch bản nháp theo kế hoạch.';
  const closedDraft = await call(responseUrl, `campaigns/${draftToClose.value.id}/close`, {
    method: 'POST', body: { expected_version: 1, reason: draftCloseReason },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(closedDraft);
  assert.equal(closedDraft.value.status, 'CLOSED');
  assert.equal(closedDraft.value.version, 2);
  const closeAudit = await responseDb.query(
    `SELECT actor_user_id,action,entity_type,entity_id,reason,
            before_state->>'status' AS before_status,after_state->>'status' AS after_status
       FROM audit_log
      WHERE entity_type='campaign' AND entity_id=$1 AND action='CAMPAIGN_CLOSE'
      ORDER BY created_at DESC,id DESC LIMIT 1`,
    [draftToClose.value.id],
  );
  assert.equal(closeAudit.rowCount, 1, 'closing a campaign must persist an audit row');
  assert.equal(closeAudit.rows[0].actor_user_id, coordinator.id);
  assert.equal(closeAudit.rows[0].action, 'CAMPAIGN_CLOSE');
  assert.equal(closeAudit.rows[0].entity_type, 'campaign');
  assert.equal(closeAudit.rows[0].entity_id, draftToClose.value.id);
  assert.equal(closeAudit.rows[0].reason, draftCloseReason);
  assert.equal(closeAudit.rows[0].before_status, 'DRAFT');
  assert.equal(closeAudit.rows[0].after_status, 'CLOSED');

  const receivedAt = new Date(Date.now() - 30 * 60_000);
  const verifiedAt = new Date(receivedAt.getTime() + 4 * 60_000);
  const firstOfferAt = new Date(receivedAt.getTime() + 5 * 60_000);
  const secondOfferAt = new Date(receivedAt.getTime() + 22 * 60_000);
  await responseDb.query(
    `INSERT INTO assistance_request
       (id,tracking_code,incident_category_code,report_mode,reporter_user_id,organization_id,region_code,status,priority,priority_basis,received_at)
     VALUES ($1,$2,'UNKNOWN','SELF',$3,$4,$5,'DISPATCHED','P2','COMPLETE',$6)`,
    [requestId, `T10${randomBytes(5).toString('hex').toUpperCase()}`, coordinator.id, organizationId, regionCode, receivedAt],
  );
  await responseDb.query(
    `INSERT INTO request_subject (request_id,location,location_source)
     VALUES ($1,ST_GeogFromText('SRID=4326;POINT(105 15)'),'MANUAL_PIN')`,
    [requestId],
  );
  const approvedFacts = {
    report_mode: 'SELF', incident_category_code: 'UNKNOWN', description: 'Yêu cầu báo cáo kiểm thử T10.',
    reporter_name: null, reporter_contact_phone: null, reporter_declared_danger: false,
    region_code: regionCode, campaign_id: null, people_affected: 1,
    location: { type: 'Point', coordinates: [105, 15], source: 'MANUAL_PIN' },
  };
  const [verificationEvent] = (await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
     VALUES ($1,$2,'REQUEST_VERIFIED','STAFF','VERIFYING','VERIFIED',$3::jsonb,$4) RETURNING id`,
    [requestId, coordinator.id, JSON.stringify({ approved_facts: approvedFacts }), verifiedAt],
  )).rows;
  await responseDb.query(
    `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,decided_at)
     VALUES ($1,'VERIFIED','CONTACT_CONFIRMED',$2,$3)`,
    [requestId, coordinator.id, verifiedAt],
  );
  await responseDb.query('UPDATE assistance_request SET verification_revision=$2 WHERE id=$1', [requestId, verificationEvent.id]);

  await responseDb.query(
    `INSERT INTO assistance_request
       (id,tracking_code,incident_category_code,report_mode,reporter_user_id,organization_id,region_code,status,received_at)
     VALUES ($1,$2,'UNKNOWN','SELF',$3,$4,$5,'SUBMITTED',$6)`,
    [unverifiedRequestId, `T10${randomBytes(5).toString('hex').toUpperCase()}`, coordinator.id, organizationId, regionCode, receivedAt],
  );
  await responseDb.query(
    `INSERT INTO request_subject (request_id,location,location_source)
     VALUES ($1,ST_GeogFromText('SRID=4326;POINT(105.01 15.01)'),'MANUAL_PIN')`,
    [unverifiedRequestId],
  );

  await responseDb.query(
    `INSERT INTO assistance_request
       (id,tracking_code,incident_category_code,report_mode,reporter_user_id,organization_id,region_code,status,received_at)
     VALUES ($1,$2,'UNKNOWN','SELF',$3,$4,$5,'SUBMITTED',$6)`,
    [duplicateRequestId, `T10${randomBytes(5).toString('hex').toUpperCase()}`, coordinator.id, organizationId, regionCode, receivedAt],
  );
  await responseDb.query(
    `INSERT INTO request_subject (request_id,location,location_source)
     VALUES ($1,ST_GeogFromText('SRID=4326;POINT(105 15)'),'MANUAL_PIN')`,
    [duplicateRequestId],
  );

  await responseDb.query(
    `INSERT INTO assistance_request
       (id,tracking_code,incident_category_code,report_mode,reporter_user_id,organization_id,region_code,status,received_at)
     VALUES ($1,$2,'UNKNOWN','SELF',$3,$4,$5,'VERIFIED',$6)`,
    [outOfScopeRequestId, `T10${randomBytes(5).toString('hex').toUpperCase()}`, coordinator.id, otherOrganizationId, regionCode, receivedAt],
  );
  await responseDb.query(
    `INSERT INTO request_subject (request_id,location,location_source)
     VALUES ($1,ST_GeogFromText('SRID=4326;POINT(105 15)'),'MANUAL_PIN')`,
    [outOfScopeRequestId],
  );
  const [foreignVerificationEvent] = (await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
     VALUES ($1,$2,'REQUEST_VERIFIED','STAFF','VERIFYING','VERIFIED',$3::jsonb,$4) RETURNING id`,
    [outOfScopeRequestId, coordinator.id, JSON.stringify({ approved_facts: approvedFacts }), verifiedAt],
  )).rows;
  await responseDb.query(
    `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,decided_at)
     VALUES ($1,'VERIFIED','CONTACT_CONFIRMED',$2,$3)`,
    [outOfScopeRequestId, coordinator.id, verifiedAt],
  );
  await responseDb.query('UPDATE assistance_request SET verification_revision=$2 WHERE id=$1', [outOfScopeRequestId, foreignVerificationEvent.id]);

  const canonicalAttachKey = key();
  const canonicalAttachBody = { campaign_id: campaignId, expected_version: 1 };
  const canonicalAttach = await call(responseUrl, `requests/${requestId}/attach-campaign`, {
    method: 'POST', body: canonicalAttachBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': canonicalAttachKey },
  });
  expectSuccess(canonicalAttach);
  assert.equal(canonicalAttach.value.campaign_id, campaignId);
  assert.equal(canonicalAttach.value.version, 2);
  const canonicalAttachReplay = await call(responseUrl, `requests/${requestId}/attach-campaign`, {
    method: 'POST', body: canonicalAttachBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': canonicalAttachKey },
  });
  expectSuccess(canonicalAttachReplay);
  assert.equal(canonicalAttachReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(canonicalAttachReplay.value.version, 2);
  const staleAttach = await call(responseUrl, `requests/${requestId}/attach-campaign`, {
    method: 'POST', body: canonicalAttachBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectVietnameseError(staleAttach, 409, 'VERSION_CONFLICT');

  const invalidAttach = await call(responseUrl, `requests/${unverifiedRequestId}/attach-campaign`, {
    method: 'POST', body: { campaign_id: 'invalid', expected_version: 1 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectVietnameseError(invalidAttach, 400, 'VALIDATION_FAILED');
  const unverifiedAttach = await call(responseUrl, `requests/${unverifiedRequestId}/attach-campaign`, {
    method: 'POST', body: { campaign_id: campaignId, expected_version: 1 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(unverifiedAttach);
  assert.equal(unverifiedAttach.value.version, 2);

  const duplicated = await call(responseUrl, `requests/${duplicateRequestId}/duplicate`, {
    method: 'POST',
    body: { expected_version: 1, canonical_request_id: requestId, reason: 'Cùng một sự việc kiểm thử.' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(duplicated);
  assert.equal(duplicated.value.status, 'DUPLICATE');
  assert.equal(duplicated.value.canonical_request_id, requestId);
  const duplicateAttach = await call(responseUrl, `requests/${duplicateRequestId}/attach-campaign`, {
    method: 'POST', body: { campaign_id: campaignId, expected_version: 2 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(duplicateAttach);
  assert.equal(duplicateAttach.value.campaign_id, campaignId);
  assert.equal(duplicateAttach.value.version, 3);

  await responseDb.query(
    `INSERT INTO rescue_team (id,organization_id,operating_region_code,name,team_kind,reporting_mode,external_contact_note)
     VALUES ($1,$3,$4,$5,'OTHER','COORDINATOR','Đội kiểm thử T10'),
            ($2,$3,$4,$6,'OTHER','COORDINATOR','Đội kiểm thử T10')`,
    [missionTeamIds[0], missionTeamIds[1], organizationId, regionCode, `T10 đội 1 ${missionTeamIds[0]}`, `T10 đội 2 ${missionTeamIds[1]}`],
  );
  await responseDb.query('UPDATE assistance_request SET attribution_locked_at=now() WHERE id=$1', [requestId]);
  await responseDb.query(
    `INSERT INTO mission (id,request_id,team_id,work_cycle,status,coordinator_user_id,verification_revision,created_at)
     VALUES ($1,$2,$3,1,'OFFERED',$4,$5,$6),
            ($7,$2,$8,1,'OFFERED',$4,$5,$9)`,
    [missionIds[0], requestId, missionTeamIds[0], coordinator.id, verificationEvent.id, firstOfferAt,
      missionIds[1], missionTeamIds[1], secondOfferAt],
  );
  const from = new Date(receivedAt.getTime() - 60_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const dateRegionFilter = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&region_code=${encodeURIComponent(regionCode)}`;
  const campaignFilter = `${dateRegionFilter}&campaign_id=${campaignId}`;
  const heatmap = await call(responseUrl, `map/heatmap?${campaignFilter}&status_layer=confirmed&cell_m=1000`, { headers: coordinatorAuth });
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

  const unverifiedHeatmap = await call(responseUrl, `map/heatmap?${campaignFilter}&status_layer=unverified&cell_m=1000`, { headers: coordinatorAuth });
  expectSuccess(unverifiedHeatmap);
  assert.equal(unverifiedHeatmap.value.items.length, 1, JSON.stringify(unverifiedHeatmap.value));
  assert.equal(unverifiedHeatmap.value.items[0].count, 1);
  assert.equal(unverifiedHeatmap.value.items[0].cell.type, 'Polygon');
  assert.equal(unverifiedHeatmap.value.items[0].center.type, 'Point');
  assert.equal(JSON.stringify(unverifiedHeatmap.value).includes(unverifiedRequestId), false, 'unverified heatmap must not expose request identifiers');

  const regionHeatmap = await call(responseUrl, `map/heatmap?${dateRegionFilter}&status_layer=confirmed&cell_m=1000`, { headers: coordinatorAuth });
  expectSuccess(regionHeatmap);
  assert.equal(regionHeatmap.value.items.length, 1, JSON.stringify(regionHeatmap.value));
  assert.equal(regionHeatmap.value.items[0].count, 1, 'regional map excludes duplicates and requests outside the coordinator organization');

  const paused = await call(responseUrl, `campaigns/${campaignId}/pause`, {
    method: 'POST', body: { expected_version: 3, reason: 'Hoàn tất kiểm tra trạng thái' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(paused);
  assert.equal(paused.value.status, 'PAUSED');
  assert.equal(paused.value.version, 4);

  const detachKey = key();
  const detachBody = { expected_version: 2 };
  const detached = await call(responseUrl, `requests/${unverifiedRequestId}/detach-campaign`, {
    method: 'POST', body: detachBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': detachKey },
  });
  expectSuccess(detached);
  assert.equal(detached.value.campaign_id, null);
  assert.equal(detached.value.version, 3);
  const detachReplay = await call(responseUrl, `requests/${unverifiedRequestId}/detach-campaign`, {
    method: 'POST', body: detachBody,
    headers: { ...coordinatorAuth, 'Idempotency-Key': detachKey },
  });
  expectSuccess(detachReplay);
  assert.equal(detachReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(detachReplay.value.version, 3);
  const attachToPausedCampaign = await call(responseUrl, `requests/${unverifiedRequestId}/attach-campaign`, {
    method: 'POST', body: { campaign_id: campaignId, expected_version: 3 },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectVietnameseError(attachToPausedCampaign, 409, 'CAMPAIGN_NOT_ACTIVE');

  const summary = await call(responseUrl, `reports/summary?${campaignFilter}`, { headers: coordinatorAuth });
  expectSuccess(summary);
  assert.equal(summary.value.status_counts.DISPATCHED, 1);
  assert.equal(summary.value.status_counts.DUPLICATE, 1);
  assert.equal(Object.hasOwn(summary.value.status_counts, 'SUBMITTED'), false, 'campaign filter excludes a detached request');
  assert.equal(summary.value.priority_counts.P2, 1);
  assert.equal(summary.value.active_missions, 2);
  assert.equal(summary.value.overdue_missions, 1);
  assert.equal(summary.value.median_seconds.receipt_to_verification, 240);
  assert.equal(summary.value.median_seconds.receipt_to_assignment, 300);

  const regionSummary = await call(responseUrl, `reports/summary?${dateRegionFilter}`, { headers: coordinatorAuth });
  expectSuccess(regionSummary);
  assert.equal(regionSummary.value.status_counts.DISPATCHED, 1);
  assert.equal(regionSummary.value.status_counts.DUPLICATE, 1);
  assert.equal(regionSummary.value.status_counts.SUBMITTED, 1);
  assert.equal(Object.hasOwn(regionSummary.value.status_counts, 'VERIFIED'), false, 'report scope excludes the fixture from another organization');
  assert.equal(regionSummary.value.priority_counts.P2, 1);
  assert.equal(regionSummary.value.active_missions, 2);
  assert.equal(regionSummary.value.overdue_missions, 1);
  assert.equal(regionSummary.value.median_seconds.receipt_to_verification, 240);
  assert.equal(regionSummary.value.median_seconds.receipt_to_assignment, 300);

  const blockedClose = await call(responseUrl, `campaigns/${campaignId}/close`, {
    method: 'POST', body: { expected_version: 4, reason: 'Đóng để kiểm tra yêu cầu còn mở.' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectVietnameseError(blockedClose, 409, 'CAMPAIGN_HAS_OPEN_REQUESTS');

  const closedSecondCampaign = await call(responseUrl, `campaigns/${secondCampaignId}/close`, {
    method: 'POST', body: { expected_version: 2, reason: 'Kết thúc chiến dịch phụ kiểm thử.' },
    headers: { ...coordinatorAuth, 'Idempotency-Key': key() },
  });
  expectSuccess(closedSecondCampaign);
  assert.equal(closedSecondCampaign.value.status, 'CLOSED');
  assert.equal(closedSecondCampaign.value.version, 3);
} finally {
  await Promise.allSettled([responseDb.end(), identityDb.end()]);
}

console.log('Response T10 HTTP smoke passed.');
