import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const collection = JSON.parse(readFileSync(new URL('../../postman/C48-backend-demo.postman_collection.json', import.meta.url), 'utf8'));
const flatten = (folder) => folder.item.flatMap((entry) => entry.request ? [entry] : flatten(entry));
const all = flatten(collection);
const main = flatten(collection.item[0]);
const script = (item, kind) => item.event?.filter((event) => event.listen === kind).flatMap((event) => event.script.exec).join('\n') || '';
function meta(item) {
  const match = script(item, 'prerequest').match(/pm.variables.set\('_c48', (".*")\);/u);
  return match ? JSON.parse(JSON.parse(match[1])) : {};
}
const op = (items, operation, occurrence = 0) => {
  const result = items.filter((item) => meta(item).operationId === operation)[occurrence];
  assert.ok(result, operation);
  return result;
};
const folder = (fragment) => {
  const result = collection.item.find((item) => item.name.includes(fragment));
  assert.ok(result, fragment);
  return flatten(result);
};
test('collection and main folder explain the optional-run boundary consistently', () => {
  assert.match(collection.info.description, /Chạy ở cấp collection cũng dừng sau folder 00/u);
  assert.match(collection.item[0].description, /Chạy ở cấp collection cũng dừng sau folder 00/u);
  assert.match(collection.item[0].description, /folder tùy chọn 10–60 chỉ chạy khi chọn riêng/u);
});
test('guest recovery SOS request disables ambient Postman cookies', () => {
  const guestRequest = all.find((item) => item.id === 'recovery-01');
  assert.ok(guestRequest, 'guest recovery request');
  assert.equal(guestRequest.protocolProfileBehavior?.disableCookies, true);
});
test('guest evidence folder uploads the fixture with tracking capability and downloads its signed URL', () => {
  const evidence = folder('Ảnh chứng cứ SOS khách');
  assert.deepEqual(evidence.map((item) => meta(item).operationId), [
    'createSelfRequest', 'uploadRequestEvidence', 'getRequestEvidenceDownloadUrl', 'downloadSignedEvidenceObject',
  ]);
  const [create, upload, signedUrl, fetchImage] = evidence;
  assert.equal(create.protocolProfileBehavior?.disableCookies, true);
  assert.ok(script(create, 'test').includes("collectionVariables.set('trackingSecret'"));
  assert.equal(upload.request.body.mode, 'formdata');
  const file = upload.request.body.formdata.find((field) => field.key === 'file');
  assert.equal(file?.type, 'file');
  assert.equal(file?.src, 'postman/fixtures/c48-evidence-demo.png');
  assert.equal(file?.contentType, 'image/png');
  const uploadHeaders = Object.fromEntries(upload.request.header.map(({ key, value }) => [key, value]));
  assert.equal(uploadHeaders['X-Tracking-Code'], '{{trackingCode}}');
  assert.equal(uploadHeaders['X-Tracking-Secret'], '{{trackingSecret}}');
  assert.ok(uploadHeaders['Idempotency-Key']);
  assert.ok(!upload.request.header.some(({ key }) => ['Authorization', 'Cookie', 'Origin', 'X-CSRF-Token'].includes(key)));
  assert.equal(upload.protocolProfileBehavior?.disableCookies, true);
  assert.ok(script(upload, 'test').includes("collectionVariables.set('evidenceId'"));
  assert.ok(script(signedUrl, 'test').includes("collectionVariables.set('signedEvidenceUrl'"));
  assert.equal(fetchImage.request.url, '{{signedEvidenceUrl}}');
  assert.ok(!fetchImage.request.header.some(({ key }) => ['Authorization', 'Cookie', 'Origin'].includes(key)));
  assert.ok(script(fetchImage, 'test').includes('image/png'));
  assert.equal(collection.variable.find((variable) => variable.key === 'evidenceId')?.value, '');
  assert.equal(collection.variable.find((variable) => variable.key === 'signedEvidenceUrl')?.value, '');
  const fixture = readFileSync(new URL('../../postman/fixtures/c48-evidence-demo.png', import.meta.url));
  assert.deepEqual([...fixture.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  const runner = sandbox();
  runner.send(create, { id: 'sos-a', tracking_code: 'ABC1234567', review_lane: 'NORMAL' }, 201);
  assert.equal(runner.values.get('requestId'), 'sos-a');
  assert.equal(runner.values.get('trackingSecret'), 'q'.repeat(43));
  runner.send(upload, { id: 'evidence-a', state: 'READY', detected_mime: 'image/png', size_bytes: 68, checksum: 'a'.repeat(64) }, 201);
  assert.equal(runner.values.get('evidenceId'), 'evidence-a');
  runner.send(signedUrl, { url: 'http://localhost:8080/c48-response-evidence/evidence-a?X-Amz-Signature=demo', expires_in: 60 }, 200);
  assert.equal(runner.values.get('signedEvidenceUrl'), 'http://localhost:8080/c48-response-evidence/evidence-a?X-Amz-Signature=demo');
  runner.send(fetchImage, {}, 200, { 'Content-Type': 'image/png', 'Content-Length': '68' });
  assert.equal(runner.failures.length, 0);
  assert.equal(runner.next, null);
});
test('path ID variables are discovered earlier in every runnable folder', () => {
  for (const section of collection.item) {
    const available = new Set();
    for (const item of flatten(section)) {
      for (const [, key] of JSON.stringify(item.request).matchAll(/\{\{([^}]+Id)\}\}/gu)) {
        const declared = collection.variable.find((variable) => variable.key === key);
        assert.ok(declared, `${section.name}: undeclared ${key}`);
        assert.ok(String(declared.value ?? '').trim() || available.has(key), `${section.name}: ${key} needs an earlier request`);
      }
      for (const [, key] of script(item, 'test').matchAll(/pm\.collectionVariables\.set\(['"]([^'"]+)['"]/gu)) available.add(key);
    }
  }
});
test('seed IDs come from GET requests and login requests have credentials', () => {
  const discover = (operationId, variable) => {
    const item = all.find((request) => meta(request).operationId === operationId && request.request.method === 'GET' &&
      script(request, 'test').includes(`collectionVariables.set('${variable}'`));
    assert.ok(item, `GET ${operationId} must populate ${variable}`);
  };
  discover('listIdentityOrganizations', 'intakeOrganizationId');
  discover('listRequestQueue', 'requestId');
  discover('logisticsDrivesPublicList', 'donationDriveId');
  discover('logisticsDrivesPublicList', 'donationItemId');
  discover('logisticsDrivesList', 'donationWarehouseId');
  for (const key of ['intakeOrganizationId', 'donationDriveId', 'donationItemId', 'donationWarehouseId']) {
    assert.equal(collection.variable.find((variable) => variable.key === key)?.value, '', `${key} must not be hardcoded`);
  }
  assert.ok(String(collection.variable.find((variable) => variable.key === 'seedPassword')?.value).length >= 10);
  const logins = all.filter((item) => meta(item).operationId === 'login');
  assert.ok(logins.length > 0);
  for (const item of logins) {
    const body = JSON.parse(item.request.body.raw);
    assert.ok(String(body.username ?? '').trim(), `${item.name}: missing username`);
    assert.ok(String(body.password ?? '').trim(), `${item.name}: missing password`);
    assert.equal(body.client_kind, 'NATIVE');
  }
});
test('GET setup requests populate organization, AI SOS and donation IDs from API results', () => {
  const cases = [
    ['listIdentityOrganizations', 'intakeOrganizationId',
      { items: [{ id: 'org-id', name: 'Trung tâm điều phối C48 (demo)', status: 'ACTIVE' }] }, 'org-id'],
    ['listRequestQueue', 'requestId',
      { items: [{ id: 'request-id', tracking_code: 'C48DEM0009', status: 'SUBMITTED' }] }, 'request-id'],
    ['logisticsDrivesPublicList', 'donationDriveId',
      { items: [{ id: 'drive-id', title: 'Quyên góp nhu yếu phẩm cho vùng ngập Demo A', status: 'OPEN',
        items: [{ item_id: 'item-id', item_name: 'Gạo' }] }] }, 'drive-id'],
    ['logisticsDrivesPublicList', 'donationItemId',
      { items: [{ id: 'drive-id', title: 'Quyên góp nhu yếu phẩm cho vùng ngập Demo A', status: 'OPEN',
        items: [{ item_id: 'item-id', item_name: 'Gạo' }] }] }, 'item-id'],
    ['logisticsDrivesList', 'donationWarehouseId',
      { items: [{ intake_warehouse_id: 'warehouse-id', title: 'Quyên góp nhu yếu phẩm cho vùng ngập Demo A', status: 'OPEN' }] }, 'warehouse-id'],
  ];
  for (const [operationId, variable, response, expected] of cases) {
    const request = all.find((item) => meta(item).operationId === operationId &&
      script(item, 'test').includes(`collectionVariables.set('${variable}'`));
    assert.ok(request, `GET ${operationId} populates ${variable}`);
    const result = sandbox({ activeAccessToken: 'test-token', seedPassword: 'test-password' });
    result.send(request, response, 200);
    assert.equal(result.skipped, false, `${variable} lookup must be runnable`);
    assert.deepEqual(result.failures, []);
    assert.equal(result.values.get(variable), expected);
  }
});
function sandbox(initial = {}) {
  const values = new Map(collection.variable.map(({ key, value }) => [key, value]));
  Object.entries(initial).forEach(([key, value]) => values.set(key, value));
  const local = new Map();
  const output = { next: undefined, skipped: false, failures: [], values };
  const variables = {
    get: (key) => local.has(key) ? local.get(key) : values.get(key),
    set: (key, value) => local.set(key, value),
    unset: (key) => local.delete(key),
    replaceIn: (value) => value.replace(/\{\{([^}]+)\}\}/gu, (_, key) => key === '$guid' ? '12345678-1234-4234-8234-123456789abc' : key === '$isoTimestamp' ? new Date().toISOString() : String(variables.get(key) ?? '')),
  };
  const pm = {
    variables, collectionVariables: { get: (key) => values.get(key), set: (key, value) => values.set(key, value), unset: (key) => values.delete(key) },
    execution: { setNextRequest: (value) => { output.next = value; }, skipRequest: () => { output.skipped = true; } },
    cookies: { toObject: () => ({}), jar: () => ({ clear: (_url, callback) => callback(null) }) },
    expect: (value) => ({ to: { eql: (expected) => assert.deepEqual(value, expected) } }),
    test: (name, callback) => { try { callback(); } catch (error) { output.failures.push({ name, error }); } },
    info: {},
  };
  const cryptoJs = { lib: { WordArray: { random: () => ({}) } }, enc: { Base64: { stringify: () => 'q'.repeat(43) } } };
  const context = vm.createContext({ pm, console: { warn() {}, log() {} }, setTimeout: (callback) => callback(), require: (name) => { assert.equal(name, 'crypto-js'); return cryptoJs; } });
  output.send = (item, body = {}, code = meta(item).expectedStatus, responseHeaders = {}) => {
    output.next = undefined; output.skipped = false; local.clear();
    const headers = new Map(item.request.header.map(({ key, value }) => [key, value]));
    pm.info.requestId = item.id; pm.info.requestName = item.name;
    pm.request = { ...item.request, url: { toString: () => item.request.url }, headers: { get: (key) => headers.get(key), remove: (key) => headers.delete(key) } };
    for (const owner of [collection, item]) vm.runInContext(script(owner, 'prerequest'), context);
    output.body = item.request.body?.raw ? JSON.parse(variables.replaceIn(item.request.body.raw)) : undefined;
    if (!output.skipped) {
      pm.response = {
        code,
        json: () => body,
        text: () => JSON.stringify(body),
        headers: { get: (name) => responseHeaders[Object.keys(responseHeaders).find((key) => key.toLowerCase() === name.toLowerCase())] ?? null },
        to: { have: { status: (expected) => assert.equal(code, expected) } },
      };
      for (const owner of [collection, item]) vm.runInContext(script(owner, 'test'), context);
    }
    return output;
  };
  return output;
}

test('main verification is a location/information/image review with no phone-contact step', () => {
  const verify = op(main, 'verifyRequest');
  const body = JSON.parse(verify.request.body.raw.replace('{{requestVersion}}', '1'));
  assert.equal(body.basis, 'EVIDENCE_REVIEWED');
  assert.ok(body.reason);
  assert.equal(main.some((item) => meta(item).operationId === 'recordRequestContactAttempt'), false);
});

test('main scenario explicitly changes actors and finishes the rescue before resolving', () => {
  const operations = main.map((item) => meta(item).operationId);
  assert.deepEqual(operations, [
    'login', 'listIdentityOrganizations', 'listIdentityRegions', 'createIdentityUser', 'createIdentityUserGrant', 'login', 'createSelfRequest', 'trackSelfRequest', 'supplementSelfRequest',
    'login', 'getStaffRequestDetail', 'startRequestVerification', 'verifyRequest', 'triageRequest',
    'responseTeamsCreate', 'createMissionOffer', 'login', 'getMission', 'acceptMission', 'transitionMission', 'transitionMission', 'transitionMission',
    'login', 'getStaffRequestDetail', 'responseRequestResolutionResolve', 'responseRequestResolutionOperation', 'login', 'trackSelfRequest',
  ]);
  assert.deepEqual(main.filter((item) => meta(item).operationId === 'transitionMission').map((item) => JSON.parse(item.request.body.raw.replace('{{missionVersion}}', '1')).to), ['EN_ROUTE', 'ON_SCENE', 'COMPLETED']);
  assert.ok(op(main, 'transitionMission', 2).request.body.raw.includes('outcome_note'));
});

test('login boundaries use explicit credentials and clear a failed actor switch', () => {
  const runner = sandbox({ activeAccessToken: 'previous' });
  runner.send(op(main, 'login'), { access_token: 'admin-token', refresh_token: 'refresh' });
  assert.equal(runner.values.get('activeAccessToken'), 'admin-token');
  assert.equal(runner.body.username, 'admin');
  runner.send(op(main, 'login', 1), { code: 'INVALID_CREDENTIALS' }, 401);
  assert.equal(runner.values.get('activeAccessToken'), undefined);
  assert.equal(runner.next, null);
  assert.equal(runner.failures.length, 1);
});

test('SOS creation commits its generated capability only on success; detail never selects another ID', () => {
  const runner = sandbox({ activeAccessToken: 'citizen', requestId: 'old', trackingSecret: 'old-secret' });
  const create = op(main, 'createSelfRequest');
  runner.send(create, { code: 'VALIDATION_FAILED' }, 400);
  assert.equal(runner.values.get('requestId'), 'old');
  assert.equal(runner.values.get('trackingSecret'), 'old-secret');
  runner.send(create, { id: 'sos-a', tracking_code: 'ABC1234567', review_lane: 'NORMAL' });
  assert.equal(runner.values.get('requestId'), 'sos-a');
  assert.equal(runner.values.get('trackingSecret'), 'q'.repeat(43));
  runner.send(op(main, 'getStaffRequestDetail'), { id: 'sos-a', version: 4, organization_id: 'org', region_code: 'DEMO_A' });
  assert.equal(runner.values.get('requestVersion'), '4');
  assert.equal(runner.values.get('requestId'), 'sos-a');
  runner.send(op(main, 'getStaffRequestDetail'), { id: 'unrelated', version: 99 });
  assert.equal(runner.values.get('requestId'), 'sos-a');
  assert.equal(runner.values.get('requestVersion'), '4');
  assert.equal(runner.next, null);
});

test('recovery contact response captures contact ID without replacing SOS ID and preserves its current version', () => {
  const runner = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a' });
  runner.send(op(folder('Khôi phục'), 'recordRequestContactAttempt'), { id: 'contact-a', version: 6 });
  assert.equal(runner.values.get('requestId'), 'sos-a');
  assert.equal(runner.values.get('contactAttemptId'), 'contact-a');
  assert.equal(runner.values.get('requestVersion'), '6');
});

test('resolution polling is bounded, checks success, and final tracking stops before optional folders', () => {
  const poll = op(main, 'responseRequestResolutionOperation');
  const runner = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a', operationId: 'operation-a', operationPollCount: '0', pollLimit: '3' });
  runner.send(poll, { state: 'PENDING', request_id: 'sos-a' });
  assert.equal(runner.next, poll.id);
  runner.send(poll, { state: 'PENDING', request_id: 'sos-a' });
  assert.equal(runner.next, poll.id);
  runner.send(poll, { state: 'PENDING', request_id: 'sos-a' });
  assert.equal(runner.next, null);
  assert.equal(runner.failures.length, 1);
  const success = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a', operationId: 'operation-a' });
  success.send(poll, { state: 'COMPLETED', request_id: 'sos-a', request_status: 'RESOLVED' });
  assert.equal(success.failures.length, 0);
  success.send(main.at(-1), { id: 'sos-a', version: 10, status: 'RESOLVED' });
  assert.equal(success.next, null);
});

test('donation optional scenario conserves counts and reviews current revisions before posting', () => {
  const donation = folder('Quyên góp');
  const operations = donation.map((item) => meta(item).operationId);
  assert.ok(operations.indexOf('logisticsDonationReceiptsReview') < operations.indexOf('logisticsDonationReceiptsPost'));
  const runner = sandbox({ activeAccessToken: 'intake', donationReceiptId: 'receipt-a', donationItemId: 'rice', receiptVersion: '2' });
  runner.send(op(donation, 'logisticsDonationReceiptsCount'), { id: 'receipt-a', version: 3, count: { revision: 4, declaration_revision: 5 } });
  const line = runner.body.lines[0];
  assert.equal(Number(line.counted_quantity), Number(line.accepted_quantity) + Number(line.held_quantity) + Number(line.rejected_quantity));
  runner.send(op(donation, 'logisticsDonationReceiptsReview'), { id: 'receipt-a', version: 4 });
  assert.equal(runner.body.count_revision, 4);
  assert.equal(runner.body.declaration_revision, 5);
  assert.ok(!all.some((item) => /distributions|stock\/adjustments|review-loss/u.test(item.request.url)));
});

test('AI optional polling terminates on unavailable output without changing manual priority', () => {
  const ai = folder('AI'); const detail = op(ai, 'getStaffRequestDetail');
  for (const status of ['FAILED', 'SKIPPED', 'STALE', 'UNKNOWN']) {
    const runner = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a', pollLimit: '2' });
    runner.send(detail, { id: 'sos-a', version: 8, priority: 'P2', ai_advisory: { id: 'advisory-a', status } });
    assert.equal(runner.next, null, `${status} is terminal and must not be polled again`);
    assert.equal(runner.values.get('requestId'), 'sos-a');
    assert.equal(runner.values.get('requestVersion'), '8');
  }
  const pending = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a', pollLimit: '2' });
  pending.send(detail, { id: 'sos-a', version: 8, ai_advisory: { id: 'advisory-a', status: 'QUEUED' } });
  assert.equal(pending.next, detail.id);
  pending.send(detail, { id: 'sos-a', version: 8, ai_advisory: { id: 'advisory-a', status: 'QUEUED' } });
  assert.equal(pending.next, null);
  assert.equal(pending.failures.length, 0);
  assert.ok(op(ai, 'responseRequestOperationsReviewAiAdvisory').request.body.raw.includes('{{requestVersion}}'));
});

test('duplicate and guest recovery use distinct source IDs and purpose-specific recovery data', () => {
  const duplicates = folder('Trùng');
  const runner = sandbox({ activeAccessToken: 'citizen' });
  runner.send(op(duplicates, 'createSelfRequest'), { id: 'canonical-a', tracking_code: 'CAN1234567', review_lane: 'NORMAL' });
  runner.send(op(duplicates, 'createSelfRequest', 1), { id: 'source-b', tracking_code: 'SRC1234567', review_lane: 'NORMAL' });
  assert.equal(runner.values.get('canonicalRequestId'), 'canonical-a');
  assert.equal(runner.values.get('duplicateRequestId'), 'source-b');
  const recovery = folder('Khôi phục');
  const guestCreation = op(recovery, 'createSelfRequest');
  assert.equal(guestCreation.protocolProfileBehavior?.disableCookies, true);
  assert.ok(!guestCreation.request.header.some(({ key }) => ['Authorization', 'Cookie', 'Origin', 'X-CSRF-Token'].includes(key)));
  runner.values.set('requestId', 'guest-a'); runner.values.set('requestVersion', '3'); runner.values.set('contactAttemptId', 'contact-a');
  runner.send(op(recovery, 'issueRequestRecoveryCode'), { recovery_code: 'recovery-a' });
  assert.equal(runner.body.contact_attempt_id, 'contact-a');
  assert.equal(runner.values.get('requestRecoveryCode'), 'recovery-a');
  assert.equal(runner.values.get('requestId'), 'guest-a');
});

test('all scenarios contain public ingress routes and stop at their own end', () => {
  assert.ok(all.length < 100);
  for (const item of all) {
    const requestUrl = typeof item.request.url === 'string' ? item.request.url : item.request.url.raw;
    if (requestUrl !== '{{signedEvidenceUrl}}') assert.match(requestUrl, /^\{\{(?:identity|response|logistics)BaseUrl\}\}/u);
    assert.doesNotMatch(requestUrl, /\/internal|\/health/u);
    assert.ok(meta(item).operationId);
  }
  for (const scenario of collection.item) assert.ok(script(flatten(scenario).at(-1), 'test').includes('setNextRequest(null)'));
});

test('complete main script chain carries actor tokens, IDs and versions without missing inputs', () => {
  const runner = sandbox(); let version = 1; let missionVersion = 1; let detailCalls = 0;
  const responses = {
    listIdentityOrganizations: () => ({ items: [{ id: 'intake-org-a', name: 'Trung tâm điều phối C48 (demo)', status: 'ACTIVE' }] }),
    listIdentityRegions: () => ({ items: [{ code: 'DEMO_A', name: 'Khu A', status: 'ACTIVE', version: 1 }], next_cursor: null }),
    createIdentityUser: () => ({ id: 'leader-a' }), createIdentityUserGrant: () => ({ id: 'grant-a' }),
    createSelfRequest: () => ({ id: 'sos-a', tracking_code: 'ABC1234567', review_lane: 'NORMAL' }),
    trackSelfRequest: () => ({ id: 'sos-a', version, status: version === 10 ? 'RESOLVED' : 'SUBMITTED' }),
    supplementSelfRequest: () => ({ id: 'sos-a', version: ++version }),
    getStaffRequestDetail: () => ({ id: 'sos-a', version: ++detailCalls === 1 ? version : (version = 9), region_code: 'DEMO_A' }),
    startRequestVerification: () => ({ id: 'sos-a', version: ++version }),
    verifyRequest: () => ({ id: 'sos-a', version: ++version }), triageRequest: () => ({ id: 'sos-a', version: ++version }),
    responseTeamsCreate: () => ({ id: 'team-a' }),
    createMissionOffer: () => ({ id: 'mission-a', request_id: 'sos-a', version: missionVersion }),
    getMission: () => ({ id: 'mission-a', version: missionVersion, can_manage_mission: true }),
    acceptMission: () => ({ id: 'mission-a', version: ++missionVersion }), transitionMission: () => ({ id: 'mission-a', version: ++missionVersion }),
    responseRequestResolutionResolve: () => ({ operation_id: 'operation-a' }),
    responseRequestResolutionOperation: () => { version = 10; return { state: 'COMPLETED', request_id: 'sos-a', request_status: 'RESOLVED' }; },
  };
  const actors = []; let actor = '';
  for (const item of main) {
    const operation = meta(item).operationId;
    const response = operation === 'login' ? { access_token: `token-${actors.length}`, refresh_token: 'refresh' } : responses[operation]();
    runner.send(item, response);
    assert.equal(runner.skipped, false, item.name);
    assert.equal(runner.failures.length, 0, item.name + ': ' + runner.failures.map(({ error }) => error.message).join(', '));
    if (operation === 'login') { actor = runner.body.username; actors.push(actor); }
    if (operation === 'createIdentityUser') assert.equal(runner.body.organization_id, runner.values.get('intakeOrganizationId'));
    if (operation === 'responseTeamsCreate') {
      assert.equal(runner.body.leader_user_id, 'leader-a');
      assert.equal(runner.body.organization_id, runner.values.get('intakeOrganizationId'));
    }
    if (operation === 'responseRequestResolutionResolve') assert.equal(runner.body.expected_version, 9);
    if (operation === 'transitionMission') assert.equal(actor, runner.values.get('demoLeaderUsername'));
    if (operation === 'getMission') assert.equal(actor, runner.values.get('demoLeaderUsername'));
    if (item !== main.at(-1)) assert.notEqual(runner.next, null, item.name);
  }
  assert.deepEqual(actors, ['admin', 'citizen1', 'coord1', runner.values.get('demoLeaderUsername'), 'coord1', 'citizen1']);
  assert.equal(runner.next, null);
});

test('leader mission read requires server-derived can_manage_mission', () => {
  const read = op(main, 'getMission');
  assert.equal(read.request.method, 'GET');
  assert.equal(read.request.url, '{{responseBaseUrl}}/missions/{{missionId}}');
  assert.ok(!read.request.header.some(({ key }) => ['Idempotency-Key', 'Content-Type'].includes(key)));
  assert.ok(read.request.header.some(({ key, value }) => key === 'Authorization' && value === 'Bearer {{activeAccessToken}}'));
  const ok = sandbox({ activeAccessToken: 'leader-token', missionId: 'mission-a' });
  ok.send(read, { id: 'mission-a', version: 2, can_manage_mission: true });
  assert.deepEqual(ok.failures, []);
  for (const body of [
    { id: 'mission-a', version: 2, can_manage_mission: false },
    { id: 'mission-a', version: 2 },
    { id: 'mission-other', version: 2, can_manage_mission: true },
  ]) {
    const bad = sandbox({ activeAccessToken: 'leader-token', missionId: 'mission-a' });
    bad.send(read, body);
    assert.equal(bad.failures.length, 1, JSON.stringify(body));
    assert.equal(bad.next, null);
  }
});
test('admin region list requires an integer version on every region', () => {
  const read = op(main, 'listIdentityRegions');
  assert.equal(read.request.method, 'GET');
  assert.equal(read.request.url, '{{identityBaseUrl}}/regions?limit=100');
  const ok = sandbox({ activeAccessToken: 'admin-token' });
  ok.send(read, { items: [{ code: 'A', name: 'A', status: 'ACTIVE', version: 3 }], next_cursor: null });
  assert.deepEqual(ok.failures, []);
  for (const items of [[], [{ code: 'A', name: 'A', status: 'ACTIVE' }], [{ code: 'A', status: 'ACTIVE', version: '3' }], [{ code: 'A', version: 0 }]]) {
    const bad = sandbox({ activeAccessToken: 'admin-token' });
    bad.send(read, { items, next_cursor: null });
    assert.equal(bad.failures.length, 1, JSON.stringify(items));
    assert.equal(bad.next, null);
  }
});
test('PROXY captures the actual event_id contract for independent concurrence', () => {
  assert.equal(JSON.parse(op(folder('PROXY'), 'login').request.body.raw).username, 'citizen3');
  const runner = sandbox({ activeAccessToken: 'coord2', requestId: 'proxy-a', requestVersion: '4' });
  runner.send(op(folder('PROXY'), 'concurRequestVerification'), { id: 'proxy-a', version: 5, event_id: 'concurrence-a' });
  assert.equal(runner.failures.length, 0);
  assert.equal(runner.values.get('concurrenceEventId'), 'concurrence-a');
  assert.equal(runner.values.get('requestVersion'), '5');
});

test('AI review needs a deliberately supplied human decision', () => {
  assert.equal(collection.variable.find(({ key }) => key === 'aiReviewDecision').value, '');
  const ai = folder('AI');
  const detail = op(ai, 'getStaffRequestDetail');
  const review = op(ai, 'responseRequestOperationsReviewAiAdvisory');
  const noDecision = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a' });
  noDecision.send(detail, { id: 'sos-a', version: 8, ai_advisory: { id: 'advisory-a', status: 'COMPLETED' } });
  assert.equal(noDecision.next, null);

  const runner = sandbox({ activeAccessToken: 'coord', requestId: 'sos-a', aiReviewDecision: 'ACCEPTED' });
  runner.send(detail, { id: 'sos-a', version: 8, ai_advisory: { id: 'advisory-a', status: 'COMPLETED' } });
  assert.equal(runner.next, review.id);
  assert.equal(runner.values.get('requestVersion'), '8');
  assert.equal(runner.values.get('advisoryId'), 'advisory-a');
  runner.send(review, { request_id: 'sos-a', advisory_id: 'advisory-a', decision: 'ACCEPTED' });
  assert.equal(runner.skipped, false);
  assert.equal(runner.body.expected_version, 8);
  assert.equal(runner.body.decision, 'ACCEPTED');
  assert.equal(runner.next, null);
  assert.equal(runner.failures.length, 0);
});
