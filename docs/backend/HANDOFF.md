# Session handoff — C48 backend, 2026-10-10

Read `/AGENTS.md`, the [project context](../c48-project-context.md), plan Sections 27–28, then [README](README.md) → [00-setup](00-setup.md) → [01 §7–§9](01-schema-review.md).

## Objective and scope

T0 and T1 from [06-implementation-tasks](06-implementation-tasks.md) are implemented in `backend/` on the user’s `/home/soang/c48` checkout as separate phase commits. T0 is `15dee22`; T1 is complete and the next task is T2.

## What is implemented

- Three NestJS apps (Identity, Response, Logistics), a shared technical package, database readiness/live probes, service prefixes, and separate TypeORM migration entry points.
- RS256 is pinned for access tokens; `scripts/gen-keys` generates a 3072-bit RSA pair and local random secrets, stores them in `.env` with mode `0600`, and refuses to rotate populated values.
- TypeORM migrations load the existing `docs/backend/schema/{identity,response,logistics}.sql`; the schema files remain authoritative. Migration-down uses a catalog-based dropper while preserving TypeORM’s tracking table, row type, and ID sequence.
- Compose includes the digest-pinned PostgreSQL/PostGIS 17/3.5 image, separate migrator/application roles and databases, migration jobs, three API services, Nginx, and an optional AIStor storage profile that requires a separately supplied license.
- Test Compose uses tmpfs PostGIS and defines health-checked API services. `scripts/test-db` runs migrations, schema-dump comparison, down/up checks, SQL assertions, existing race suites, a migrated capacity-one race, and the delayed-seal-after-abort fence check.
- `up`, `migrate`, `seed`, `reset-demo`, `test-db`, and `gen-keys` commands exist. Seed hashes `SEED_PASSWORD` with Argon2id and refuses production mode and unexpected database contents. `reset-demo` checks both the caller’s `NODE_ENV` and backend `.env` before deleting its volume. Root `.dockerignore` keeps local dependencies and `.env` out of build contexts.
- Exact direct dependency and image versions plus source links are recorded in [VERSIONS.md](VERSIONS.md).
- T1 provides the Vietnamese error catalog/filter, centralized PostgreSQL error mapping and retry, insert-first idempotency, purpose-bound peppered secret hashes, permission/scope evaluation, correlation IDs, filter-bound keyset cursors, validated PostgreSQL/runtime settings, Pino redaction, advisory-lock/SKIP-LOCKED job helpers, optimistic version updates, and a keep-alive cross-service client with timeout, circuit breaking, and credential-bound single-flight.

## Verification actually run

- Node 24.15.0 ran `npm run build` successfully for all three apps and `npm test` successfully (two Jest suites, 15 tests, and one key-generation test). A Node 24 Argon2id hash smoke check also passed. `npm ci --no-audit --no-fund` succeeded on the host (Node 26.5.0, outside the project’s pinned Node 24 range); clean image builds remain unverified.
- Shell syntax checks for backend scripts, `node --check` for `seed.mjs`, and the `reset-demo` production guard check pass.
- `docker compose --profile test -f backend/infra/compose.test.yaml config --quiet`, `nginx:1.30.5 nginx -t`, and `git diff --check` pass in `/home/soang/c48`.
- On a clean disposable PostGIS 17/3.5 stack, all three TypeORM migrations applied and their schema dumps matched the authoritative SQL. All three SQL assertion suites passed; the existing Response and Logistics race suites passed; the migrated capacity-one race returned SQLSTATE `23505`; and the delayed-seal-after-abort fence passed. Each service migration also passed cloned-database up/down/up checks. Those checks exposed and fixed TypeORM tracking-object cleanup and test-clone ownership defects.
- All three freshly compiled service entry points started on the isolated Compose network and passed `/health/ready` against their databases. Existing test images for Identity and Response were stale and lacked entrypoints; direct Node 24 runtime checks passed. Fresh Docker image builds remain unverified.
- The T1 database integration script passed on PostgreSQL for insert-first idempotency wait/replay, changed-payload conflict, transaction advisory-lock exclusion, and `SKIP LOCKED` job claiming. All three freshly compiled APIs also passed readiness and Vietnamese 404-envelope/correlation-ID HTTP checks. The T1 Compose configuration, shell/Node script syntax, and `git diff --check` passed; its disposable containers, network, and database volume were removed afterward.
- `bash backend/scripts/test-db` did **not** complete because Docker BuildKit could not reach npm (`ECONNRESET`, then `ETIMEDOUT` on retry). Its equivalent schema, migration, race, fence, and readiness checks were run individually on the disposable stack and passed. The stack was cleaned up after verification.
- AIStor was not started because the external license file is not supplied. Its current license/tier conditions are documented in [VERSIONS.md](VERSIONS.md).

## Owner decisions that bind implementation

- Independent human review of every donation receipt is mandatory; no automatic approval of receipts or distributions (the DB enforces receipt review).
- Police, military, and government units are `GOVERNMENT`/`MILITARY` teams; units without the app use `COORDINATOR` mode and coordinators record progress, including `DECLINE`.
- Citizens never enter item lists; phone, headcount, note, and media are optional; category `UNKNOWN` exists.
- Automatic steps are bookkeeping and warnings only. Verification, priority, rescue dispatch, and resolve remain human decisions.
- Delivery by the rescue team (plan §28.3) is an optional slice after T15.

## Remaining work and next task

1. Continue with T2 Identity authentication in [06-implementation-tasks](06-implementation-tasks.md); do not skip ahead in the task order.
2. Once registry access is available, rerun `bash backend/scripts/test-db` as a single-command integration gate and verify fresh Docker image builds.
3. Before relying on Nginx rate limits, address the known limits: hourly registration/tracking quotas are approximated with minute-based limits, keys use exact client IP rather than IPv4 `/24`/IPv6 `/56`, and upload-byte quota and login-per-IP-plus-username limiting are not implemented. Syntax passed; request behavior and these quotas were not tested.
4. Implement and verify `scripts/backup` and `scripts/restore` in T18. Backups must include the three PostgreSQL databases plus object bytes and a key/size/checksum manifest; restore must target an empty isolated stack and verify scoped access (plan §§6.3 and 23.6).

No real credentials or license files were copied into the repository. The temporary `.env` used for Compose validation was excluded when moving files into the user’s checkout.
