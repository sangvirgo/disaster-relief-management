import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const responseUrl = requiredEnv('C48_RESPONSE_BASE_URL').replace(/\/+$/u, '');
const identityUrl = requiredEnv('C48_IDENTITY_BASE_URL').replace(/\/+$/u, '');
const responseDb = new Client({ connectionString: requiredEnv('C48_RESPONSE_DATABASE_URL') });
const identityDb = new Client({ connectionString: requiredEnv('C48_IDENTITY_DATABASE_URL') });
const seedPassword = requiredEnv('SEED_PASSWORD');
const campaignIds = {
  north: '00000000-0000-4000-8000-0000000000c1',
  northOverlap: '00000000-0000-4000-8000-0000000000c2',
  south: '00000000-0000-4000-8000-0000000000c3',
};
const requestIds = {
  southPriority: '00000000-0000-4000-8000-00000000f107',
  northClaim: '00000000-0000-4000-8000-0000000000f3',
};

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

async function login(username) {
  const result = await call(identityUrl, 'auth/login', {
    method: 'POST', body: { username, password: seedPassword, client_kind: 'NATIVE' },
  });
  expectSuccess(result);
  return { id: result.value.user.id, token: result.value.access_token };
}

async function command(actor, path, body, idempotencyKey = key(), method = 'POST') {
  return call(responseUrl, path, { method, body, actor, idempotencyKey });
}

function selfBody(coordinates, suffix) {
  return {
    incident_category_code: 'FLOOD',
    description: `Báo tin kiểm thử tự động vùng chiến dịch ${suffix}.`,
    people_affected: 2,
    reporter_name: 'Người dân kiểm thử',
    reporter_contact_phone: null,
    reporter_declared_danger: false,
    needs_rescue: true,
    needs_relief_supplies: false,
    location: { type: 'Point', coordinates, source: 'GPS', accuracy_m: 8, captured_at: new Date().toISOString() },
  };
}

async function createRequest(reporter, coordinates, suffix, idempotencyKey = key(), body = selfBody(coordinates, suffix)) {
  const result = await call(responseUrl, 'requests', {
    method: 'POST', body, actor: reporter, idempotencyKey,
  });
  expectSuccess(result, 201);
  return { ...result.value, headers: result.headers, idempotencyKey };
}

