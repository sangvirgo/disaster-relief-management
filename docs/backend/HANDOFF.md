# Session handoff — C48 backend, 2026-10-10

Template: plan Appendix A.6. Read `/AGENTS.md`, the [project context](../c48-project-context.md), plan Sections 27–28, then [README](README.md) → [00-setup](00-setup.md) → [01 §7–§9](01-schema-review.md).

## Objective and scope
Prepare the C48 backend for implementation: review the plan and backend pack for logic errors, apply the owner's decisions, align and verify the physical schema. **No application code, migrations or OpenAPI exist yet.**

## Repository placement
Backend in `backend/`, exported API contracts in `contracts/openapi/`, Web in `web/`, Mobile in `mobile/`, AI only as the optional `advisor` module inside `backend/apps/response` (00-setup §1.1).

## What is done
- Infrastructure specification (00 §8) and demo seed data (`seed/seed-{identity,response,logistics}.sql`, 00 §9): seeds load cleanly on fresh databases and their end-of-file assertions pass; cross-service ids were cross-checked. Seeds use the placeholder psql variable `seed_password_hash` that the seeder must fill with an Argon2id hash of `SEED_PASSWORD`.
- Plan Section 28 and 01 §8–§9 record the round-2 decisions (resolution outcomes, one credential header scheme, loss review table, recovery table, attribution-lock release, skip Logistics for requests never admitted, supplement gating, automation matrix, optional delivery-carrier slice, column/index cleanup).
- `docs/backend/schema/{identity,response,logistics}.sql` and `test-*.sql` implement them and were executed on `postgis/postgis:17-3.5`: identity 37, response 95, logistics 133 assertions pass; restricted application roles, the SECURITY DEFINER stock writer, nine two-session races (`race-tests-*.sh`) and query plans at 200k rows (`explain-*.sql`) ran. Details and numbers: 01 §9.5.

## Owner decisions that bind the implementation
- Independent human review of every donation receipt is mandatory; **no auto approval** of receipts or distributions (the DB enforces it for receipts).
- Police/military/government units are `GOVERNMENT`/`MILITARY` teams; units without the app use `COORDINATOR` mode and the coordinator records progress (including DECLINE).
- Citizens never enter item lists; phone, headcount, note and media are optional; category `UNKNOWN` exists.
- Automatic steps are bookkeeping and warnings only; verification, priority, rescue dispatch and the resolve command stay human.
- Delivery by the rescue team (plan §28.3) is an optional slice after T15.

## Not done / next concrete task
- **T0** (06-implementation-tasks): monorepo, three Nest apps, Compose with the pinned PostGIS digest, TypeORM migrations whose dump equals `schema/*.sql`, `VERSIONS.md`. Then T1.
- Service-level rules without SQL: `attribution_locked_at`/`logistics_admitted_at` handling, `outcome_basis`, orphaned-duplicate cascade, derived count flags, need auto-FULFILLED, auto reconcile, concurrence staleness by material fact event, cross-service admit/seal/abort races (T9, T14, T16).
- Primary-source checks before pinning (plan A.5): Node/Nest/TypeORM versions, MinIO AIStor licence/artifact, map tile provider.
- Known loose ends: the append-only table list lives in both the trigger block and the grant block of each SQL file; `request_attention_idx` predicate must equal the query text exactly; role names are cluster-wide, so loading a file twice into one database fails on CREATE TABLE.

## Commands to re-verify (needs Docker)
```bash
docker run -d --name c48pg -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 postgis/postgis:17-3.5
export PGPASSWORD=x PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres
cd docs/backend/schema
for s in identity response logistics; do psql -qc "create database t_$s"; psql -d t_$s -q -v ON_ERROR_STOP=1 -f $s.sql && psql -d t_$s -v ON_ERROR_STOP=1 -f test-$s.sql; done
./race-tests-response.sh && ./race-tests-logistics.sh
```
Never mark a test case passed from a documentation edit. Do not commit secrets.
