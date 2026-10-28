# 00 — Backend setup, conventions and rules for implementing agents

Read first: `/AGENTS.md`, [project context](../c48-project-context.md), the [plan](../c48-technology-and-delivery-plan.md) (Sections 8, 22, 23, 25, 26 are binding), then this folder in numeric order. **Where this folder and the plan's Mermaid ERDs differ on columns, this folder wins** (see [01](01-schema-review.md)). Where they differ on business rules, the plan wins — stop and report the conflict instead of choosing silently.

## 1. Repository layout (create only what the current task needs)

```text
backend/
  apps/identity/  apps/response/  apps/logistics/      # each: main.ts, app.module.ts, config/, database/{data-source.ts,migrations/}, modules/<capability>/
  packages/technical/                                   # secret hashing, error envelope, idempotency helper, VN message-catalog loader. No business rules.
infra/{compose.yaml,nginx/,db-init/} scripts/{db,dev,build,smoke,proofs,__tests__}/
```

Module names: Identity `auth sessions grants users orgs`; Response `requests tracking verification teams missions campaigns evidence notices`; Logistics `catalog drives receipts stock needs commitments distributions reports`. One `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/` per module. Controllers contain no SQL or state logic.

## 1.1 Top-level workspace layout (Web, Mobile, AI and contracts have a fixed place)

```text
/                         # repository root
  AGENTS.md  docs/        # plan, backend pack, research, diagrams (already present)
  backend/                # section 1 above: three NestJS services, infra, scripts, seed wiring
  contracts/openapi/      # exported openapi.json per service, committed after every backend task (06 "Parallel work")
  web/                    # React + Vite (Admin, Coordinator, Manager, public SOS/donation pages) — frontend owner
  mobile/                 # React Native + Expo (Citizen, Volunteer/team leader, donor) — mobile owner
```

- **Web and Mobile** consume only `contracts/openapi/*.json` and the public `/api/v1/...` routes through Nginx; they never import backend code. Mock servers are generated from the OpenAPI files until a service is live. Each has its own package manager workspace, lint/format config and Vietnamese string resources (backend messages are never shown as UI copy; clients branch on `code` and render their own Vietnamese text — AGENTS.md language policy). Compose builds Web as a separate static Nginx image and serves it through the same public Nginx ingress as `/`; `/api/v1/...` remains routed to the APIs.
- **AI is not a separate service or runtime.** Plan §12 and `AGENTS.md` keep it inside Response (`backend/apps/response/src/ai`, same NestJS runtime, no Python). The Response worker always polls for advisory jobs; it calls Gemini when `GEMINI_API_KEY` is configured and marks jobs skipped without a key. Its schema-constrained advice requires coordinator review and cannot set official priority or dispatch. Research notes stay in `docs/`.
- **Ownership** (plan §26.9): backend owner builds `backend/` and `contracts/`; Web and Mobile owners build `web/` and `mobile/` and may only change contracts through the documented edit to `02–04` first.
- A `web/` or `mobile/` folder is created only by the task that needs it (plan §22.1 "create only what the current slice needs"); until then the placement above is the contract.

## 2. Pinned decisions and the spike that must precede code

Node 24 LTS, NestJS (Express adapter), TypeScript strict, TypeORM + PostgreSQL 17+ with PostGIS 3.5+ (image digest pinned), Jest + Supertest, `@nestjs/swagger`, Passport-JWT, AWS SDK v3 S3 client, class-validator DTOs. **Task T0** (one day): prove on the pinned image — geometry/geography migration, `ST_DWithin`, `SELECT … FOR UPDATE` with deterministic order, partial/expression unique indexes from `schema/*.sql` through TypeORM migrations, two parallel transactions racing the capacity-one index. Record exact versions in `docs/backend/VERSIONS.md`; never use `latest`. If TypeORM cannot express an index, write it as raw SQL inside the migration — the SQL files are the existing baseline; target deltas in01 §7/plan §27 must be applied at T0-S first.

## 3. API conventions (all three services)

