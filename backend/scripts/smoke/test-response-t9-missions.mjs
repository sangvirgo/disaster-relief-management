import assert from 'node:assert/strict';

export async function runMissionSmoke({
  responseDb, responseUrl, reporter, coordinator, otherRegionCoordinator, appTeam, coordinatorTeam, organizationId, call, key, assertVietnameseError,
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
    region_code: 'T8_REGION', campaign_id: null, people_affected: 1,
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
        SET region_code='T8_REGION',status='TRIAGED',priority='P2',priority_basis='COMPLETE',
            verification_revision=$2,version=3
      WHERE id=$1`, [request.value.id, verified.id],
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
  assert.equal(evidence.status, 201, JSON.stringify(evidence.value));
  assert.equal(evidence.value.state, 'READY');
  const evidenceOwner = await responseDb.query(
    'SELECT request_id,mission_id FROM evidence_metadata WHERE id=$1', [evidence.value.id],
  );
  assert.equal(evidenceOwner.rows[0].request_id, null);
  assert.equal(evidenceOwner.rows[0].mission_id, offered.value.id);

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
  assert.ok(detail.value.evidence.items.some((item) => item.id === evidence.value.id));

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

  const context = { responseDb, responseUrl, reporter, coordinator, call, key };
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

  await responseDb.query("UPDATE mission SET created_at=clock_timestamp()-interval '2 hours' WHERE id=$1", [raceMission.id]);
  const overdue = await call(responseUrl, 'missions/overdue-offers?limit=10', {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(overdue.status, 200, JSON.stringify(overdue.value));
  assert.ok(overdue.value.items.some((item) => item.id === raceMission.id));
  const outOfScopeOverdue = await call(responseUrl, 'missions/overdue-offers?limit=10', {
    headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` },
  });
  assert.equal(outOfScopeOverdue.status, 200, JSON.stringify(outOfScopeOverdue.value));
  assert.deepEqual(outOfScopeOverdue.value.items, [], 'out-of-scope coordinators cannot see overdue missions');
  assert.equal(outOfScopeOverdue.headers.get('cache-control'), 'no-store');
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

async function createTriagedRequest({ responseDb, responseUrl, reporter, coordinator, call, key }, label) {
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
    region_code: 'T8_REGION', campaign_id: null, people_affected: 1,
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
    `UPDATE assistance_request SET region_code='T8_REGION',status='TRIAGED',priority='P2',priority_basis='COMPLETE',
            verification_revision=$2,version=3 WHERE id=$1`, [created.value.id, verified.rows[0].id],
  );
  return { id: created.value.id, revisionId: verified.rows[0].id };
}
