# 00 — Backend setup, conventions and rules for implementing agents

Read first: `/AGENTS.md`, [project context](../c48-project-context.md), the [plan](../c48-technology-and-delivery-plan.md) (Sections 8, 22, 23, 25, 26 are binding), then this folder in numeric order. **Where this folder and the plan's Mermaid ERDs differ on columns, this folder wins** (see [01](01-schema-review.md)). Where they differ on business rules, the plan wins — stop and report the conflict instead of choosing silently.

## 1. Repository layout (create only what the current task needs)

```text
backend/
  apps/identity/  apps/response/  apps/logistics/      # each: main.ts, app.module.ts, config/, database/{data-source.ts,migrations/}, modules/<capability>/
  packages/technical/                                   # secret hashing, error envelope, idempotency helper, VN message-catalog loader. No business rules.
  infra/{compose.yaml,compose.test.yaml,nginx/,db-init/} scripts/ test/{integration,k6}/
```

Module names: Identity `auth sessions grants users orgs`; Response `requests tracking verification teams missions campaigns evidence notices`; Logistics `catalog drives receipts stock needs commitments distributions reports`. One `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/` per module. Controllers contain no SQL or state logic.

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
6. **Resolution intents:** the finalizer's first statement is `UPDATE resolution_intent SET state='COMPLETED' WHERE id=$1 AND state='PENDING'` (rowcount 1 or stop); abort uses the same lock. Recovery never re-drives an `ABORTED` intent. Logistics `seal`/`freeze` first confirm with Response that the intent is `PENDING` (`GET /internal/operations/{id}`); `unseal` requires a live (non-ABORTED) `cycle_intent` row of the cycle whose `intent_id` equals the presented intent (there is no `intent_id`/`seal_id` column on the cycle); under the cycle lock every seal/freeze/unseal also checks durable local cycle_intent state; ABORTED is retained even for an empty/missing cycle and rejects late commands already remote-prevalidated. `freeze` also upserts the cycle (a delayed `POST /needs` on a cancelled request must find a FROZEN cycle, not create an OPEN one).
7. **Revoke-all vs refresh rotation (Identity):** every revoke-all first does `UPDATE app_user SET authz_version = authz_version + 1` (row lock), then revokes families; rotation takes `app_user … FOR SHARE`, requires `status='ACTIVE'` and `authz_version` = the family's, then rotates. Two parallel refreshes (two tabs) are **not** reuse: a token rotated < 10 s ago returns `409 REFRESH_RACE` (client retries with its newest token); older reuse revokes the family.
8. **Central SQLSTATE mapping:** `23505` unique → the command's specific conflict code, `23514` check → a `409` domain code (e.g. `INSUFFICIENT_STOCK`), `40P01` deadlock / `55P03` lock timeout → bounded retry (≤ 2, jittered) then `503 LOCK_TIMEOUT`. A raw 500 for any of these is a bug. Use savepoints / `ON CONFLICT` instead of retrying inside an aborted transaction (tracking-code collision).
9. **Check-then-insert caps** (SOS soft throttle, `PROXY_OPEN_CAP`) may overshoot under parallel requests; accepted — the overshoot only lands in the review lane. Do not add locks for them.
10. **Time and cursors:** `now()` is the transaction *start* time, so a long transaction can commit a row "in the past" of a cursor already served. Ledger/audit/notice lists accept this (readers see a consistent `generated_at`); anything that must be exact (reconciliation) uses SUM, not a cursor.

## 3.2 Background jobs, pools, timeouts