| Topic | Rule |
|---|---|
| Base path | `/api/v1/identity`, `/api/v1/response`, `/api/v1/logistics`. Internal routes under `/internal/` are never exposed by Nginx (404). |
| Ids / time / numbers | uuid; ISO-8601 UTC (`2026-10-07T08:30:00Z`); quantities and coordinates-accuracy as **decimal strings** for quantities (`"12.500"`), numbers for lat/lng. GeoJSON order `[lng, lat]`; `lat ∈ [-90,90]`, `lng ∈ [-180,180]`. |
| Auth (staff/citizen) | Web: HttpOnly cookies + `X-CSRF-Token` + allowed `Origin` on every state change. Native: `Authorization: Bearer <access>`. Identity introspection on every protected request (plan §10.3). |
| Guest credentials | `X-Tracking-Secret: <secret>` (SOS) and `X-Donation-Secret: <secret>` (donation); `Authorization` carries only a native Bearer token (plan §28.2 item 3 withdrew the `C48-Tracking`/`C48-Donation` schemes). 32 random bytes, base64url, client generated. Never in URL, query, log or Referer. Secrets are purpose-bound (`sos-tracking`, `donation-capability`); a secret of one purpose never validates for another. |
| Idempotency | Header `Idempotency-Key: <uuid>` (format checked, `IDEMPOTENCY_KEY_INVALID`) is **required on every non-GET request except** `auth/login`, `auth/refresh`, `auth/logout`, `auth/csrf`, `notices/{id}/read` and the `/internal/` calls keyed by `intent_id`. **Implementation (the order matters, proven by a parallel-session test):** the *first statement* of the command's own transaction is `INSERT INTO idempotency_record … ON CONFLICT DO NOTHING`; a concurrent duplicate blocks on the primary key until the first commits, then replays the stored result (there is no "in progress" state to poll). If the wait exceeds `lock_timeout` the duplicate gets `503 LOCK_TIMEOUT` and retries. Same key + same canonical payload (+ same secret hash for guests) → original status/body + `Idempotent-Replay: true`; different payload/secret → `409 IDEMPOTENCY_KEY_REUSED`. Store only `response_status` + `resource_ref` (type + id) and re-read the resource on replay (no body, no PII, never a recovery plaintext; plan §28.2 item 6). Do **not** create a row for requests rejected by validation, throttling or auth. Retention: guests 24 h, staff 7 days, deleted in batches of 5,000 (`statement_timeout` 30 s); daily-partition the table (drop partitions) once it exceeds ~1 M rows/day. Cross-service validation calls happen **before** the transaction opens, so the key is claimed only when the real work starts. |
| Optimistic locking | Commands on versioned aggregates carry `expected_version` in the body and are written as `UPDATE … SET version = version + 1 WHERE id = $1 AND version = $2 RETURNING …` — **0 rows ⇒ `409 VERSION_CONFLICT`** (never `repository.save()`, which does not enforce it). Mutating a versioned row without `expected_version` is a contract error. Material automated mutations (including progress recompute) increment version; no-op/notice-only work does not. Parent-locked append commands declare their version behavior explicitly. No generic status PATCH. |
| Pagination | **Every** collection GET is paginated, including nested collections. Keyset only: `?limit=50&cursor=<opaque>`, `limit` ≤ 100. Cursor = base64url(JSON `{ sort: [<sort values>], id, filter_hash }`); the order is **always `(sort_key, id)`** and the query uses a row comparison `(sort_key, id) > ($1, $2)`, so every list index must end in `id` (verified in 01 §3). A cursor whose `filter_hash` differs → `400 CURSOR_INVALID`. Sort keys must be NOT NULL (`created_at`, `received_at`; never a nullable column such as `closes_at`). Scope filters apply **before** pagination. No total counts, no OFFSET. Nested arrays are capped and flagged `{ items: [...], more: true }` with a sub-resource endpoint for the rest (timeline 50, duplicates 20, contributions 20, disputes 20, evidence 5). Reports, reconciliation and the heatmap require a scope filter and a bounded window (reports ≤ 366 days, heatmap ≤ 31 days) else `400 VALIDATION_FAILED`. |
| Filtering | Whitelisted query parameters only; unknown parameter → `400 VALIDATION_FAILED`. |
| Correlation | `X-Correlation-Id` accepted/generated, echoed in responses and error bodies, propagated on cross-service calls. |
| Language | Every human-readable message is Vietnamese regardless of `Accept-Language`. Machine fields (`code`, enums, field names) stay English. Clients branch on `code`. |
| Caching | Authenticated, tracking and donation responses: `Cache-Control: no-store`. |
| Cross-service calls | Service JWT (client credentials), 2 s timeout, no open DB transaction, same idempotency key forwarded. Outage → `503` with the specific unavailable code below; never fake success. |

**Error envelope** (all errors):

```json
{ "code": "VERSION_CONFLICT", "message": "Dữ liệu đã được cập nhật. Vui lòng tải lại trước khi tiếp tục.",
  "field_errors": { "people_affected": ["PEOPLE_AFFECTED_OUT_OF_RANGE"] },
  "details": { "current_version": 7 }, "correlation_id": "uuid" }
```

`field_errors` values are stable codes; the Vietnamese text per code lives in the catalog (Identity/Response/Logistics each own theirs; the shared loader is technical only).

### Shared error codes

| HTTP | code | Vietnamese message |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại các trường được đánh dấu. |
| 401 | `UNAUTHENTICATED` | Bạn cần đăng nhập để thực hiện thao tác này. |
| 401 | `SESSION_EXPIRED` | Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại. |
| 403 | `FORBIDDEN` | Bạn không có quyền thực hiện thao tác này. |
| 403 | `CSRF_INVALID` | Yêu cầu không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang. |
| 404 | `NOT_FOUND` | Không tìm thấy dữ liệu yêu cầu. (also used instead of 403 when existence must not leak) |
| 409 | `VERSION_CONFLICT` | Dữ liệu đã được cập nhật. Vui lòng tải lại trước khi tiếp tục. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Mã yêu cầu đã được dùng cho nội dung khác. |
| 409 | `STATE_TRANSITION_INVALID` | Trạng thái hiện tại không cho phép thao tác này. |
| 400/411 | `CURSOR_INVALID`, `IDEMPOTENCY_KEY_INVALID`, `TOO_MANY_LINES`, `LENGTH_REQUIRED` | see [07-error-catalog.md](07-error-catalog.md) — the catalog is the single source of every code and its Vietnamese message |
| 413 | `PAYLOAD_TOO_LARGE` | Tệp hoặc nội dung vượt quá giới hạn cho phép. |
| 415 | `UNSUPPORTED_MEDIA` | Định dạng tệp không được hỗ trợ. |
| 429 | `RATE_LIMITED` | Bạn thao tác quá nhanh. Vui lòng thử lại sau. (SOS hard ceiling: add "Nếu đang nguy hiểm, hãy gọi 113/114/115.") |
| 500 | `INTERNAL_ERROR` | Hệ thống gặp lỗi. Vui lòng thử lại sau. |
| 503 | `IDENTITY_UNAVAILABLE` | Dịch vụ tài khoản tạm thời không khả dụng. Vui lòng thử lại. |
| 503 | `RESPONSE_UNAVAILABLE` / `LOGISTICS_UNAVAILABLE` | Dịch vụ … tạm thời không khả dụng. Vui lòng thử lại. |
| 503 | `LOCK_TIMEOUT` | Hệ thống đang bận xử lý dữ liệu này. Vui lòng thử lại. (retryable, safe with the same key) |

