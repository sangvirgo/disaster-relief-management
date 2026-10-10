import http from 'k6/http';
import { check } from 'k6';
import encoding from 'k6/encoding';

const baseUrl = __ENV.IDENTITY_URL || 'http://identity-api:3001/api/v1/identity';

export const options = {
  vus: 10,
  duration: '15s',
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const credentials = {
    username: __ENV.K6_USERNAME,
    password: __ENV.K6_PASSWORD,
    client_kind: 'NATIVE',
  };
  const login = http.post(`${baseUrl}/auth/login`, JSON.stringify(credentials), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(login, { 'test session created': (response) => response.status === 200 });
  if (login.status !== 200) throw new Error('Identity k6 login failed');

  const service = http.post(`${baseUrl}/internal/token`, JSON.stringify({
    client_id: __ENV.SERVICE_CLIENT_ID,
    client_secret: __ENV.SERVICE_CLIENT_SECRET,
    audience: 'identity',
  }), { headers: { 'Content-Type': 'application/json' } });
  check(service, { 'service token created': (response) => response.status === 200 });
  if (service.status !== 200) throw new Error('Identity k6 service-token request failed');

  const claims = JSON.parse(encoding.b64decode(login.json('access_token').split('.')[1], 'rawurl', 's'));
  return {
    userToken: login.json('access_token'),
    serviceToken: service.json('access_token'),
    sid: claims.sid,
    sub: claims.sub,
  };
}

export default function (tokens) {
  const response = http.post(`${baseUrl}/internal/introspect`, JSON.stringify({ sid: tokens.sid, sub: tokens.sub }), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.serviceToken}`,
    },
  });
  check(response, {
    'introspection returns active session': (result) => result.status === 200 && result.json('active') === true,
  });
}

export function teardown(tokens) {
  http.post(`${baseUrl}/auth/logout`, null, {
    headers: { Authorization: `Bearer ${tokens.userToken}` },
  });
}
