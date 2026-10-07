# C48 backend implementation pack

Turns the [technology and delivery plan](../c48-technology-and-delivery-plan.md) into something an engineer or AI agent can implement without guessing. Status: **design artifacts only — no application code, migrations or product tests exist yet.** The SQL was executed against PostgreSQL 17 + PostGIS 3.5 (96 constraint assertions pass; hot queries measured at 200k rows; six race conditions reproduced by a reviewer and fixed in the design); nothing else has been run.

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