## 3.1 Concurrency rules (all commands) — added after the 4-agent review

1. **Lock order, always sorted by id within a level:** `app_user` → `campaign` → `request` → `rescue_team` → `team_member` → `mission`; Logistics: `distribution` → `fulfillment_cycle` → `relief_need` → `commitment` → `stock_balance` (by `(warehouse_id, item_id)`). Pre-read parent ids without locking (they are immutable), then lock in this order.
2. **Lock modes matter (READ COMMITTED does not protect a read that is followed by a write to another row):** attach/offer/create-with-campaign take `campaign … FOR SHARE`; pause/close take `FOR UPDATE`. Offer takes `rescue_team … FOR SHARE`; availability change, membership change, leader transfer and accept take `FOR UPDATE`. **Every mission command locks the request row `FOR UPDATE`**, even if the recompute changes nothing (otherwise it escapes the RESOLVING barrier). Leader transfer demotes the old leader *before* promoting the new one (the partial unique index is not deferrable). Re-joining a team reactivates the existing `team_member` row.
3. **Logistics SUM checks are only safe under the right parent lock:** need/commitment totals under `relief_need … FOR UPDATE`; handoff arithmetic and dispatch under `distribution … FOR UPDATE` (handoffs carry no `expected_version`, so the lock is mandatory); also maintained as `distribution_line` counters with CHECKs.
4. **Stock changes only by inserting a `stock_movement`**; the trigger updates `stock_balance`. Lock balances first, in `(warehouse_id, item_id)` order; **pre-insert missing balances** (`INSERT … ON CONFLICT DO NOTHING`, sorted) before any update — two receipts posting items (A,B) and (B,A) otherwise deadlock on balance creation (reproduced). Never write absolute values computed from a SELECT. At most 50 lines per command (`TOO_MANY_LINES`).
5. **Approval-style commands lock their own row first:** stock-adjustment review = `SELECT stock_adjustment … FOR UPDATE`, check `PENDING`, `operation_ref = 'ADJ:' || adjustment_id` (never derived from the idempotency key; the DB also allows one movement per adjustment); receipt post/count/release-held lock `donation_receipt`, counts compute revision=current+1; release-held reads already independently approved revision without creating one; `UNIQUE` violations map to `STALE_REVISION`.
6. **Resolution intents:** Response commits a PENDING intent and the request's RESOLVING barrier before calling Logistics; every cross-service call stays outside both services' database transactions. The finalizer transaction's first business statement is `UPDATE resolution_intent SET state='COMPLETED' WHERE id=$1 AND state='PENDING'` (one row or stop); cancellation mission/team/request work follows that CAS. Abort first changes PENDING→ABORTING, then calls Logistics `unseal` for that exact intent, then the local abort transaction's first business statement CASes ABORTING→ABORTED before restoring request progress. Recovery re-drives PENDING and ABORTING with the same intent id every 30 s under a PostgreSQL advisory lock; it never re-drives ABORTED. Skip Logistics freeze/seal/unseal when `logistics_admitted_at IS NULL`. Logistics `seal`/`freeze` first confirm through `GET /internal/operations/{id}` that the exact intent is still PENDING and matches request/cycle/kind; seal also binds the stored `outcome_basis`. `unseal` requires that exact intent to be ABORTING and the request not RESOLVED/CLOSED, and a live `cycle_intent` row must bind that id (there is no `intent_id`/`seal_id` column on `fulfillment_cycle`). Under the cycle lock, every seal/freeze/unseal checks durable local `cycle_intent` state; ABORTED is retained even for an empty/missing cycle and rejects late commands already remote-prevalidated. `freeze` upserts the cycle so a delayed `POST /needs` on a cancelled request finds FROZEN rather than creating OPEN.
7. **Revoke-all vs refresh rotation (Identity):** every revoke-all first does `UPDATE app_user SET authz_version = authz_version + 1` (row lock), then revokes families; rotation takes `app_user … FOR SHARE`, requires `status='ACTIVE'` and `authz_version` = the family's, then rotates. Two parallel refreshes (two tabs) are **not** reuse: a token rotated < 10 s ago returns `409 REFRESH_RACE` (client retries with its newest token); older reuse revokes the family.
8. **Central SQLSTATE mapping:** `23505` unique → the command's specific conflict code, `23514` check → a `409` domain code (e.g. `INSUFFICIENT_STOCK`), `40P01` deadlock / `55P03` lock timeout → bounded retry (≤ 2, jittered) then `503 LOCK_TIMEOUT`. A raw 500 for any of these is a bug. Use savepoints / `ON CONFLICT` instead of retrying inside an aborted transaction (tracking-code collision).
9. **Check-then-insert caps** (SOS soft throttle, `PROXY_OPEN_CAP`, `PROXY_DAILY_SOFT_LIMIT`) may overshoot under parallel requests; accepted as soft limits. Do not add locks for them or reject/drop an SOS.
10. **Time and cursors:** `now()` is the transaction *start* time, so a long transaction can commit a row "in the past" of a cursor already served. Ledger/audit/notice lists accept this (readers see a consistent `generated_at`); anything that must be exact (reconciliation) uses SUM, not a cursor.

