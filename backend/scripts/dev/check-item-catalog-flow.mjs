import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const password = env.match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim();
if (!password) throw new Error('SEED_PASSWORD is missing');
const base = 'http://127.0.0.1:8080/api/v1';

async function call(service, path, method = 'GET', body, token) {
  const response = await fetch(`${base}/${service}/${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  return { status: response.status, result };
}

function check(actual, expected, label) {
  if (actual.status !== expected) throw new Error(`${label}: HTTP ${actual.status}, code ${actual.result.code ?? 'none'}`);
  console.log(`${label}: HTTP ${actual.status}${actual.result.code ? ` ${actual.result.code}` : ''}`);
}

const login = await call('identity', 'auth/login', 'POST', { username: 'ops_mgr', password, client_kind: 'NATIVE' });
check(login, 200, 'login');
const token = login.result.access_token;
const citizenLogin = await call('identity', 'auth/login', 'POST', { username: 'citizen1', password, client_kind: 'NATIVE' });
check(citizenLogin, 200, 'citizen login');
const types = await call('logistics', 'item-types?limit=10', 'GET', undefined, token);
const units = await call('logistics', 'units?limit=10', 'GET', undefined, token);
check(types, 200, 'item types');
check(units, 200, 'units');
const type = types.result.items[0]?.code;
const unit = units.result.items[0]?.code;
if (!type || !unit) throw new Error('Catalog type/unit is missing');

const suffix = randomUUID().slice(0, 8);
let itemId;
try {
  const created = await call('logistics', 'items', 'POST', { item_type_code: type, unit_code: unit, name: `Vật phẩm thử ${suffix}` }, token);
  check(created, 201, 'create item');
  itemId = created.result.id;
  const forbidden = await call('logistics', `items/${itemId}`, 'PATCH', { expected_version: created.result.version, name: 'Không được sửa' }, citizenLogin.result.access_token);
  check(forbidden, 403, 'catalog permission');
  if (forbidden.result.code !== 'FORBIDDEN') throw new Error('Wrong permission code');
  const invalid = await call('logistics', `items/${itemId}`, 'PATCH', { expected_version: created.result.version, name: '' }, token);
  check(invalid, 400, 'invalid name');
  if (invalid.result.code !== 'VALIDATION_FAILED' || !/[^\x00-\x7F]/u.test(invalid.result.message ?? '')) throw new Error('Validation message is not Vietnamese');
  const renamed = await call('logistics', `items/${itemId}`, 'PATCH', { expected_version: created.result.version, name: `Vật phẩm đã sửa ${suffix}` }, token);
  check(renamed, 200, 'rename item');
  if (renamed.result.name !== `Vật phẩm đã sửa ${suffix}`) throw new Error('Name did not change');
  const aliases = await call('logistics', `items/${itemId}`, 'PATCH', { expected_version: renamed.result.version, aliases: [`từ khóa ${suffix}`] }, token);
  check(aliases, 200, 'update aliases');
  if (!aliases.result.aliases?.includes(`từ khóa ${suffix}`)) throw new Error('Aliases did not change');
  const stale = await call('logistics', `items/${itemId}`, 'PATCH', { expected_version: renamed.result.version, name: 'Tên cũ' }, token);
  check(stale, 409, 'stale version');
  if (stale.result.code !== 'VERSION_CONFLICT') throw new Error('Wrong stale version code');
  const staleDelete = await call('logistics', `items/${itemId}`, 'DELETE', { expected_version: renamed.result.version }, token);
  check(staleDelete, 409, 'stale delete');
  if (staleDelete.result.code !== 'VERSION_CONFLICT') throw new Error('Wrong stale delete code');
  const deleted = await call('logistics', `items/${itemId}`, 'DELETE', { expected_version: aliases.result.version }, token);
  check(deleted, 200, 'delete unused item');
  itemId = undefined;
  const referenced = await call('logistics', 'items/00000000-0000-4000-8000-0000000a1004', 'DELETE', { expected_version: 1 }, token);
  check(referenced, 409, 'delete referenced item');
  if (referenced.result.code !== 'ITEM_IN_USE') throw new Error('Wrong referenced item code');
} finally {
  if (itemId) console.error(`Test item remains: ${itemId}`);
}
