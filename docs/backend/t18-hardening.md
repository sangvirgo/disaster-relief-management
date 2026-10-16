# T18 hardening and evidence

## Scope and evidence status

T18 uses the existing C48 application and `backend/infra/compose.yaml`. The checks do not create databases, schemas, or helper containers. The audit-access and auth-timeout smokes create temporary Identity actors, grants, and sessions in the primary database; both clean up their rows, and the auth-timeout smoke verifies cleanup in a transaction. The separate T8/T9/T14 operational smokes create durable synthetic demo records. Backup and restore tooling is provided, but neither operation has been run in this workspace.

| Area | Implementation and evidence | Status and limit |
|---|---|---|
| Security headers and CSP | `backend/infra/nginx/nginx.conf` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, and `Cache-Control: no-store`. The privacy access format uses `$uri` and omits query arguments. `backend/scripts/__tests__/t18-hardening.test.mjs` checks these directives; the ingress smoke checks live responses through Nginx. | Static evidence passes. The full ingress smoke passed through the existing Nginx service on loopback port 8081 on 2026-10-15. Port 8080 remains occupied by another local service. |
| Throttling | Identity login applies 5 attempts/minute per IP+username, 30/minute per IP, and 300/minute globally; registration applies 3/hour per IP. Response tracking and event reads apply 10/minute and 60/hour per client IP in the application, matching the Nginx edge guard. Unit tests cover the minute/hour limits and a full-map expiry case. | The application limiter is bounded to 20,000 hashed client keys and is process-local. Full-map cleanup runs at most once per minute; until the next sweep, new client keys fail closed if the map remains full. The Nginx zones are per ingress process. Multi-replica coordination and IPv4 `/24` / IPv6 `/56` normalization remain deployment decisions; do not treat these local limits as a distributed abuse-control service. |
| Logs and PII | Pino redaction covers request URLs/referers, signed/download URLs, and reporter, beneficiary, and alternate-contact phone fields. Nginx access logging records `$uri`, not the raw request target. `backend/packages/technical/test/t1-primitives.spec.ts` checks representative nested fields and signed URLs. | Unit evidence checks representative fields; it does not prove that every future log statement is safe. Review new structured log fields whenever they are added. |
| Dependency audit | `npm audit --omit=dev` reports 0 production dependency vulnerabilities. | Full `npm audit` reports 20 moderate findings in the development dependency chain through Jest and `sprintf-js`. npm proposes a breaking `ts-jest` downgrade with `npm audit fix --force`; no dependency or lockfile changes were made in T18. |
| Backup and restore | `backend/scripts/db/backup` dumps all three primary PostgreSQL databases through the existing `postgres` service and mirrors the two configured evidence buckets. Before creating artifacts, it compares the selected mc alias URL with `response-api`'s resolved `S3_PUBLIC_ENDPOINT`. It writes `object_inventory.jsonl` rows with bucket, key, byte size, and SHA-256. Restore validates checksums and archives, requires empty recovery databases, and compares each target cluster's `system_identifier` with the existing primary Compose PostgreSQL cluster before any `pg_restore`. | No backup artifact was created and no database restore was run. Endpoint mismatch or inspection failure blocks backup; restore fails closed when either cluster identifier cannot be read or matches. TC-29 restore execution is **pending** until an approved isolated recovery destination exists. Object restoration is blocked until an isolated endpoint and empty target buckets are independently verified. Never restore over `c48_identity`, `c48_response`, or `c48_logistics`. |
| k6 performance scenario | `backend/test/k6/t18-hardening.js` defines 20 VUs, a 2-minute read-only warm-up, a 10-minute measured interval, and a 4:1 read-to-synthetic-SOS iteration mix with latency and failure thresholds. `setup()` rejects non-loopback URLs before workload startup and still requires explicit SOS-write opt-in, a pre-issued token, and an approved point. | Not run: it creates persistent SOS records and is a sustained workload. TC-PERF-01 evidence, dataset size, runtime hardware, and measured results remain pending. No synthetic data or 10k-row fixture was created. |
| Vietnamese API error copy | Direct API smoke covers anonymous Identity, Response, and Logistics audit 401 checks for `UNAUTHENTICATED`, Vietnamese messages, and `no-store`; it also covers an invalid DTO POST with `400 VALIDATION_FAILED`. The full ingress smoke covers correlation IDs and security headers through Nginx. | Direct and ingress 401/validation evidence passed. The authenticated Logistics permission-denial copy passed with a temporary restricted Identity actor. Web/Mobile inert-rendering and accessibility evidence remains pending. |
| Audit access | Logistics exposes the documented `GET /audit-logs` with required `entity_type`, optional `entity_id`, filter-bound keyset paging, and system `AUDIT_READ`. The route reads the existing `audit_log` table and adds no write path or schema. Producers record identifiers, lifecycle/version changes, and staff-entered reasons; no credential or signed-URL field is emitted by the reviewed producers. | Unit, DTO, module-wiring, and OpenAPI checks pass. Main-stack allow/deny smoke passed: temporary system ADMIN received 200, restricted VOLUNTEER received Vietnamese `FORBIDDEN`, and both actor-specific Identity audit counts stayed 0 → 0. The script verified cleanup of its temporary users, grants, session families, and refresh sessions. Free-text reasons remain privileged data; the route is system-ADMIN-only and `no-store`, and staff must not put credentials or signed URLs in those notes. The current index places `entity_id` before the ordering columns, so a page filtered only by `entity_type` may sort all matching audit rows; no representative-scale `EXPLAIN` was run. Revisit indexing before high-volume use without changing the current schema in this phase. |

