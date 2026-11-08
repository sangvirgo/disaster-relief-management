import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Explicitly recovers the named existing demo team through the public API. No SQL
// writes, new users/teams, permission changes, or reset are performed.
assert.ok(process.env.SEED_PASSWORD, 'SEED_PASSWORD is required');
assert.ok(process.env.C48_READINESS_TEAM_ID, 'C48_READINESS_TEAM_ID must identify the existing stuck demo team');
const base = process.env.C48_API_BASE_URL || 'http://127.0.0.1:8080/api/v1';
const teamId = process.env.C48_READINESS_TEAM_ID;
async function call(service, path, token, body, key = randomUUID(), method = 'POST') {
  const response = await fetch(`${base}/${service}/${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, value: await response.json(), replay: response.headers.get('Idempotent-Replay') };
}
async function login(username) {
  const result = await call('identity', 'auth/login', null, { username, password: process.env.SEED_PASSWORD, client_kind: 'NATIVE' });
  assert.equal(result.status, 200, `login ${username}: HTTP ${result.status}`);
  assert.ok(result.value.access_token);
  return result.value.access_token;
}
function error(result, status, code) {
  assert.equal(result.status, status);
  assert.equal(result.value.code, code);
  assert.ok(/[\u00c0-\u1ef9]/u.test(result.value.message), 'Vietnamese error feedback is required');
}
const leader = await login(process.env.C48_READINESS_LEADER || 'vol_leader_seed');
const citizen = await login('citizen1');
const coord = await login('coord1');
const before = await call('response', `teams/${teamId}`, leader, null, null, 'GET');
assert.equal(before.status, 200);
assert.equal(before.value.readiness_required, true, 'Only recover a team with an existing readiness latch');
assert.equal(before.value.availability, 'UNAVAILABLE');
const version = before.value.version;
const current = () => new Date(Date.now() - 1000).toISOString();
const body = { expected_version: version, confirmation_basis: 'SELF', occurred_at: current() };
error(await call('response', `teams/${teamId}`, leader, { expected_version: version, availability: 'AVAILABLE' }, randomUUID(), 'PATCH'), 409, 'TEAM_NOT_ELIGIBLE');
error(await call('response', `teams/${teamId}/ready`, citizen, body), 403, 'FORBIDDEN');
error(await call('response', `teams/${teamId}/ready`, coord, { ...body, confirmation_basis: 'PHONE' }), 400, 'VALIDATION_FAILED');
error(await call('response', `teams/${teamId}/ready`, leader, { ...body, expected_version: version - 1 }), 409, 'VERSION_CONFLICT');
error(await call('response', `teams/${teamId}/ready`, leader, { ...body, occurred_at: '2020-01-01T00:00:00.000Z' }), 400, 'VALIDATION_FAILED');
error(await call('response', `teams/${teamId}/ready`, leader, { ...body, occurred_at: new Date(Date.now() + 3600000).toISOString() }), 400, 'VALIDATION_FAILED');
error(await call('response', `teams/${teamId}/ready`, leader, { ...body, confirmation_basis: 'BAD' }), 400, 'VALIDATION_FAILED');
const key = randomUUID();
const recovered = await call('response', `teams/${teamId}/ready`, leader, body, key);
assert.equal(recovered.status, 200);
assert.equal(recovered.value.readiness_required, false);
assert.equal(recovered.value.availability, 'AVAILABLE');
assert.equal(recovered.value.version, version + 1);
const replay = await call('response', `teams/${teamId}/ready`, leader, body, key);
assert.equal(replay.status, 200);
assert.equal(replay.value.version, version + 1);
assert.equal(replay.replay, 'true');
error(await call('response', `teams/${teamId}/ready`, leader, body), 409, 'VERSION_CONFLICT');
const after = await call('response', `teams/${teamId}`, leader, null, null, 'GET');
assert.equal(after.value.version, version + 1);
assert.equal(after.value.readiness_required, false);
assert.equal(after.value.availability, 'AVAILABLE');
console.log(`PASS: primary API readiness recovery ${version} -> ${after.value.version}; generic PATCH, permission, person, stale version/time, future, DTO validation and replay checked`);
