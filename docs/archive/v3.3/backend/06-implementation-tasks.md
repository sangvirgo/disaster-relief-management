> **Historical v3.3 source — not an implementation contract.** Read the [current backend pack](../../../backend/README.md) for v4.0 authority. Old section numbers, test claims and commands below describe their original revision.

# 06 — Ordered implementation tasks

## Agent start here

1. Read `/AGENTS.md`, `docs/c48-project-context.md`, plan **§22, §23, §25, §26, §27** and Appendix A, then `README.md` and `00`–`07` in this folder.
2. **First task is T0-S (schema round 3), then T0.** `schema/*.sql` is not yet at the final contract: `01-schema-review.md` §7 lists seven changes (R1, L1–L7) with the tests required. Do T0-S as one commit, run every `test-*.sql` (existing 96 + new) on `postgis/postgis:17-3.5`, record commands and results in `docs/backend/VERSIONS.md`. Do not start T0 until T0-S passes.
3. Cut ladder and gates: plan §27.1. Do not implement a cut candidate before its week-5 gate; do not cut a protected item (seal, independent review, once-only posting, nonnegative stock, human verification, Vietnamese content).
4. Every list endpoint must meet 00 §3.4 (query budget, batching, open-status indexes). Every cross-service multi-record read uses the batch endpoints (03 §5, 04 §5).
5. When a rule here conflicts with the plan, stop and report (00 §7); do not choose silently.

One task per branch/PR. A task is done only when its **exit evidence** exists (commands + results recorded) and the Definition of Done in [00](00-setup.md) §6 holds. Order follows plan §16 slices; do not start a task before its dependencies. Cut order if time runs out (plan §16): optional AI → push → full offline queue → CSV → advanced warehouse depth (see [01](01-schema-review.md) §5) — never the seal protocol, independent review, once-only posting, nonnegative stock, human verification, privacy, Vietnamese messages or truthful ACK.

| # | Task | Depends | Deliverables | Exit evidence |
|---|---|---|---|---|
| T0-S | **Schema round 3** | — | Apply `01-schema-review.md` §7 (R1, L1–L7) to `schema/response.sql` and `schema/logistics.sql`; add the §7.3 assertions to `schema/test-response.sql` / `test-logistics.sql`; update the existing test inserts that need `organization_id` on `donation_delivery` / `donation_receipt` | All previous assertions + new ones PASS on PostgreSQL 17 + PostGIS 3.5 (`ON_ERROR_STOP`); `EXPLAIN` evidence for R1/L1–L3 on a ≥ 200 k-row fixture saved under `docs/backend/evidence/`; 01 §3 table updated with the new measurements |
| T0 | **Spike + workspace** | — | Monorepo skeleton, three Nest apps booting, Compose (3 DBs, PostGIS image digest pinned, MinIO AIStor Free, Nginx), `VERSIONS.md`; load `schema/*.sql` through TypeORM migrations; race test on `mission_team_one_active_uq`; `ST_DWithin` + `FOR UPDATE` demo | Migrated schema dump equals `schema/*.sql`; `schema/test-*.sql` pass; parallel-transaction test output; decision recorded if TypeORM is replaced |
| T1 | **Technical package** | T0 | Error envelope + exception filter loading [07-error-catalog.md](07-error-catalog.md), **central SQLSTATE mapper (23505/23514/40P01/55P03)**, idempotency interceptor (insert-first protocol, 00 §3), purpose-bound secret hashing with versioned pepper, scope evaluator + role→permission constant ([05](05-permissions.md)), correlation id, **keyset helper with `(sort, id)` cursor + filter hash**, env validation, **pino redaction paths**, **job runner (advisory lock + SKIP LOCKED + jitter)**, **cross-service client (keep-alive, timeout, circuit breaker, single-flight)**, `UPDATE … WHERE version` helper | Unit tests; TC-L10N-01 skeleton (no English framework text leaks); idempotency replay/conflict/in-progress tests on real DB |
| T2 | **Identity auth** | T1 | register/login/refresh/logout/change-password/me/csrf; Argon2id; family rotation + reuse detection; Web cookie vs Native transports | TC-BE-01 (partial), TC-BE-20, TC-BE-28; parallel-refresh test (loser gets `REFRESH_RACE`, family survives); disable-vs-rotation race leaves no live token |
| T3 | **Identity admin + internal** | T2 | users, orgs, memberships, grants, regions, audit, `/internal/token|introspect|users:lookup`, seeds | Grant change revokes sessions; last-admin guard; introspection p95 under k6 smoke; TC-BE-12 identity half |
| T4 | **Response: SELF intake** | T1,T3 | `POST /requests` (guest + signed-in), tracking secret protocol, region derivation, soft/hard throttle (`RATE_LIMITED_REVIEW`), subject snapshot, event, idempotency | TC-01..05, TC-20, TC-BE-24 (intake part), TC-BE-12 (unassigned queue) |
| T5 | **Response: tracking, supplement, claim, evidence** | T4 | track, supplements, mine, claim, secret revoke, evidence upload/download via MinIO with quota + reconciler | TC-24, TC-BE-22, TC-BE-24 rest; storage-down keeps SOS |
| T6 | **Response: PROXY + abuse controls** | T4 | `POST /requests/proxy`, `PROXY_OPEN_CAP`, `PROXY_QUOTA_REVIEW`, informational flags | TC-REV-01..03, TC-REV-12; Identity-down ⇒ 503, never SELF fallback |
| T7 | **Response: verification, duplicates, priority** | T4 | start-verification, contact attempts, verify/reject/duplicate/concur, candidates, triage, authority referral, region correction, overdue scan + notices | TC-09..11, TC-BE-03/11/25, TC-REV-04; race: duplicate A→B vs B→C |
| T8 | **Response: teams, position, candidates** | T3 | teams/members/skills/position endpoints, candidates query with priority-aware band | TC-12, TC-REV-05/06/13; unit tests of the band algorithm with the plan's examples; `EXPLAIN` on candidate query |
| T9 | **Response: missions** | T7,T8 | create/offer, accept/decline/transition, record-on-behalf, cancel/fail, progress recompute, overdue offers, mission evidence | TC-07, TC-13, TC-14, TC-BE-04/10, TC-REV-07/11; race: two offers to one team |
| T10 | **Response: campaigns, map, reports, notices** | T7 | campaign lifecycle, public projection, heatmap, summary report, notices | TC-30, TC-BE-02/13/14 (Response half), TC-REV-08; heatmap on 10k seed < 2 s |
| T11 | **Logistics: catalog, assets, opening, adjustments** | T3 | items/types/units, warehouses, points, vehicles, opening stock, adjustment request/review, stock + movements read | TC-BE-21; ledger append-only + balance = Σ movements test; adjustment self-review denied |
| T12 | **Logistics: drives and declarations** | T11 | public drive pages, drive lifecycle, guest/signed-in deliveries, revisions, disputes, claim, assisted declaration, capability secret | TC-DON-01/02/06/07, TC-REV-09/14; guest works with Identity stopped |
| T13 | **Logistics: count, review, post** | T12 | receipts, count revisions, review, post (exactly once), release-held, dispute resolve | TC-DON-03/04/05/09; concurrent post and replay-with-new-key ⇒ one credit; self-review denied |
| T14 | **Logistics: needs, commitments, fulfillment** | T11,T9 | cycle, needs, reduce/cancel/confirm, commitments, release, fulfillment board, internal read | TC-15, TC-18, TC-19, TC-31, TC-BE-05/09/15/19/23/26; race: two commitments on one need |
| T15 | **Logistics: distribution and handoff** | T14 | prepare/approve/dispatch/cancel, handoffs with arithmetic, settlements, return/loss, reconcile | TC-16, TC-DIST-01..04; race: two dispatches on one stock; approval voided by edit |
| T16 | **Resolution/cancellation seal** | T9,T14 | Response intents, recovery task, Logistics freeze/seal/unseal, resolve/abort/close/reopen/cancel endpoints | TC-BE-17/18, TC-BE-07, TC-REV (resolve path), crash-recovery test (kill between seal and commit) — do this **early**, it is the riskiest part (plan R-03) |
| T17 | **Reports and reconciliation** | T13,T15 | stock/fulfillment/donation reports, public summary, reconciliation flags | TC-REC-01, TC-BE-14 (full), TC-23 |
| T18 | **Hardening + evidence** | all (needs TC-PERF-02 scale seed) | security headers/CSP, throttling configs, log redaction, backup/restore runbook executed, k6 scenario, accessibility of API error copy | TC-BE-27/28/29/30, TC-29, TC-PERF-01 **and TC-PERF-02** (1 M-row seed, ≤ 1 % open) with hardware recorded; `pg_stat_statements` top-20 attached |
| T19 | **Contracts + handoff** | all | exported OpenAPI per service committed, traceability matrix updated, SRS/SDD derivations, user-guide inputs, session handoff note | OpenAPI diff clean; matrix lists executed vs planned |