## TC-BE acceptance evidence

- **TC-BE-27 — backend ingress checks passed; client checks pending.** The direct API and Nginx ingress smokes passed again on 2026-10-16: Identity, Response, and Logistics anonymous 401 checks (`no-store`, Vietnamese copy), plus Vietnamese DTO validation `400 VALIDATION_FAILED` through Nginx at `http://127.0.0.1:8081` with expected correlation/security headers. The authenticated audit smoke passed SYSTEM ADMIN access and restricted VOLUNTEER denial with exact Vietnamese `FORBIDDEN`; temporary Identity audit rows stayed `0 -> 0`. This invocation found no Logistics distribution audit rows, so it skipped the content-filter assertion; populated matching/nonmatching `entity_id` filtering passed on 2026-10-15. Port 8080 remains occupied by another local service. Web/Mobile inert-rendering and accessibility checks remain pending.
- **TC-BE-28 — partial.** The primary-stack auth smoke passed again on 2026-10-16. It exercised statement-timeout rollback across three attempts, lock-timeout rollback while another transaction held the user row lock, and successful idempotent retries/replays with one committed version increment; temporary auth fixtures were removed and their absence verified. The configuration unit test in `backend/packages/technical/test/t1-primitives.spec.ts` verifies that `DB_POOL_MAX=100` is accepted, `101` is rejected, and `postgresOptions` passes the configured value as `extra.max`. Compose currently configures pool maxima of 20/30/20 for Identity/Response/Logistics. Runtime pool saturation/bounds remain **PENDING**; the smoke and static configuration do not establish pool exhaustion behavior. The three migration CLIs now emit only a service-labeled `MIGRATION_FAILED` message without exception details; a static regression test checks all three catch handlers.
- **TC-BE-29 — partial.** The Logistics audit reader is restricted to system `AUDIT_READ`; unit tests cover permission denial before SQL, DTO filter/page bounds, and filter-bound cursor behavior. The 2026-10-15 main-stack audit smoke passed populated matching/nonmatching `entity_id` filters, and the 2026-10-16 smoke passed allow/deny but skipped filtering because no distribution rows were present. A source audit reviewed the known Identity, Response, and Logistics logger callsites and shared Pino redaction; migration failure output now avoids raw exception details. Runtime application/container log output has not been scanned, and staff-entered audit reasons remain untrusted privileged data. A read-only primary Logistics query found 120 audit rows (86 `relief_need`); the entity-type-only 51-row query used a sequential scan and sort (0.525 ms, 22 shared-buffer hits). The current index cannot provide this ordering when `entity_id` is absent, so representative-scale plan evidence remains open. CSV export and push are not implemented, so their conditional checks do not apply. The dependency audit result above is not evidence for these application checks.
- **TC-29 restore — pending.** No backup artifact or restore was executed. Database restore requires an approved isolated recovery destination, and object restoration remains blocked pending independent endpoint and empty-target verification.

Static verification for this evidence update:

