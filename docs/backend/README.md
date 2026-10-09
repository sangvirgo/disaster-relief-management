# C48 backend: implementation entry point

**Version 4.0 · 2026-10-09 · documentation baseline.** Read [project context](../c48-project-context.md), [main plan/Appendix A](../c48-technology-and-delivery-plan.md) and root AGENTS first.

| Read in order | Purpose |
|---|---|
| [01-design.md](01-design.md) | Business states, service ownership, permissions, target database changes, field/index purpose and transaction rules. |
| [02-api-contracts.md](02-api-contracts.md) | Complete core endpoint/DTO/authorization contracts and Vietnamese error catalog. |
| [03-implementation.md](03-implementation.md) | T0-S/T0–T19, dependencies, concrete acceptance cases and execution evidence gates. |

**Authority:** the main plan fixes scope; design fixes business/data rules; API fixes transport; implementation plan fixes order/evidence. Resolve contradictions in these files before implementing the affected slice. No archive document overrides this pack.

**First task: T0-S, then T0.** [schema/](schema/) contains the v3.3 SQL input and old assertions. It is intentionally unchanged in this documentation revision. Apply every target delta in 01, replace/update focused assertions, run PostgreSQL/PostGIS restricted-role and race checks, and record evidence before treating it as the implementation schema. No v4.0 SQL/runtime compatibility or application tests are claimed to have passed.

The previous eight backend documents and cumulative main plan are [archived](../archive/v3.3/backend/README.md) for provenance; agents do not need to read them to implement the current core. Existing diagrams are historical until regenerated/checked against this baseline.

The review/evidence ledger is in 03. Execution creates `VERSIONS.md` and `evidence/` only when exact versions and checks actually exist. Do not add competing plans, return ORM entities, introduce Python/brokers/payments or automate rescue decisions.
