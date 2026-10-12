import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function assertVietnamese(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.value));
  assert.equal(result.value?.code, code, JSON.stringify(result.value));
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese user-facing copy');
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

async function addCandidateTeam(responseDb, organizationId, coordinatorId, {
  id = randomUUID(), name, position, skills = ['T8_A', 'T8_C'], teamOrganizationId = organizationId,
  regionCode = 'T8_REGION', reportingMode = 'COORDINATOR', availability = 'AVAILABLE', status = 'ACTIVE',
  readinessRequired = false, externalContactNote = 'Liên hệ kiểm thử T8',
}) {
  await responseDb.query(
    `INSERT INTO rescue_team
       (id,organization_id,operating_region_code,name,team_kind,reporting_mode,external_contact_note,availability,status,readiness_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, teamOrganizationId, regionCode, `Đội ${name} ${id.slice(0, 8)}`,
      reportingMode === 'APP' ? 'VOLUNTEER' : 'OTHER', reportingMode, externalContactNote, availability, status, readinessRequired],
  );
  await responseDb.query('INSERT INTO team_skill (team_id,skill_code) SELECT $1,unnest($2::text[])', [id, skills]);
  if (position) {
    await responseDb.query(
      `INSERT INTO team_position (team_id,location,accuracy_m,captured_at,source,set_by_user_id)
       VALUES ($1,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,10,$4,'COORDINATOR_REPORTED',$5)`,
      [id, position.longitude, position.latitude, position.captured_at, coordinatorId],
    );
  }
  return id;
}

export async function runTeamCandidatesSmoke({ responseDb, responseUrl, reporter, coordinator, otherRegionCoordinator, organizationId, appTeam, call, key }) {
  await responseDb.query("INSERT INTO incident_category (code,display_name) VALUES ('T8_TEAM_CANDIDATES','Kiểm thử chọn đội') ON CONFLICT (code) DO NOTHING");
  await responseDb.query(
    `INSERT INTO incident_category_skill (category_code,skill_code) VALUES ('T8_TEAM_CANDIDATES','T8_A'),('T8_TEAM_CANDIDATES','T8_C')
     ON CONFLICT DO NOTHING`,
  );
  const request = await call(responseUrl, 'requests', {
    method: 'POST',
    body: {
      incident_category_code: 'T8_TEAM_CANDIDATES', description: 'Yêu cầu kiểm thử chọn đội.', people_affected: 1,
      reporter_name: 'Người báo tin T8', reporter_declared_danger: false,
      location: { type: 'Point', coordinates: [104.5, 14.5], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(request.status, 201, JSON.stringify(request.value));
  await responseDb.query("UPDATE assistance_request SET region_code='T8_REGION' WHERE id=$1", [request.value.id]);

  const checkedScope = await responseDb.query(
    'SELECT organization_id,region_code FROM assistance_request WHERE id=$1', [request.value.id],
  );
  assert.deepEqual(checkedScope.rows, [{ organization_id: organizationId, region_code: 'T8_REGION' }]);

  const endpoint = `requests/${request.value.id}/team-candidates`;
  assertVietnamese(await call(responseUrl, endpoint), 401, 'UNAUTHENTICATED');
  assertVietnamese(await call(responseUrl, endpoint, { headers: { Authorization: `Bearer ${reporter.token}` } }), 403, 'FORBIDDEN');
  assertVietnamese(await call(responseUrl, endpoint, { headers: { Authorization: `Bearer ${otherRegionCoordinator.token}` } }), 403, 'FORBIDDEN');

  const invalidRadius = await call(responseUrl, `${endpoint}?radius_m=0`, {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(invalidRadius.status, 400, JSON.stringify(invalidRadius.value));
  assert.equal(invalidRadius.value?.code, 'VALIDATION_FAILED');
  assert.match(invalidRadius.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese validation copy');

  await responseDb.query('INSERT INTO team_skill (team_id,skill_code) VALUES ($1,\'T8_C\') ON CONFLICT DO NOTHING', [appTeam.value.id]);
  const staleTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'vị trí cũ', position: { longitude: 104.5, latitude: 14.5, captured_at: new Date(Date.now() - 31 * 60_000) },
  });
  const missingTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, { name: 'thiếu vị trí' });
  const futureTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'thời gian tương lai', position: { longitude: 104.5, latitude: 14.5, captured_at: new Date(Date.now() + 60_000) },
  });
  const busyTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, { name: 'đang có nhiệm vụ' });
  const farTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'ngoài bán kính', position: { longitude: 104.9, latitude: 14.5, captured_at: new Date() },
  });
  const missingSkillTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'thiếu kỹ năng', skills: ['T8_A'], position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });
  const wrongOrganizationTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'sai tổ chức', teamOrganizationId: randomUUID(),
    position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });
  const wrongRegionTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'sai khu vực', regionCode: 'T8_OTHER',
    position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });
  const unavailableTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'không sẵn sàng', availability: 'UNAVAILABLE',
    position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });
  const readinessRequiredTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'cần kiểm tra sẵn sàng', readinessRequired: true,
    position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });
  const inactiveTeam = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'đội ngừng hoạt động', status: 'INACTIVE',
    position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });
  const appTeamWithoutLeader = await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    name: 'đội ứng dụng thiếu trưởng đội', reportingMode: 'APP',
    position: { longitude: 104.5, latitude: 14.5, captured_at: new Date() },
  });

  const event = await responseDb.query(
    'SELECT id FROM request_event WHERE request_id=$1 ORDER BY occurred_at,id LIMIT 1', [request.value.id],
  );
  assert.equal(event.rowCount, 1);
  const busyMissionId = randomUUID();
  await responseDb.query(
    `INSERT INTO mission (id,request_id,team_id,work_cycle,status,coordinator_user_id,verification_revision)
     SELECT $1,r.id,$2,r.work_cycle,'OFFERED',$3,$4 FROM assistance_request r WHERE r.id=$5`,
    [busyMissionId, busyTeam, coordinator.id, event.rows[0].id, request.value.id],
  );
  const historicalMissionId = randomUUID();
  await responseDb.query(
    `INSERT INTO mission (id,request_id,team_id,work_cycle,status,coordinator_user_id,verification_revision,created_at)
     SELECT $1,r.id,$2,r.work_cycle,'COMPLETED',$3,$4,statement_timestamp()-interval '48 hours'
       FROM assistance_request r WHERE r.id=$5`,
    [historicalMissionId, appTeam.value.id, coordinator.id, event.rows[0].id, request.value.id],
  );
  await responseDb.query(
    `INSERT INTO mission_event (mission_id,actor_user_id,from_status,to_status,occurred_at,recorded_at)
     VALUES ($1,$2,'ON_SCENE','COMPLETED',statement_timestamp()-interval '48 hours',statement_timestamp()-interval '10 minutes')`,
    [historicalMissionId, coordinator.id],
  );

  const candidates = await call(responseUrl, endpoint, { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assert.equal(candidates.status, 200, JSON.stringify(candidates.value));
  assert.equal(candidates.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(candidates.value).includes('Liên hệ kiểm thử T8'), false, 'team candidates must not expose coordinator contact PII');
  assert.deepEqual(candidates.value.parameters, {
    radius_m: 10_000, position_max_age_s: 1_800, priority: null, distance_tolerance_m: 2_000,
  });
  const appCandidate = candidates.value.items.find((item) => item.team.id === appTeam.value.id);
  assert.ok(appCandidate, 'eligible fresh APP team is included');
  assert.ok(appCandidate.distance_m > 0 && appCandidate.distance_m < 2_000);
  assert.equal(appCandidate.position_age_s >= 0 && appCandidate.position_age_s <= 1_800, true);
  assert.equal(appCandidate.accuracy_m, null);
  assert.equal(appCandidate.recent_missions_24h, 1, 'server-recorded mission event counts once even when its occurred_at is old');
  assert.equal(appCandidate.has_active_work, false);
  assert.equal(appCandidate.in_band, true);
  assert.equal(appCandidate.suggested, true);
  assert.equal(JSON.stringify(candidates.value).includes('coordinates'), false, 'team coordinates stay private');
  const unknownIds = candidates.value.unknown_position.map((item) => item.team.id);
  assert.ok(unknownIds.includes(staleTeam));
  assert.ok(unknownIds.includes(missingTeam));
  assert.ok(unknownIds.includes(futureTeam));
  assert.equal(candidates.value.unknown_position.find((item) => item.team.id === missingTeam).position_age_s, null);
  assert.ok(candidates.value.unknown_position.find((item) => item.team.id === staleTeam).position_age_s > 1_800);
  assert.ok(candidates.value.unknown_position.find((item) => item.team.id === futureTeam).position_age_s < 0);
  assert.equal(unknownIds.includes(busyTeam), false, 'busy teams are not in unknown_position');
  assert.equal(candidates.value.items.some((item) => item.team.id === busyTeam), false, 'busy teams are not in items');
  assert.equal(candidates.value.items.some((item) => item.team.id === farTeam), false, 'fresh teams outside radius are omitted');
  assert.equal(candidates.value.items.some((item) => item.team.id === missingSkillTeam), false, 'missing required skills are excluded');
  const eligibilityExcludedTeams = [
    wrongOrganizationTeam, wrongRegionTeam, unavailableTeam, readinessRequiredTeam,
    inactiveTeam, appTeamWithoutLeader,
  ];
  for (const teamId of eligibilityExcludedTeams) {
    assert.equal(candidates.value.items.some((item) => item.team.id === teamId), false, `${teamId} must not be a candidate`);
    assert.equal(unknownIds.includes(teamId), false, `${teamId} must not be an unknown-position candidate`);
  }

  const noFresh = await call(responseUrl, `${endpoint}?radius_m=1`, { headers: { Authorization: `Bearer ${coordinator.token}` } });
  assert.equal(noFresh.status, 200, JSON.stringify(noFresh.value));
  assert.deepEqual(noFresh.value.items, []);
  assert.equal(noFresh.value.unknown_position.some((item) => item.suggested), false);

  const p1Request = await call(responseUrl, 'requests', {
    method: 'POST',
    body: {
      incident_category_code: 'T8_TEAM_CANDIDATES', description: 'Yêu cầu P1 kiểm thử khoảng cách.', people_affected: 1,
      reporter_name: 'Người báo tin T8', reporter_declared_danger: false,
      location: { type: 'Point', coordinates: [105.2, 15.2], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(p1Request.status, 201, JSON.stringify(p1Request.value));
  await responseDb.query(
    "UPDATE assistance_request SET region_code='T8_REGION',priority='P1',priority_basis='COMPLETE' WHERE id=$1",
    [p1Request.value.id],
  );

  const fartherTeamId = `0${randomUUID().slice(1)}`;
  const nearestTeamId = `f${randomUUID().slice(1)}`;
  assert.ok(fartherTeamId < nearestTeamId, 'farther team id sorts first to expose a rounded-distance tie');
  await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    id: fartherTeamId, name: 'P1 xa hơn', position: { longitude: 105.2000012, latitude: 15.2, captured_at: new Date() },
  });
  await addCandidateTeam(responseDb, organizationId, coordinator.id, {
    id: nearestTeamId, name: 'P1 gần hơn', position: { longitude: 105.200001, latitude: 15.2, captured_at: new Date() },
  });

  const p1Distance = await responseDb.query(
    `SELECT ST_Distance(ST_SetSRID(ST_MakePoint(105.2,15.2),4326)::geography,
                        ST_SetSRID(ST_MakePoint(105.2000012,15.2),4326)::geography) AS farther_m,
            ST_Distance(ST_SetSRID(ST_MakePoint(105.2,15.2),4326)::geography,
                        ST_SetSRID(ST_MakePoint(105.200001,15.2),4326)::geography) AS nearest_m`,
  );
  const fartherDistance = Number(p1Distance.rows[0].farther_m);
  const nearestDistance = Number(p1Distance.rows[0].nearest_m);
  assert.ok(nearestDistance < fartherDistance);
  const roundedP1Distances = await responseDb.query(
    `SELECT round($1::numeric,1) AS farther_m,round($2::numeric,1) AS nearest_m`, [fartherDistance, nearestDistance],
  );
  assert.equal(Number(roundedP1Distances.rows[0].farther_m), Number(roundedP1Distances.rows[0].nearest_m));

  const p1Candidates = await call(responseUrl, `requests/${p1Request.value.id}/team-candidates?radius_m=10`, {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(p1Candidates.status, 200, JSON.stringify(p1Candidates.value));
  assert.deepEqual(p1Candidates.value.items.map((item) => item.team.id), [nearestTeamId, fartherTeamId]);
  assert.equal(p1Candidates.value.items.find((item) => item.team.id === nearestTeamId).suggested, true);
  assert.equal(p1Candidates.value.items.find((item) => item.team.id === fartherTeamId).suggested, false);
  assert.equal(p1Candidates.value.items[0].distance_m, p1Candidates.value.items[1].distance_m);

  const requestScope = checkedScope.rows[0];
  await responseDb.query("UPDATE assistance_request SET region_code='T8_OTHER' WHERE id=$1", [request.value.id]);
  const staleTarget = await responseDb.query(
    `SELECT r.id FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
      WHERE r.id=$1 AND r.organization_id=$2 AND r.region_code IS NOT DISTINCT FROM $3`,
    [request.value.id, requestScope.organization_id, requestScope.region_code],
  );
  assert.equal(staleTarget.rowCount, 0, 'the candidate target predicate rejects a changed region after the permission scope was checked');
  await responseDb.query('UPDATE assistance_request SET region_code=$2 WHERE id=$1', [request.value.id, requestScope.region_code]);

  const unlocatedRequest = await call(responseUrl, 'requests', {
    method: 'POST',
    body: {
      incident_category_code: 'T8_TEAM_CANDIDATES', description: 'Yêu cầu không thuộc vùng kiểm thử.',
      reporter_name: 'Người báo tin T8', reporter_declared_danger: false,
      location: { type: 'Point', coordinates: [103, 13], source: 'GPS', accuracy_m: 5, captured_at: new Date().toISOString() },
    },
    headers: { Authorization: `Bearer ${reporter.token}`, 'Idempotency-Key': key() },
  });
  assert.equal(unlocatedRequest.status, 201, JSON.stringify(unlocatedRequest.value));
  const noRegion = await call(responseUrl, `requests/${unlocatedRequest.value.id}/team-candidates`, {
    headers: { Authorization: `Bearer ${coordinator.token}` },
  });
  assert.equal(noRegion.status, 200, JSON.stringify(noRegion.value));
  assert.deepEqual(noRegion.value.items, []);
  assert.deepEqual(noRegion.value.unknown_position, []);
}
