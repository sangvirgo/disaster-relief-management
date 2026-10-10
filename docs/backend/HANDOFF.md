# Session handoff — C48 backend, 2026-10-10

Read `/AGENTS.md`, [project context](../c48-project-context.md), plan Sections 27–28, then [README](README.md) → [00-setup](00-setup.md) → [01 §7–§9](01-schema-review.md). Follow the ordered task table in [06-implementation-tasks](06-implementation-tasks.md), one task at a time.

## Objective

Continue implementing the backend plan in `/home/soang/c48/backend`. T0–T3 have separate commits on `main`; proceed with T4 Response SELF intake, then follow T5–T19 and their listed dependencies. Commit each completed task separately. The API contracts and SQL in `docs/backend/` take precedence for shapes; the main plan governs business behavior.

## T3 completed

Identity now includes user administration, organizations and memberships, scoped grants, regions, audit search, service credentials/JWTs, session introspection, user lookup, and internal organization lookup. Admin writes use the existing idempotency helper and transactional audit records. Authorization changes invalidate sessions; organization membership removal also revokes that user's organization-scoped grants. No schema change was needed. T3 API details are in [02-identity-api](02-identity-api.md), and the full auth/admin/internal contract is in [identity OpenAPI](../../contracts/openapi/identity.json).

The Response campaign lookup client is present and fails closed on missing or malformed responses. `GET /internal/campaigns/{id}` is specified in [03-response-api](03-response-api.md) but is not implemented until T10, so campaign-scoped grant creation will return `RESPONSE_UNAVAILABLE` until T10 lands.

## Verification actually run

- `npm run build` passed for Identity, Response, and Logistics; `npm test` passed with 6 suites / 24 tests plus the key-generator test.
- PostgreSQL 17 HTTP integration passed for T2 authentication and T3 admin/internal APIs, including session invalidation, last-admin protection, audit privacy, idempotency, keyset reads, membership removal, service-token audience checks, and internal lookup. The database was loaded from the authoritative Identity schema.
- k6 `identity-introspection.js` passed at 10 VUs for 15 seconds: p95 4.09 ms, 0% failed HTTP requests, 55,449 HTTP requests. This was a local smoke on PostgreSQL 17; it is not T18's recorded-hardware performance evidence.
- `docker compose --profile test -f backend/infra/compose.test.yaml config --quiet`, OpenAPI JSON parsing and 201 local-reference checks across 25 paths, JS syntax checks, and `git diff --check` passed.
- Current shell Node is 26.5.0, outside `backend/package.json`'s pinned Node 24 range. Earlier T0–T2 checks included Node 24.15.0; rerun T3/full-suite gates under Node 24 when available.
- `bash backend/scripts/test-db` and fresh Docker image builds were not verified in this T3 pass. The disposable PostgreSQL test stack must be stopped after current tests; do not stop any unrelated `simmes-v3-*` containers.

## Binding decisions and known limits

- All user-facing product and backend messages remain Vietnamese. Machine contracts and source identifiers stay English.
- Human staff retain verification, prioritization, and dispatch decisions; AI must not automate them.
- Rate limits are still process-local for registration/login; Nginx tracking quotas are minute-based approximations and use exact client IPs. Upload-byte quota remains open. Resolve the planned limits in T18 before production claims.
- T18 still needs an executed backup/restore runbook covering all three PostgreSQL databases and object bytes with a key/size/checksum manifest. AIStor remains dependent on a separately supplied license file.

## Next task: T4

Implement Response SELF intake only, following [03-response-api §2](03-response-api.md) and T4 in [06](06-implementation-tasks.md): guest and signed-in requests, tracking-secret hashing/replay, region derivation, throttling, subject snapshot, event, and idempotency. Start with TDD and trace the relevant FR/UR/UC/TC identifiers. Verify guest SOS still works without Identity. Do not start T5 until T4 exit evidence passes and T4 is committed.