## 3.2 Background jobs, pools, timeouts

- **Jobs** (recovery 30 s, overdue scans, evidence reconciler, drive/campaign sync 5 min, idempotency/session/notice cleanup): each run first takes `pg_try_advisory_xact_lock(hashtext('<job>'))` (skip if not acquired) and claims rows with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 100`; ±20 % jitter; batches ≤ 500 (cleanup deletes 5,000 at a time); every job is idempotent; notice inserts use `ON CONFLICT DO NOTHING`; material job mutations bump aggregate version; no-op scans/notices do not. `SCHEDULER_ENABLED=true` on exactly one replica in the demo Compose. The evidence reconciler and an uploader race on `UPDATE … WHERE state='PENDING' RETURNING` — the reconciler deletes the object only if it won. Mass operations (campaign close cancelling many requests) run with concurrency ≤ 5.
- **Pools (per replica):** Identity 20, Response 30, Logistics 20; PostgreSQL `max_connections ≥ Σ(pool × replicas) + 20`; introspection uses its **own** small pool. `idle_in_transaction_session_timeout = 10 s`. Statement timeouts: default 8 s; introspection 500 ms; heatmap/reports 15 s via `SET LOCAL`; cleanup 30 s. `lock_timeout` 3 s.
- **HTTP:** server `requestTimeout` 15 s, except Response uses 90 s for ≤50 MiB evidence uploads; `headersTimeout` 10 s, `keepAliveTimeout` 65 s (above the Nginx upstream keep-alive); Nginx `client_max_body_size` 1 MiB for JSON routes, 55 MiB only on `…/evidence`; S3 connect 3 s / socket 30 s; cross-service client: keep-alive agent (`maxSockets` ≥ 50), 2 s timeout, **circuit breaker** per callee (5 failures in 10 s ⇒ fail fast with the specific `*_UNAVAILABLE` for 5 s), `Retry-After` on 503.
- **Dependency rule — no synchronous cycles:** Identity never calls Response in a request path (grant creation records the campaign id and Response validates the campaign when it evaluates the grant; a cached `GET /internal/campaigns/{id}` with 60 s TTL is allowed). Logistics may call Response; Response may call Logistics only for seal/freeze/fulfillment reads; both call Identity only for introspection/lookup.
- **Introspection (plan §10.3 keeps "no positive cache"):** identical concurrent lookups for the same `sid` are coalesced (single-flight, lives only for the in-flight call, so revocation latency is unchanged); a failing callee trips the breaker. A short positive cache (≤ 5 s, keyed by `(sid, authz_version)`, negative 30 s) is **not** enabled; add it only if the k6 run shows Identity as the bottleneck, and then amend plan §10.3/R-09 and the revocation SLA together.

## 3.3 Abuse, uploads, secrets (additions)

- **SOS flood:** the Response service counts per-IP `source_ip_hash` and per-phone `request_phone_idx` over the last minute; a breach stores the SOS in `RATE_LIMITED_REVIEW`. Nginx `limit_req_zone` enforces the higher hard per-IP ceiling (default 10× the soft threshold) with a Vietnamese `SOS_RATE_CEILING` response. The **global** ceiling `SOS_GLOBAL_PER_MIN` (default 300) also stores reports for review; once T5 lands, reviewed-lane requests get no evidence/supplement endpoints. `GET /requests` defaults to `review_lane=NORMAL`; the review lane is its own view, so spam cannot bury normal reports.
- **Tracking lookups:** credential and code travel in headers (`X-Tracking-Secret`, `X-Tracking-Code`), never the query string; Nginx logs omit `$args` and both headers; lookup by `tracking_secret_hash` (unique index), then compare the code in constant time — never branch on "code exists"; `tracking_code` ≥ 40 bits (Crockford base32); `track` limited to 10/min and 60/h per IP.
- **Login:** dummy-hash path for unknown **and disabled** users; Argon2id concurrency capped (semaphore ≈ cores/2) and a global login budget so a flood cannot become a CPU DoS.
- **Uploads:** require `Content-Length` (`411 LENGTH_REQUIRED`); a streaming byte counter aborts at the declared size; guests: ≤ 2 concurrent uploads and 200 MiB/h per IP, `client_body_timeout 30s`; a global semaphore of 20 concurrent uploads per replica (`429` + `Retry-After`); sniff only the first 4 KiB; the guest byte budget counts declared bytes for accepted media uploads, including failed object-store writes, using the purpose-bound `evidence_metadata.upload_source_ip_hash`; invalid media rejected during local staging is not charged, and raw IPs are never stored. `shortcut:` MP4 checks the container signature only; add the plan's bounded `ffprobe` codec validation before production video uploads.
- **Mass assignment:** DTOs use `whitelist` + `forbidNonWhitelisted`; `organization_id`, `reporter_user_id`, `status`, `priority`, `version`, `region_code` are never accepted from a create body (server-set); fields naming another organization/user (e.g. `POST /teams`) are checked against the caller's scope.
- **CSRF on `POST /requests`:** a request carrying cookies needs the CSRF token (otherwise a hostile site could file an SOS linked to a victim's account); guests send no cookies.
- **Logs and responses:** pino redaction from T1: `authorization`, `cookie`, `x-tracking-code`, `x-tracking-secret`, `x-donation-secret`, `x-recovery-code`, `*.phone`, `*.location`, `*password*`, `*secret*`, `token`; list rows mask phones (`09******45`), full number only in detail views; global `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on authenticated/tracking responses; hash peppers are versioned (`v1:` prefix) — rotation re-binds on next use, existing hashes stay valid for their own version; Identity receives `JWT_PRIVATE_KEY` and verifier-side secrets for all service clients; Response and Logistics receive only `JWT_PUBLIC_KEY` and their own `RESPONSE_SERVICE_CLIENT_ID/SECRET` or `LOGISTICS_SERVICE_CLIENT_ID/SECRET`; admin-chosen temporary passwords are redacted from logs (or generated server-side and shown once).
- **Health:** `GET /health/live` and `/health/ready` per service (no dependency detail, unauthenticated, not routed publicly).

