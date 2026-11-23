import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const publicBaseUrl = (__ENV.C48_K6_PUBLIC_URL || 'http://127.0.0.1:8080').replace(/\/$/u, '');
const responseUrl = `${publicBaseUrl}/api/v1/response`;
const accessToken = __ENV.C48_K6_ACCESS_TOKEN || '';
const longitude = Number(__ENV.C48_K6_SOS_LONGITUDE);
const latitude = Number(__ENV.C48_K6_SOS_LATITUDE);
const incidentCategory = __ENV.C48_K6_INCIDENT_CATEGORY || 'FLOOD';
const readLatency = new Trend('read_latency_ms', true);
const sosLatency = new Trend('sos_latency_ms', true);

function isLoopbackBaseUrl(value) {
  const match = /^https?:\/\/(\[[0-9a-f:.]+\]|[^:/?#]+)(?::(\d{1,5}))?(?:\/[^?#]*)?$/iu.exec(value);
  if (!match) return false;

  const hostname = match[1].toLowerCase();
  const port = match[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) return false;
  if (hostname === 'localhost' || hostname === '[::1]') return true;

  const parts = hostname.split('.');
  const octets = parts.map(Number);
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/u.test(part)) &&
    octets.every((octet) => octet >= 0 && octet <= 255) && octets[0] === 127;
}

// The access token lives at most 10 minutes (identity access TTL), so run-t18.sh runs the measured interval in
// segments shorter than that and logs in again between them. Defaults keep the documented 2 min + 10 min shape.
const vus = Number(__ENV.C48_K6_VUS || 20);
const warmupDuration = __ENV.C48_K6_WARMUP || '2m';
const measuredDuration = __ENV.C48_K6_MEASURED || '10m';
const warmupSeconds = warmupDuration === '0s' ? 0 : undefined;

export const options = {
  scenarios: {
    ...(warmupSeconds === 0 ? {} : { warmup: { executor: 'constant-vus', exec: 'warmup', vus, duration: warmupDuration } }),
    measured: { executor: 'constant-vus', exec: 'default', vus, duration: measuredDuration, ...(warmupSeconds === 0 ? {} : { startTime: warmupDuration }) },
  },
  thresholds: {
    // Empty-threshold entries only make k6 print a per-status request count, so failures are attributed in the summary.
    'http_reqs{status:200}': ['count>=0'], 'http_reqs{status:201}': ['count>=0'], 'http_reqs{status:400}': ['count>=0'],
    'http_reqs{status:401}': ['count>=0'], 'http_reqs{status:429}': ['count>=0'], 'http_reqs{status:500}': ['count>=0'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    read_latency_ms: ['p(95)<2000'],
    sos_latency_ms: ['p(95)<3000'],
  },
};

export function setup() {
  if (!isLoopbackBaseUrl(publicBaseUrl)) {
    throw new Error('Refusing to run: C48_K6_PUBLIC_URL must use a loopback host.');
  }
  if (__ENV.K6_ENABLE_SOS_WRITES !== '1') {
    throw new Error('Refusing to run: set K6_ENABLE_SOS_WRITES=1 only for an authorized performance window.');
  }
  if (!accessToken || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !/^[A-Z0-9_]{2,40}$/u.test(incidentCategory)) {
    throw new Error('Provide a pre-issued reporter token, an approved SOS point, and a valid category.');
  }
  return { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } };
}

function readOwnRequests(headers, recordLatency) {
  const response = http.get(`${responseUrl}/requests/mine?limit=20`, { headers });
  if (recordLatency) readLatency.add(response.timings.duration);
  check(response, {
    'scoped request read succeeds with no-store': (result) => result.status === 200 && result.headers['Cache-Control'] === 'no-store',
  });
}

export function warmup(data) {
  readOwnRequests(data.headers, false);
}

function idempotencyKey() {
  const iteration = __ITER.toString(16).padStart(8, '0').slice(-8);
  const vu = __VU.toString(16).padStart(4, '0').slice(-4);
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  return `${iteration}-${vu}-4000-8000-${timestamp}`;
}

function createSyntheticRequest(headers) {
  const response = http.post(`${responseUrl}/requests`, JSON.stringify({
    incident_category_code: incidentCategory,
    description: 'Bản ghi tổng hợp dùng cho kiểm thử hiệu năng T18.',
    people_affected: 1,
    location: { type: 'Point', coordinates: [longitude, latitude], source: 'MANUAL_PIN' },
  }), { headers: { ...headers, 'Idempotency-Key': idempotencyKey() } });
  sosLatency.add(response.timings.duration);
  check(response, { 'synthetic SOS is accepted': (result) => result.status === 201 });
}

export default function (data) {
  if (__ITER % 5 === 4) createSyntheticRequest(data.headers);
  else readOwnRequests(data.headers, true);
}
