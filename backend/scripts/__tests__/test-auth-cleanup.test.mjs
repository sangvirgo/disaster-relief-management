import assert from 'node:assert/strict';
import test from 'node:test';

const cleanupSupport = await import('../smoke/test-auth-cleanup.mjs').catch(() => ({}));

function fakeDatabase({ users = [], families = [], registeredResources = [], idempotencyRecords = [], remaining = {}, failure } = {}) {
  const calls = [];
  const userRows = users.map((user) => ({ ...user }));
  const idempotencyRows = idempotencyRecords.map((record) => ({ ...record }));
  return {
    calls,
    users: userRows,
    idempotencyRows,
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (failure && failure.test(sql)) throw new Error('database cleanup failed');
      if (/SELECT resource_id\s+FROM idempotency_record/u.test(sql)) return { rows: registeredResources };
      if (/SELECT id FROM session_family/u.test(sql)) return { rows: families };
      if (/DELETE FROM idempotency_record/u.test(sql)) {
        const exactTuples = /USING unnest/u.test(sql);
        const [scopes = [], commands = [], keys = []] = exactTuples ? values : [[], [], values[0] ?? []];
        for (let index = idempotencyRows.length - 1; index >= 0; index--) {
          const record = idempotencyRows[index];
          const matches = exactTuples
            ? scopes.some((scope, tupleIndex) => scope === record.scope_key
              && commands[tupleIndex] === record.command && keys[tupleIndex] === record.idempotency_key)
            : keys.includes(record.idempotency_key);
          if (matches) {
            idempotencyRows.splice(index, 1);
          }
        }
      }
      if (/DELETE FROM app_user/u.test(sql)) {
        const [ids = []] = values;
        for (let index = userRows.length - 1; index >= 0; index--) {
          if (ids.includes(userRows[index].id)) userRows.splice(index, 1);
        }
      }
      if (/AS users/u.test(sql)) {
        const [ids = [], , scopes = [], commands = [], keys = []] = values;
        return {
          rows: [{
            users: userRows.filter(({ id }) => ids.includes(id)).length,
            session_families: 0,
            refresh_sessions: 0,
            grants: 0,
            idempotency_records: idempotencyRows.filter((record) => scopes.some((scope, tupleIndex) => scope === record.scope_key
              && commands[tupleIndex] === record.command && keys[tupleIndex] === record.idempotency_key)).length,
            ...remaining,
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('deletes and verifies auth smoke users from tracked IDs and registration resources', async () => {
  assert.equal(typeof cleanupSupport.cleanupAuthSmokeFixtures, 'function');
  const userId = '11111111-1111-4111-8111-111111111111';
  const recoveredUserId = '22222222-2222-4222-8222-222222222222';
  const userFamilyId = '33333333-3333-4333-8333-333333333333';
  const trackedFamilyId = '44444444-4444-4444-8444-444444444444';
  const idempotencyKey = '55555555-5555-4555-8555-555555555555';
  const database = fakeDatabase({
    users: [{ id: userId, username: 'registered-user' }, { id: recoveredUserId, username: 'response-lost-user' }],
    families: [{ id: userFamilyId }, { id: trackedFamilyId }],
    registeredResources: [{ resource_id: recoveredUserId }],
    idempotencyRecords: [{
      scope_key: 'anon:register', command: 'identity.auth.register', idempotency_key: idempotencyKey,
    }],
  });

  await cleanupSupport.cleanupAuthSmokeFixtures({
    database,
    userIds: new Set([userId]),
    familyIds: new Set([trackedFamilyId]),
    idempotencyRecords: [{ scopeKey: 'anon:register', command: 'identity.auth.register', key: idempotencyKey }],
  });

  const cleanupUsers = [userId, recoveredUserId];
  const cleanupFamilies = [trackedFamilyId, userFamilyId];
  const findRegisteredResources = database.calls.find(({ sql }) => /SELECT resource_id\s+FROM idempotency_record/u.test(sql));
  assert.match(findRegisteredResources.sql, /scope_key = 'anon:register'/u);
  assert.match(findRegisteredResources.sql, /command = 'identity\.auth\.register'/u);
  assert.match(findRegisteredResources.sql, /resource_type = 'app_user'/u);
  assert.deepEqual(findRegisteredResources.values, [[idempotencyKey]]);
  const findFamilies = database.calls.find(({ sql }) => /SELECT id FROM session_family/u.test(sql));
  assert.deepEqual(findFamilies.values, [cleanupUsers]);
  const deleteSessions = database.calls.find(({ sql }) => /DELETE FROM refresh_session/u.test(sql));
  assert.deepEqual(deleteSessions.values, [cleanupFamilies]);
  const deleteFamilies = database.calls.find(({ sql }) => /DELETE FROM session_family/u.test(sql));
  assert.deepEqual(deleteFamilies.values, [cleanupFamilies, cleanupUsers]);
  const deleteUsers = database.calls.find(({ sql }) => /DELETE FROM app_user/u.test(sql));
  assert.deepEqual(deleteUsers.values, [cleanupUsers]);
  const deleteIdempotency = database.calls.find(({ sql }) => /DELETE FROM idempotency_record/u.test(sql));
  assert.match(deleteIdempotency.sql, /stored\.scope_key = fixture\.scope_key/u);
  assert.match(deleteIdempotency.sql, /stored\.command = fixture\.command/u);
  assert.deepEqual(deleteIdempotency.values, [['anon:register'], ['identity.auth.register'], [idempotencyKey]]);
  const verify = database.calls.find(({ sql }) => /AS users/u.test(sql));
  assert.match(verify.sql, /AS session_families/u);
  assert.match(verify.sql, /AS refresh_sessions/u);
  assert.match(verify.sql, /AS grants/u);
  assert.match(verify.sql, /AS idempotency_records/u);
  assert.deepEqual(verify.values, [cleanupUsers, cleanupFamilies, ['anon:register'], ['identity.auth.register'], [idempotencyKey]]);
  assert.deepEqual(database.users, []);
  assert.equal(database.calls.at(-1).sql, 'COMMIT');
});

test('preserves a pre-existing same-name user without a registration idempotency resource', async () => {
  assert.equal(typeof cleanupSupport.cleanupAuthSmokeFixtures, 'function');
  const existingUser = {
    id: '66666666-6666-4666-8666-666666666666',
    username: 'existing-smoke-name',
  };
  const database = fakeDatabase({ users: [existingUser] });

  await cleanupSupport.cleanupAuthSmokeFixtures({
    database,
    userIds: new Set(),
    usernames: new Set([existingUser.username]),
    familyIds: new Set(),
    idempotencyRecords: [{
      scopeKey: 'anon:register', command: 'identity.auth.register', key: '77777777-7777-4777-8777-777777777777',
    }],
  });

  assert.deepEqual(database.users, [existingUser]);
  const deleteUsers = database.calls.find(({ sql }) => /DELETE FROM app_user/u.test(sql));
  assert.deepEqual(deleteUsers.values, [[]]);
  const registrationLookup = database.calls.find(({ sql }) => /SELECT resource_id\s+FROM idempotency_record/u.test(sql));
  assert.deepEqual(registrationLookup.values, [['77777777-7777-4777-8777-777777777777']]);
  assert.equal(database.calls.some(({ sql }) => /username/u.test(sql)), false);
});

test('fails and rolls back when a fixture delete query fails', async () => {
  assert.equal(typeof cleanupSupport.cleanupAuthSmokeFixtures, 'function');
  const database = fakeDatabase({ failure: /DELETE FROM refresh_session/u });

  await assert.rejects(cleanupSupport.cleanupAuthSmokeFixtures({
    database,
    userIds: new Set(['11111111-1111-4111-8111-111111111111']),
    familyIds: new Set(),
    idempotencyRecords: [],
  }), /database cleanup failed/u);

  assert.equal(database.calls.filter(({ sql }) => sql === 'ROLLBACK').length, 2);
  assert.equal(database.calls.some(({ sql }) => sql === 'COMMIT'), false);
});

test('fails and rolls back when verification finds any remaining fixture type', async () => {
  assert.equal(typeof cleanupSupport.cleanupAuthSmokeFixtures, 'function');
  const database = fakeDatabase({
    remaining: { users: 1, session_families: 2, refresh_sessions: 3, grants: 4, idempotency_records: 5 },
  });

  await assert.rejects(cleanupSupport.cleanupAuthSmokeFixtures({
    database,
    userIds: new Set(['11111111-1111-4111-8111-111111111111']),
    familyIds: new Set(),
    idempotencyRecords: [],
  }), /users=1, session_families=2, refresh_sessions=3, grants=4, idempotency_records=5/u);

  assert.equal(database.calls.filter(({ sql }) => sql === 'ROLLBACK').length, 2);
  assert.equal(database.calls.some(({ sql }) => sql === 'COMMIT'), false);
});

test('removes an idempotency record only from its tracked scope and command', async () => {
  const sharedKey = '88888888-8888-4888-8888-888888888888';
  const tracked = { scopeKey: 'user:fixture', command: 'identity.auth.change-password', key: sharedKey };
  const unrelated = { scope_key: 'user:other', command: 'identity.auth.lock-timeout-smoke', idempotency_key: sharedKey };
  const database = fakeDatabase({
    idempotencyRecords: [
      { scope_key: tracked.scopeKey, command: tracked.command, idempotency_key: tracked.key },
      unrelated,
    ],
  });

  await cleanupSupport.cleanupAuthSmokeFixtures({
    database,
    userIds: new Set(),
    familyIds: new Set(),
    idempotencyRecords: [tracked],
  });

  assert.deepEqual(database.idempotencyRows, [unrelated]);
});
