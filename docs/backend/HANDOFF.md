# Session handoff — C48 backend, 2026-10-11

Read [AGENTS.md](../../AGENTS.md), [project context](../c48-project-context.md), plan Sections 27–28, then [README](README.md) → [00-setup](00-setup.md) → [01 §7–§9](01-schema-review.md). Follow the ordered task table in [06-implementation-tasks](06-implementation-tasks.md), one task at a time.

## Objective

Continue implementing only the backend microservices in `/home/soang/c48`. T0–T7 implementation phases have separate commits on `main`; T7 acceptance now passes. The T5 selected-provider acceptance gate remains open pending the AIStor lab artifact, private-access, and restore checks. Proceed with T8–T19 in dependency order and commit each completed task separately. AI agent/service work is outside this scope. The API contracts and SQL in `docs/backend/` take precedence for shapes; the main plan governs business behavior.

## T3 completed

Identity now includes user administration, organizations and memberships, scoped grants, regions, audit search, service credentials/JWTs, session introspection, user lookup, and internal organization lookup. Admin writes use the existing idempotency helper and transactional audit records. Authorization changes invalidate sessions; organization membership removal also revokes that user's organization-scoped grants. No schema change was needed. T3 API details are in [02-identity-api](02-identity-api.md), and the full auth/admin/internal contract is in [identity OpenAPI](../../contracts/openapi/identity.json).

The security follow-up isolates Compose environment variables per service, keeps signing keys and client credentials out of unrelated APIs, makes grant self-checks UUID-case-insensitive, and binds temporary-password idempotency to the existing purpose-bound peppered secret hash. Identity responses now set `Cache-Control: no-store`; shared OpenAPI error responses document that header. User lookup ownership is enforced by the consuming service because Identity cannot query another service's records.

The Response campaign lookup client is present and fails closed on missing or malformed responses. `GET /internal/campaigns/{id}` is specified in [03-response-api](03-response-api.md) but is not implemented until T10, so campaign-scoped grant creation will return `RESPONSE_UNAVAILABLE` until T10 lands.

## T4 completed

`POST /api/v1/response/requests` now accepts SELF reports from guests and locally verified signed-in access tokens. Request, subject snapshot, and REPORTER-visible submission event commit together; region is assigned only when exactly one boundary covers the point, leaving unmatched or ambiguous results in the unassigned queue. Guest tracking secrets and source IPs are purpose-bound hashes. Idempotency binds the payload and guest secret, concurrent retries return one request, and replays keep the original creation representation after status changes. Validation/authentication/category failures write no idempotency record.

Soft IP, phone, and global thresholds retain reports in `RATE_LIMITED_REVIEW`; the source-IP and phone indexes support those counts. Nginx enforces the higher per-IP hard ceiling with Vietnamese 429 copy across case and trailing-slash route variants. Cookie-authenticated SELF submissions require an allowed Origin and CSRF token; Identity cookies are scoped to `/api/v1` while refresh remains Identity-only. Guest SOS and signed-in token validation were exercised with Identity stopped. The current Response intake contract is captured in [response OpenAPI](../../contracts/openapi/response.json); T19 completes the per-service exports.

T4 exit evidence: `npm test` passed 9 suites / 33 tests; `npm run build` passed; `npm run check:compose-env` passed all 12 service allow-lists; `bash backend/scripts/db/test-db` passed migration dump/up/down checks, SQL assertions/races, Identity HTTP tests, Response intake integration (including TC-01..05, TC-20, TC-BE-24 intake, TC-BE-12, ambiguous boundaries, transitioned-request replay, transaction rollback, and Nginx hard-rate rejection for canonical/case/trailing-slash paths). Response intake contract is in [response OpenAPI](../../contracts/openapi/response.json). Docker images were built with pinned Node 24.15.0. The local test stack was removed by its cleanup trap.

## T5 implementation delivered; provider gate pending

Response now supports reporter tracking and event history, account-owned request listing, versioned supplements with idempotent replay, guest-to-account claim, scoped capability revocation, coordinator-issued one-time recovery, and streamed request-evidence upload/download. A corrected pre-verification location re-derives the queue region in the same transaction using the exactly-one-boundary rule. Evidence is stored under generated private object keys; uploads validate actual media signatures and SHA-256, reserve per-request and guest-IP quotas, and leave the request unchanged on storage failure. The Nginx MinIO proxy strips API secrets and sends `Cache-Control: no-store`. An advisory-locked job marks stale `PENDING` evidence failed and retries old failed-object deletion until `cleanup_completed_at` records success. API details are in [03-response-api](03-response-api.md) and [response OpenAPI](../../contracts/openapi/response.json).

