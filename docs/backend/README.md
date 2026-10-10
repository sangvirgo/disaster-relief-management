# C48 backend implementation pack

Turns the [technology and delivery plan](../c48-technology-and-delivery-plan.md) into something an engineer or AI agent can implement without guessing. Status: **design artifacts only — no application code, migrations or product tests exist yet.** The SQL was executed against PostgreSQL 17 + PostGIS 3.5. Original baseline: 96 assertions. After the 2026-10-10 cleanup and hardening (01 §9, status in §9.5): identity 37, response 95, logistics 133 assertions pass; restricted application roles, the SECURITY DEFINER stock writer, nine two-session races and the key query plans at 200k rows were executed.

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

**Focused logic update (2026-10-09, SQL aligned 2026-10-10):** the full main plan and all diagrams are retained. Read plan Sections 27–28 and 01-schema-review §7–§9. The SQL files in `schema/` implement those deltas (status in 01 §9.5); there are still no migrations or application code.

**Round-2 update (2026-10-09):** read plan Section 28 and 01 §8 after §27/§7. They govern automation, resolution outcomes, headers, loss review, recovery codes, attribution-lock release, delivery carrier and the column/index cleanup. The SQL files implement 01 §9 and the T0-S gate is met for the SQL layer (01 §9.5); what remains is T0 (migrations equal to these files) and service-level rules.