## 4. Environment variables (per service; validate at boot; none committed)

`NODE_ENV, PORT, DATABASE_URL (own role, own database), DB_POOL_MAX, DB_LOCK_TIMEOUT_MS=3000, DB_STATEMENT_TIMEOUT_MS=8000, JWT_ISSUER, JWT_AUDIENCE, JWT_PUBLIC_KEY (Response/Logistics) / JWT_PRIVATE_KEY (Identity), WEB_ALLOWED_ORIGINS, SECRET_HASH_PEPPER_AUTH_V1 and SECRET_HASH_PEPPER_AUTH_CURRENT, ARGON2_MEMORY_KIB, ARGON2_TIME_COST, ARGON2_PARALLELISM, ARGON2_MAX_CONCURRENCY, IDENTITY_SERVICE_CLIENT_ID/SECRET, RESPONSE_SERVICE_CLIENT_ID/SECRET, LOGISTICS_SERVICE_CLIENT_ID/SECRET, IDENTITY_BASE_URL, RESPONSE_BASE_URL, LOGISTICS_BASE_URL, S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, SECRET_HASH_PEPPER_SOS / _DONATION, DEMO_INTAKE_ORGANIZATION_ID, SOS_SOFT_LIMIT_PER_IP and SOS_HARD_LIMIT_PER_IP (Nginx zones), PROXY_OPEN_CAP=3, PROXY_DAILY_SOFT_LIMIT=10, VERIFY_OVERDUE_MINUTES=15, OFFER_OVERDUE_MINUTES=10, TEAM_POSITION_FRESH_MINUTES=30, TEAM_SEARCH_RADIUS_M=10000, TEAM_BAND_TOLERANCE_M=2000, TEAM_BAND_TOLERANCE_P2_M=500, TEAM_BAND_TOLERANCE_P1_M=0, SIGNED_URL_TTL_S=60, SOS_GLOBAL_PER_MIN=300, SCHEDULER_ENABLED, INTROSPECT_TIMEOUT_MS=500`; `DB_POOL_MAX` defaults 20 / 30 / 20 (Identity / Response / Logistics). `PROXY_DAILY_SOFT_LIMIT` is a rolling 24-hour review threshold, not a rejection rule. `S3_PUBLIC_ENDPOINT` is the external Nginx base URL used only for signed links (local default `http://localhost:8080`); configure it to the host reachable by clients on a real deployment. Compose uses the host `.env` only for interpolation and passes an allow-listed environment to each container; `npm run check:compose-env` verifies those lists using `.env.example`. `gen-keys` creates the initial Identity auth pepper; retain old versioned pepper variables during key rotation until old sessions are retired. Production requires HTTPS Web origins and a 3072-bit RSA private key. Argon2 settings default to 64 MiB, time cost 3, parallelism 1, and a concurrency cap of about half the available cores. Provide `.env.example`, never real values.

Email OTP registration additionally needs a random server-only `EMAIL_OTP_PEPPER` and `IDENTITY_EMAIL_SMTP_HOST`, `IDENTITY_EMAIL_SMTP_PORT`, `IDENTITY_EMAIL_SMTP_SECURE`, `IDENTITY_EMAIL_SMTP_USER`, `IDENTITY_EMAIL_SMTP_PASSWORD`, and `IDENTITY_EMAIL_FROM`. Google Identity login verifies ID tokens for the comma-separated server allow-list `GOOGLE_CLIENT_IDS`. For Compose builds, set the Web client ID as `VITE_GOOGLE_CLIENT_ID` in `backend/.env`; it is passed as a public build argument to the Web image. Direct Vite development can use `frontend/web/.env.local`. Set Android and iOS client IDs in `mobile/.env`. Client IDs are public identifiers. Never place the Gemini key, OAuth client secret, SMTP password, JWT private key or peppers in a client environment file. Optional Response advisory extraction uses server-only `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash-lite`; incident narratives are sent after masking obvious direct identifiers. Transient Gemini failures stay queued with exponential backoff, and each call counts toward PostgreSQL's local maximum of 500 provider calls per `America/Los_Angeles` date, independent of Google’s project quota.

