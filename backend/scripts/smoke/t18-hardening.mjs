import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== '--direct-apis') || arguments_.length > 1) {
  throw new Error('Supported option: --direct-apis');
}
const directApiMode = arguments_.includes('--direct-apis');

function loopbackBase(value, name) {
  const base = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)) {
    throw new Error(`${name} must use a loopback host.`);
  }
  if (base.pathname !== '/' || base.search || base.hash) {
    throw new Error(`${name} must be an origin without a path, query, or fragment.`);
  }
  return base;
}

const publicBase = loopbackBase(process.env.C48_T18_PUBLIC_BASE_URL || 'http://127.0.0.1:8080', 'C48_T18_PUBLIC_BASE_URL');
const identityBase = directApiMode
  ? loopbackBase(process.env.C48_T18_IDENTITY_BASE_URL || 'http://127.0.0.1:3001', 'C48_T18_IDENTITY_BASE_URL')
  : publicBase;
const responseBase = directApiMode
  ? loopbackBase(process.env.C48_T18_RESPONSE_BASE_URL || 'http://127.0.0.1:3002', 'C48_T18_RESPONSE_BASE_URL')
  : publicBase;
const logisticsBase = directApiMode
  ? loopbackBase(process.env.C48_T18_LOGISTICS_BASE_URL || 'http://127.0.0.1:3003', 'C48_T18_LOGISTICS_BASE_URL')
  : publicBase;

const errorCopy = {
  UNAUTHENTICATED: 'Bạn cần đăng nhập để thực hiện thao tác này.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  VALIDATION_FAILED: 'Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại các trường được đánh dấu.',
};

