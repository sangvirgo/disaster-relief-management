# Session handoff — C48 backend, 2026-10-10

Read `/AGENTS.md`, [project context](../c48-project-context.md), plan Sections 27–28, then [README](README.md) → [00-setup](00-setup.md) → [01 §7–§9](01-schema-review.md). Follow the ordered task table in [06-implementation-tasks](06-implementation-tasks.md), one task at a time.

## Objective

Continue implementing the backend plan in `/home/soang/c48`. T0–T4 have separate commits on `main`; proceed with T5 Response tracking, supplement, claim, and evidence, then follow T6–T19 and their listed dependencies. Commit each completed task separately. The API contracts and SQL in `docs/backend/` take precedence for shapes; the main plan governs business behavior.

## T3 completed

Identity now includes user administration, organizations and memberships, scoped grants, regions, audit search, service credentials/JWTs, session introspection, user lookup, and internal organization lookup. Admin writes use the existing idempotency helper and transactional audit records. Authorization changes invalidate sessions; organization membership removal also revokes that user's organization-scoped grants. No schema change was needed. T3 API details are in [02-identity-api](02-identity-api.md), and the full auth/admin/internal contract is in [identity OpenAPI](../../contracts/openapi/identity.json).

The security follow-up isolates Compose environment variables per service, keeps signing keys and client credentials out of unrelated APIs, makes grant self-checks UUID-case-insensitive, and binds temporary-password idempotency to the existing purpose-bound peppered secret hash. Identity responses now set `Cache-Control: no-store`; shared OpenAPI error responses document that header. User lookup ownership is enforced by the consuming service because Identity cannot query another service's records.

The Response campaign lookup client is present and fails closed on missing or malformed responses. `GET /internal/campaigns/{id}` is specified in [03-response-api](03-response-api.md) but is not implemented until T10, so campaign-scoped grant creation will return `RESPONSE_UNAVAILABLE` until T10 lands.

## T4 completed

`POST /api/v1/response/requests` now accepts SELF reports from guests and locally verified signed-in access tokens. Request, subject snapshot, and REPORTER-visible submission event commit together; region is assigned only when exactly one boundary covers the point, leaving unmatched or ambiguous results in the unassigned queue. Guest tracking secrets and source IPs are purpose-bound hashes. Idempotency binds the payload and guest secret, concurrent retries return one request, and replays keep the original creation representation after status changes. Validation/authentication/category failures write no idempotency record.

Soft IP, phone, and global thresholds retain reports in `RATE_LIMITED_REVIEW`; the source-IP and phone indexes support those counts. Nginx enforces the higher per-IP hard ceiling with Vietnamese 429 copy across case and trailing-slash route variants. Cookie-authenticated SELF submissions require an allowed Origin and CSRF token; Identity cookies are scoped to `/api/v1` while refresh remains Identity-only. Guest SOS and signed-in token validation were exercised with Identity stopped. The current Response intake contract is captured in [response OpenAPI](../../contracts/openapi/response.json); T19 completes the per-service exports.

T4 exit evidence: `npm test` passed 9 suites / 33 tests; `npm run build` passed; `npm run check:compose-env` passed all 12 service allow-lists; `bash backend/scripts/test-db` passed migration dump/up/down checks, SQL assertions/races, Identity HTTP tests, Response intake integration (including TC-01..05, TC-20, TC-BE-24 intake, TC-BE-12, ambiguous boundaries, transitioned-request replay, transaction rollback, and Nginx hard-rate rejection for canonical/case/trailing-slash paths). Response intake contract is in [response OpenAPI](../../contracts/openapi/response.json). Docker images were built with pinned Node 24.15.0. The local test stack was removed by its cleanup trap.

## Verification actually run

- T3 verification: `npm run build` passed for Identity, Response, and Logistics; `npm test` passed with 7 suites / 27 tests plus the key-generator test. T3 HTTP coverage includes permission denial, uppercase UUID self-grant rejection, session invalidation, last-admin protection, audit privacy/timestamps, idempotency, keyset reads, membership removal, service-token audience checks, lookup, no-store, and malformed organization UUID validation.
- T4 verification: see the T4 exit evidence above.
- k6 `identity-introspection.js` passed at 10 VUs for 15 seconds: 59,339/59,339 checks passed, 0% failed HTTP requests, and p95 3.62 ms. This is a local smoke, not T18's recorded-hardware performance evidence.
- `npm run check:compose-env` passed exact environment allow-lists for all 12 services, including the production-seed `NODE_ENV` guard. `docker compose -f backend/infra/compose.test.yaml --profile test config --quiet` passed. The OpenAPI semantic check passed for 122 documented operation/responses, resolving shared error refs and checking that each exposes `Cache-Control` without unsupported `$ref` siblings.
- Local `npm test` and `npm run build` used shell Node 26.5.0, outside the package's pinned Node 24 range; the full Compose database suite built and ran the APIs on pinned Node 24.15.0.
- Fresh production image builds and a production deployment were not verified. The k6 test stack and its temporary database were removed after the smoke; no other containers were touched.

## Binding decisions and known limits

- All user-facing product and backend messages remain Vietnamese. Machine contracts and source identifiers stay English.
- Human staff retain verification, prioritization, and dispatch decisions; AI must not automate them.
- Rate limits are still process-local for registration/login; Nginx tracking quotas are minute-based approximations and use exact client IPs. Upload-byte quota remains open. Resolve the planned limits in T18 before production claims.
- T18 still needs an executed backup/restore runbook covering all three PostgreSQL databases and object bytes with a key/size/checksum manifest. AIStor remains dependent on a separately supplied license file.

## Next task: T5

Implement Response tracking, supplement, claim, and evidence, following [03-response-api §1](03-response-api.md) and T5 in [06](06-implementation-tasks.md). Start with TDD and trace TC-24, TC-BE-22, and TC-BE-24; use the existing MinIO AIStor decision and limits in the main plan §§6.3 and 12. Keep evidence failure independent from the already committed SOS. Continue on `main` in `/home/soang/c48`; make a separate phase commit after T5 exit evidence passes.