Build the static Web image from `backend/` with `docker compose --env-file .env -f infra/compose.yaml build web`. Compose serves Web at `http://localhost:8080/` through the existing Nginx ingress; browser API requests use the same origin and `/api/v1/...` paths. The Web container has no published host port. `VITE_GOOGLE_CLIENT_ID` and optional `VITE_GOOGLE_MAPS_API_KEY` are public build-time settings, not server secrets.

## 5. Testing rules

- Unit: state machines, permission predicates, quantity arithmetic, DTO mapping (Jest).
- Database: **real PostgreSQL/PostGIS** in the primary Reliva stack; run `docs/backend/schema/test-*.sql` against its migrated databases and add race checks with two parallel connections for every lock/unique-index claim. There is no separate test database or Compose stack. Any primary-volume reset requires the explicit `--reset` flag and must not be run against demo data.
- API: Supertest role × endpoint × scope matrix from [05](05-permissions.md); every command endpoint: success, validation, 401, 403, 404-not-leaking, 409 version, idempotent replay.
- Vietnamese: every error code has a catalog entry; a test fails if any response `message` contains no Vietnamese diacritic-capable text or is an English framework default (class-validator, Nest, Postgres, S3 strings must never leak).
- Record commands and results actually run; never mark a TC passed from a documentation edit.

## 6. Definition of Done (per task)

1. Migration up/down applied on a clean database; schema matches `schema/*.sql` (diff the dump).
2. OpenAPI generated and equals the contract in 02–04 (paths, DTO fields, status codes, error codes).
3. Permission checks enforced in the service layer **and** list queries filtered by scope before pagination.
4. Idempotency + `expected_version` behaviour tested.
5. Audit/timeline/notice written in the same local transaction as the change.
6. Vietnamese messages for every new code; no PII/secret in logs.
7. Linked FR/TC IDs listed in the PR; traceability row updated; planned-vs-executed tests reported honestly.
8. No cross-service table access; cross-service calls outside transactions.

## 7. Working rules for an AI agent

- Implement one task of [06](06-implementation-tasks.md) at a time; stop at its exit evidence.
- Do not add tables, columns, endpoints, dependencies or services that are not in this folder; propose them as a written change first (update 01 or the relevant contract), then implement.
- Never introduce: Python, Kafka/Redis/queues, a payments or cart concept, automatic triage/dispatch, AI-driven verification, background location tracking.
- Synthetic data only. Never include secrets in commits. Commit messages: conventional (`feat(response): …`), one task per commit/PR.
- Leave a handoff (plan Appendix A.6) before the context ends.

## Logic-review integration — 2026-10-09

Plan §27 and01 §7 supply the target deltas; earlier benchmark/assertion reports do not prove these new rules. T0-S verifies/pins PostgreSQL/PostGIS first and aligns DDL/assertions before T0. Every target column names writer, reader/integrity use, null/default and PII treatment; every index names exact query/constraint, overlap and measured plan. Check app privileges and races on actual restricted credentials/connections. No application code or SQL is changed in this documentation review.

Stock balance writer uses SECURITY DEFINER with dedicated NOLOGIN owner, fixed trusted search_path and qualified references; app cannot own/replace it, directly alter balances or mutate/truncate ledger. Controlled zero-balance creation/movement insertion remains usable under app-role privileges. Validate exact decimal lexical scale before numeric(18,3) casting, plus finite stored values. Native dual authentication keeps Bearer in Authorization and capability in X-Tracking-Secret/X-Donation-Secret; X-Recovery-Code is separate. Redact all of these headers. Recovery issuance alone replays metadata without plaintext; other replay preserves original body/status, including202.

## 8. Docker and infrastructure specification (T0 builds exactly this; no application code in this section)

One host, one Compose project `c48`. PostgreSQL, API, Nginx, and MinIO console ports bind only to loopback; Nginx is the public API entry point. Names below are the current service names; the images, ports and volumes are recorded in `VERSIONS.md`.

From `backend/`, `docker compose build` builds the application images and `docker compose up --build` builds and starts the core stack. `COMPOSE_FILE=infra/compose.yaml` in `.env` selects the sole Compose file. Application images default to `reliva/<service>:latest`; every service has the explicit container name `reliva-<service>`. The Compose project, database names, network, and persistent volumes retain their existing C48 names. Explicit container names are intended for this single-host stack and prevent scaling a service to multiple replicas.

### 8.1 Services

| Service | Image / build | Internal port | Published | Depends on (healthy) | Purpose |
|---|---|---|---|---|---|
| `postgres` | PostGIS image, **digest pinned** (`postgis/postgis:17-3.5` at 2026-10-10: `sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6`) | 5432 | `127.0.0.1:55432` | — | One server, three primary databases `c48_identity`, `c48_response`, `c48_logistics`; volume `c48_pgdata` |
| `db-init` | same image, one-shot | — | — | postgres | Creates databases, roles, extensions and per-role timeouts (8.2); exits 0 |
| `identity-migrate`, `response-migrate`, `logistics-migrate` | service image, one-shot | — | — | db-init | Run TypeORM migrations as the service migrator role; the migrated schema dump must equal `schema/<svc>.sql` |
| `identity-api`, `response-api`, `logistics-api` | `backend/apps/<svc>/Dockerfile` (multi-stage, non-root, Node 24 LTS pinned patch) | 3001 / 3002 / 3003 | `127.0.0.1:3001` / `:3002` / `:3003` | its migrate job; MinIO is optional for Response and Logistics | NestJS HTTP; `GET /health/live`, `/health/ready` (not routed by Nginx) |
| `minio` | MinIO Community built from source tag `RELEASE.2025-10-15T17-29-55Z` (`infra/minio/Dockerfile`), `storage` profile; no license | 9000 (S3); 9001 console | console: `127.0.0.1:9001`; S3 stays internal | — | Private buckets `c48-response-evidence`, `c48-logistics-evidence`; volume `c48_minio-data` |
| `minio-init` | `mc` one-shot | — | — | minio | Creates the two buckets, one access key per service limited to its bucket, no public policy |
| `nginx` | `nginx:1.30.5` | 80 | `127.0.0.1:${PUBLIC_PORT:-8080}:80` | the three APIs | Routing, rate limits, body limits, header hygiene (8.3) |
| `seed` (profile `seed`) | `reliva/identity-api:latest`, one-shot | — | — | all migrate jobs | Demo data (section 9); refuses `NODE_ENV=production` |

