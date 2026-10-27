import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collection = JSON.parse(readFileSync(new URL('../../postman/C48-backend-demo.postman_collection.json', import.meta.url), 'utf8'));
const seedSql = readFileSync(new URL('../../../docs/backend/seed/seed-identity.sql', import.meta.url), 'utf8');
const expansionIdentitySql = readFileSync(new URL('../../../docs/backend/seed/seed-expansion-identity.sql', import.meta.url), 'utf8');
const items = [];

function collect(children) {
  for (const item of children) {
    if (item.item) collect(item.item);
    else items.push(item);
  }
}

collect(collection.item);

function itemNamed(name) {
  const item = items.find((entry) => entry.name.includes(name));
  assert.ok(item, `Postman request containing "${name}" exists`);
  return item;
}

function operation(operationId) {
  const item = items.find((entry) => entry.event?.some((event) =>
    event.listen === 'prerequest' && event.script.exec.some((line) => line.includes(`\\"operationId\\":\\"${operationId}\\"`))));
  assert.ok(item, `Postman request for ${operationId} exists`);
  return item;
}

function metadata(item) {
  const line = item.event?.find((event) => event.listen === 'prerequest')?.script.exec.find((entry) =>
    entry.includes("pm.variables.set('_c48'"));
  const encoded = line?.match(/pm\.variables\.set\('_c48', (".*")\);/u)?.[1];
  assert.ok(encoded, `Postman metadata exists for ${item.name}`);
  return JSON.parse(JSON.parse(encoded));
}

test('public donation smoke uses a quantity valid for every unit precision', () => {
  const body = JSON.parse(operation('logisticsDonationsCreateDelivery').request.body.raw);
  assert.equal(body.lines[0].declared_quantity, '1');
});

test('donation declaration revision uses a precision-safe sample quantity', () => {
  const raw = operation('logisticsDonationsReviseDeclaration').request.body.raw.replace('{{donationVersion}}', '1');
  const body = JSON.parse(raw);
  assert.equal(body.lines[0].declared_quantity, '1');
});

test('donation claim and recovery requests use the donor flow login token', () => {
  for (const operationId of ['logisticsDonationsClaim', 'logisticsDonationsRecover']) {
    const authorization = operation(operationId).request.header.find((header) => header.key === 'Authorization');
    assert.equal(authorization?.value, 'Bearer {{donorAccessToken}}', operationId);
  }
});

