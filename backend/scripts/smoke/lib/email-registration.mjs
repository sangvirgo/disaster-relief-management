// Registration now needs an email OTP that smoke tests cannot read, so they register through the real API
// and then complete the pending registration directly in the primary Identity database.
export function withEmail(body) {
  return { ...body, email: `${String(body.username).toLowerCase()}@example.test` };
}

export async function activateEmailRegistration(identityDb, registered) {
  const challengeId = registered.value?.verification?.challenge_id;
  if (!challengeId) throw new Error(`registration did not return a challenge: ${JSON.stringify(registered.value)}`);
  const rows = (await identityDb.query('SELECT * FROM email_registration WHERE challenge_id=$1', [challengeId])).rows;
  const row = rows[0];
  if (!row || !row.password_hash) throw new Error('pending email registration not found');
  await identityDb.query(
    `INSERT INTO app_user (id,username,display_name,email,password_hash,status,email_verified_at)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE',now())`,
    [row.id, row.username, row.display_name, row.email, row.password_hash],
  );
  await identityDb.query("INSERT INTO role_grant (user_id,role_code,scope_type) VALUES ($1,'CITIZEN','SYSTEM')", [row.id]);
  await identityDb.query('UPDATE email_registration SET confirmed_at=now(),password_hash=NULL,code_hash=NULL WHERE id=$1', [row.id]);
  return registered;
}
