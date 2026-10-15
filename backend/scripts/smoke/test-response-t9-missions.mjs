import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

export async function runMissionSmoke({
  responseDb, responseUrl, reporter, coordinator, otherRegionCoordinator, overdueReader, appTeam, coordinatorTeam, organizationId, regionCode, call, key, assertVietnameseError,
}) {
  await responseDb.query(
    "INSERT INTO incident_category (code,display_name) VALUES ('T9_MISSION','Yêu cầu kiểm thử nhiệm vụ') ON CONFLICT (code) DO NOTHING",
  );
  await responseDb.query(
    "INSERT INTO incident_category_skill (category_code,skill_code) VALUES ('T9_MISSION','T8_A') ON CONFLICT DO NOTHING",
  );

  const request = await call(responseUrl, 'requests', {
    method: 'POST',
    body: {
      incident_category_code: 'T9_MISSION', description: 'Cần hỗ trợ tại khu vực kiểm thử.', people_affected: 1,
      reporter_name: 'Người báo tin T9', reporter_contact_phone: '+84912345678', reporter_declared_danger: false,
      location: { type: 'Point', coordinates: [104.5, 14.5], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(request.status, 201, JSON.stringify(request.value));

  const approvedFacts = {
    report_mode: 'SELF', incident_category_code: 'T9_MISSION', description: 'Cần hỗ trợ tại khu vực kiểm thử.',
    reporter_name: 'Người báo tin T9', reporter_contact_phone: '+84912345678', reporter_declared_danger: false,
    region_code: regionCode, campaign_id: null, people_affected: 1,
    location: { type: 'Point', coordinates: [104.5, 14.5], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
  };
  const [verified] = (await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
     VALUES ($1,$2,'REQUEST_VERIFIED','STAFF','VERIFYING','VERIFIED',$3::jsonb) RETURNING id`,
    [request.value.id, coordinator.id, JSON.stringify({ approved_facts: approvedFacts })],
  )).rows;
  await responseDb.query(
    `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id)
     VALUES ($1,'VERIFIED','CONTACT_CONFIRMED',$2)`, [request.value.id, coordinator.id],
  );
  await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
     VALUES ($1,$2,'REQUEST_TRIAGED','STAFF','VERIFIED','TRIAGED',$3::jsonb)`,
    [request.value.id, coordinator.id, JSON.stringify({ priority: 'P2', priority_basis: 'COMPLETE' })],
  );
  await responseDb.query(
    `UPDATE assistance_request
        SET region_code=$3,status='TRIAGED',priority='P2',priority_basis='COMPLETE',
            verification_revision=$2,version=3
      WHERE id=$1`, [request.value.id, verified.id, regionCode],
  );

  const body = { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' };
  const idempotencyKey = key();
  const unauthenticated = await call(responseUrl, `requests/${request.value.id}/missions`, {
    method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey },
  });
  assertVietnameseError(unauthenticated, 401, 'UNAUTHENTICATED');

  const offered = await call(responseUrl, `requests/${request.value.id}/missions`, {
    method: 'POST', body,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(offered.status, 201, JSON.stringify(offered.value));
  assert.equal(offered.value.status, 'OFFERED');

  const replayed = await call(responseUrl, `requests/${request.value.id}/missions`, {
    method: 'POST', body,
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': idempotencyKey },
  });
  assert.equal(replayed.status, 201, JSON.stringify(replayed.value));
  assert.equal(replayed.headers.get('idempotent-replay'), 'true');
  assert.equal(replayed.value.id, offered.value.id);

  const stored = await responseDb.query(
    `SELECT m.status,m.verification_revision,m.suggested_team_id,r.verification_revision AS request_revision,
            r.attribution_locked_at,r.status AS request_status
       FROM mission m JOIN assistance_request r ON r.id=m.request_id WHERE m.id=$1`, [offered.value.id],
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].status, 'OFFERED');
  assert.equal(stored.rows[0].verification_revision, stored.rows[0].request_revision);
  assert.ok(stored.rows[0].attribution_locked_at);
  assert.equal(stored.rows[0].request_status, 'DISPATCHED');

  const outOfScopeDetail = await call(responseUrl, `missions/${offered.value.id}`, {
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` },
  });
  assertVietnameseError(outOfScopeDetail, 403, 'FORBIDDEN');
  const outOfScopeMine = await call(responseUrl, 'missions/mine?limit=10', {
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` },
  });
  assertVietnameseError(outOfScopeMine, 403, 'FORBIDDEN');

  const invalidEdge = await call(responseUrl, `missions/${offered.value.id}/transition`, {
    method: 'POST', body: { expected_version: 1, to: 'EN_ROUTE' },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(invalidEdge, 409, 'STATE_TRANSITION_INVALID');

  const boundary = `----c48-t9-${key()}`;
  const file = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x54, 0x39]);
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="mission.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const deniedEvidenceResponse = await fetch(`${responseUrl}/missions/${offered.value.id}/evidence`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${otherRegionCoordinator.token}`, 'Idempotency-Key': key(),
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(multipart.length),
    },
    body: multipart,
  });
  const deniedEvidenceText = await deniedEvidenceResponse.text();
  assertVietnameseError({
    status: deniedEvidenceResponse.status, headers: deniedEvidenceResponse.headers,
    value: JSON.parse(deniedEvidenceText),
  }, 403, 'FORBIDDEN');

  const evidenceResponse = await fetch(`${responseUrl}/missions/${offered.value.id}/evidence`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key(),
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(multipart.length),
    },
    body: multipart,
  });
  const evidenceText = await evidenceResponse.text();
  const evidence = { status: evidenceResponse.status, headers: evidenceResponse.headers, value: evidenceText ? JSON.parse(evidenceText) : undefined };
  const evidenceStorageUnavailable = evidence.status === 503 && evidence.value?.code === 'STORAGE_UNAVAILABLE';
  if (evidenceStorageUnavailable) {
    assertVietnameseError(evidence, 503, 'STORAGE_UNAVAILABLE');
    console.log('SKIP mission-evidence storage assertions: the configured object store is unavailable (T5 provider gate).');
  } else {
    assert.equal(evidence.status, 201, JSON.stringify(evidence.value));
    assert.equal(evidence.value.state, 'READY');
    const evidenceOwner = await responseDb.query(
      'SELECT request_id,mission_id FROM evidence_metadata WHERE id=$1', [evidence.value.id],
    );
    assert.equal(evidenceOwner.rows[0].request_id, null);
    assert.equal(evidenceOwner.rows[0].mission_id, offered.value.id);
  }

  const mine = await call(responseUrl, `missions/mine?limit=10`, {
    headers: { Authorization: `Bearer ${reporter.token}` },
  });
  assert.equal(mine.status, 200, JSON.stringify(mine.value));
  assert.ok(mine.value.items.some((item) => item.id === offered.value.id));
  assert.equal(mine.value.items.find((item) => item.id === offered.value.id).reporter_contact_phone, '+84912345678');
  const detail = await call(responseUrl, `missions/${offered.value.id}`, {
    headers: { Authorization: `Bearer ${reporter.token}` },
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.value));
  assert.equal(detail.value.location.coordinates[0], 104.5);
  assert.equal(detail.value.reporter_contact_phone, '+84912345678');
  assert.equal(
    detail.value.evidence.items.some((item) => item.id === evidence.value?.id),
    !evidenceStorageUnavailable,
  );

  const acceptKey = key();
  const acceptBody = { expected_version: 1 };
  const accepted = await call(responseUrl, `missions/${offered.value.id}/accept`, {
    method: 'POST', body: acceptBody,
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': acceptKey },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.value));
  assert.equal(accepted.value.status, 'ACCEPTED');
  assert.equal(accepted.value.created_at, offered.value.created_at);
  const acceptReplay = await call(responseUrl, `missions/${offered.value.id}/accept`, {
    method: 'POST', body: acceptBody,
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': acceptKey },
  });
  assert.equal(acceptReplay.status, 200, JSON.stringify(acceptReplay.value));
  assert.equal(acceptReplay.headers.get('idempotent-replay'), 'true');

  for (const [to, expectedVersion] of [['EN_ROUTE', 2], ['ON_SCENE', 3]]) {
    const changed = await call(responseUrl, `missions/${offered.value.id}/transition`, {
      method: 'POST', body: { expected_version: expectedVersion, to },
      headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.value));
    assert.equal(changed.value.status, to);
  }
  const missingOutcome = await call(responseUrl, `missions/${offered.value.id}/transition`, {
    method: 'POST', body: { expected_version: 4, to: 'COMPLETED' },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(missingOutcome, 400, 'VALIDATION_FAILED');
  const completed = await call(responseUrl, `missions/${offered.value.id}/transition`, {
    method: 'POST', body: {
      expected_version: 4, to: 'COMPLETED',
      result: { outcome_note: 'Đội đã hỗ trợ người dân đến nơi an toàn.' },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.value));
  assert.equal(completed.value.status, 'COMPLETED');
  const completedRequest = await responseDb.query('SELECT status FROM assistance_request WHERE id=$1', [request.value.id]);
  assert.equal(completedRequest.rows[0].status, 'TRIAGED', 'mission completion must not resolve the request');

  const context = { responseDb, responseUrl, reporter, coordinator, regionCode, call, key };
  const pendingSupplementRequest = await createTriagedRequest(context, 'có thông tin bổ sung đang chờ duyệt');
  const trackingCode = await responseDb.query('SELECT tracking_code FROM assistance_request WHERE id=$1', [pendingSupplementRequest.id]);
  const supplement = await call(responseUrl, `requests/${pendingSupplementRequest.id}/supplements`, {
    method: 'POST', body: { expected_version: 3, description: 'Thông tin bổ sung đang chờ duyệt.' },
    headers: {
      Authorization: `Bearer ${reporter.token}`, 'X-Tracking-Code': trackingCode.rows[0].tracking_code,
      'Idempotency-Key': key(),
    },
  });
  assert.equal(supplement.status, 201, JSON.stringify(supplement.value));
  const pendingEvent = await responseDb.query(
    `SELECT payload->>'pending_review' AS pending_review FROM request_event
      WHERE request_id=$1 AND event_type='REPORTER_SUPPLEMENT' ORDER BY occurred_at DESC LIMIT 1`,
    [pendingSupplementRequest.id],
  );
  assert.equal(pendingEvent.rows[0].pending_review, 'true');
  const pendingOffer = await call(responseUrl, `requests/${pendingSupplementRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 4, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(pendingOffer.status, 201, JSON.stringify(pendingOffer.value));
  const pendingSnapshot = await responseDb.query(
    `SELECT e.payload->>'pending_review' AS pending_review,m.status
       FROM mission m JOIN request_event e ON e.id=m.verification_revision WHERE m.id=$1`, [pendingOffer.value.id],
  );
  assert.equal(pendingSnapshot.rows[0].pending_review, null, 'mission keeps the approved verification snapshot');
  assert.equal(pendingSnapshot.rows[0].status, 'OFFERED');
  const pendingCancel = await call(responseUrl, `missions/${pendingOffer.value.id}/cancel`, {
    method: 'POST', body: { expected_version: 1, reason: 'Thu hồi lời mời sau khi kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(pendingCancel.status, 200, JSON.stringify(pendingCancel.value));

  const failedRequest = await createTriagedRequest(context, 'điều phối đánh dấu nhiệm vụ thất bại');
  const failedOffer = await call(responseUrl, `requests/${failedRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(failedOffer.status, 201, JSON.stringify(failedOffer.value));
  const failed = await call(responseUrl, `missions/${failedOffer.value.id}/fail`, {
    method: 'POST', body: { expected_version: 1, reason: 'Đội không thể triển khai nhiệm vụ.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(failed.status, 200, JSON.stringify(failed.value));
  assert.equal(failed.value.status, 'FAILED');

  const declinedRequest = await createTriagedRequest(context, 'từ chối bởi trưởng đội');
  const declinedOffer = await call(responseUrl, `requests/${declinedRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(declinedOffer.status, 201, JSON.stringify(declinedOffer.value));
  const declined = await call(responseUrl, `missions/${declinedOffer.value.id}/decline`, {
    method: 'POST', body: { expected_version: 1, reason: 'Đội không thể nhận nhiệm vụ.' },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(declined.status, 200, JSON.stringify(declined.value));
  assert.equal(declined.value.status, 'DECLINED');

  const raceRequests = await Promise.all([
    createTriagedRequest(context, 'tranh chấp phân công A'),
    createTriagedRequest(context, 'tranh chấp phân công B'),
  ]);
  const raceOffers = await Promise.all(raceRequests.map((item) => call(responseUrl, `requests/${item.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  })));
  const winners = raceOffers.filter((item) => item.status === 201);
  const losers = raceOffers.filter((item) => item.status === 409);
  assert.equal(winners.length, 1, JSON.stringify(raceOffers.map((item) => ({ status: item.status, value: item.value }))));
  assert.equal(losers.length, 1, JSON.stringify(raceOffers.map((item) => ({ status: item.status, value: item.value }))));
  assert.ok(['TEAM_BUSY', 'TEAM_HAS_ACTIVE_MISSION'].includes(losers[0].value.code), JSON.stringify(losers[0].value));
  const raceMission = winners[0].value;

  // Keep this fixture at the head of the bounded page when prior smoke rows accumulate.
  await responseDb.query("UPDATE mission SET created_at=TIMESTAMPTZ '2000-01-01 00:00:00+00' WHERE id=$1", [raceMission.id]);
  const overdue = await call(responseUrl, 'missions/overdue-offers?limit=10', {
    headers: { Authorization: `Bearer ${overdueReader.token}` },
  });
  assert.equal(overdue.status, 200, JSON.stringify(overdue.value));
  assert.ok(overdue.value.items.some((item) => item.id === raceMission.id));
  const outOfScopeOverdue = await call(responseUrl, 'missions/overdue-offers?limit=10', {
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` },
  });
  assert.equal(outOfScopeOverdue.status, 200, JSON.stringify(outOfScopeOverdue.value));
  assert.deepEqual(outOfScopeOverdue.value.items, [], 'out-of-scope coordinators cannot see overdue missions');
  assert.equal(outOfScopeOverdue.headers.get('cache-control'), 'no-store');
  if (process.env.SCHEDULER_ENABLED === 'true') {
    const noticeDeadline = Date.now() + 45_000;
    let overdueNotices = [];
    while (Date.now() < noticeDeadline && overdueNotices.length === 0) {
      overdueNotices = (await responseDb.query(
        "SELECT id FROM notice WHERE source_id=$1 AND notice_type='MISSION_OFFER_OVERDUE' AND recipient_user_id=$2",
        [raceMission.id, coordinator.id],
      )).rows;
      if (!overdueNotices.length) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(overdueNotices.length, 1, 'overdue offers must produce one scoped coordinator notice');
  } else {
    console.log('SKIP overdue mission notice smoke: SCHEDULER_ENABLED is false; scan behavior is covered by the unit test.');
  }
  const stillAssigned = await responseDb.query('SELECT team_id,status FROM mission WHERE id=$1', [raceMission.id]);
  assert.deepEqual(stillAssigned.rows, [{ team_id: appTeam.value.id, status: 'OFFERED' }], 'overdue notice must not auto-reassign');

  const beforeOfferedCancel = await responseDb.query('SELECT availability,readiness_required FROM rescue_team WHERE id=$1', [appTeam.value.id]);
  assert.equal(beforeOfferedCancel.rows[0].availability, 'AVAILABLE');
  assert.equal(beforeOfferedCancel.rows[0].readiness_required, false);
  const offeredCancel = await call(responseUrl, `missions/${raceMission.id}/cancel`, {
    method: 'POST', body: { expected_version: 1, reason: 'Thu hồi lời mời trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(offeredCancel.status, 200, JSON.stringify(offeredCancel.value));
  const afterOfferedCancel = await responseDb.query('SELECT availability,readiness_required FROM rescue_team WHERE id=$1', [appTeam.value.id]);
  assert.equal(afterOfferedCancel.rows[0].availability, 'AVAILABLE', 'canceling OFFERED must keep team readiness');
  assert.equal(afterOfferedCancel.rows[0].readiness_required, false);

  const campaign = await call(responseUrl, 'campaigns', {
    method: 'POST', body: { name: `T9 lock campaign ${key()}`, region_code: regionCode },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(campaign.status, 201, JSON.stringify(campaign.value));
  const activatedCampaign = await call(responseUrl, `campaigns/${campaign.value.id}/activate`, {
    method: 'POST', body: { expected_version: campaign.value.version },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(activatedCampaign.status, 200, JSON.stringify(activatedCampaign.value));

  const campaignOfferRequest = await createTriagedRequest(context, 'tranh chấp lời mời nhiệm vụ và đóng chiến dịch');
  const attachedCampaignRequest = await call(responseUrl, `requests/${campaignOfferRequest.id}/attach-campaign`, {
    method: 'POST', body: { expected_version: 3, campaign_id: campaign.value.id },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(attachedCampaignRequest.status, 200, JSON.stringify(attachedCampaignRequest.value));
  const campaignRequest = await responseDb.query('SELECT version FROM assistance_request WHERE id=$1', [campaignOfferRequest.id]);
  const campaignLockDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
  await campaignLockDb.connect();
  let campaignTransactionOpen = false;
  let campaignOfferPending;
  let campaignClosePending;
  let campaignOffer;
  let campaignClose;
  try {
    await campaignLockDb.query('BEGIN');
    campaignTransactionOpen = true;
    const [{ pid: campaignBlockerPid }] = (await campaignLockDb.query('SELECT pg_backend_pid() AS pid')).rows;
    await campaignLockDb.query('SELECT id FROM campaign WHERE id=$1 FOR UPDATE', [campaign.value.id]);
    campaignOfferPending = call(responseUrl, `requests/${campaignOfferRequest.id}/missions`, {
      method: 'POST', body: {
        expected_version: Number(campaignRequest.rows[0].version), team_id: appTeam.value.id,
        override_reason: 'Đội được chọn trong kiểm thử.',
      },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    campaignOfferPending.catch(() => undefined);
    const [campaignOfferPid] = await waitForLockWaiters(
      responseDb, campaignBlockerPid, 1, 'campaign mission offer', [campaignOfferPending],
    );
    campaignClosePending = call(responseUrl, `campaigns/${campaign.value.id}/close`, {
      method: 'POST', body: { expected_version: activatedCampaign.value.version, reason: 'Đóng để kiểm tra tranh chấp.' },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    campaignClosePending.catch(() => undefined);
    await waitForLockWaiterBlockedBy(responseDb, campaignOfferPid, 'campaign close', [campaignClosePending]);
    await campaignLockDb.query('COMMIT');
    campaignTransactionOpen = false;
    [campaignOffer, campaignClose] = await Promise.all([campaignOfferPending, campaignClosePending]);
  } finally {
    if (campaignTransactionOpen) await campaignLockDb.query('ROLLBACK').catch(() => undefined);
    await Promise.all([campaignOfferPending, campaignClosePending]
      .filter(Boolean).map((pending) => pending.catch(() => undefined)));
    await campaignLockDb.end();
  }
  assert.equal(campaignOffer.status, 201, JSON.stringify(campaignOffer.value));
  assertVietnameseError(campaignClose, 409, 'CAMPAIGN_HAS_OPEN_REQUESTS');
  // The already-linked request is open, so campaign close must remain blocked after the offer wins.
  const campaignLockState = await responseDb.query(
    `SELECT c.status AS campaign_status,r.status AS request_status,r.campaign_id,m.status AS mission_status
       FROM campaign c JOIN assistance_request r ON r.campaign_id=c.id
       JOIN mission m ON m.request_id=r.id WHERE c.id=$1 AND r.id=$2 AND m.id=$3`,
    [campaign.value.id, campaignOfferRequest.id, campaignOffer.value.id],
  );
  assert.deepEqual(campaignLockState.rows, [{
    campaign_status: 'ACTIVE', request_status: 'DISPATCHED', campaign_id: campaign.value.id, mission_status: 'OFFERED',
  }]);

  const campaignOfferCancelled = await call(responseUrl, `missions/${campaignOffer.value.id}/cancel`, {
    method: 'POST', body: { expected_version: campaignOffer.value.version, reason: 'Thu hồi lời mời sau kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(campaignOfferCancelled.status, 200, JSON.stringify(campaignOfferCancelled.value));

  const noOpRecomputeRequest = await createTriagedRequest(context, 'khóa yêu cầu khi tiến độ nhiệm vụ không đổi');
  const noOpRecomputeOffer = await call(responseUrl, `requests/${noOpRecomputeRequest.id}/missions`, {
    method: 'POST', body: {
      expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.',
    },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(noOpRecomputeOffer.status, 201, JSON.stringify(noOpRecomputeOffer.value));
  const noOpRecomputeAccepted = await call(responseUrl, `missions/${noOpRecomputeOffer.value.id}/accept`, {
    method: 'POST', body: { expected_version: 1 },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(noOpRecomputeAccepted.status, 200, JSON.stringify(noOpRecomputeAccepted.value));
  const [progressBeforeNoOp] = (await responseDb.query(
    'SELECT status,version FROM assistance_request WHERE id=$1', [noOpRecomputeRequest.id],
  )).rows;
  assert.equal(progressBeforeNoOp.status, 'IN_PROGRESS');
  const noOpLockDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
  await noOpLockDb.connect();
  let noOpTransactionOpen = false;
  let noOpTransitionPending;
  try {
    await noOpLockDb.query('BEGIN');
    noOpTransactionOpen = true;
    const [{ pid: noOpBlockerPid }] = (await noOpLockDb.query('SELECT pg_backend_pid() AS pid')).rows;
    await noOpLockDb.query('SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE', [noOpRecomputeRequest.id]);
    noOpTransitionPending = call(responseUrl, `missions/${noOpRecomputeOffer.value.id}/transition`, {
      method: 'POST', body: { expected_version: 2, to: 'EN_ROUTE' },
      headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
    });
    noOpTransitionPending.catch(() => undefined);
    await waitForLockWaiters(responseDb, noOpBlockerPid, 1, 'mission progress no-op recompute', [noOpTransitionPending]);
    await noOpLockDb.query('COMMIT');
    noOpTransactionOpen = false;
    const noOpTransition = await noOpTransitionPending;
    assert.equal(noOpTransition.status, 200, JSON.stringify(noOpTransition.value));
    const [progressAfterNoOp] = (await responseDb.query(
      'SELECT status,version FROM assistance_request WHERE id=$1', [noOpRecomputeRequest.id],
    )).rows;
    assert.deepEqual(progressAfterNoOp, progressBeforeNoOp);
  } finally {
    if (noOpTransactionOpen) await noOpLockDb.query('ROLLBACK').catch(() => undefined);
    await noOpTransitionPending?.catch(() => undefined);
    await noOpLockDb.end();
  }
  const noOpMissionOnScene = await call(responseUrl, `missions/${noOpRecomputeOffer.value.id}/transition`, {
    method: 'POST', body: { expected_version: 3, to: 'ON_SCENE' },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(noOpMissionOnScene.status, 200, JSON.stringify(noOpMissionOnScene.value));
  const noOpMissionCompleted = await call(responseUrl, `missions/${noOpRecomputeOffer.value.id}/transition`, {
    method: 'POST', body: {
      expected_version: 4, to: 'COMPLETED', result: { outcome_note: 'Đội đã hỗ trợ người dân an toàn.' },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(noOpMissionCompleted.status, 200, JSON.stringify(noOpMissionCompleted.value));

  const resolvingRaceRequest = await createTriagedRequest(context, 'tranh chấp hoàn tất nhiệm vụ và xử lý yêu cầu');
  const resolvingRaceOffer = await call(responseUrl, `requests/${resolvingRaceRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(resolvingRaceOffer.status, 201, JSON.stringify(resolvingRaceOffer.value));
  const resolvingEvidenceResponse = await fetch(`${responseUrl}/missions/${resolvingRaceOffer.value.id}/evidence`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key(),
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(multipart.length),
    },
    body: multipart,
  });
  const resolvingEvidenceText = await resolvingEvidenceResponse.text();
  const resolvingEvidence = {
    status: resolvingEvidenceResponse.status, headers: resolvingEvidenceResponse.headers,
    value: resolvingEvidenceText ? JSON.parse(resolvingEvidenceText) : undefined,
  };
  const resolutionEvidenceUnavailable = resolvingEvidence.status === 503 && resolvingEvidence.value?.code === 'STORAGE_UNAVAILABLE';
  if (resolutionEvidenceUnavailable) {
    assertVietnameseError(resolvingEvidence, 503, 'STORAGE_UNAVAILABLE');
    console.log('SKIP request resolution success assertion: mission evidence storage is unavailable (T5 provider gate).');
  } else {
    assert.equal(resolvingEvidence.status, 201, JSON.stringify(resolvingEvidence.value));
    assert.equal(resolvingEvidence.value.state, 'READY');
  }
  const acceptedRaceMission = await call(responseUrl, `missions/${resolvingRaceOffer.value.id}/accept`, {
    method: 'POST', body: { expected_version: 1 },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(acceptedRaceMission.status, 200, JSON.stringify(acceptedRaceMission.value));
  const enRouteRaceMission = await call(responseUrl, `missions/${resolvingRaceOffer.value.id}/transition`, {
    method: 'POST', body: { expected_version: 2, to: 'EN_ROUTE' },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(enRouteRaceMission.status, 200, JSON.stringify(enRouteRaceMission.value));
  const onSceneRaceMission = await call(responseUrl, `missions/${resolvingRaceOffer.value.id}/transition`, {
    method: 'POST', body: { expected_version: 3, to: 'ON_SCENE' },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(onSceneRaceMission.status, 200, JSON.stringify(onSceneRaceMission.value));
  const [resolvingRequestVersion] = (await responseDb.query(
    'SELECT version FROM assistance_request WHERE id=$1', [resolvingRaceRequest.id],
  )).rows;

  const lockDb = new Client({ connectionString: process.env.C48_RESPONSE_DATABASE_URL });
  await lockDb.connect();
  let transactionOpen = false;
  let completionPending;
  let resolutionPending;
  const resolutionOperationIds = new Set();
  try {
    await lockDb.query('BEGIN');
    transactionOpen = true;
    const [{ pid: requestBlockerPid }] = (await lockDb.query('SELECT pg_backend_pid() AS pid')).rows;
    await lockDb.query('SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE', [resolvingRaceRequest.id]);
    resolutionPending = call(responseUrl, `requests/${resolvingRaceRequest.id}/resolve`, {
      method: 'POST', body: {
        expected_version: Number(resolvingRequestVersion.version),
        outcome_basis: 'RESCUE_COMPLETED', resolution_reason: 'Đã hoàn tất nhiệm vụ cứu trợ.',
      },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    }).then((result) => {
      if (typeof result.value?.operation_id === 'string') resolutionOperationIds.add(result.value.operation_id);
      return result;
    });
    resolutionPending.catch(() => undefined);
    const [resolutionWaiterPid] = await waitForLockWaiters(
      responseDb, requestBlockerPid, 1, 'request resolution', [resolutionPending],
    );
    completionPending = call(responseUrl, `missions/${resolvingRaceOffer.value.id}/transition`, {
      method: 'POST', body: { expected_version: 4, to: 'COMPLETED', result: { outcome_note: 'Đội đã hỗ trợ người dân an toàn.' } },
      headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
    });
    completionPending.catch(() => undefined);
    await waitForLockWaiterBlockedBy(responseDb, resolutionWaiterPid, 'mission completion', [completionPending]);
    await lockDb.query('COMMIT');
    transactionOpen = false;

    const [firstResolution, completedMission] = await Promise.all([resolutionPending, completionPending]);
    assertVietnameseError(firstResolution, 409, 'RESOLUTION_BLOCKED');
    assert.equal(completedMission.status, 200, JSON.stringify(completedMission.value));
    assert.equal(completedMission.value.status, 'COMPLETED');

    const [completedRequest] = (await responseDb.query(
      'SELECT status,version FROM assistance_request WHERE id=$1', [resolvingRaceRequest.id],
    )).rows;
    assert.equal(completedRequest.status, 'TRIAGED');
    const resolvedRequest = await call(responseUrl, `requests/${resolvingRaceRequest.id}/resolve`, {
      method: 'POST', body: {
        expected_version: Number(completedRequest.version),
        outcome_basis: 'RESCUE_COMPLETED', resolution_reason: 'Đã hoàn tất nhiệm vụ cứu trợ.',
      },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    if (resolutionEvidenceUnavailable) {
      assertVietnameseError(resolvedRequest, 409, 'RESOLUTION_BLOCKED');
      assert.deepEqual(resolvedRequest.value.details.reasons, ['NO_COMPLETED_MISSION_EVIDENCE']);
    } else {
      assert.equal(resolvedRequest.status, 202, JSON.stringify(resolvedRequest.value));
      const finalResolutionOperationId = resolvedRequest.value.operation_id;
      assert.ok(finalResolutionOperationId, JSON.stringify(resolvedRequest.value));
      resolutionOperationIds.add(finalResolutionOperationId);
      const finalizedOperation = await call(responseUrl, `operations/${finalResolutionOperationId}`, {
        headers: { Authorization: `Bearer ${coordinator.token}` },
      });
      assert.equal(finalizedOperation.status, 200, JSON.stringify(finalizedOperation.value));
      assert.equal(finalizedOperation.value.state, 'COMPLETED');
      const finalResolutionState = await responseDb.query(
        `SELECT r.status AS request_status,m.status AS mission_status
           FROM assistance_request r JOIN mission m ON m.request_id=r.id WHERE r.id=$1`,
        [resolvingRaceRequest.id],
      );
      assert.deepEqual(finalResolutionState.rows, [{ request_status: 'RESOLVED', mission_status: 'COMPLETED' }]);
    }
  } finally {
    if (transactionOpen) await lockDb.query('ROLLBACK').catch(() => undefined);
    await Promise.all([completionPending, resolutionPending]
      .filter(Boolean).map((pending) => pending.catch(() => undefined)));
    try {
      for (const operationId of resolutionOperationIds) {
        const operation = await call(responseUrl, `operations/${operationId}`, {
          headers: { Authorization: `Bearer ${coordinator.token}` },
        });
        if (['PENDING', 'ABORTING'].includes(operation.value?.state)) {
          const [currentRequest] = (await responseDb.query(
            'SELECT version FROM assistance_request WHERE id=$1', [resolvingRaceRequest.id],
          )).rows;
          const aborted = await call(responseUrl, `operations/${operationId}/abort`, {
            method: 'POST', body: {
              expected_version: Number(currentRequest.version), reason: 'Dọn thao tác kiểm thử chưa hoàn tất.',
            },
            headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
          });
          assert.equal(aborted.status, 202, JSON.stringify(aborted.value));
          const abortedOperation = await call(responseUrl, `operations/${operationId}`, {
            headers: { Authorization: `Bearer ${coordinator.token}` },
          });
          assert.equal(abortedOperation.value?.state, 'ABORTED');
        }
      }
    } finally {
      await lockDb.end();
    }
  }

  const availabilityRaceRequest = await createTriagedRequest(context, 'tranh chấp lời mời và trạng thái đội');
  const [availabilityRaceTeam] = (await responseDb.query(
    'SELECT version FROM rescue_team WHERE id=$1 AND availability=\'AVAILABLE\'', [appTeam.value.id],
  )).rows;
  assert.ok(availabilityRaceTeam, 'the team must be available before the race');
  let availabilityRaceMissionId;
  let availabilityPatch;
  await responseDb.query('BEGIN');
  try {
    const [{ pid: availabilityBlockerPid }] = (await responseDb.query('SELECT pg_backend_pid() AS pid')).rows;
    // Keep the offer's FOR SHARE compatible while forcing PATCH's FOR UPDATE to wait.
    await responseDb.query('SELECT id FROM rescue_team WHERE id=$1 FOR SHARE', [appTeam.value.id]);
    const availabilityRaceOffer = await call(responseUrl, `requests/${availabilityRaceRequest.id}/missions`, {
      method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    assert.equal(availabilityRaceOffer.status, 201, JSON.stringify(availabilityRaceOffer.value));
    availabilityRaceMissionId = availabilityRaceOffer.value.id;
    availabilityPatch = call(responseUrl, `teams/${appTeam.value.id}`, {
      method: 'PATCH', body: { expected_version: Number(availabilityRaceTeam.version), availability: 'UNAVAILABLE' },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    availabilityPatch.catch(() => undefined);
    await waitForLockWaiters(responseDb, availabilityBlockerPid, 1, 'team availability PATCH', [availabilityPatch]);
  } finally {
    await responseDb.query('COMMIT');
  }
  const blockedAvailabilityPatch = await availabilityPatch;
  assertVietnameseError(blockedAvailabilityPatch, 409, 'TEAM_BUSY');
  const availabilityRaceState = await responseDb.query(
    `SELECT t.availability,m.status FROM rescue_team t
      JOIN mission m ON m.team_id=t.id AND m.request_id=$2 WHERE t.id=$1`,
    [appTeam.value.id, availabilityRaceRequest.id],
  );
  assert.deepEqual(availabilityRaceState.rows, [{ availability: 'AVAILABLE', status: 'OFFERED' }]);
  const availabilityRaceCancel = await call(responseUrl, `missions/${availabilityRaceMissionId}/cancel`, {
    method: 'POST', body: { expected_version: 1, reason: 'Thu hồi lời mời sau kiểm thử tranh chấp.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(availabilityRaceCancel.status, 200, JSON.stringify(availabilityRaceCancel.value));

  const unavailableFirstRequest = await createTriagedRequest(context, 'đội chưa sẵn sàng trước khi phân công');
  const [availableTeamBeforePatch] = (await responseDb.query(
    'SELECT version FROM rescue_team WHERE id=$1 AND availability=\'AVAILABLE\'', [appTeam.value.id],
  )).rows;
  assert.ok(availableTeamBeforePatch, 'the team must be available before PATCH-first coverage');
  const unavailableFirstPatch = await call(responseUrl, `teams/${appTeam.value.id}`, {
    method: 'PATCH', body: { expected_version: Number(availableTeamBeforePatch.version), availability: 'UNAVAILABLE' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(unavailableFirstPatch.status, 200, JSON.stringify(unavailableFirstPatch.value));
  const unavailableFirstOffer = await call(responseUrl, `requests/${unavailableFirstRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(unavailableFirstOffer, 409, 'TEAM_NOT_ELIGIBLE');
  assert.equal(unavailableFirstOffer.value.details?.reason, 'UNAVAILABLE');
  const unavailableFirstMissions = await responseDb.query(
    'SELECT id,status FROM mission WHERE request_id=$1', [unavailableFirstRequest.id],
  );
  assert.deepEqual(unavailableFirstMissions.rows, [], 'an unavailable team must not receive an offered mission');
  const unavailableTeamState = await responseDb.query(
    'SELECT availability,readiness_required,version FROM rescue_team WHERE id=$1', [appTeam.value.id],
  );
  assert.equal(unavailableTeamState.rows[0].availability, 'UNAVAILABLE');
  assert.equal(unavailableTeamState.rows[0].readiness_required, false);
  const restoredTeam = await call(responseUrl, `teams/${appTeam.value.id}`, {
    method: 'PATCH', body: { expected_version: Number(unavailableTeamState.rows[0].version), availability: 'AVAILABLE' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(restoredTeam.status, 200, JSON.stringify(restoredTeam.value));

  const acceptedCancelRequest = await createTriagedRequest(context, 'hủy nhiệm vụ đã nhận');
  const acceptedCancelOffer = await call(responseUrl, `requests/${acceptedCancelRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: appTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(acceptedCancelOffer.status, 201, JSON.stringify(acceptedCancelOffer.value));
  const acceptedForCancel = await call(responseUrl, `missions/${acceptedCancelOffer.value.id}/accept`, {
    method: 'POST', body: { expected_version: 1 },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(acceptedForCancel.status, 200, JSON.stringify(acceptedForCancel.value));
  const activeCancel = await call(responseUrl, `missions/${acceptedCancelOffer.value.id}/cancel`, {
    method: 'POST', body: { expected_version: 2, reason: 'Đội dừng nhiệm vụ trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(activeCancel.status, 200, JSON.stringify(activeCancel.value));
  const afterActiveCancel = await responseDb.query('SELECT availability,readiness_required FROM rescue_team WHERE id=$1', [appTeam.value.id]);
  assert.equal(afterActiveCancel.rows[0].availability, 'UNAVAILABLE');
  assert.equal(afterActiveCancel.rows[0].readiness_required, true);

  await responseDb.query(
    "UPDATE rescue_team SET availability='AVAILABLE',readiness_required=false,version=version+1 WHERE id=$1",
    [coordinatorTeam.value.id],
  );
  await responseDb.query(
    "INSERT INTO team_skill (team_id,skill_code) VALUES ($1,'T8_A') ON CONFLICT DO NOTHING", [coordinatorTeam.value.id],
  );
  const coordinatorMissionRequest = await createTriagedRequest(context, 'đội điều phối không có tài khoản');
  const coordinatorOffer = await call(responseUrl, `requests/${coordinatorMissionRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: coordinatorTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(coordinatorOffer.status, 201, JSON.stringify(coordinatorOffer.value));
  const noMembers = await responseDb.query('SELECT count(*)::int AS count FROM team_member WHERE team_id=$1', [coordinatorTeam.value.id]);
  assert.equal(noMembers.rows[0].count, 0, 'COORDINATOR team remains accountless');
  const falseLeaderAction = await call(responseUrl, `missions/${coordinatorOffer.value.id}/accept`, {
    method: 'POST', body: { expected_version: 1 },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(falseLeaderAction, 403, 'MISSION_NOT_LEADER');
  const outOfScopeRecord = await call(responseUrl, `missions/${coordinatorOffer.value.id}/record-on-behalf`, {
    method: 'POST', body: {
      expected_version: 1, to: 'DECLINED', recorded_basis: 'PHONE', reported_by: 'Chỉ huy đội',
      reason: 'Đội báo không thể nhận nhiệm vụ.', occurred_at: new Date().toISOString(),
    },
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(outOfScopeRecord, 403, 'FORBIDDEN');
  const recordedDecline = await call(responseUrl, `missions/${coordinatorOffer.value.id}/record-on-behalf`, {
    method: 'POST', body: {
      expected_version: 1, to: 'DECLINED', recorded_basis: 'PHONE', reported_by: 'Chỉ huy đội',
      reason: 'Đội báo không thể nhận nhiệm vụ.', occurred_at: new Date().toISOString(),
    },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(recordedDecline.status, 200, JSON.stringify(recordedDecline.value));
  assert.equal(recordedDecline.value.status, 'DECLINED');
  const recordedEvent = await responseDb.query(
    "SELECT recorded_basis,reported_by FROM mission_event WHERE mission_id=$1 AND to_status='DECLINED'", [coordinatorOffer.value.id],
  );
  assert.deepEqual(recordedEvent.rows, [{ recorded_basis: 'PHONE', reported_by: 'Chỉ huy đội' }]);

  const coordinatorCompletionRequest = await createTriagedRequest(context, 'hoàn tất do điều phối viên ghi thay');
  const coordinatorCompletionOffer = await call(responseUrl, `requests/${coordinatorCompletionRequest.id}/missions`, {
    method: 'POST', body: { expected_version: 3, team_id: coordinatorTeam.value.id, override_reason: 'Đội được chọn trong kiểm thử.' },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(coordinatorCompletionOffer.status, 201, JSON.stringify(coordinatorCompletionOffer.value));
  for (const [to, expectedVersion] of [['ACCEPTED', 1], ['EN_ROUTE', 2], ['ON_SCENE', 3]]) {
    const recorded = await call(responseUrl, `missions/${coordinatorCompletionOffer.value.id}/record-on-behalf`, {
      method: 'POST', body: {
        expected_version: expectedVersion, to, recorded_basis: 'PHONE', reported_by: 'Chỉ huy đội',
        reason: 'Điều phối viên xác nhận tiến độ.', occurred_at: new Date().toISOString(),
      },
      headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
    });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.value));
    assert.equal(recorded.value.status, to);
  }
  const incompleteCompletion = await call(responseUrl, `missions/${coordinatorCompletionOffer.value.id}/record-on-behalf`, {
    method: 'POST', body: {
      expected_version: 4, to: 'COMPLETED', recorded_basis: 'PHONE', reported_by: 'Chỉ huy đội',
      reason: 'Điều phối viên xác nhận kết quả.', occurred_at: new Date().toISOString(),
    },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assertVietnameseError(incompleteCompletion, 400, 'VALIDATION_FAILED');
  const completedOnBehalf = await call(responseUrl, `missions/${coordinatorCompletionOffer.value.id}/record-on-behalf`, {
    method: 'POST', body: {
      expected_version: 4, to: 'COMPLETED', recorded_basis: 'PHONE', reported_by: 'Chỉ huy đội',
      reason: 'Điều phối viên xác nhận kết quả.', occurred_at: new Date().toISOString(),
      result: { outcome_note: 'Đội đã hỗ trợ người dân đến nơi an toàn.' },
    },
    headers: { Authorization: `Bearer ${coordinator.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(completedOnBehalf.status, 200, JSON.stringify(completedOnBehalf.value));
  assert.equal(completedOnBehalf.value.status, 'COMPLETED');
  const coordinatorCompletedRequest = await responseDb.query(
    'SELECT status FROM assistance_request WHERE id=$1', [coordinatorCompletionRequest.id],
  );
  assert.equal(coordinatorCompletedRequest.rows[0].status, 'TRIAGED', 'recording completion must not resolve request');

  return { requestId: request.value.id, missionId: offered.value.id, revisionId: verified.id, teamId: appTeam.value.id };
}

async function waitForLockWaiters(db, blockerPid, expectedCount, label, pendingCommands) {
  const waiters = (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await db.query(
        `SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>$1`,
        [blockerPid],
      );
      const blocked = result.rows.filter(({ blockers }) => blockers.includes(blockerPid)).map(({ pid }) => pid);
      if (blocked.length >= expectedCount) return blocked;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(`Timed out waiting for ${label} lock waiter(s)`);
  })();
  const completed = Promise.race(pendingCommands.map((pending) => pending.then(
    (result) => ({ result }), (error) => ({ error }),
  )));
  const outcome = await Promise.race([waiters.then((blocked) => ({ blocked })), completed]);
  if (outcome.blocked) return outcome.blocked;
  if (outcome.error) throw outcome.error;
  assert.fail(`${label} completed before ${expectedCount} lock waiter(s) appeared: HTTP ${outcome.result.status} ${JSON.stringify(outcome.result.value)}`);
}

async function waitForLockWaiterBlockedBy(db, blockerPid, label, pendingCommands) {
  return waitForLockWaiters(db, blockerPid, 1, label, pendingCommands);
}

async function createTriagedRequest({ responseDb, responseUrl, reporter, coordinator, regionCode, call, key }, label) {
  const description = `Cần hỗ trợ trong kiểm thử T9 ${label}.`;
  const created = await call(responseUrl, 'requests', {
    method: 'POST',
    body: {
      incident_category_code: 'T9_MISSION', description, people_affected: 1,
      reporter_name: 'Người báo tin T9', reporter_contact_phone: '+84912345678', reporter_declared_danger: false,
      location: { type: 'Point', coordinates: [104.5, 14.5], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  const approvedFacts = {
    report_mode: 'SELF', incident_category_code: 'T9_MISSION', description,
    reporter_name: 'Người báo tin T9', reporter_contact_phone: '+84912345678', reporter_declared_danger: false,
    region_code: regionCode, campaign_id: null, people_affected: 1,
    location: { type: 'Point', coordinates: [104.5, 14.5], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
  };
  const verified = await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
     VALUES ($1,$2,'REQUEST_VERIFIED','STAFF','VERIFYING','VERIFIED',$3::jsonb) RETURNING id`,
    [created.value.id, coordinator.id, JSON.stringify({ approved_facts: approvedFacts })],
  );
  await responseDb.query(
    `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id)
     VALUES ($1,'VERIFIED','CONTACT_CONFIRMED',$2)`, [created.value.id, coordinator.id],
  );
  await responseDb.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
     VALUES ($1,$2,'REQUEST_TRIAGED','STAFF','VERIFIED','TRIAGED',$3::jsonb)`,
    [created.value.id, coordinator.id, JSON.stringify({ priority: 'P2', priority_basis: 'COMPLETE' })],
  );
  await responseDb.query(
    `UPDATE assistance_request SET region_code=$3,status='TRIAGED',priority='P2',priority_basis='COMPLETE',
            verification_revision=$2,version=3 WHERE id=$1`, [created.value.id, verified.rows[0].id, regionCode],
  );
  return { id: created.value.id, revisionId: verified.rows[0].id };
}