`npm test` passed 18 suites / 55 tests and 2 Node checks; `npm run build` passed; `npm run check:compose-env` passed all 12 service allow-lists; Compose test configuration and script syntax checks passed. The Response OpenAPI check resolved 11 operations / 85 responses and verified `Cache-Control: no-store`. `bash backend/scripts/db/test-db` passed schema dump comparisons, migration up/down/up, SQL assertions/races, Identity HTTP tests, T4 intake integration, and T5 HTTP integration covering cookie-authenticated safe reads, revoked-cookie capability tracking, Identity-down capability tracking, location/region correction, supplement/recovery/revocation, evidence MIME/checksum/download/quota, storage failure preserving SOS, and scheduled stale-evidence reconciliation. Unit tests also cover client-aborted multipart cleanup, temporary-file failures, capability access without Identity, S3 connection/socket timeouts, and byte quotas. Docker used pinned Node 24.15.0, and the test stack was removed by its cleanup trap. The in-memory storage adapter was tested; T5 is not marked done because plan §6.3 still requires verification against the selected AIStor lab artifact, private access, and restore path. No AI agent or service was built.

## T6 implemented: PROXY intake and abuse controls

`POST /api/v1/response/requests/proxy` requires a live Identity session and stores the authenticated reporter separately from the affected household. It records relationship, source, last-known time, contactability and optional contacts; household coordinates alone determine the region. Missing/expired sessions fail, Identity outages return `503`, and the route never falls back to SELF. Idempotency replays the original result. `PROXY_OPEN_CAP` defaults to 3 simultaneous unverified reports; `PROXY_DAILY_SOFT_LIMIT` defaults to 10 in a rolling 24-hour window. Both are never-drop soft thresholds and may overshoot under parallel requests per 00 §3/§4; no account lock is used. Existing registration throttles cover new-account creation.

Response writes quota-excess reports with `PROXY_QUOTA_REVIEW` and adds a staff-only `PROXY_ACTIVITY_FLAG` when the reporter account/phone has at least three distinct PROXY household locations (approximate 100 m cells) in 24 hours or any prior rejected report. The event contains counts, up to ten recent PROXY request IDs, and up to ten IDs of rejected requests (SELF or PROXY); it does not change status/priority, classify fraud, or block the reporter. The 10/day and three-location triggers are provisional demo thresholds that need field calibration. T7 implements coordinator review lanes, flags, verification, duplicate handling, triage, referrals, and contact attempts.

T6 exit evidence: `npm test` passed 18 suites / 56 tests plus 2 Node checks; `npm run build` passed for all three services; `npm run check:compose-env` passed all 12 service allow-lists; `docker compose --profile test -f backend/infra/compose.test.yaml config --quiet` passed; `bash backend/scripts/db/test-db` passed the full schema/migration/race/auth suite and T4/T5/T6 HTTP integration. T6 HTTP checks cover the Nginx hard ceiling on `/requests/proxy`, Identity-down 503, missing/revoked session, source/household region and contact persistence, idempotent replay, fourth open request, eleventh daily request, prior-rejection/multiple-location staff flags, and no status/priority change. The database test stack was removed by its cleanup trap.

## T7 completed: verification, duplicates, priority

T7 acceptance is unblocked. Response operations cover verification start/contact attempts, verification and rejection, duplicate linking and canonical-rejection orphaning, concurrence tied to the latest material fact, corroboration candidates, triage, authority referral, region correction, overdue scanning/notices, and supplement-review gating. T7 keeps human staff responsible for verification, priority, and dispatch.

Two PostgreSQL `42P08` failures came from reusing an untyped UUID parameter inside polymorphic `jsonb_build_object` expressions. The reporter notice and duplicate-orphan coordinator notice now cast only the JSON `request_id` occurrence to `uuid`; SQL bindings, schema, API contracts, and Vietnamese messages are unchanged. Smoke fixtures now page through older FIFO unassigned requests, give the corroboration candidate a distinct test IP, and use a fresh proxy reporter for concurrence supplements so the normal review lane remains available. The duplicate cascade assertion expects version 3 after the child advances from 1 to 2 when linked as DUPLICATE and from 2 to 3 when returned to VERIFYING.

T7 exit evidence: `npx tsc --noEmit` passed; `npm test` passed 18 suites / 56 tests plus 2 Node checks; `npm run build` passed and found all three service entry points and migrations; `bash scripts/db/test-db` passed the full database, migration, race, Identity, Response intake, T5, T6, and T7 suites. T7 reported: “verification, queue, detail, supplement review, rejection threshold, duplicate, priority, and overdue notice integration passed.” PostgreSQL query logging confirmed the two `42P08` statements before the UUID casts. The final T7 orphan rows were `VERIFYING`, had `canonical_request_id = null`, and version 3. No migration, schema, OpenAPI, error-copy, or NestJS module-wiring changes were made.

## Verification actually run