async function request(base, path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { Accept: 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  const raw = await response.text();
  let value;
  try {
    value = raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new Error(`Expected a JSON response from ${path}; received non-JSON content.`);
  }
  return { response, value };
}

function verifyError(result, { status, code, path, checkIngressHeaders }) {
  const { response, value } = result;
  assert.equal(response.status, status, `${path} returned unexpected HTTP status ${response.status}`);
  assert.equal(value?.code, code, `${path} returned unexpected error code ${String(value?.code)}`);
  assert.equal(value?.message, errorCopy[code], `${path} returned unexpected user-facing error copy`);
  assert.equal(response.headers.get('cache-control'), 'no-store', `${path} must not be cached`);
  if (checkIngressHeaders) {
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${path} is missing X-Content-Type-Options`);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', `${path} is missing Referrer-Policy`);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'; frame-ancestors 'none'/u,
      `${path} is missing the expected Content-Security-Policy`);
  }
  assert.equal(typeof value?.correlation_id, 'string', `${path} is missing a correlation identifier`);
  assert.ok(value.correlation_id.length > 0, `${path} returned an empty correlation identifier`);
}

const unauthenticatedIdentity = await request(identityBase, '/api/v1/identity/me');
verifyError(unauthenticatedIdentity, {
  status: 401,
  code: 'UNAUTHENTICATED',
  path: 'GET /api/v1/identity/me',
  checkIngressHeaders: !directApiMode,
});
console.log(`${directApiMode ? 'PASS Identity API' : 'PASS ingress + Identity'} 401: ${directApiMode ? 'no-store, Vietnamese copy.' : 'security headers, no-store, Vietnamese copy.'}`);

const unauthenticatedResponse = await request(responseBase, '/api/v1/response/requests/mine?limit=1');
verifyError(unauthenticatedResponse, {
  status: 401,
  code: 'UNAUTHENTICATED',
  path: 'GET /api/v1/response/requests/mine?limit=1',
  checkIngressHeaders: !directApiMode,
});
console.log(`${directApiMode ? 'PASS Response API' : 'PASS ingress + Response'} 401: ${directApiMode ? 'no-store, Vietnamese copy.' : 'security headers, no-store, Vietnamese copy.'}`);

const auditPath = '/api/v1/logistics/audit-logs?entity_type=distribution&limit=1';
const unauthenticatedAudit = await request(logisticsBase, auditPath);
verifyError(unauthenticatedAudit, {
  status: 401,
  code: 'UNAUTHENTICATED',
  path: 'GET /api/v1/logistics/audit-logs (anonymous)',
  checkIngressHeaders: !directApiMode,
});
console.log(`${directApiMode ? 'PASS Logistics API' : 'PASS ingress + Logistics'} audit route 401: no-store, Vietnamese copy.`);

const auditReaderToken = process.env.C48_T18_AUDIT_READ_TOKEN;
if (auditReaderToken) {
  const auditPage = await request(logisticsBase, auditPath, { headers: { Authorization: `Bearer ${auditReaderToken}` } });
  assert.equal(auditPage.response.status, 200, 'AUDIT_READ request must succeed');
  assert.equal(auditPage.response.headers.get('cache-control'), 'no-store', 'audit rows must not be cached');
  assert.ok(Array.isArray(auditPage.value?.items), 'audit page must contain items');
  assert.ok(auditPage.value.next_cursor === null || typeof auditPage.value.next_cursor === 'string', 'audit page cursor must be nullable text');
  assert.ok(!JSON.stringify(auditPage.value).includes(auditReaderToken), 'audit response must not contain the bearer token');
  const auditItems = auditPage.value.items;
  if (auditItems.length === 0) {
    console.log('SKIP Logistics audit filtering: no distribution audit rows; content is not verified.');
  } else {
    assert.ok(auditItems.length > 0, 'a populated distribution page must be non-empty');
    assert.ok(auditItems.every((item) => item.entity_type === 'distribution'), 'audit page must respect entity_type');
    const entityId = auditItems[0].entity_id;
    assert.equal(typeof entityId, 'string');
    assert.ok(entityId.length > 0);
    const entityAuditPath = `/api/v1/logistics/audit-logs?entity_type=distribution&entity_id=${encodeURIComponent(entityId)}&limit=1`;
    const entityAudit = await request(logisticsBase, entityAuditPath, { headers: { Authorization: `Bearer ${auditReaderToken}` } });
    assert.equal(entityAudit.response.status, 200, 'AUDIT_READ request must retrieve an entity_id-filtered page');
    assert.equal(entityAudit.response.headers.get('cache-control'), 'no-store', 'audit rows must not be cached');
    assert.ok(Array.isArray(entityAudit.value?.items), 'entity_id-filtered page must contain items');
    assert.ok(entityAudit.value.items.length > 0, 'the selected audit row must remain visible with both filters');
    assert.ok(entityAudit.value.items.every((item) => item.entity_type === 'distribution' && item.entity_id === entityId),
      'audit page must respect entity_type and entity_id');
    assert.ok(!JSON.stringify(entityAudit.value).includes(auditReaderToken), 'audit response must not contain the bearer token');
    const nonmatchingEntityId = randomUUID();
    assert.notEqual(nonmatchingEntityId, entityId);
    const unmatchedAuditPath = `/api/v1/logistics/audit-logs?entity_type=distribution&entity_id=${nonmatchingEntityId}&limit=1`;
    const unmatchedAudit = await request(logisticsBase, unmatchedAuditPath, { headers: { Authorization: `Bearer ${auditReaderToken}` } });
    assert.equal(unmatchedAudit.response.status, 200, 'AUDIT_READ must retrieve an empty page for a valid nonmatching entity_id');
    assert.equal(unmatchedAudit.response.headers.get('cache-control'), 'no-store', 'audit rows must not be cached');
    assert.deepEqual(unmatchedAudit.value?.items, [], 'entity_id filtering must exclude rows with a nonmatching entity_id');
    assert.ok(!JSON.stringify(unmatchedAudit.value).includes(auditReaderToken), 'audit response must not contain the bearer token');
    console.log('PASS Logistics audit filtering: populated results match the requested entity_id; a valid nonmatching entity_id returns no rows.');
  }
  console.log('PASS Logistics audit access: system AUDIT_READ token received a no-store 200 response.');
} else {
  console.log('SKIP Logistics audit allow check: C48_T18_AUDIT_READ_TOKEN is not set.');
}

const deniedAuditToken = process.env.C48_T18_AUDIT_DENIED_TOKEN;
if (deniedAuditToken) {
  const deniedAudit = await request(logisticsBase, auditPath, { headers: { Authorization: `Bearer ${deniedAuditToken}` } });
  verifyError(deniedAudit, {
    status: 403,
    code: 'FORBIDDEN',
    path: 'GET /api/v1/logistics/audit-logs (restricted reader)',
    checkIngressHeaders: !directApiMode,
  });
  console.log('PASS Logistics audit access: token without AUDIT_READ received Vietnamese FORBIDDEN.');
} else {
  console.log('SKIP Logistics audit deny check: C48_T18_AUDIT_DENIED_TOKEN is not set.');
}

if (directApiMode) {
  console.log('SKIP DTO POST: direct mode sends GET requests only.');
} else {
  const invalidIntake = await request(responseBase, '/api/v1/response/requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'f6e8a19b-2c34-4f75-8a12-9d46a3f17b20',
    },
    body: {},
  });
  verifyError(invalidIntake, {
    status: 400,
    code: 'VALIDATION_FAILED',
    path: 'POST /api/v1/response/requests (invalid DTO)',
    checkIngressHeaders: true,
  });
  console.log('PASS DTO rejection: validation stopped before the intake handler; Vietnamese copy verified with ingress headers.');
}
