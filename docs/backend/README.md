# C48 backend implementation pack

Turns the [technology and delivery plan](../c48-technology-and-delivery-plan.md) into something an engineer can implement without guessing. Status: **T0 workspace, T1 technical package, T2 Identity authentication, T3 Identity administration/internal APIs, T4 Response SELF intake, T6 Response PROXY intake/abuse controls, and T7–T12 are implemented; T5 code is implemented with its AIStor provider gate open; T13–T19 remain. T7 supplies the coordinator queue/detail views for T6 review lanes and flags.** The SQL was executed against PostgreSQL 17 + PostGIS 3.5. Original baseline: 96 assertions. After the 2026-10-10 cleanup and hardening (01 §9, status in §9.5): identity 37, response 95, logistics 133 assertions pass; restricted application roles, the SECURITY DEFINER stock writer, nine two-session races and the key query plans at 200k rows were executed.

| File | Purpose |
|---|---|
| [00-setup.md](00-setup.md) | Repo layout, API conventions, shared error codes (Vietnamese), env vars, testing rules, Definition of Done, rules for AI agents |
| [01-schema-review.md](01-schema-review.md) | Senior review of the data model: round 1 (17 findings) and round 2 by four independent agents (races reproduced, integrity gaps fixed), index policy with measured results, rules the DB cannot enforce, deferred/rejected items |
| [schema/](schema/) | Physical DDL per service (`identity.sql`, `response.sql`, `logistics.sql`) and executable constraint tests (`test-*.sql`) |
| [02-identity-api.md](02-identity-api.md) · [03-response-api.md](03-response-api.md) · [04-logistics-api.md](04-logistics-api.md) | Endpoint contracts: auth, permissions, request/response shapes, rules, error codes |
| [07-error-catalog.md](07-error-catalog.md) | Every error code with HTTP status and Vietnamese message |
| [05-permissions.md](05-permissions.md) | Role → permission map, scope matching, object rules, PII inventory, public surface |
| [06-implementation-tasks.md](06-implementation-tasks.md) | Ordered tasks T0–T19 with dependencies and exit evidence |

**Precedence:** business rules → the plan; column lists and endpoint shapes → this folder. If they conflict, stop and report.

**Re-run the SQL checks** (needs Docker):
```bash
docker run -d --name c48pg -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 postgis/postgis:17-3.5
# for each service: create database, load <service>.sql, then run test-<service>.sql with psql -v ON_ERROR_STOP=1
```

**Focused logic update (2026-10-09, SQL aligned 2026-10-10):** the full main plan and all diagrams are retained. Read plan Sections 27–28 and 01-schema-review §7–§9. The SQL files in `schema/` implement those deltas (status in 01 §9.5), and T0 TypeORM migrations load the same files without diverging.

**Round-2 update (2026-10-09):** read plan Section 28 and 01 §8 after §27/§7. They govern automation, resolution outcomes, headers, loss review, recovery codes, attribution-lock release, delivery carrier and the column/index cleanup. The SQL files implement 01 §9 and the T0-S gate is met for the SQL layer (01 §9.5); the next implementation task after T1 was T2 Identity auth.

**T2 update (2026-10-10):** Identity implements registration, Web/Native login and refresh, logout, password change, current-user grants, CSRF, Argon2id, RS256 access tokens, refresh-family rotation/reuse detection, and disable/authz-version barriers. The tested T2 surface and transport shapes are captured in [identity OpenAPI](../../contracts/openapi/identity.json).

**T3 update (2026-10-10):** Identity implements user, organization, membership, grant, region, audit, and service-token/introspection endpoints. The security follow-up isolates Compose secrets by service, hardens self-grant and temporary-password idempotency checks, and documents `Cache-Control: no-store`; full PostgreSQL HTTP integration, build, unit tests, and a 10-VU introspection k6 smoke passed. See [HANDOFF](HANDOFF.md) for exact evidence and the campaign-validation dependency on T10.

**T4 update (2026-10-11):** Response SELF intake accepts guest and signed-in reports, stores request/subject/event atomically, assigns a region only for one covering boundary, hashes tracking/source-IP secrets, replays the original creation result after state changes, and routes soft-throttled reports to review. Cookie submissions enforce CSRF; guest intake is tested with Identity stopped. Nginx enforces the per-IP hard ceiling across case and trailing-slash aliases. PostgreSQL migration, rollback, API integration, Vietnamese error checks, and the [Response OpenAPI snapshot](../../contracts/openapi/response.json) pass.

**T5 update (2026-10-11):** Response tracking, supplements, account claim/recovery, and private evidence operations are implemented and PostgreSQL HTTP-tested with the in-memory storage adapter; S3 timeouts, private Nginx proxying, quotas, and failed-upload cleanup are covered. The selected AIStor artifact, private access, and restore check remain an open provider gate; T6 adds PROXY intake on the same Response service.

**T6 update (2026-10-11):** `POST /requests/proxy` requires a live Identity session, stores household provenance and derives region from the household pin. Open-account and rolling daily soft limits retain excess reports in `PROXY_QUOTA_REVIEW`; staff-only location/rejection signals are recorded without changing status/priority or blocking the reporter. The selected defaults are 3 open / 10 per rolling 24 hours; the activity flag uses three distinct ~100 m cells in 24 hours. These thresholds are provisional and require field calibration. Database/HTTP integration covers identity outage/revocation, idempotency, provenance, both quota limits, and private flags. T7 will make the review lane and staff flags visible in coordinator queue/detail APIs.
