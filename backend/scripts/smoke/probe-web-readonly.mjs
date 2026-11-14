// Read-only route/role probe for the running main stack. Set C48_PROBE_PASSWORD
// in the caller's environment. Never print tokens or response record contents.
const base = 'http://127.0.0.1:8080/api/v1';
const password = process.env.C48_PROBE_PASSWORD;
if (!password) throw new Error('C48_PROBE_PASSWORD is required');
const to = new Date();
const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
const windowQuery = `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;

const cases = [
  ['identity', '/me'],
  ['identity', '/users?limit=2'],
  ['response', '/requests/mine?limit=2'],
  ['response', '/requests?limit=2'],
  ['response', '/missions/mine?limit=2'],
  ['response', `/reports/summary${windowQuery}`],
  ['response', `/map/heatmap${windowQuery}`],
  ['logistics', '/public/donation-drives?limit=2'],
  ['logistics', '/donation-drives?limit=2'],
  ['logistics', '/donation-deliveries?limit=2'],
  ['logistics', '/stock?limit=2'],
  ['logistics', '/reports/stock-summary?limit=2'],
];
const users = ['citizen3', 'coord_seed', 'vol_leader_seed', 'ops_seed', 'intake2', 'reviewer2', 'admin'];

function shape(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (!value || typeof value !== 'object') return typeof value;
  const keys = Object.keys(value);
  const listKey = keys.find((key) => Array.isArray(value[key]));
  return `${keys.slice(0, 9).join(',')}${listKey ? ` ${listKey}(${value[listKey].length})` : ''}`;
}
async function request(service, path, token) {
  try {
    const response = await fetch(`${base}/${service}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const value = await response.json().catch(() => undefined);
    return { status: response.status, shape: shape(value), code: response.ok ? undefined : value?.code,
      field_errors: response.ok ? undefined : value?.field_errors,
      message: response.ok ? undefined : value?.message, correlation: response.ok ? undefined : Boolean(value?.correlation_id) };
  } catch (error) { return { network_error: String(error) }; }
}
for (const [service, path] of cases) {
  if (path === '/me' || path === '/requests?limit=2' || path === '/stock?limit=2') {
    console.log(JSON.stringify({ user: 'anonymous', path: `${service}${path}`, result: await request(service, path) }));
  }
}
for (const user of users) {
  const response = await fetch(`${base}/identity/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password, client_kind: 'NATIVE' }),
  });
  const auth = await response.json().catch(() => undefined);
  console.log(JSON.stringify({ user, path: 'identity/auth/login', status: response.status,
    shape: shape(auth), code: response.ok ? undefined : auth?.code,
    message: response.ok ? undefined : auth?.message }));
  if (!response.ok || !auth?.access_token) continue;
  if (user === 'coord_seed') {
    const invalidPath = `/reports/summary?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
    console.log(JSON.stringify({ user, path: `response${invalidPath}`, result: await request('response', invalidPath, auth.access_token) }));
  }
  for (const [service, path] of cases) {
    console.log(JSON.stringify({ user, path: `${service}${path}`,
      result: await request(service, path, auth.access_token) }));
  }
}