await Promise.all([responseDb.connect(), identityDb.connect()]);
try {
  const [primary, secondaryA, secondaryB, citizen] = await Promise.all([
    login('coord1'), login('coord2'), login('coord3'), login('citizen1'),
  ]);
  const grants = await identityDb.query(
    `SELECT role_code,scope_type FROM role_grant WHERE user_id=$1 AND revoked_at IS NULL ORDER BY role_code,scope_type`,
    [secondaryB.id],
  );
  assert.deepEqual(grants.rows, [{ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM' }]);
  assert.equal((await responseDb.query(
    'SELECT count(*)::int AS count FROM campaign_engagement WHERE user_id=$1 AND ended_at IS NULL AND last_active_at>now()-interval \'60 minutes\'',
    [secondaryB.id],
  )).rows[0].count, 0, 'coord3 starts without an engagement');

  const secondaryEmpty = await call(responseUrl, 'requests?limit=50', { actor: secondaryB });
  expectSuccess(secondaryEmpty);
  assert.deepEqual(secondaryEmpty.value.items, []);
  const noEngagementAction = await command(secondaryB, `requests/${requestIds.southPriority}/claim`, {});
  expectVietnameseError(noEngagementAction, 403, 'FORBIDDEN');
  assert.match(noEngagementAction.value.message, /Hãy chọn một chiến dịch/u);

  const triage = await call(responseUrl, 'campaigns/triage', { actor: secondaryB });
  expectSuccess(triage);
  assert.ok(triage.value.items.length >= 4);
  assert.ok(triage.value.items.every((item) => item.status === 'ACTIVE'));
  assert.equal(triage.value.items[0].id, campaignIds.south, 'the unattended P1 campaign ranks first');
  assert.ok(triage.value.items[0].urgency.reason_codes.includes('NO_COORDINATOR'));
  assert.ok(triage.value.items[0].urgency.reason_codes.includes('P1_UNHANDLED'));

  const engageKey = key();
  const engaged = await command(secondaryB, `campaigns/${campaignIds.south}/engage`, undefined, engageKey);
  expectSuccess(engaged, 201);
  const engageReplay = await command(secondaryB, `campaigns/${campaignIds.south}/engage`, undefined, engageKey);
  expectSuccess(engageReplay, 201);
  assert.equal(engageReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(engageReplay.value.id, engaged.value.id);

  const southQueue = await call(responseUrl, `requests?campaign_id=${campaignIds.south}&limit=100`, { actor: secondaryB });
  expectSuccess(southQueue);
  assert.ok(southQueue.value.items.length > 0);
  assert.ok(southQueue.value.items.every((item) => item.campaign_id === campaignIds.south));
  assert.ok(southQueue.value.items.every((item) => !['UNMATCHED', 'CONFLICT'].includes(item.campaign_match_state)));
  const priorityRequest = southQueue.value.items.find((item) => item.id === requestIds.southPriority);
  assert.ok(priorityRequest, 'the active South campaign queue includes its P1 request');
  const teamCandidates = await call(responseUrl, `requests/${requestIds.southPriority}/team-candidates?radius_m=50000`, { actor: secondaryB });
  expectSuccess(teamCandidates);
  const southTeam = teamCandidates.value.items.find((item) => item.suggested);
  assert.ok(southTeam, 'a nearby team is suggested regardless of any campaign association');
  assert.equal(southTeam.suggested, true);
  assert.equal(Object.hasOwn(southTeam.team, 'campaign_id'), false);
  const priorityRequestDetail = await call(responseUrl, `requests/${requestIds.southPriority}`, { actor: secondaryB });
  expectSuccess(priorityRequestDetail);
  const assignment = await command(secondaryB, `requests/${requestIds.southPriority}/missions`, {
    expected_version: priorityRequestDetail.value.version, team_id: southTeam.team.id,
  });
  expectSuccess(assignment, 201);
  assert.equal(assignment.value.team_id, southTeam.team.id);
  const noTeamCampaignColumn = await responseDb.query(
    `SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema='public' AND table_name='rescue_team' AND column_name='campaign_id'`,
  );
  assert.equal(noTeamCampaignColumn.rows[0].count, 0, 'rescue teams have no campaign column');
  const secondaryOverview = await call(responseUrl, 'campaigns/overview', { actor: secondaryB });
  expectVietnameseError(secondaryOverview, 403, 'FORBIDDEN');

  const secondEngagement = await command(secondaryB, `campaigns/${campaignIds.north}/engage`, undefined);
  expectSuccess(secondEngagement, 201);
  const secondaryACampaigns = await call(responseUrl, 'me/engagements', { actor: secondaryA });
  expectSuccess(secondaryACampaigns);
  assert.ok(secondaryACampaigns.value.items.some((item) => item.campaign_id === campaignIds.north));
  const secondaryBCampaigns = await call(responseUrl, 'me/engagements', { actor: secondaryB });
  expectSuccess(secondaryBCampaigns);
  assert.ok(secondaryBCampaigns.value.items.some((item) => item.campaign_id === campaignIds.north));
  for (const actor of [secondaryA, secondaryB]) {
    const conflictHidden = await call(responseUrl, 'requests?campaign_match_state=CONFLICT&limit=50', { actor });
    expectSuccess(conflictHidden);
    assert.deepEqual(conflictHidden.value.items, []);
  }

  const secondaryClaim = await command(secondaryA, `requests/${requestIds.northClaim}/claim`, {});
  expectSuccess(secondaryClaim);
  const peerClaim = await command(secondaryB, `requests/${requestIds.northClaim}/claim`, {});
  expectVietnameseError(peerClaim, 409, 'REQUEST_ALREADY_CLAIMED');
  const primaryTakeover = await command(primary, `requests/${requestIds.northClaim}/claim`, {});
  expectSuccess(primaryTakeover);
  assert.equal(primaryTakeover.value.handled_by, primary.id);
  const secondaryBlocked = await command(secondaryA, `requests/${requestIds.northClaim}/claim`, {});
  expectVietnameseError(secondaryBlocked, 409, 'REQUEST_ALREADY_CLAIMED');
  const takeover = await responseDb.query(
    `SELECT e.event_type,n.recipient_user_id,n.payload
       FROM request_event e LEFT JOIN notice n ON n.source_id=e.request_id AND n.recipient_user_id=$2
      WHERE e.request_id=$1 AND e.event_type='CLAIM_TAKEN_OVER'`,
    [requestIds.northClaim, secondaryA.id],
  );
  assert.equal(takeover.rowCount, 1);
  assert.ok(takeover.rows[0].payload);
  assert.match(takeover.rows[0].payload.message, /vừa được .* tiếp quản/u);

  const disengageSouth = await command(secondaryB, `campaigns/${campaignIds.south}/disengage`, undefined);
  expectSuccess(disengageSouth);
  const afterOneDisengage = await call(responseUrl, `requests?campaign_id=${campaignIds.south}&limit=50`, { actor: secondaryB });
  expectSuccess(afterOneDisengage);
  assert.deepEqual(afterOneDisengage.value.items, []);
  const disengageNorth = await command(secondaryB, `campaigns/${campaignIds.north}/disengage`, undefined);
  expectSuccess(disengageNorth);
  const afterAllDisengage = await call(responseUrl, 'requests?limit=50', { actor: secondaryB });
  expectSuccess(afterAllDisengage);
  assert.deepEqual(afterAllDisengage.value.items, []);
  const myHistory = await call(responseUrl, 'me/coordination-history?limit=50', { actor: secondaryB });
  expectSuccess(myHistory);
  assert.ok(myHistory.value.items.some((item) => item.campaign_id === campaignIds.south && item.ended_at));
  const campaignHistory = await call(responseUrl, `campaigns/${campaignIds.south}/history?limit=50`, { actor: secondaryB });
  expectSuccess(campaignHistory);
  assert.ok(campaignHistory.value.items.length > 0, 'campaign timeline persists after disengagement');

  const primaryOverview = await call(responseUrl, 'campaigns/overview', { actor: primary });
  expectSuccess(primaryOverview);
  const southOverview = primaryOverview.value.items.find((item) => item.id === campaignIds.south);
  assert.ok(southOverview);
  assert.equal(southOverview.has_active_coordinator, false);
  assert.ok(primaryOverview.value.common_queue.conflict >= 1);

  const secondaryCreate = await command(secondaryB, 'campaigns', {
    name: 'Không được phép tạo chiến dịch', center: { lat: 18, lng: 110 }, radius_m: 5000,
  });
  expectVietnameseError(secondaryCreate, 403, 'FORBIDDEN');
  const invalidRadius = await command(primary, 'campaigns', {
    name: 'Chiến dịch bán kính không hợp lệ', center: { lat: 18, lng: 110 }, radius_m: 499,
  });
  expectVietnameseError(invalidRadius, 400, 'VALIDATION_FAILED');
  const createdCampaign = await command(primary, 'campaigns', {
    name: `Chiến dịch kiểm tra điều phối ${randomUUID().slice(0, 8)}`,
    objective: 'Kiểm tra quyền quản lý và vùng hoạt động.',
    center: { lat: 18, lng: 110 }, radius_m: 5000,
  });
  expectSuccess(createdCampaign, 201);
  assert.deepEqual(createdCampaign.value.center, { lat: 18, lng: 110 });
  const patchedCampaign = await command(primary, `campaigns/${createdCampaign.value.id}`, {
    expected_version: 1, center: { lat: 18.01, lng: 110.01 }, radius_m: 6000,
  }, key(), 'PATCH');
  expectSuccess(patchedCampaign);
  const activatedCampaign = await command(primary, `campaigns/${createdCampaign.value.id}/activate`, { expected_version: 2 });
  expectSuccess(activatedCampaign);
  const campaignEngagement = await command(secondaryB, `campaigns/${createdCampaign.value.id}/engage`, undefined);
  expectSuccess(campaignEngagement, 201);
  const pausedCampaign = await command(primary, `campaigns/${createdCampaign.value.id}/pause`, {
    expected_version: 3, reason: 'Tạm dừng sau khi kiểm tra vùng chiến dịch.',
  });
  expectSuccess(pausedCampaign);
  assert.equal(pausedCampaign.value.status, 'PAUSED');
  const pausedEngagementHistory = await call(responseUrl, `campaigns/${createdCampaign.value.id}/history?limit=50`, { actor: secondaryB });
  expectSuccess(pausedEngagementHistory);
  assert.ok(pausedEngagementHistory.value.items.some((item) => item.event_type === 'COORDINATION_CAMPAIGN_CLOSED'));
  const pausedReengage = await command(secondaryB, `campaigns/${createdCampaign.value.id}/engage`, undefined);
  expectVietnameseError(pausedReengage, 409, 'CAMPAIGN_NOT_ACTIVE');

  const noCenterCampaign = await command(primary, 'campaigns', {
    name: `Chiến dịch chưa có vùng ${randomUUID().slice(0, 8)}`,
  });
  expectSuccess(noCenterCampaign, 201);
  const noCenterActive = await command(primary, `campaigns/${noCenterCampaign.value.id}/activate`, { expected_version: 1 });
  expectSuccess(noCenterActive);

  const single = await createRequest(citizen, [106.7001, 10.7801], 'một vùng');
  const overlapKey = key();
  const overlapBody = selfBody([105.8501, 21.0301], 'vùng chồng lấn');
  const overlap = await createRequest(citizen, [105.8501, 21.0301], 'vùng chồng lấn', overlapKey, overlapBody);
  const overlapReplay = await createRequest(citizen, [105.8501, 21.0301], 'vùng chồng lấn', overlapKey, overlapBody);
  assert.equal(overlapReplay.headers.get('idempotent-replay'), 'true');
  assert.equal(overlapReplay.id, overlap.id);
  const { rows: [boundaryPoint] } = await responseDb.query(
    `SELECT ST_X(ST_Project(center,radius_m,0)::geometry)::float8 AS longitude,
            ST_Y(ST_Project(center,radius_m,0)::geometry)::float8 AS latitude
       FROM campaign WHERE id=$1`, [campaignIds.south],
  );
  const boundary = await createRequest(citizen, [boundaryPoint.longitude, boundaryPoint.latitude], 'đúng biên bán kính');
  const outside = await createRequest(citizen, [110, 18], 'ngoài vùng');
  const attribution = await responseDb.query(
    `SELECT r.id,r.tracking_code,r.campaign_id,r.campaign_match_state,r.campaign_candidate_ids,r.priority,
            count(m.id)::int AS mission_count
       FROM assistance_request r LEFT JOIN mission m ON m.request_id=r.id
      WHERE r.id=ANY($1::uuid[]) GROUP BY r.id ORDER BY r.id`,
    [[single.id, overlap.id, boundary.id, outside.id]],
  );
  const byId = new Map(attribution.rows.map((row) => [row.id, row]));
  assert.equal(byId.get(single.id).campaign_id, campaignIds.south);
  assert.equal(byId.get(single.id).campaign_match_state, 'AUTO_ATTACHED');
  assert.equal(byId.get(overlap.id).campaign_id, null);
  assert.equal(byId.get(overlap.id).campaign_match_state, 'CONFLICT');
  assert.deepEqual(new Set(byId.get(overlap.id).campaign_candidate_ids), new Set([campaignIds.north, campaignIds.northOverlap]));
  assert.equal(byId.get(outside.id).campaign_id, null);
  assert.equal(byId.get(outside.id).campaign_match_state, 'UNMATCHED');
  assert.equal(byId.get(boundary.id).campaign_id, campaignIds.south, 'ST_DWithin includes an SOS at the campaign radius boundary');
  assert.equal(byId.get(boundary.id).campaign_match_state, 'AUTO_ATTACHED');
  assert.ok(attribution.rows.every((row) => row.priority === null && row.mission_count === 0));
  const audit = await responseDb.query(
    `SELECT action FROM audit_log WHERE entity_type='assistance_request' AND entity_id=ANY($1::text[]) AND action='CAMPAIGN_AUTO_ATTACHED'`,
    [[single.id]],
  );
  assert.equal(audit.rowCount, 1);
  const autoEvent = await responseDb.query("SELECT count(*)::int AS count FROM request_event WHERE request_id=$1 AND event_type='CAMPAIGN_AUTO_ATTACHED'", [single.id]);
  assert.equal(autoEvent.rows[0].count, 1);
  const conflictNotices = await responseDb.query(
    `SELECT payload FROM notice WHERE source_id=$1 AND recipient_user_id=$2 AND notice_type='CAMPAIGN_MATCH_CONFLICT'`,
    [overlap.id, primary.id],
  );
  assert.equal(conflictNotices.rowCount, 1);
  assert.match(conflictNotices.rows[0].payload.message, /Cần điều phối chính chọn chiến dịch/u);
  const conflictDetail = await call(responseUrl, `requests/${overlap.id}`, { actor: primary });
  expectSuccess(conflictDetail);
  const manuallyAttached = await command(primary, `requests/${overlap.id}/attach-campaign`, {
    campaign_id: campaignIds.north, expected_version: conflictDetail.value.version,
  });
  expectSuccess(manuallyAttached);
  assert.equal(manuallyAttached.value.campaign_id, campaignIds.north);
  assert.equal(manuallyAttached.value.campaign_match_state, 'MANUAL');

  // Two-coordinator verification where the concurring coordinator is a campaign coordinator (engaged, not a primary coordinator).
  const reengaged = await command(secondaryB, `campaigns/${campaignIds.south}/engage`, undefined);
  expectSuccess(reengaged, 201);
  async function startAndConcur(requestId) {
    const detail = await call(responseUrl, `requests/${requestId}`, { actor: primary });
    expectSuccess(detail);
    const started = await command(primary, `requests/${requestId}/start-verification`, { expected_version: detail.value.version });
    expectSuccess(started);
    const concurrence = await command(secondaryB, `requests/${requestId}/concur`, {
      expected_version: started.value.version, note: 'Đã rà soát độc lập.',
    });
    expectSuccess(concurrence);
    return concurrence;
  }
  const concurred = await startAndConcur(single.id);
  const verifiedByTwo = await command(primary, `requests/${single.id}/verify`, {
    expected_version: concurred.value.version, basis: 'TWO_COORDINATOR_JUDGMENT',
    reason: 'Hai điều phối viên đã rà soát.', concurrence_event_id: concurred.value.event_id,
  });
  expectSuccess(verifiedByTwo);
  assert.equal(verifiedByTwo.value.status, 'VERIFIED');
  const lapsed = await startAndConcur(boundary.id);
  expectSuccess(await command(secondaryB, `campaigns/${campaignIds.south}/disengage`, undefined));
  const rejectedAfterLapse = await command(primary, `requests/${boundary.id}/verify`, {
    expected_version: lapsed.value.version, basis: 'TWO_COORDINATOR_JUDGMENT',
    reason: 'Hai điều phối viên đã rà soát.', concurrence_event_id: lapsed.value.event_id,
  });
  expectVietnameseError(rejectedAfterLapse, 409, 'SECOND_COORDINATOR_REQUIRED');

  console.log('PASS campaign coordination smoke: triage, role scope, engage/disengage history, takeover notice, campaign management, and spatial SOS attribution.');
} finally {
  await Promise.all([responseDb.end().catch(() => {}), identityDb.end().catch(() => {})]);
}
