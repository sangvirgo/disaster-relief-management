# SOS Advisory and Focused Demo Review Fixes

> **For agentic workers:** Use subagent-driven-development for the separate AI, presentation, and Postman tasks. Preserve the existing uncommitted work. Do not build, start containers, reset databases, or call live providers.

**Goal:** Correct the reviewed advisory and Postman defects while keeping SOS coordination central and donations a small supporting workflow.

**Architecture:** Keep the three existing services and manual priority/dispatch. Reuse the Response advisory table and existing state transitions; no new service, runtime, dependency, or test database. External advisory input defaults to structured facts, with narrative excluded unless explicitly enabled for synthetic demonstrations. Automatic retries are limited by `GEMINI_MAX_RETRIES`; expired leases can be reclaimed with claim-token fencing, and a scoped coordinator can explicitly retry a current failed advisory through an idempotent endpoint. Main Postman scenarios preserve aggregate identity, actor boundaries, current versions, and necessary repeated operations. Existing Logistics APIs and accounting safeguards remain available; the demo does not need to exercise all public operations.

**Tech Stack:** NestJS/TypeScript, PostgreSQL/PostGIS, React, Postman v2.1, existing Jest and Node script tests.

## Accepted scope

The user authorized implementing the preceding review recommendations and reducing donation/logistics emphasis. Work in the current workspace, including its uncommitted feature changes. Keep machine-readable contracts stable where possible; document additive freshness and unknown states. Technical documentation remains English and product copy Vietnamese.

### Task 1: Advisory correctness and external data minimization

- [ ] Add regression cases for enqueue/claim input agreement, sticky danger, A → B → A, accepted supplements, stale review, insufficient input, and narrative egress.
- [ ] Use a versioned advisory input identity so fact reversions cannot select an unrelated latest result; check freshness on reads and authoritative reviews.
- [ ] Enqueue after accepted material supplements and derive hashes from persisted values.
- [ ] Default to structured external input; remove the broad title-case name matcher that destroys emergency descriptions.
- [ ] Represent insufficient facts explicitly without changing official priority or queue order.
- [ ] Run only targeted host unit tests with the available Node 24 runtime.

### Task 2: Coordinator presentation

- [ ] Display insufficient, stale, disabled, failed, and rejected advice accurately in Vietnamese.
- [ ] Keep rejected results as clearly marked history; never present them as current recommendations.
- [ ] Update review payloads if freshness/version guards require them.
- [ ] Check frontend types without emitting build artifacts.

### Task 3: Focused Postman scenarios

- [ ] Replace route-uniqueness assertions with behavioral script/scenario checks.
- [ ] Make the main SELF → verification → human triage → offer → team progress → resolution sequence explicit, with necessary login, detail, and transition repeats.
- [ ] Preserve IDs, capabilities, and versions across actor changes and list reads; polling must be bounded.
- [ ] Keep duplicate and recovery scenarios separate, with distinct canonical/contact IDs and independent actors.
- [ ] Keep only a short optional donation intake/review flow; use valid conserved quantities and actual revisions. Remove advanced donation/logistics operations from the default demonstration.
- [ ] Run focused Node script tests without HTTP execution.

### Task 4: Integration, contracts, and guidance

- [ ] Update AGENTS.md and project/backend guidance: SOS coordination is the primary demonstration; donations remain supporting; do not weaken stock accounting or independent review.
- [ ] Update OpenAPI generation details and snapshots for any advisory response/review changes.
- [ ] Inspect the complete diff and run relevant unit/script/contract/type checks that need neither builds nor live services.
- [ ] Record actual checks and explicitly identify all live integration verification not performed.

### Follow-up: Retry control and coordinator retry endpoint

- [x] Set `GEMINI_MAX_RETRIES=3` by default and allow a finite, environment-configured retry budget.
- [x] Requeue expired processing leases while budget remains; fence every result write with the current claim token.
- [x] Add an idempotent `REQUEST_VERIFY`-scoped endpoint to retry only the latest fresh `FAILED` advisory, resetting its budget and writing a staff audit event.
- [x] Update the database migration/schema, OpenAPI, Vietnamese timeline label, API guide, and regression tests.

### Verification record (2026-10-28)

- `npm test` (backend): 120 Jest suites / 631 tests passed; 111 Node script tests passed.
- `npm run build` (backend) and `npm run build` (frontend/web) passed. The frontend build reports its existing large-chunk advisory.
- `npm run contracts:check` passed: 37 Identity, 82 Response, and 86 Logistics operations.
- `npm run check:compose-env` passed for all 13 primary Compose services.
- `git diff --check` passed. Verification ran under Node 26.11.1, outside the documented Node 24 engine range.
- No primary database migration or live Gemini request was run; those require the main stack/provider configuration.