- From `backend/`: `node scripts/__tests__/t18-hardening.test.mjs` — **PASS (10/10)**, including a connection-string host-override regression that exits before connecting.
- From `backend/`: `node scripts/__tests__/migration-error-logging.test.mjs` — **PASS (3/3)**; a static regression check requires each service migration CLI catch handler to emit only its service-labeled `MIGRATION_FAILED` line and exit code, without exception details.
- From `backend/`: `node scripts/__tests__/t18-backup-safety.test.mjs` — **PASS (7/7)**, including private config permissions, symlinks, and non-regular config rejection; `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand apps/response/test/tracking-pagination.spec.ts` — **PASS (5/5)**.
- From `backend/`: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand packages/technical/test/t1-primitives.spec.ts` — **PASS (1 suite / 15 tests)**; configuration assertions cover the `DB_POOL_MAX` boundary and `postgresOptions.extra.max` mapping, not runtime pool evidence.
- From `backend/` against the primary C48 APIs and `c48_identity`: `node scripts/smoke/test-auth.mjs` — **PASS** on 2026-10-16; cleanup was transactional and verified no fixture rows remained. `node scripts/smoke/test-logistics-audit-access.mjs` — **PASS** for allow/deny on 2026-10-16, with filtering skipped because the selected entity type had no rows; populated `entity_id` filtering passed on 2026-10-15. These checks do not measure pool saturation.
- From `backend/`: `bash -n scripts/db/backup scripts/db/restore` and `node --check scripts/db/validate-mc-config.mjs` — **PASS**.
- From `backend/`: `node --check --input-type=module < test/k6/t18-hardening.js` — **PASS**.
- From the repository root: `git diff --check` — **PASS**.

## Running the low-impact smoke

The default ingress smoke makes three anonymous GET requests (Identity, Response, Logistics audit) and one invalid `POST /requests` with an empty body. The POST has a valid idempotency key so the interceptor can pass it; Nest validation rejects the empty DTO before the controller handler and persistence service run. Optional pre-issued tokens enable GET-only Logistics audit allow/deny and filtering probes. These probes do not register, log in, create a session, or print response bodies or credentials.

In both the optional-token check and the authenticated main-stack smoke below, an empty first distribution page prints `SKIP Logistics audit filtering` and does not establish content-filter evidence. A populated page supplies one existing `entity_id` for a positive-filter read, then a distinct valid UUID for a negative-filter read that must return no rows. These audit-filter probes are GET-only.

From `backend/`, after the main APIs and the existing `nginx` service are already running:

```sh
node scripts/smoke/t18-hardening.mjs
```

The default origin is `http://127.0.0.1:8080`. `C48_T18_PUBLIC_BASE_URL` may select another loopback-published port; the script rejects non-loopback hosts. Expected evidence is four `PASS` lines for Identity 401, Response 401, Logistics audit 401, and DTO validation. A failure is reported by endpoint and expected property, without dumping the response body.

When ingress is unavailable, `--direct-apis` sends the three anonymous GET requests to existing loopback API ports 3001, 3002, and 3003. It checks error codes, exact Vietnamese messages, correlation IDs, and no-store behavior. It deliberately skips the invalid POST and cannot verify Nginx headers. Optional `C48_T18_AUDIT_READ_TOKEN` and `C48_T18_AUDIT_DENIED_TOKEN` values check that a system `AUDIT_READ` reader can retrieve a filtered page and a restricted reader receives Vietnamese `FORBIDDEN`; without either token, that check is explicitly skipped.

```sh
node scripts/smoke/t18-hardening.mjs --direct-apis
```

For authenticated audit permission checks against the primary stack, run:

```sh
node --env-file=.env scripts/smoke/test-logistics-audit-access.mjs
```

This smoke requires a PostgreSQL URL for `c48_identity` on loopback port `55432` and rejects URL query or fragment overrides before connecting. It creates temporary system ADMIN and restricted VOLUNTEER actors directly in Identity and logs them in; these setup and cleanup actions write Identity rows, while only the Logistics audit-filter probes are GET-only. It records the temporary actors' Identity audit-row count before and after the API checks (expected `0 -> 0`), then removes and verifies only their refresh sessions, sessions, grants, and user rows. It does not modify either service's `audit_log`, run migrations/seeds, or reset a volume.

The corresponding static checks can be run from `backend/`:

```sh
node scripts/__tests__/t18-hardening.test.mjs
```

