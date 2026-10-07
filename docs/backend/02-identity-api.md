# 02 — Identity service: API contract

Schema: [schema/identity.sql](schema/identity.sql). Conventions: [00](00-setup.md). Permissions: [05](05-permissions.md). Owns accounts, credentials, organizations, memberships, scoped grants, refresh sessions, region catalog, audit of those. Never stores phones, locations or request data.

## 1. Auth model (implement exactly)

- **Idempotency exceptions:** `register`, `change-password`, `deactivate`, `members/remove` and every other non-GET command require `Idempotency-Key` (00 §3); only login/refresh/logout/csrf are exempt. Versioned admin commands (`disable`, `enable`, `reset-password`, organization/region deactivate) require `expected_version`. DTOs forbid unknown fields (`role*`/`scope*` on register ⇒ 400); `granted_by` is always the caller, self-grant is refused (except the one-time bootstrap seed).
- **Passwords:** Argon2id (maintained library, parameters pinned in config); minimum 10 characters, not equal to username, rejected if in a bundled common-password list; never logged. Login failures return one generic `INVALID_CREDENTIALS` (also for disabled/unknown users) with the same dummy-hash work for unknown **and disabled** users; Argon2id concurrency is capped by a semaphore and a global login budget (00 §3.3). Admin-chosen temporary passwords are redacted from logs.
- **Access token:** asymmetric JWT (EdDSA or RS256, pinned at T0), `iss`, `aud`, `sub`, `sid` (= `session_family.id`, constant across rotations), `iat`, `exp` = +10 min, `jti`. No roles, phones or PII. Services verify signature locally, then call introspection on **every** protected request (no positive cache).
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
| `POST /auth/register` | none, CSRF (Web), throttled | `{ username, password, display_name }` → `201 { user: { id, username, display_name } }`. Always `CITIZEN` only; any `role*`/`scope*` field is ignored → `400` if present. Errors: `USERNAME_TAKEN` 409, `PASSWORD_WEAK` 400 |
| `POST /auth/login` | none, CSRF (Web), throttled | `{ username, password, client_kind: "WEB"\|"NATIVE" }` → Web: `200 { user, session: { expires_at }, must_change_password }` + cookies. Native: `200 { user, access_token, refresh_token, expires_in, must_change_password }`. Errors: `INVALID_CREDENTIALS` 401 |
| `POST /auth/refresh` | refresh cookie / `{ refresh_token }` (native), CSRF (Web) | → same shape as login without `user`. Errors: `SESSION_EXPIRED` 401, `REFRESH_REUSED` 401 (family revoked) |
| `POST /auth/logout` | session, CSRF | `204`; revokes the family, clears cookies |
| `POST /auth/change-password` | session, CSRF | `{ current_password, new_password }` → `204`; revokes all other families; clears `must_change_password`. Errors `INVALID_CREDENTIALS`, `PASSWORD_WEAK` |
| `GET /me` | session | → `200 { id, username, display_name, must_change_password, grants: [ { id, role_code, scope_type, organization_id, region_code, campaign_id } ] }` |
| `GET /regions` | session | → `{ items: [ { code, name, status } ], next_cursor }` (paginated like every list; the catalog is small) |

Throttling (Nginx + app): login 5 / minute per IP+username, 30 / minute per IP; register 3 / hour per IP. Exceeding → `429 RATE_LIMITED`.

## 3. Admin endpoints (`USER_MANAGE` / `GRANT_MANAGE` / `ORG_MANAGE`)

| Method & path | Request → Response | Rules / errors |
|---|---|---|
| `POST /users` (Idem) | `{ username, display_name, temporary_password, organization_id? }` → `201 user` | Creates an account with `must_change_password=true`; optional membership. `USERNAME_TAKEN` |
| `GET /users?query=&status=&cursor=&limit=` | → paged `{ id, username, display_name, status, created_at }`, order `(created_at DESC, id DESC)` | No credential fields. `query` is a case-insensitive **prefix** match on username or display name (served by `app_user_*_prefix_idx`); substring search is deliberately not offered |
| `GET /users/{id}` | → user + memberships + live grants | |
| `POST /users/{id}/disable` / `/enable` (Idem) | `{ expected_version, reason }` → `200 user` | Disable revokes all families. `LAST_ADMIN` 409 if it removes the last active ADMIN |
| `POST /users/{id}/reset-password` (Idem) | `{ expected_version, temporary_password, reason }` → `204` | Revokes all families, sets `must_change_password` |
| `POST /users/{id}/grants` (Idem) | `{ role_code, scope_type, organization_id?, region_code?, campaign_id?, reason }` → `201 grant` | Shape per `scope_shape` CHECK; region validated against catalog; campaign validated via Response `GET /internal/campaigns/{id}` (service token, outside any DB transaction); duplicate live grant → `GRANT_EXISTS` 409; `ADMIN` only with `SYSTEM` scope; self-grant of any role → `FORBIDDEN`. Revokes target's sessions |
| `POST /grants/{id}/revoke` (Idem) | `{ reason }` → `200 grant` | Soft revoke; `LAST_ADMIN` guard |
| `GET /users/{id}/grants?include_revoked=&cursor=` | → paged grants (live first) | |
| `POST /organizations` (Idem) | `{ name, organization_kind }` → `201` | `ORGANIZATION_NAME_TAKEN` |
| `GET /organizations?cursor=` · `POST /organizations/{id}/deactivate` | | Deactivation blocked while ACTIVE grants/memberships exist: `ORGANIZATION_IN_USE` 409 |
| `POST /organizations/{id}/members` (Idem) | `{ user_id }` → `201` · `POST /organizations/{id}/members/{user_id}/remove` → `204` | |
| `POST /regions` (Idem) · `POST /regions/{code}/deactivate` | `{ code, name }` | `SYSTEM`-scope admin |
| `GET /audit-logs?entity_type=&entity_id=&cursor=` | → paged audit rows | `AUDIT_READ`; no password/token/secret ever stored |

Every admin write inserts an `audit_log` row (actor, action, entity, before/after, reason, correlation id) in the same transaction.

## 4. Internal endpoints (Compose network only; Nginx returns 404)

| Method & path | Caller | Purpose |
|---|---|---|
| `POST /internal/token` | Response, Logistics | client-credentials → `{ access_token, expires_in }` (aud-restricted) |
| `POST /internal/introspect` | Response, Logistics | `{ sid, sub }` (from an already signature-verified JWT) → `200 { active, user_id, display_name, status, authz_version, grants: [...] }`; `active=false` if the family is revoked/expired, the user is disabled, or `authz_version` is stale. Two indexed lookups (`session_family` PK + `role_grant_live_uq`), dedicated small pool, `statement_timeout` 500 ms, p95 ≤ 100 ms. Callers coalesce identical concurrent calls and use a circuit breaker (00 §3.2) |
| `POST /internal/users:lookup` | Response, Logistics | `{ ids: [uuid ≤ 100] }` → `{ items: [ { id, display_name } ] }` for showing actor names; unknown ids omitted; only ids already present in the caller's own data (calls are logged by count) |
| `GET /internal/organizations/{id}` | Response, Logistics | existence/kind/status check |

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