Networks: single bridge `c48-internal`; APIs reach each other by service name (`http://response-api:3002`) for `/internal/` calls. PostgreSQL and published API/console ports bind to host loopback; service-to-service traffic stays on the internal network. Migration jobs wait for PostgreSQL, and APIs wait for their migration jobs; API-to-MinIO dependency is optional when the `storage` profile is off.

### 8.2 Database initialisation (`infra/db-init/`)

- Databases: `c48_identity` (extension `citext`), `c48_response` and `c48_logistics` (extension `postgis`); created by the superuser in `db-init` because PostGIS is not a trusted extension.
- Per service two login roles: `<svc>_migrator` (owns the database objects, used only by migrate jobs) and `<svc>_app_login` (member of the NOLOGIN role defined in the SQL: `c48_identity_app`, `c48_response_app`, `c48_logistics_app`). Logistics additionally keeps the NOLOGIN `c48_logistics_owner` that owns the SECURITY DEFINER stock writer. The application login never owns tables or functions.
- Role defaults (`ALTER ROLE … SET`): `lock_timeout=3s`, `statement_timeout=8s`, `idle_in_transaction_session_timeout=10s` (00 §3.2); introspection pool uses its own role setting `statement_timeout=500ms`.
- `max_connections` ≥ Σ(pools) + 20 (00 §3.2). `shared_buffers` and memory are set for the demo host and recorded.
- Passwords come from `.env` (never committed). `.env.example` lists every variable of §4 plus `POSTGRES_PASSWORD`, `*_MIGRATOR_PASSWORD`, `*_APP_PASSWORD`, `S3_*`, `JWT_*`, `PUBLIC_PORT`, `SEED_PASSWORD`.

### 8.3 Nginx (`infra/nginx/`)

- API and Web upstreams use Docker DNS (`127.0.0.11`, 30-second cache), a shared upstream `zone`, and `server ... resolve` to refresh addresses after container replacement. This syntax requires Nginx 1.27.3 or later; the Compose image is 1.30.5.
- Routes: `/api/v1/identity/` → `identity-api:3001`, `/api/v1/response/` → `response-api:3002`, `/api/v1/logistics/` → `logistics-api:3003`; everything else → static web build when present, else 404. HTTP keep-alive to upstreams (`keepalive 64`).
- `location ~ /internal/ { return 404; }` for every service prefix and for `/health`; `Server` and upstream version headers hidden; caller-supplied `X-Internal-*` and identity headers stripped; `X-Forwarded-For` set by Nginx only.
- Rate limits (00 §3.3): `limit_req_zone` per IPv4 /24 and IPv6 /56 for SOS soft and hard ceilings (hard returns 429 with the 113/114/115 body), login 5/min per IP+username and 30/min per IP, register 3/h per IP, tracking 10/min and 60/h per IP, guest uploads 2 concurrent and 200 MiB/h per IP.
- Body limits: `client_max_body_size 1m` default; `55m` only on `…/evidence` locations; `client_body_timeout 30s`; require `Content-Length` on uploads (`411`).
- Logging: access log format without `$args`, `Authorization`, `Cookie`, `X-Tracking-*`, `X-Donation-Secret`, `X-Recovery-Code`.
- Security headers on all responses: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CSP `default-src 'self'; frame-ancestors 'none'`; `Cache-Control: no-store` is set by the APIs on authenticated, tracking and donation responses.

### 8.4 Commands the repository must provide (`scripts/`)

| Command | Effect |
|---|---|
| `scripts/dev/up` | Starts the main Reliva APIs, PostgreSQL, Nginx, and the optional storage profile; waits for healthy |
| `scripts/db/migrate` | Runs the three declared main-stack migration services |
| `scripts/db/seed` | Runs the declared `seed` job; loads full fixtures when all application tables are empty, otherwise ensures campaign support and campaigns, then adds insert-only Identity, Response, and Logistics expansion fixtures. New demo accounts use the configured `SEED_PASSWORD`; existing records are not updated or reset. |
| `bash scripts/db/reset-demo --reset` | Explicitly removes only the `c48_pgdata` volume, then migrates, seeds, and starts the main stack. Preserves `c48_minio-data` and all MinIO objects. |
| `bash scripts/db/test-db --reset` | Requires explicit `--reset`; resets only `c48_pgdata`, then runs schema, migration, race, auth, and API smoke checks against the primary Reliva databases and APIs. SQL proofs run through the existing PostgreSQL service; HTTP/database smoke scripts run from the host. It resets/reseeds the primary Postgres before API smoke and leaves smoke rows in the primary databases. |
| `scripts/dev/gen-keys` | generates the JWT key pair and service client secrets into `.env`/untracked files |
| `scripts/db/backup`, `scripts/db/restore` | `pg_dump` retaining owners/ACLs for the three databases and `mc mirror` of the buckets through the existing MinIO service’s loopback S3 port (`MINIO_BACKUP_HOST_PORT`, default `59000`). Recovery requires independently provisioned roles and verifies restored application/stock privileges. TC-29 restore execution remains pending: no isolated recovery destination was available, so no restore verification was run (see [T18 evidence](t18-hardening.md)). |

