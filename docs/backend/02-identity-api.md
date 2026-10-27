# 02 — Identity service: API contract

Schema: [schema/identity.sql](schema/identity.sql). Conventions: [00](00-setup.md). Permissions: [05](05-permissions.md). Owns accounts, credentials, organizations, memberships, scoped grants, refresh sessions, region catalog, audit of those. Never stores phones, locations or request data.

## 1. Auth model (implement exactly)

- **Idempotency exceptions:** `register`, `change-password`, `deactivate`, `members/remove` and every other non-GET command require `Idempotency-Key` (00 §3); only login/refresh/logout/csrf are exempt. Versioned admin commands (`disable`, `enable`, `reset-password`, organization/region deactivate) require `expected_version`. DTOs forbid unknown fields (`role*`/`scope*` on register ⇒ 400); the granting actor is always the caller (recorded in `audit_log`; `role_grant` has no `granted_by` column), self-grant is refused (except the one-time bootstrap seed).
- **Passwords:** Argon2id (maintained library, parameters pinned in config); minimum 10 characters, not equal to username, rejected if in a bundled common-password list; never logged. Login failures return one generic `INVALID_CREDENTIALS` (also for disabled/unknown users) with the same dummy-hash work for unknown **and disabled** users; Argon2id concurrency is capped by a semaphore and a global login budget (00 §3.3). Admin-chosen temporary passwords are redacted from logs.
- **Access token:** RS256 asymmetric JWT (3072-bit RSA key pair), `iss`, `aud`, `sub`, `sid` (= `session_family.id`, constant across rotations), `iat`, `exp` = +10 min, `jti`. No roles, phones or PII. Services verify signature locally, then call introspection on **every** protected request (no positive cache).
- **Sessions:** one `session_family` row per login (its id is the JWT `sid`; it carries `client_kind`, `authz_version`, `absolute_expires_at`, revocation). `refresh_session` rows are the rotation chain; the unique partial index guarantees **one live token per family**. Refresh token = opaque 32 random bytes, only its SHA-256+pepper hash is stored.
- **Rotation (one transaction):** `SELECT app_user … FOR SHARE` → require `status='ACTIVE'` and `app_user.authz_version = session_family.authz_version` (else revoke family `ROLE_CHANGE`/`DISABLED`) → `SELECT refresh_session … FOR UPDATE` on the presented hash → if `rotated_at IS NULL`: set `rotated_at` **first**, insert the child with the same family, return it. If the presented token has `rotated_at` set: when it was rotated **< 10 s ago** return `409 REFRESH_RACE` (two tabs / a retried request — the client retries with the newest token it holds); older ⇒ **reuse**: revoke the family (`REUSE_DETECTED`) and return `REFRESH_REUSED`. The absolute expiry is never extended.
- **Revoke-all** (disable, admin reset, grant change): first `UPDATE app_user SET authz_version = authz_version + 1` (this row lock serialises against rotation), then `UPDATE session_family SET revoked_at … WHERE user_id = ? AND revoked_at IS NULL`. A rotation that raced it sees the new `authz_version` on its next call and dies. Never revoke by scanning `refresh_session`.
- **Cleanup job:** purge `refresh_session` rows with `rotated_at` older than the 10 s grace window plus the reuse-detection horizon (keep 1 hour), and families past `absolute_expires_at` (batched, advisory-locked).
- **Web transport:** access and refresh in `HttpOnly; Secure; SameSite=Strict` host-only cookies (paths `/api/v1` and `/api/v1/identity/auth`), body returns metadata only; every state change needs `Origin` allow-list + `X-CSRF-Token` (HMAC-bound to a pre-session id; rotated at login). **Native transport:** tokens in JSON; refused if the request carries cookies or a browser `Origin`.
- **Revocation triggers:** logout (that family), disable user, admin password reset, any grant added/revoked for the user (all families). The next protected request fails at introspection (it compares `session_family.authz_version` with the user's).
- **Service tokens:** client-credentials grant, 5-minute JWT, `aud` restricted per receiving service; receiving service checks issuer, audience and allowed caller id.

## 2. Public / session endpoints

| Method & path | Auth | Request → Response |
|---|---|---|
| `GET /auth/csrf` | none (Web) | → `200 { "csrf_token": "…" }` |
| `POST /auth/register` | none, CSRF (Web), throttled | `{ username, password, display_name, email }` → `201 { user, verification: { challenge_id }, email_sent }`. Creates a ten-minute `email_registration` attempt, not an account; `user` is a prospective account preview. Pending attempts reserve neither username nor email. A valid email code atomically creates the `ACTIVE` account with that UUID and its `CITIZEN` grant. Errors: `USERNAME_TAKEN`/`EMAIL_TAKEN` 409, `PASSWORD_WEAK` 400, `EMAIL_OTP_UNAVAILABLE` 503 |
| `POST /auth/email/verify` | none, CSRF (Web), throttled | `{ challenge_id, code }` → `{ verified: true, user }`; code expires after five minutes or the fixed registration deadline, whichever is earlier, and allows five attempts. A successful verification creates the account and grants `CITIZEN` in one transaction; wrong, expired, exhausted, unknown and consumed codes return generic `EMAIL_OTP_INVALID` 400. Uniqueness conflicts at account creation return `USERNAME_TAKEN`/`EMAIL_TAKEN` 409 |
| `POST /auth/email/resend` | none, CSRF (Web), throttled | `{ challenge_id }` → `{ challenge_id, email_sent }`; a 60-second cooldown and three-per-hour IP/email limits apply. Resending rotates the challenge/code, invalidates the previous challenge, and never extends the ten-minute registration deadline. Unknown, expired or confirmed registrations return `{ challenge_id: null, email_sent: false }`. Unavailable delivery leaves only a pending attempt and reports `email_sent: false` |
| `POST /auth/login` | none, CSRF (Web), throttled | `{ username, password, client_kind: "WEB"\|"NATIVE" }` → Web: `200 { user, session: { expires_at }, must_change_password }` + cookies. Native: `200 { user, access_token, refresh_token, expires_in, must_change_password }`. Errors: `INVALID_CREDENTIALS` 401 |
| `POST /auth/google` | none, CSRF (Web), throttled | `{ id_token, client_kind: "WEB"\|"NATIVE", first_time_username? }` → a session in the same transport-specific shape as login. Identity verifies the Google ID token against `GOOGLE_CLIENT_IDS` and uses the stable Google `sub`; it never links an existing account by matching email alone |
| `POST /auth/google/link` | live session, CSRF (Web) | `{ id_token }` → `{ linked: true }`; requires a session created within the last 15 minutes and refuses an identity already linked elsewhere |
| `POST /auth/refresh` | refresh cookie / `{ refresh_token }` (native), CSRF (Web) | → same shape as login without `user`. Errors: `SESSION_EXPIRED` 401, `REFRESH_REUSED` 401 (family revoked) |
| `POST /auth/logout` | session, CSRF | `204`; revokes the family, clears cookies |
| `POST /auth/change-password` | session, CSRF | `{ current_password, new_password }` → `204`; revokes all other families; clears `must_change_password`. Errors `INVALID_CREDENTIALS`, `PASSWORD_WEAK` |
| `GET /me` | session | → `200 { id, username, display_name, must_change_password, grants: [ { id, role_code, scope_type, organization_id, region_code, campaign_id } ] }` |
| `GET /regions` | session | → `{ items: [ { code, name, status } ], next_cursor }` (paginated like every list; the catalog is small) |

A registration idempotency replay returns the same prospective account and the current challenge while the attempt is live, without sending another email. After ten minutes or cleanup, replay returns `410 REGISTRATION_EXPIRED`; register again with a new key. Distinct attempts may use the same username/email until one is verified; only actual accounts reserve identifiers. Passwords are Argon2id hashes, OTPs are purpose-bound hashes, and both hashes are cleared from the attempt on confirmation. No pending attempt can authenticate.

The existing `JobRunner` performs advisory-locked cleanup once per minute when `SCHEDULER_ENABLED=true`, deleting at most 100 expired `email_registration` rows per transaction with `FOR UPDATE SKIP LOCKED`, including confirmed attempts. It never deletes accounts or grants. Deadline checks apply even when the scheduler is disabled. Verification, resend and cleanup lock the same registration row; cleanup skips in-flight verification.

The additive migration retains legacy `email_verification_challenge` history and all old account UUIDs. Unverified `PENDING_EMAIL` placeholders with no session, grant, membership or external identity are anonymized and disabled, releasing their identifiers. Still-live latest challenges move into `email_registration` with the original ten-minute deadline and a new prospective account UUID. Expired placeholders are released without a new attempt. Legacy pending rows with account-bearing relationships remain unchanged for manual review; the migration never changes `ACTIVE` accounts. For the earlier OTP driver-result bug, the migration backfills `CITIZEN` only for an `ACTIVE` email-verified account whose matching legacy challenge was consumed at the exact verification timestamp and which has no grant history at all. Previously revoked grants are never reinstated. Writes to the retained legacy challenge table are revoked from the app role. Automatic down-migration is allowed only while the new registration table is empty and no anonymized legacy placeholders exist. Otherwise it refuses rollback; restoring converted identifiers/credentials requires a reviewed backup.

Throttling (Nginx + app): login 5 / minute per IP+username, 30 / minute per IP; register 3 / hour per IP; email verification 10 / minute per IP with five attempts per challenge; email resend 3 / hour per IP/email plus a per-challenge cooldown. Exceeding → `429 RATE_LIMITED`. Set `EMAIL_OTP_PEPPER` to a random server-only secret and configure `IDENTITY_EMAIL_SMTP_*`/`IDENTITY_EMAIL_FROM` for delivery. `GOOGLE_CLIENT_IDS` is a comma-separated server allow-list of accepted OAuth client IDs. Never put the Gemini or SMTP secret in Web or Mobile environment files.

## 3. Admin endpoints (`USER_MANAGE` / `GRANT_MANAGE` / `ORG_MANAGE`)

| Method & path | Request → Response | Rules / errors |
|---|---|---|
| `POST /users` (Idem) | `{ username, display_name, temporary_password, organization_id? }` → `201 user` | Creates an account with `must_change_password=true`; optional membership. `USERNAME_TAKEN` |
| `GET /users?query=&status=&cursor=&limit=` | → paged `{ id, username, display_name, status, must_change_password, version, created_at }`, order `(created_at DESC, id DESC)` | No credential fields. `query` is a case-insensitive **prefix** match on username or display name (served by `app_user_*_prefix_idx`); substring search is deliberately not offered |
| `GET /users/{id}` | → user + memberships + live grants | |
| `POST /users/{id}/disable` / `/enable` (Idem) | `{ expected_version, reason }` → `200 user` | Disable revokes all families. `LAST_ADMIN` 409 if it removes the last active ADMIN |
| `POST /users/{id}/reset-password` (Idem) | `{ expected_version, temporary_password, reason }` → `204` | Revokes all families, sets `must_change_password` |
| `POST /users/{id}/grants` (Idem) | `{ role_code, scope_type, organization_id?, region_code?, campaign_id?, reason }` → `201 grant` | Shape per `scope_shape` CHECK; region validated against catalog; campaign validated via Response `GET /internal/campaigns/{id}` (service token, outside any DB transaction); duplicate live grant → `GRANT_EXISTS` 409; `ADMIN` only with `SYSTEM` scope; self-grant of any role → `FORBIDDEN`. Revokes target's sessions |
| `POST /grants/{id}/revoke` (Idem) | `{ reason }` → `200 grant` | Soft revoke; `LAST_ADMIN` guard |
| `GET /users/{id}/grants?include_revoked=&cursor=` | → paged grants (live first) | |
| `POST /organizations` (Idem) | `{ name, organization_kind }` → `201` | `ORGANIZATION_NAME_TAKEN` |
| `GET /organizations?cursor=` · `POST /organizations/{id}/deactivate` | | Deactivation blocked while ACTIVE grants/memberships exist: `ORGANIZATION_IN_USE` 409 |
| `POST /organizations/{id}/members` (Idem) | `{ user_id }` → `201` · `POST /organizations/{id}/members/{user_id}/remove` → `204` | Removing a member revokes the member's live grants scoped to this organization and all session families in the same transaction; each grant revocation and membership change is audited. |
| `POST /regions` (Idem) · `POST /regions/{code}/deactivate` | `{ code, name }` | `SYSTEM`-scope admin |
| `GET /audit-logs?entity_type=&entity_id=&cursor=` | → paged audit rows | `entity_type` is required; `AUDIT_READ`; no password/token/secret ever stored |

Every admin write inserts an `audit_log` row (actor, action, entity, before/after, reason, correlation id) in the same transaction.

Campaign-scoped grants call the Response internal campaign lookup before the Identity transaction. The lookup returns campaign status, organization, region, and version; grants fail closed when Response is unavailable.

## 4. Internal endpoints (Compose network only; Nginx returns 404)

| Method & path | Caller | Purpose |
|---|---|---|
| `POST /internal/token` | Response, Logistics | client-credentials → `{ access_token, expires_in }` (aud-restricted) |
| `POST /internal/introspect` | Response, Logistics | `{ sid, sub }` (from an already signature-verified JWT) → `200 { active, user_id, display_name, status, authz_version, grants: [...] }`; `active=false` if the family is revoked/expired, the user is disabled, or `authz_version` is stale. Dedicated pool (max 4), `statement_timeout` 500 ms, p95 ≤ 100 ms. The local 10-VU/15-second smoke measured p95 4.09 ms; callers coalesce identical concurrent calls and use a circuit breaker (00 §3.2) |
| `POST /internal/users:lookup` | Response, Logistics | `{ ids: [uuid ≤ 100] }` → `{ items: [ { id, display_name } ] }`; unknown ids omitted. Disabled and non-volunteer users are included so callers can render historical actor names. Callers must derive IDs from records in their own database and enforce that ownership before calling. Lookup calls are logged by count. |
| `POST /internal/users:check-active` | Response only | `{ user_id }` → `{ active: true }` or `{ active: false, reason: USER_NOT_FOUND\|USER_INACTIVE }`. Checks only whether `app_user` exists and has status `ACTIVE`; returns no Identity fields, memberships, or grants, and explicitly rejects Logistics. Used only to gate team membership. |
| `POST /internal/regions:lookup` | Response only | `{ codes: [1..100 nonblank strings, each ≤ 80 characters] }` → `{ items: [ { code, name } ] }`; unknown codes are omitted. Reads only the Identity region catalog and explicitly rejects Logistics. |
| `POST /internal/team-leader-eligibility` | Response only | `{ user_id, organization_id }` → `{ eligible: true }` or `{ eligible: false, reason }`, where `reason` is `USER_NOT_FOUND`, `USER_INACTIVE`, `MEMBERSHIP_REQUIRED`, or `VOLUNTEER_GRANT_REQUIRED`. Eligibility requires an active account, active membership in the active organization, and a current VOLUNTEER grant scoped to SYSTEM or that same organization. The endpoint returns no user identity fields and explicitly rejects Logistics. |
| `POST /internal/request-coordinators` | Response only | `{ organization_id }` → active users' current COORDINATOR grants plus organization-scoped OPERATIONS_MANAGER grants; used to revalidate a second coordinator at verification and resolve scoped overdue-notice recipients. The route requires a valid Identity service token and explicitly rejects callers other than Response. |
| `GET /internal/organizations/{id}` | Response, Logistics | existence/kind/status check |

All Identity API responses include `Cache-Control: no-store`. Internal lookups authenticate the service caller; cross-service record ownership remains the caller service's responsibility and must be enforced in that service's query and integration tests.

## 5. Identity error codes

| HTTP | code | Vietnamese message |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | Tên đăng nhập hoặc mật khẩu không đúng. |
| 401 | `REFRESH_REUSED` | Phiên đăng nhập không còn an toàn. Vui lòng đăng nhập lại. |
| 400 | `PASSWORD_WEAK` | Mật khẩu chưa đủ mạnh (tối thiểu 10 ký tự, không phổ biến). |
| 409 | `USERNAME_TAKEN` | Tên đăng nhập đã được sử dụng. |
| 409 | `LAST_ADMIN` | Không thể thực hiện vì đây là quản trị viên cuối cùng. |
| 409 | `GRANT_EXISTS` | Quyền này đã được cấp cho người dùng. |
| 409 | `ORGANIZATION_NAME_TAKEN` / `ORGANIZATION_IN_USE` | Tên tổ chức đã tồn tại. / Tổ chức đang được sử dụng. |
| 400 | `SCOPE_INVALID` | Phạm vi quyền không hợp lệ. |
| 409 | `REFRESH_RACE` | Phiên đang được làm mới ở nơi khác. Vui lòng thử lại. |

The authoritative list of all codes and messages is [07-error-catalog.md](07-error-catalog.md).

## 6. Seeds and tests

Seed: regions, one coordinating organization, one ADMIN (password from env at first run, `must_change_password`), demo accounts per role (≥ 2 REVIEWER/INTAKE users so independent review is demonstrable). Tests: TC-BE-01, TC-BE-20, TC-BE-28, TC-L10N-01; add: two parallel refreshes → one child, the loser gets `REFRESH_RACE` and the family stays alive; replay after the grace window revokes the family; disable/reset racing a rotation leaves **no** live token (proven failing without the `authz_version` barrier), grant change revokes sessions, introspection under k6 load, last-admin guard, username case-insensitivity, native vs browser transport separation.