Earlier runtime inventory (superseded by the 2026-10-15 ingress run below): Postgres and all three primary APIs were healthy. Only the existing `logistics-api` service was rebuilt/recreated for the audit route; no database volume, migration, or seed job was run. At that time the existing `nginx` container was `Created` and port 8080 was unavailable, so no ingress request was sent. The direct smoke passed anonymous Identity, Response, and Logistics audit 401 checks for no-store and Vietnamese messages. The authenticated audit smoke passed its system ADMIN allow and restricted VOLUNTEER deny checks with Identity audit rows 0 -> 0 and verified temporary actor cleanup. That run predates the non-empty content check and is not evidence that matching audit rows were returned. Direct mode skips validation POST; validation and ingress-header evidence were pending at that point.

### T18 ingress follow-up — 2026-10-15

From `backend/`, the full ingress smoke passed against the existing main-stack Nginx service with `C48_T18_PUBLIC_BASE_URL=http://127.0.0.1:8081 node --env-file=.env scripts/smoke/t18-hardening.mjs`. It reported four passing checks: Identity 401, Response 401, Logistics audit 401, and DTO validation 400. The smoke verified Vietnamese validation copy, no-store behavior, correlation IDs, and Nginx security headers. The optional token-based audit check was skipped because no tokens were supplied; the separate authenticated Logistics audit smoke passed permission allow/deny and populated filters. Port 8080 remains occupied by another local service. This was run against existing APIs/Nginx; no database reset, seeding, or volume deletion occurred.

## Backup procedure

Backups contain personal and operational data. Choose an access-controlled, encrypted destination outside the repository and protect it according to the organization’s retention policy. No retention period is set by this runbook. Run during a planned quiet window and coordinate intake/write activity: the three database dumps and object mirrors are sequential, not a single cross-service atomic snapshot. The script does not start or stop services.

From the repository root, set `C48_MINIO_ALIAS` to the already-configured alias for the main MinIO endpoint and `MC_CONFIG_DIR` to its private configuration directory. Keep both outside Git and do not print their contents. Before invoking Compose or accessing a database, backup rejects symlinks in the configuration path, requires the directory to have no group/other permissions (`0700` or stricter), and requires `config.json` to be a regular non-symlink file with no group/other permissions (`0600` or stricter). It fails closed if it cannot verify these properties.

```sh
export C48_MINIO_ALIAS='c48-primary'
export MC_CONFIG_DIR='/secure/operator/mc-config'
backend/scripts/db/backup /secure/backups/c48
```

The script requires the existing `backend/.env` for Compose interpolation, uses only `backend/infra/compose.yaml` and its `postgres` service, applies a private file umask, and rejects destinations inside the repository. Before creating the destination or dumping databases, it reads `response-api`'s resolved `S3_PUBLIC_ENDPOINT` from Compose JSON and compares it with the selected alias `url` in `$MC_CONFIG_DIR/config.json`. It requires exact normalized HTTP(S) URL equality and fails closed if either value is missing, invalid, or different; command output and credentials are not printed. This verifies configured endpoint strings, not DNS routing or remote server identity. The script writes custom-format dumps for `c48_identity`, `c48_response`, and `c48_logistics`, mirrors `c48-response-evidence` and `c48-logistics-evidence`, then records one JSONL row per object in `object_inventory.jsonl` with `bucket`, `key`, `size_bytes`, and `sha256`. The inventory rejects symlinks and files that change while hashing. The checksum manifest covers the inventory too. It does not reset databases or remove data. Do not commit the output or paste its contents into logs or chat.

The database-to-object mapping is:

- Response object keys are referenced by `evidence_metadata` rows in `c48_response` and stored in `c48-response-evidence`.
- The `c48_logistics` schema reserves attachment metadata; the configured `c48-logistics-evidence` bucket is mirrored as well so the backup includes the declared Logistics object store.

Verify an artifact without modifying it:

```sh
cd /secure/backups/c48/c48-YYYYMMDDTHHMMSSZ
sha256sum --check --strict manifest.sha256
```

## Isolated restore procedure

TC-29 requires restore verification. Under the current no-test-database rule, this phase does not provision a separate database or object store. A backup must not be restored over the primary C48 databases. The execution gate remains **pending** until an authorized, isolated recovery destination is available.

When that destination is available, an operator must first provide:

1. An isolated PostgreSQL recovery service with existing empty databases named exactly `c48_recovery_identity`, `c48_recovery_response`, and `c48_recovery_logistics`. Do not add these to the main Compose project.
2. A private `PGSERVICEFILE` outside the repository, mode `0600` or stricter, with service entries named by `PGSERVICE_IDENTITY`, `PGSERVICE_RESPONSE`, and `PGSERVICE_LOGISTICS`. Each entry must point to its corresponding isolated database.
3. An independently verified isolated MinIO endpoint and two pre-created, empty target buckets. Alias configuration alone does not establish isolation; do not point a restore alias at the primary endpoint.
4. A verified backup directory outside the repository.