### 8.5 Compose-backed integration checks (`infra/compose.yaml`)
`backend/infra/compose.yaml` is the only Compose file. Integration and smoke checks use the main `c48` project and the existing `postgres`, `identity-api`, `response-api`, `logistics-api`, and `nginx` services. Postgres and API ports bind to loopback (`55432`, `3001`–`3003`; Nginx uses `8080` by default). Host scripts use `C48_*_DATABASE_URL` and `C48_*_BASE_URL` values for the primary databases and APIs. There is no separate integration profile, database, schema, helper container, or API variant. Migration and seed jobs remain declared services in the main stack, and SQL proofs use `docker compose exec postgres` against the primary databases. Only `bash scripts/db/test-db --reset` and `bash scripts/db/reset-demo --reset` may remove `c48_pgdata`; they preserve `c48_minio-data` and all MinIO objects.

## 9. Demo seed data (`docs/backend/seed/`, executed by `scripts/db/seed`)

**Rules.** Synthetic only; Vietnamese labels with diacritics; fake phones `0900000xxx`; no real coordinates of private addresses. Passwords are **not** in the files: the seeder reads `SEED_PASSWORD`, hashes it with the production Argon2id settings and substitutes it for the psql variable `seed_password_hash`; every seeded user has `must_change_password = true`. Ids are fixed (prefix `00000000-0000-4000-8000-`) so the three services reference each other as opaque ids. The seeder checks every public application table in all three databases before writing. It runs the full identity → response → logistics fixtures only when all three databases are empty. Otherwise it transactionally ensures campaign support and campaigns, then runs deterministic, insert-only Identity, Response, and Logistics expansion fragments. New rows are added with conflict-safe inserts and prerequisite checks; the populated path does not update or delete existing records. The seeder runs under the migrator role (not the application role), and full fixture assertions still abort on mismatch.

| File | Content |
|---|---|
| `seed/seed-campaign-support.sql` | Shared idempotent `DEMO_A`/`DEMO_B`/`DEMO_C` regions and coordination/volunteer organization rows used by both seed modes |
| `seed/seed-campaigns.sql` | Shared idempotent `UNKNOWN` incident category, three demo region boundaries, and eight campaign rows with `ACTIVE` and `PAUSED` examples |
| `seed/seed-identity.sql` | Base fixture: three regions, two organizations, 17 demo accounts covering every role, memberships, and grants. Includes the Identity expansion fragment during a full seed. |
| `seed/seed-expansion-identity.sql` | Seven additional synthetic accounts (`ops_seed`, `citizen3`, `coord_seed`, and two volunteer leader/member pairs), memberships, and grants; used by both seed modes. |
| `seed/seed-response.sql` | Base fixture: catalogs, three region boundaries, eight campaigns, eight teams, 13 requests covering each lane and status, missions, notices, and scenario assertions. Includes the Response expansion fragment during a full seed. |
| `seed/seed-expansion-response.sql` | Four additional teams, positions, skills, and 12 synthetic self-reported SOS requests across the three demo regions; used by both seed modes. |
| `seed/seed-logistics.sql` | Base fixture: catalog, two warehouses, relief points, vehicles, stock ledger, donation drives and review states, fulfillment, distributions, and notices. Includes the Logistics expansion fragment before ledger assertions during a full seed. |
| `seed/seed-expansion-logistics.sql` | Four additional catalog items, a Demo C warehouse and open drive, four declared donations, opening stock movements, and a draft campaign distribution; used by both seed modes. |

**Shared ids** (prefix `00000000-0000-4000-8000-`): organizations `…000000000001/2`, campaigns `…0000c1`–`…0000c8`, the aid request `…0000f5` that Logistics links to, and demo users `…000000000101`–`…000000000118`. Seed files are cross-checked so every user id used by Response/Logistics has a matching Identity fixture; the Logistics cycle matches the Response request's organization, campaign, and region. Full-seed assertions verify the 25 requests and 12 teams alongside the stock-ledger invariants.

**Demo scripts the seed must support** (plan §17): guest SOS retry; PROXY report with separate reporter and household locations; verification and priority; nearby-team comparison (fresh vs stale vs accountless teams); heatmap of confirmed requests; donation 60/58/55/3; 12-of-20 then 8; denied cross-scope and self-review attempts.

**Seed acceptance.** After `scripts/db/reset-demo`: the stock ledger sums equal every balance; `commitment_counter_mismatch` and `check_cycle_state_matches_intent()` return no rows; and no mission breaks the capacity-one index. Full lifecycle fixtures load only into empty application tables; expansion fragments can be rerun against populated databases and preserve existing rows. These assertions are the last statements of the full seed files and run in CI against the main Compose stack.
