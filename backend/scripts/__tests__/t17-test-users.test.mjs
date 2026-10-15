import assert from 'node:assert/strict';
import test from 'node:test';

const userSupport = await import('../smoke/t17-test-users.mjs').catch(() => ({}));

test('keeps a registered user available for cleanup when grant setup fails', async () => {
  assert.equal(typeof userSupport.registerAndLoginT17User, 'function');
  const userId = '11111111-1111-4111-8111-111111111111';
  const cleanupUserIds = new Set();

  await assert.rejects(userSupport.registerAndLoginT17User({
    cleanupUserIds,
    register: async () => ({ status: 201, value: { user: { id: userId } } }),
    grant: async () => { throw new Error('grant setup failed'); },
    login: async () => assert.fail('login must not run after grant setup fails'),
  }), /grant setup failed/u);

  assert.deepEqual([...cleanupUserIds], [userId]);
});

test('revokes grants and disables every tracked smoke user', async () => {
  assert.equal(typeof userSupport.cleanupT17TestUsers, 'function');
  const userId = '22222222-2222-4222-8222-222222222222';
  const calls = [];

  await userSupport.cleanupT17TestUsers({
    query: async (sql, values) => calls.push([sql, values]),
  }, new Set([userId]));

  assert.equal(calls.length, 2);
  assert.match(calls[0][0], /UPDATE role_grant SET revoked_at=now\(\)/u);
  assert.deepEqual(calls[0][1], [userId]);
  assert.match(calls[1][0], /UPDATE app_user SET status='DISABLED',authz_version=authz_version\+1/u);
  assert.deepEqual(calls[1][1], [userId]);
});