After checking those prerequisites, the operator can run the database restore with:

```sh
export PGSERVICEFILE='/secure/operator/pg_service.conf'
export PGSERVICE_IDENTITY='c48-recovery-identity'
export PGSERVICE_RESPONSE='c48-recovery-response'
export PGSERVICE_LOGISTICS='c48-recovery-logistics'
export C48_RESTORE_CONFIRM='I_HAVE_AN_ISOLATED_DESTINATION'
backend/scripts/db/restore /secure/backups/c48/c48-YYYYMMDDTHHMMSSZ
```

Before inspecting target databases, the script reads `system_identifier` through the existing main Compose `postgres` service. It then reads the identifier through each configured recovery service and aborts before any restore if an identifier cannot be inspected, is malformed, or matches the primary cluster. Before restoring any archive, it checks all three target database names and counts user objects across custom schemas, relations, types/enums, functions/procedures, operators, collations/conversions, operator classes/families, text-search objects, extended statistics, large objects, publications, foreign data wrappers, foreign servers, event triggers, access methods, casts, procedural languages, transforms, default privileges, user mappings, and subscriptions scoped to the target database. It excludes `pg_catalog`, `information_schema`, and exact extension members (`pg_depend.deptype = 'e'`); for unnamespaced rows in `pg_am`, `pg_cast`, `pg_language`, `pg_transform`, `pg_default_acl`, and `pg_user_mapping`, it counts only normal object OIDs at or above 16384, excluding initdb built-ins and pinned rows. The built-in `public` schema itself is allowed while its contents are checked. Auto-extension dependencies (`deptype = 'x'`) remain counted because they are not extension members. User mappings are checked independently by their own catalog row, so an extension-owned foreign server does not suppress a mapping that could collide. A catalog query error or malformed count fails closed. A normal empty database with its default system objects yields zero. The target service role must be able to call `pg_control_system()`; inspection failure blocks the restore. It never creates or drops a database and never uses `pg_restore --clean` or `--create`. Do not run it against a primary database. Keep the restored databases isolated from application traffic until checks are complete.

PostgreSQL 17 `pg_dump` includes non-system extensions as restore entries. The preflight counts top-level `pg_extension` rows with OIDs at or above 16384; lower-OID initdb-installed extensions are excluded, while extension member objects remain filtered because the extension is restored as a unit.

Object restoration remains blocked until an operator independently verifies the isolated MinIO endpoint identity and confirms both target buckets are empty. An alias or environment variable is not sufficient evidence because it can resolve to the primary endpoint. This runbook provides no executable object-copy command; do not copy objects until that separate verification is documented and reviewed. Once an isolated destination is approved, verify object inventory and checksums against the private backup manifests and confirm application metadata-to-object references before recording TC-29 as passed. No such isolated verification has been performed for T18.

## k6 scenario gate

The scenario is intentionally opt-in and writes synthetic assistance requests during its measured interval. `setup()` accepts only HTTP(S) URLs using `localhost`, `[::1]`, or a canonical IPv4 address in `127.0.0.0/8`; a remote host is rejected before either workload starts. Do not run it until a performance window, approved test point/category, pre-issued reporter token, and cleanup/retention decision are in place. It does not create a fixture dataset or clean up generated requests.

Example invocation, for an explicitly authorized performance window only:

```sh
K6_ENABLE_SOS_WRITES=1 \
C48_K6_PUBLIC_URL='http://127.0.0.1:8080' \
C48_K6_ACCESS_TOKEN='<pre-issued-token>' \
C48_K6_SOS_LONGITUDE='<approved-longitude>' \
C48_K6_SOS_LATITUDE='<approved-latitude>' \
C48_K6_INCIDENT_CATEGORY='FLOOD' \
k6 run backend/test/k6/t18-hardening.js
```

Record the host CPU, memory, PostgreSQL and application container limits, dataset row count, k6 version, checks, failed-request rate, and p95 read/SOS latency with any future result. The scenario thresholds are `<1%` failed HTTP requests, `>99%` checks, read p95 `<2s`, and SOS p95 `<3s`. T18 has no measured result yet.