test('donation capability secret is retained only after a successful declaration', () => {
  const prerequest = collection.event.find((event) => event.listen === 'prerequest').script.exec.join('\n');
  const testScript = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  const createRequests = items.filter((item) => {
    try { return metadata(item).operationId === 'logisticsDonationsCreateDelivery'; } catch { return false; }
  });

  assert.equal(createRequests.length, 2, 'both existing donation create forms remain in use');
  for (const item of createRequests) {
    const header = item.request.header.find((entry) => entry.key === 'X-Donation-Secret');
    assert.equal(header?.value, '{{pendingDonationSecret}}', item.name);
  }
  assert.match(prerequest, /pm\.variables\.set\('pendingDonationSecret', makeSecret\(\)\)/u);
  assert.doesNotMatch(prerequest, /pm\.collectionVariables\.set\('donationSecret', makeSecret\(\)\)/u);
  assert.match(testScript, /if \(pm\.response\.code >= 200 && pm\.response\.code < 300[\s\S]*meta\.operationId === 'logisticsDonationsCreateDelivery'[\s\S]*const pendingSecret = pm\.variables\.get\('pendingDonationSecret'\)[\s\S]*pm\.collectionVariables\.set\('donationSecret', pendingSecret\)/u);
});

test('donation recovery reuses the created public code and saves the issued recovery code', () => {
  const recovery = operation('logisticsDonationsRecover');
  const body = JSON.parse(recovery.request.body.raw);
  const recoveryHeader = recovery.request.header.find((entry) => entry.key === 'X-Recovery-Code');
  const testScript = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');

  assert.equal(body.public_code, '{{donationPublicCode}}');
  assert.equal(recoveryHeader?.value, '{{recoveryCode}}');
  assert.match(testScript, /meta\.operationId === 'logisticsDonationsIssueRecovery' && body\.recovery_code[\s\S]*pm\.collectionVariables\.set\('recoveryCode', body\.recovery_code\)/u);
});

test('request supplement includes at least one reported fact', () => {
  const body = JSON.parse(operation('supplementSelfRequest').request.body.raw.replace('{{requestVersion}}', '1'));
  assert.ok(Object.keys(body).some((field) => field !== 'expected_version'));
});

test('proxy request forms include GPS accuracy and capture timestamp', () => {
  const proxyRequests = items.filter((item) => {
    const url = typeof item.request.url === 'string' ? item.request.url : item.request.url?.raw;
    return url?.endsWith('/requests/proxy');
  });
  assert.ok(proxyRequests.length > 0);
  for (const item of proxyRequests) {
    const body = JSON.parse(item.request.body.raw);
    assert.equal(body.location.source, 'GPS', item.name);
    assert.ok(Number.isFinite(body.location.accuracy_m), item.name);
    assert.equal(body.location.captured_at, '{{$isoTimestamp}}', item.name);
  }
});

test('catalog item uses the type and unit created by earlier requests', () => {
  const body = JSON.parse(operation('logisticsCatalogCreateItem').request.body.raw);
  assert.equal(body.item_type_code, '{{itemTypeCode}}');
  assert.equal(body.unit_code, '{{unitCode}}');
  assert.ok(items.indexOf(operation('logisticsCatalogCreateUnit')) < items.indexOf(operation('logisticsCatalogCreateItem')));
});

test('stock adjustment review uses the ID returned by adjustment creation', () => {
  const script = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  const requestUrl = operation('logisticsStockReviewAdjustment').request.url;
  const reviewUrl = typeof requestUrl === 'string' ? requestUrl : requestUrl.raw;

  assert.match(script, /logisticsStockCreateAdjustment[\s\S]*pm\.collectionVariables\.set\('adjustmentId', body\.id\)/);
  assert.match(reviewUrl, /\/stock\/adjustments\/\{\{adjustmentId\}\}\/review$/);
  assert.ok(collection.variable.some((variable) => variable.key === 'adjustmentId'));
});

test('quick queue smoke uses a coordinator session', () => {
  const header = itemNamed('Queue điều phối theo quyền cán bộ').request.header.find((entry) => entry.key === 'Authorization');
  assert.equal(header?.value, 'Bearer {{coordinatorAccessToken}}');
});

test('coordinator queue saves a request ID for the existing detail request', () => {
  const testScript = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  const detail = operation('getStaffRequestDetail');
  const url = typeof detail.request.url === 'string' ? detail.request.url : detail.request.url.raw;

  assert.match(testScript, /meta\.operationId === 'listRequestQueue'[\s\S]*pm\.collectionVariables\.set\('requestId', firstRequest\.id\)/u);
  assert.match(url, /\/requests\/\{\{requestId\}\}$/u);
});

test('AI advisory review uses the advisory ID returned by detail and clears stale IDs', () => {
  const testScript = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  const detail = operation('getStaffRequestDetail');
  const review = operation('responseRequestOperationsReviewAiAdvisory');
  const reviewUrl = typeof review.request.url === 'string' ? review.request.url : review.request.url.raw;

  assert.match(testScript, /meta\.operationId === 'getStaffRequestDetail'[\s\S]*body\.ai_advisory\.id[\s\S]*pm\.collectionVariables\.set\('advisoryId', body\.ai_advisory\.id\)[\s\S]*pm\.collectionVariables\.unset\('advisoryId'\)/u);
  assert.match(reviewUrl, /\/requests\/\{\{requestId\}\}\/ai-advisories\/\{\{advisoryId\}\}\/review$/u);
  assert.ok(review.request.description.includes('`/requests/{id}`'));
  assert.ok(review.request.description.includes('COMPLETED'));
  assert.ok(review.request.description.includes('chưa có bản ghi để rà soát'));
});

test('queue and detail save backend priority advisory values into Postman variables', () => {
  const testScript = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  const variableKeys = [
    'priorityAdvisoryScore',
    'priorityAdvisoryLevel',
    'priorityAdvisoryReasonCodes',
    'priorityAdvisorySource',
    'priorityAdvisoryRulesVersion',
  ];

  for (const key of variableKeys) {
    assert.ok(collection.variable.some((variable) => variable.key === key), `${key} is declared`);
  }
  assert.match(testScript, /meta\.operationId === 'listRequestQueue'[\s\S]*setPriorityAdvisoryVariables\(firstRequest\.priority_advisory\)/u);
  assert.match(testScript, /meta\.operationId === 'getStaffRequestDetail'[\s\S]*setPriorityAdvisoryVariables\(body\.priority_advisory\)/u);
  for (const field of ['score', 'level', 'reason_codes', 'source', 'rules_version']) {
    assert.ok(testScript.includes(`advisory.${field}`), `priority_advisory.${field} is captured`);
  }
});

test('heatmap requests include a seeded region filter', () => {
  const heatmapRequests = items.filter((item) => {
    const url = typeof item.request.url === 'string' ? item.request.url : item.request.url.raw;
    return url.includes('/map/heatmap');
  });
  assert.ok(heatmapRequests.length > 0);
  for (const item of heatmapRequests) {
    const url = typeof item.request.url === 'string' ? item.request.url : item.request.url.raw;
    assert.match(url, /[?&]region_code=\{\{regionCode\}\}/u, item.name);
  }
  assert.equal(collection.variable.find((variable) => variable.key === 'regionCode')?.value, 'DEMO_A');
});

test('native CSRF probe clears cookies before other local API requests', () => {
  const script = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  assert.match(script, /getAuthCsrf[\s\S]*cookies\.jar\(\)\.clear/);
});

test('Native login clears stale Web cookies and Origin before sending', () => {
  const script = collection.event.find((event) => event.listen === 'prerequest').script.exec.join('\n');
  const cleanup = script.match(/if \(nativeLoginBody\.client_kind === 'NATIVE'\) \{([\s\S]*?)\n\}/u)?.[1];
  assert.ok(cleanup, 'Native login has a dedicated cookie cleanup block');
  assert.match(cleanup, /cookies\.toObject\(\)/);
  assert.match(cleanup, /cookies\.jar\(\)\.clear/);
  assert.match(cleanup, /console\.warn/);
  assert.doesNotMatch(cleanup, /pm\.execution\.skipRequest\(\)/, 'a Cookie Jar allowlist error must not silently skip login');
  assert.match(script, /headers\.remove\('Origin'\)/);
});

test('WEB refresh probe skips when no browser refresh cookie exists', () => {
  const refresh = itemNamed('session WEB không body');
  const script = refresh.event.find((event) => event.listen === 'prerequest').script.exec.join('\n');
  assert.match(script, /c48_refresh/);
  assert.match(script, /pm\.execution\.skipRequest\(\)/);
});

test('Postman collection contains public routes only', () => {
  const urls = items.map((item) => typeof item.request.url === 'string' ? item.request.url : item.request.url.raw);
  assert.ok(urls.every((url) => !/\/internal(?:\/|$)/u.test(url)));
});

test('citizen registration fails the Postman check when OTP email is not sent', () => {
  const script = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  assert.ok(script.includes('meta.operationId === "registerCitizen"') || script.includes("meta.operationId === 'registerCitizen'"));
  assert.ok(script.includes('pm.expect(body.email_sent).to.eql(true)'));
  assert.ok(script.includes('body.verification.challenge_id'));
  assert.ok(script.includes("pm.collectionVariables.set('challengeId'"));
});

test('Postman exposes every seeded account and gives each login its own token pair', () => {
  const userRows = seedSql.match(/INSERT INTO app_user[\s\S]*?FROM \(VALUES([\s\S]*?)\) AS v/u)?.[1];
  assert.ok(userRows, 'identity seed includes the demo user list');
  const seedPassword = collection.variable.find((variable) => variable.key === 'seedPassword')?.value;
  assert.equal(typeof seedPassword, 'string');
  assert.ok(seedPassword.trim(), 'the flow collection can run without a separate environment file');
  const seededUsernames = [...userRows.matchAll(/\(\s*'[a-f0-9]+'\s*,\s*'([^']+)'/giu)].map((match) => match[1]);
  const usernameVariables = collection.variable.filter((variable) => variable.key.endsWith('SeedUsername'));

  assert.deepEqual(
    usernameVariables.map((variable) => variable.value).sort(),
    seededUsernames.sort(),
    'Postman usernames match the identity seed exactly',
  );

  const usernameVariableByValue = new Map(usernameVariables.map((variable) => [variable.value, variable.key]));
  const loginRequests = items.filter((item) => {
    try { return metadata(item).operationId === 'login'; } catch { return false; }
  });
  const seededLoginRequests = loginRequests.filter((item) => {
    const usernameVariable = item.request.body?.raw?.match(/"username"\s*:\s*"\{\{([^}]+)\}\}"/u)?.[1];
    return usernameVariableByValue.has(usernameVariables.find((variable) => variable.key === usernameVariable)?.value);
  });
  const seededLoginUsernames = seededLoginRequests.map((item) => {
    const usernameVariable = item.request.body.raw.match(/"username"\s*:\s*"\{\{([^}]+)\}\}"/u)?.[1];
    return usernameVariables.find((variable) => variable.key === usernameVariable)?.value;
  });

  const primaryFlowAccounts = ['admin', 'campaign_mgr', 'citizen1', 'citizen2', 'coord1', 'coord_regional', 'dist1', 'intake1', 'ops_mgr', 'reviewer1', 'vol_leader1'];
  assert.deepEqual([...new Set(seededLoginUsernames)].sort(), primaryFlowAccounts.sort(), 'each authenticated seed flow uses its primary seeded account');

  const authenticatedFlows = new Map([
    ['01 · Công dân · tự gửi SOS (SELF)', 'citizenSeedUsername'],
    ['02 · Công dân · gửi thay người thân (PROXY)', 'proxyCitizenSeedUsername'],
    ['03 · Người quyên góp · khai báo và theo dõi', 'citizenSeedUsername'],
    ['04 · Điều phối viên (COORDINATOR)', 'coordinatorSeedUsername'],
    ['05 · Quản lý chiến dịch (CAMPAIGN_MANAGER)', 'campaignManagerSeedUsername'],
    ['06 · Quản lý vận hành (OPERATIONS_MANAGER)', 'operationsManagerSeedUsername'],
    ['07 · Nhân viên tiếp nhận (INTAKE_STAFF)', 'intakeSeedUsername'],
    ['08 · Người duyệt độc lập (REVIEWER)', 'reviewerSeedUsername'],
    ['09 · Nhân viên phân phối (DISTRIBUTION_STAFF)', 'distributionSeedUsername'],
    ['10 · Tình nguyện viên (VOLUNTEER)', 'volunteerSeedUsername'],
    ['11 · Quản trị hệ thống (ADMIN)', 'adminSeedUsername'],
  ]);
  for (const [flowName, usernameVariable] of authenticatedFlows) {
    const flow = collection.item.find((entry) => entry.name === flowName);
    assert.ok(flow, `authenticated flow ${flowName} exists`);
    const guide = flow.item?.find((entry) => entry.name.startsWith('00 · Luồng gợi ý'));
    assert.ok(guide, `${flowName} has a login guide`);
    const flowLogins = guide.item?.filter((entry) => {
      try { return metadata(entry).operationId === 'login' && JSON.parse(entry.request.body.raw).client_kind === 'NATIVE'; } catch { return false; }
    }) || [];
    assert.equal(flowLogins.length, 1, `${flowName} has exactly one Native login`);
    assert.equal(guide.item[0], flowLogins[0], `${flowName} starts with its login`);
    assert.match(flowLogins[0].request.body.raw, new RegExp(`"username"\\s*:\\s*"\\{\\{${usernameVariable}\\}\\}"`, 'u'));
    assert.ok(metadata(flowLogins[0]).tokenTarget, `${flowName} stores its own access token`);
    assert.ok(metadata(flowLogins[0]).refreshTokenTarget, `${flowName} stores its own refresh token`);
  }

  const nativeLoginRequests = loginRequests.filter((item) => JSON.parse(item.request.body.raw).client_kind === 'NATIVE');
  const targets = nativeLoginRequests.map(metadata);
  assert.equal(new Set(targets.map((entry) => entry.tokenTarget)).size, targets.length, 'access tokens are isolated per login flow');
  assert.equal(new Set(targets.map((entry) => entry.refreshTokenTarget)).size, targets.length, 'refresh tokens are isolated per login flow');
  for (const target of targets) {
    assert.ok(collection.variable.some((variable) => variable.key === target.tokenTarget), `${target.tokenTarget} exists`);
    assert.ok(collection.variable.some((variable) => variable.key === target.refreshTokenTarget), `${target.refreshTokenTarget} exists`);
  }

  const googleLogin = metadata(operation('identityAuthGoogleLogin'));
  assert.equal(googleLogin.tokenTarget, 'googleCitizenAccessToken');
  assert.equal(googleLogin.refreshTokenTarget, 'googleCitizenRefreshToken');

  const webFlow = collection.item[0].item.find((item) => item.name.startsWith('05 · Phiên WEB · cookie và CSRF'));
  assert.ok(webFlow, 'WEB cookie flow exists');
  const webCsrfIndex = webFlow.item.findIndex((item) => item.name.includes('bắt đầu phiên WEB'));
  const webLoginIndex = webFlow.item.findIndex((item) => item.name === 'POST /auth/login · phiên WEB');
  const webRefreshIndex = webFlow.item.findIndex((item) => item.name.includes('session WEB'));
  assert.ok(webCsrfIndex >= 0 && webCsrfIndex < webLoginIndex && webLoginIndex < webRefreshIndex, 'WEB flow runs CSRF, login, then refresh');
  assert.equal(JSON.parse(webFlow.item[webLoginIndex].request.body.raw).client_kind, 'WEB');
  assert.equal(webFlow.variable.find((variable) => variable.key === 'clientKind')?.value, 'WEB');
});

test('Identity demo seeds assign unique verified emails and active account flags', () => {
  assert.match(seedSql, /INSERT INTO app_user \(id, username, display_name, email, email_verified_at, password_hash, status, must_change_password\)/u);
  assert.match(seedSql, /v\.username \|\| '\+' \|\| substr\(md5\(pg_temp\.u\(v\.suffix\)::text\), 1, 10\) \|\| '@example\.test'/u);
  assert.match(seedSql, /now\(\), :'seed_password_hash', 'ACTIVE', true/u);
  assert.match(expansionIdentitySql, /UPDATE app_user AS account[\s\S]*email_verified_at = COALESCE\([\s\S]*status = 'ACTIVE'[\s\S]*must_change_password = true/u);
  assert.match(expansionIdentitySql, /INSERT INTO app_user \(id, username, display_name, email, email_verified_at, password_hash, status, must_change_password\)/u);
  assert.match(expansionIdentitySql, /'@example\.test'/u);
});
