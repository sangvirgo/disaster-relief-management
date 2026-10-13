import assert from 'node:assert/strict';

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

const errorCopy = {
  UNAUTHENTICATED: 'Bạn cần đăng nhập để thực hiện thao tác này.',
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
