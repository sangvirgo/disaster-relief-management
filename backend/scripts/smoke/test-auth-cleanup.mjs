export async function cleanupAuthSmokeFixtures({ database, userIds, familyIds, idempotencyRecords }) {
  const trackedUserIds = [...new Set(userIds)];
  const trackedFamilyIds = [...new Set(familyIds)];
  const trackedIdempotencyRecords = [...new Map(idempotencyRecords.map((record) => [
    JSON.stringify([record.scopeKey, record.command, record.key]), record,
  ])).values()];
  const registrationKeys = trackedIdempotencyRecords
    .filter(({ scopeKey, command }) => scopeKey === 'anon:register' && command === 'identity.auth.register')
    .map(({ key }) => key);
  const recordScopes = trackedIdempotencyRecords.map(({ scopeKey }) => scopeKey);
  const recordCommands = trackedIdempotencyRecords.map(({ command }) => command);
  const recordKeys = trackedIdempotencyRecords.map(({ key }) => key);

  await database.query('ROLLBACK');
  await database.query('BEGIN');
  try {
    const registrationResources = await database.query(
      `SELECT resource_id
         FROM idempotency_record
        WHERE scope_key = 'anon:register'
          AND command = 'identity.auth.register'
          AND idempotency_key = ANY($1::uuid[])
          AND resource_type = 'app_user'
          AND resource_id IS NOT NULL`,
      [registrationKeys],
    );
    const cleanupUserIds = [...new Set([
      ...trackedUserIds,
      ...registrationResources.rows.map(({ resource_id }) => resource_id),
    ])];
    const familyRows = await database.query(
      'SELECT id FROM session_family WHERE user_id = ANY($1::uuid[])',
      [cleanupUserIds],
    );
    const cleanupFamilyIds = [...new Set([
      ...trackedFamilyIds,
      ...familyRows.rows.map(({ id }) => id),
    ])];

    await database.query(
      'DELETE FROM refresh_session WHERE family_id = ANY($1::uuid[])',
      [cleanupFamilyIds],
    );
    await database.query(
      'DELETE FROM session_family WHERE id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])',
      [cleanupFamilyIds, cleanupUserIds],
    );
    await database.query(
      'DELETE FROM role_grant WHERE user_id = ANY($1::uuid[])',
      [cleanupUserIds],
    );
    await database.query(
      'DELETE FROM app_user WHERE id = ANY($1::uuid[])',
      [cleanupUserIds],
    );
    await database.query(
      `DELETE FROM idempotency_record AS stored
        USING unnest($1::text[], $2::text[], $3::uuid[]) AS fixture(scope_key, command, idempotency_key)
        WHERE stored.scope_key = fixture.scope_key
          AND stored.command = fixture.command
          AND stored.idempotency_key = fixture.idempotency_key`,
      [recordScopes, recordCommands, recordKeys],
    );

    const verification = await database.query(
      `SELECT
         (SELECT count(*)::int FROM app_user
           WHERE id = ANY($1::uuid[])) AS users,
         (SELECT count(*)::int FROM session_family
           WHERE id = ANY($2::uuid[]) OR user_id = ANY($1::uuid[])) AS session_families,
         (SELECT count(*)::int FROM refresh_session
           WHERE family_id = ANY($2::uuid[])) AS refresh_sessions,
         (SELECT count(*)::int FROM role_grant
           WHERE user_id = ANY($1::uuid[])) AS grants,
         (SELECT count(*)::int
            FROM idempotency_record AS stored
            JOIN unnest($3::text[], $4::text[], $5::uuid[]) AS fixture(scope_key, command, idempotency_key)
              ON stored.scope_key = fixture.scope_key
             AND stored.command = fixture.command
             AND stored.idempotency_key = fixture.idempotency_key) AS idempotency_records`,
      [cleanupUserIds, cleanupFamilyIds, recordScopes, recordCommands, recordKeys],
    );
    const remaining = verification.rows[0];
    if (!remaining) throw new Error('Auth smoke cleanup verification returned no result');

    const leftovers = Object.entries(remaining)
      .filter(([, count]) => Number(count) !== 0)
      .map(([table, count]) => `${table}=${count}`);
    if (leftovers.length) {
      throw new Error(`Auth smoke cleanup left fixture rows: ${leftovers.join(', ')}`);
    }

    await database.query('COMMIT');
  } catch (error) {
    try {
      await database.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Auth smoke fixture cleanup failed and its transaction could not be rolled back',
      );
    }
    throw error;
  }
}
