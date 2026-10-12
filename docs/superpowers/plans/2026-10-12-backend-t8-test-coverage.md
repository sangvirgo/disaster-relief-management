# Backend T8 test coverage

## Scope

Add focused unit and database-backed integration coverage for existing T8 behavior. Do not change runtime behavior, API contracts, schemas, migrations, or user-facing copy.

## Steps

1. Add a unit test that verifies a request without a region returns empty candidate lists without querying candidate data.
2. Extend the T8 database smoke tests to cover distance-based position suppression, candidate eligibility exclusions, and a nonexistent team leader UUID.
3. Run the focused Jest tests, TypeScript check, full Jest/Node test suite, and database smoke gate. Confirm OpenAPI snapshots and migrations are unchanged.
4. Have a NestJS structure/spec reviewer inspect the test placement and assertions; update the backend handoff with results and remaining acceptance gates.

## Acceptance

- New unit and integration cases pass with the existing backend test conventions.
- Candidate exclusions are asserted against both `items` and `unknown_position`.
- Suppressed position updates leave the stored row and audit count unchanged.
- A nonexistent leader returns the existing `NOT_FOUND` contract and creates no team.
- `npm run build`, `npm test`, `npx tsc --noEmit`, and `bash scripts/db/test-db` pass.
- `contracts/openapi/*.json` and migration/schema files have no diff.