- **Jobs** (recovery 30 s, overdue scans, evidence reconciler, drive/campaign sync 5 min, idempotency/session/notice cleanup): each run first takes `pg_try_advisory_xact_lock(hashtext('<job>'))` (skip if not acquired) and claims rows with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 100`; ±20 % jitter; batches ≤ 500 (cleanup deletes 5,000 at a time); every job is idempotent; notice inserts use `ON CONFLICT DO NOTHING`; material job mutations bump aggregate version; no-op scans/notices do not. `SCHEDULER_ENABLED=true` on exactly one replica in the demo Compose. The evidence reconciler and an uploader race on `UPDATE … WHERE state='PENDING' RETURNING` — the reconciler deletes the object only if it won. Mass operations (campaign close cancelling many requests) run with concurrency ≤ 5.
- **Pools (per replica):** Identity 20, Response 30, Logistics 20; PostgreSQL `max_connections ≥ Σ(pool × replicas) + 20`; introspection uses its **own** small pool. `idle_in_transaction_session_timeout = 10 s`. Statement timeouts: default 8 s; introspection 500 ms; heatmap/reports 15 s via `SET LOCAL`; cleanup 30 s. `lock_timeout` 3 s.
- **HTTP:** server `requestTimeout` 15 s, `headersTimeout` 10 s, `keepAliveTimeout` 65 s (above the Nginx upstream keep-alive); Nginx `client_max_body_size` 1 MiB for JSON routes, 55 MiB only on `…/evidence`; S3 connect 3 s / socket 30 s; cross-service client: keep-alive agent (`maxSockets` ≥ 50), 2 s timeout, **circuit breaker** per callee (5 failures in 10 s ⇒ fail fast with the specific `*_UNAVAILABLE` for 5 s), `Retry-After` on 503.
- **Dependency rule — no synchronous cycles:** Identity never calls Response in a request path (grant creation records the campaign id and Response validates the campaign when it evaluates the grant; a cached `GET /internal/campaigns/{id}` with 60 s TTL is allowed). Logistics may call Response; Response may call Logistics only for seal/freeze/fulfillment reads; both call Identity only for introspection/lookup.
- **Introspection (plan §10.3 keeps "no positive cache"):** identical concurrent lookups for the same `sid` are coalesced (single-flight, lives only for the in-flight call, so revocation latency is unchanged); a failing callee trips the breaker. A short positive cache (≤ 5 s, keyed by `(sid, authz_version)`, negative 30 s) is **not** enabled; add it only if the k6 run shows Identity as the bottleneck, and then amend plan §10.3/R-09 and the revocation SLA together.

## 3.3 Abuse, uploads, secrets (additions)

- **SOS flood:** Nginx `limit_req_zone` per IP (/24 IPv4, /56 IPv6) for the soft and hard ceilings; a **global** ceiling `SOS_GLOBAL_PER_MIN` (default 300) — above it new reports are still stored (`RATE_LIMITED_REVIEW`) but get no evidence/supplement endpoints; per-phone counting uses `request_phone_idx`; `source_ip_hash` is stored for analysts. `GET /requests` defaults to `review_lane=NORMAL`; the review lane is its own view, so spam can never bury normal reports.
- **Tracking lookups:** credential and code travel in headers (`X-Tracking-Secret`, `X-Tracking-Code`), never the query string; Nginx logs omit `$args` and both headers; lookup by `tracking_secret_hash` (unique index), then compare the code in constant time — never branch on "code exists"; `tracking_code` ≥ 40 bits (Crockford base32); `track` limited to 10/min and 60/h per IP.
- **Login:** dummy-hash path for unknown **and disabled** users; Argon2id concurrency capped (semaphore ≈ cores/2) and a global login budget so a flood cannot become a CPU DoS.
- **Uploads:** require `Content-Length` (`411 LENGTH_REQUIRED`); a streaming byte counter aborts at the declared size; guests: ≤ 2 concurrent uploads and 200 MiB/h per IP, `client_body_timeout 30s`; a global semaphore of 20 concurrent uploads per replica (`429` + `Retry-After`); sniff only the first 4 KiB; MP4 H.264/AAC verified by `ffprobe` in a bounded subprocess (5 s) — if not implemented, accept MP4 by container check only and record the risk.
- **Mass assignment:** DTOs use `whitelist` + `forbidNonWhitelisted`; `organization_id`, `reporter_user_id`, `status`, `priority`, `version`, `region_code` are never accepted from a create body (server-set); fields naming another organization/user (e.g. `POST /teams`) are checked against the caller's scope.
- **CSRF on `POST /requests`:** a request carrying cookies needs the CSRF token (otherwise a hostile site could file an SOS linked to a victim's account); guests send no cookies.
- **Logs and responses:** pino redaction from T1: `authorization`, `cookie`, `x-tracking-code`, `x-tracking-secret`, `x-donation-secret`, `x-recovery-code`, `*.phone`, `*.location`, `*password*`, `*secret*`, `token`; list rows mask phones (`09******45`), full number only in detail views; global `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on authenticated/tracking responses; hash peppers are versioned (`v1:` prefix) — rotation re-binds on next use, existing hashes stay valid for their own version; each service has its own `SERVICE_CLIENT_ID/SECRET`; admin-chosen temporary passwords are redacted from logs (or generated server-side and shown once).
- **Health:** `GET /health/live` and `/health/ready` per service (no dependency detail, unauthenticated, not routed publicly).

## 4. Environment variables (per service; validate at boot; none committed)

`NODE_ENV, PORT, DATABASE_URL (own role, own database), DB_POOL_MAX, DB_LOCK_TIMEOUT_MS=3000, DB_STATEMENT_TIMEOUT_MS=8000, JWT_ISSUER, JWT_AUDIENCE, JWT_PUBLIC_KEY (Response/Logistics) / JWT_PRIVATE_KEY (Identity), SERVICE_CLIENT_ID, SERVICE_CLIENT_SECRET, IDENTITY_BASE_URL, RESPONSE_BASE_URL, LOGISTICS_BASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, SECRET_HASH_PEPPER_SOS / _DONATION, DEMO_INTAKE_ORGANIZATION_ID, SOS_SOFT_LIMIT_PER_IP and SOS_HARD_LIMIT_PER_IP (Nginx zones), PROXY_OPEN_CAP=3, VERIFY_OVERDUE_MINUTES=15, OFFER_OVERDUE_MINUTES=10, TEAM_POSITION_FRESH_MINUTES=30, TEAM_SEARCH_RADIUS_M=10000, TEAM_BAND_TOLERANCE_M=2000, TEAM_BAND_TOLERANCE_P2_M=500, TEAM_BAND_TOLERANCE_P1_M=0, SIGNED_URL_TTL_S=60, SOS_GLOBAL_PER_MIN=300, SCHEDULER_ENABLED, INTROSPECT_TIMEOUT_MS=500`; `DB_POOL_MAX` defaults 20 / 30 / 20 (Identity / Response / Logistics). Provide `.env.example`, never real values.

## 5. Testing rules

- Unit: state machines, permission predicates, quantity arithmetic, DTO mapping (Jest).
- Database: **real PostgreSQL/PostGIS** (Compose test profile); run `docs/backend/schema/test-*.sql` in CI against the migrated schema; add race tests with two parallel connections for every lock/unique-index claim.
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