- T3 verification: `npm run build` passed for Identity, Response, and Logistics; `npm test` passed with 7 suites / 27 tests plus the key-generator test. T3 HTTP coverage includes permission denial, uppercase UUID self-grant rejection, session invalidation, last-admin protection, audit privacy/timestamps, idempotency, keyset reads, membership removal, service-token audience checks, lookup, no-store, and malformed organization UUID validation.
- T4 verification: see the T4 exit evidence above.
- k6 `identity-introspection.js` passed at 10 VUs for 15 seconds: 59,339/59,339 checks passed, 0% failed HTTP requests, and p95 3.62 ms. This is a local smoke, not T18's recorded-hardware performance evidence.
- `npm run check:compose-env` passed exact environment allow-lists for all 12 services, including the production-seed `NODE_ENV` guard. `docker compose -f backend/infra/compose.test.yaml --profile test config --quiet` passed. The OpenAPI semantic check passed for 122 documented operation/responses, resolving shared error refs and checking that each exposes `Cache-Control` without unsupported `$ref` siblings.
- T5 code verification: the commands and test counts are recorded above. Evidence upload was tested with the in-memory storage adapter; the required live AIStor private-access and restore checks remain open.
- Local `npm test` and `npm run build` used shell Node 26.5.0, outside the package's pinned Node 24 range; the full Compose database suite built and ran the APIs on pinned Node 24.15.0.
- Fresh production image builds and a production deployment were not verified. The k6 test stack and its temporary database were removed after the smoke; no other containers were touched.

## Binding decisions and known limits

- All user-facing product and backend messages remain Vietnamese. Machine contracts and source identifiers stay English.
- Human staff retain verification, prioritization, and dispatch decisions; AI must not automate them.
- Rate limits are still process-local for registration/login; Nginx tracking quotas are minute-based approximations and use exact client IPs. Review planned limits in T18 before production claims.
- MP4 validation checks the ISO-BMFF container signature but not its video/audio tracks; add a bounded `ffprobe` check before accepting untrusted production video. T18 still needs an executed backup/restore runbook covering all three PostgreSQL databases and object bytes with a key/size/checksum manifest. AIStor requires a separately supplied license file and was not integration-tested.
- T6's `PROXY_DAILY_SOFT_LIMIT=10` and three-location flag threshold are provisional demo choices; validate them with field operators before real-world use. Soft limits intentionally have no serialization lock, so concurrent requests can briefly exceed the configured count.

## Refactor handoff — 2026-10-11

- **A:** Split Response request operations into query, verification, triage, dedup/referral, persistence, and supplement-review services plus shared helpers. The facade retains its public signatures; operation source files are below 400 lines.
- **B:** Grouped scripts under `db/`, `dev/`, `build/`, `smoke/`, and `proofs/`; updated package, Compose, proof, and documentation references. Kept both `gen-keys` entry points because the shell wrapper and tests reference `gen-keys.mjs`.
- **C:** Moved Node tests to `scripts/__tests__/`, scoped Jest discovery to apps/packages, and retained the baseline count: 18 suites / 56 tests plus 2 Node tests.
- **D:** Grouped technical utilities under `config/`, `errors/`, `http/`, `idempotency/`, `observability/`, `pagination/`, `persistence/`, and `security/`. `index.ts` keeps the same exported symbol set; all source, test, and smoke-build paths were updated.
- **E:** `backend/.gitignore` already ignores `dist/`; build artifacts were not committed.
- **Commits:** A — `51b4f03`, `13d4909`, `fa6a83c`, `18a4c7c`, `3dfb8b0`, `bf4d76b`, `9c1ad73`, `a5900a3`; B — `81a3642`; C — `b3f5975`; D — `70c524a`. The T7 implementation commit is `4613bec`.
- **Checks:** baseline and final `npm run build` passed; baseline and final `npm test` passed with 18 suites / 56 tests plus 2 Node tests; `npx tsc --noEmit` passed after each structural checkpoint. OpenAPI JSON diff from `4613bec` is empty. Compose environment checks and test Compose validation passed after B.
- **T7 acceptance follow-up (resolved):** The original `start-verification` `DATABASE_42P08` failure reproduced on `4613bec`; it was fixed in a separate behavior/test follow-up. Full T7 database acceptance now passes. See the T7 section above.
- **Docker cleanup:** removed 180 images labeled by `c48-test-*` Compose projects after confirming no C48 test containers remained. Existing `simmes-v3-local` images and containers were left untouched.
- The user-added `/home/soang/c48/.codegraph/` index remains untracked and must not be staged or removed.

## Next task: T8

Proceed with T8 in [06](06-implementation-tasks.md), following the documented dependency order. Keep the T5 selected-provider acceptance gate tracked separately; its AIStor artifact, private-access, and restore checks remain outstanding.