**Parallel work for Web/Mobile:** after each task export `openapi.json`; frontends mock from it. Contracts change only through a documented edit to 02–04 first.

**Open items that block specific tasks:** priority/region seed polygons and the heatmap projection (T4, T10); map tile provider (Web, not backend); MinIO AIStor Free licence/artifact (T0, T5); warehouse-depth cuts are decided by the plan §27.1 gates (week 5 / week 7); retention policy (none until decided).

## Race and scale tests required by the 4-agent review (add to the tasks above)

| Where | Test |
|---|---|
| T2/T3 | Disable user while a refresh rotation is in flight ⇒ no live refresh token afterwards; `authz_version` mismatch ⇒ introspection inactive |
| T4/T5 | Same idempotency key sent twice in parallel ⇒ one request row, duplicate replays; retry of a lost response with the same secret returns the original, never `TRACKING_SECRET_IN_USE` |
| T7 | Duplicate A→B vs B→C; verify with a stale `CONCURRENCE` (supplement in between) ⇒ rejected |
| T8/T9 | Offer vs availability PATCH (team never UNAVAILABLE with an OFFERED mission); leader transfer vs member removal (always one active leader); offer vs campaign close; mission transition vs `resolve` (RESOLVING barrier holds even for a no-op recompute) |
| T11 | Two reviewers approve one adjustment with different keys ⇒ one movement; `TRUNCATE` on append-only tables refused |
| T13 | Two posts of items (A,B)/(B,A) to the same warehouse with no balance rows ⇒ no deadlock; post replayed under a new key ⇒ one credit |
| T15 | Handoff over-balance with two parallel handoffs; approval, then line edit, then dispatch ⇒ `APPROVAL_STALE` |
| T16 | Delayed `seal` after `abort` ⇒ refused; delayed `unseal` of an old intent ⇒ refused; delayed `POST /needs` after cancel ⇒ `CYCLE_FROZEN`; finalizer vs abort ⇒ exactly one wins |
| All list tasks | TC-BE-30: statement count for page size 5 equals page size 50; no per-row cross-service call (TC-BE-33 batch endpoints) |
| T14/T15 | TC-BE-31 (need target lock and settlement target) |
| T13 | TC-BE-32 (posting cap) |
| T10/T17/T18 | `EXPLAIN` on the queue, unassigned, candidate, heatmap and report queries at 200k requests (budgets: queue < 5 ms, heatmap < 500 ms); keyset page 2/50 uses `Index Cond` |
