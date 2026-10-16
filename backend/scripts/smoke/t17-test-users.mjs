import assert from 'node:assert/strict';

export async function registerAndLoginT17User({ cleanupUserIds, register, grant, login }) {
  const registration = await register();
  assert.equal(registration.status, 201, JSON.stringify(registration.value));
  const id = registration.value?.user?.id;
  assert.equal(typeof id, 'string', 'registration response must include the user id');
  cleanupUserIds.add(id);

  await grant(id);
  const result = await login();
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal(typeof result.value?.access_token, 'string', 'login response must include an access token');
  return { id, token: result.value.access_token };
}

export async function cleanupT17TestUsers(identityDb, userIds) {
  for (const userId of userIds) {
    await identityDb.query(
      "UPDATE session_family SET revoked_at=now(),revoke_reason='LOGOUT' WHERE user_id=$1 AND revoked_at IS NULL", [userId],
    );
    await identityDb.query(
      'UPDATE role_grant SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId],
    );
    await identityDb.query(
      "UPDATE app_user SET status='DISABLED',authz_version=authz_version+1 WHERE id=$1", [userId],
    );
  }
}
