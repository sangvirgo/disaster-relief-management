# 06 — Ordered implementation tasks

**T0-S is done for the SQL layer (01 §9.5); start with T0.** Read plan §27, §28 and 01 §7–§9. The SQL files in `schema/` implement the target deltas; application code must match them through migrations.

One task per branch/PR. A task is done only when its **exit evidence** exists (commands + results recorded) and the Definition of Done in [00](00-setup.md) §6 holds. Order follows plan §16 slices; do not start a task before its dependencies. Cut order if time runs out (plan §16): optional AI → push → full offline queue → CSV → advanced warehouse depth (see [01](01-schema-review.md) §5) — never the seal protocol, independent review, once-only posting, nonnegative stock, human verification, privacy, Vietnamese messages or truthful ACK.

| # | Task | Depends | Deliverables | Exit evidence |
|---|---|---|---|---|
| T0-S | **Focused target schema alignment** — DONE for the SQL layer 2026-10-10 (evidence in 01 §9.5: restricted roles, SECURITY DEFINER writer, races, EXPLAIN) | — | Verify supported PostgreSQL/PostGIS and pin image first; apply01 §7 to schema/migrations and focused assertions; complete every-column/index inventory | Real restricted-role assertions, controlled two-session races, exact SQLSTATE/constraint checks and measured EXPLAIN evidence recorded; no inherited PASS claim for new deltas |
| T0 | **Spike + workspace** | T0-S | Monorepo skeleton, three Nest apps booting, Compose (3 DBs, PostGIS image digest pinned, MinIO AIStor Free, Nginx), `VERSIONS.md`; load `schema/*.sql` through TypeORM migrations; race test on `mission_team_one_active_uq`; `ST_DWithin` + `FOR UPDATE` demo | Migrated schema dump equals `schema/*.sql`; `schema/test-*.sql` pass; parallel-transaction test output; decision recorded if TypeORM is replaced |
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
| T16 | **Resolution/cancellation seal** | T9,T14,T15 | Response intents, recovery task, Logistics freeze/seal/unseal, resolve/abort/close/reopen/cancel endpoints | TC-BE-17/18, TC-BE-07, TC-REV (resolve path), crash-recovery test (kill between seal and commit) — do this **early**, it is the riskiest part (plan R-03) |
| T17 | **Reports and reconciliation** | T13,T15 | stock/fulfillment/donation reports, public summary, reconciliation flags | TC-REC-01, TC-BE-14 (full), TC-23 |
| T18 | **Hardening + evidence** | T2–T17 | security headers/CSP, throttling configs, log redaction, backup/restore runbook executed, k6 scenario, accessibility of API error copy | TC-BE-27/28/29, TC-29, TC-PERF-01 with hardware recorded |
| T19 | **Contracts + handoff** | T18 | exported OpenAPI per service committed, traceability matrix updated, SRS/SDD derivations, user-guide inputs, session handoff note | OpenAPI diff clean; matrix lists executed vs planned |

**Parallel work for Web/Mobile:** after each task export `openapi.json`; frontends mock from it. Contracts change only through a documented edit to 02–04 first.

**Open items that block specific tasks:** priority/region seed polygons and the heatmap projection (T4, T10); map tile provider (Web, not backend); MinIO AIStor Free licence/artifact (T0, T5); decision on warehouse-depth cuts (T12–T15); retention policy (none until decided).

## Race and scale tests required by the 4-agent review (add to the tasks above)

| Where | Test |
|---|---|
| T2/T3 | Disable user while a refresh rotation is in flight ⇒ no live refresh token afterwards; `authz_version` mismatch ⇒ introspection inactive |
| T4/T5 | Same idempotency key sent twice in parallel ⇒ one request row, duplicate replays; retry of a lost response with the same secret returns the original, never `TRACKING_SECRET_IN_USE` |
| T7 | Duplicate A→B vs B→C; verify with a stale `CONCURRENCE` (supplement in between) ⇒ rejected |
| T8/T9 | Offer vs availability PATCH (team never UNAVAILABLE with an OFFERED mission); leader transfer vs member removal (APP always has one active leader; COORDINATOR may have zero accounts); offer vs campaign close; mission transition vs `resolve` (RESOLVING barrier holds even for a no-op recompute) |
| T11 | Two reviewers approve one adjustment with different keys ⇒ one movement; `TRUNCATE` on append-only tables refused |
| T13 | Two posts of items (A,B)/(B,A) to the same warehouse with no balance rows ⇒ no deadlock; post replayed under a new key ⇒ one credit |
| T15 | Handoff over-balance with two parallel handoffs; approval, then line edit, then dispatch ⇒ `APPROVAL_STALE` |
| T16 | Delayed `seal` after `abort` ⇒ refused; delayed `unseal` of an old intent ⇒ refused; delayed `POST /needs` after cancel ⇒ `CYCLE_FROZEN`; finalizer vs abort ⇒ exactly one wins |
| T10/T17/T18 | `EXPLAIN` on the queue, unassigned, candidate, heatmap and report queries at 200k requests (budgets: queue < 5 ms, heatmap < 500 ms); keyset page 2/50 uses `Index Cond` |

## Focused logic acceptance ownership (plan §27)

| Tasks | Required addition |
|---|---|
| T4/T5/T7 | TC-LOGIC-01/04/10/14: optional intake/unknown facts, guest tracking version, recovery, scoped sources/concurrence, immutable approved snapshots and explicit supplement review; pending danger alerts immediately. |
| T8/T9 | TC-LOGIC-02/03/12: accountless external team, field outcome without media, active-cancel readiness, first-offer attribution stamp and offer-versus-attribution race. |
| T11/T0-S | TC-LOGIC-09/13: hardened stock writer under restricted role, lexical decimals/finite values, useful columns/index inventory and EXPLAIN. |
| T13/T17 | TC-LOGIC-07/08: held revision independently reviewed before incremental post; POSTED history preserved; accepted by drive and distributed by campaign/warehouse separately. |
| T14/T15 | Need auto FULFILLED, "prepare from commitments" with human approval only, auto reconcile, loss review table, settlement slimming (TC-AUTO-03/04, TC-AUTO-02, TC-R2-07) |
| T0/T16 | TC-LOGIC-05/11: prototype delayed-seal-after-abort durable local fence early at T0; full resolution/failure-review/adopt/abort and zero-mission branch at T16; original202 replay preserved. |

Client, AI research, SRS/SDD, schedule and demo deliverables remain in the full plan. This backend task update does not delete or replace them. No SQL/runtime checks were executed for this documentation review.

## Round-2 additions (plan §28)

| Tasks | Required addition |
|---|---|
| T0-S | Apply 01 §8 deltas and the column/index audit; remove columns without writer and reader; TC-R2-02/03/07 schema assertions |
| T4/T5/T6 | `UNKNOWN` category seed; header scheme (`X-Tracking-Secret`); TC-R2-06 |
| T7 | Duplicate cascade (TC-AUTO-05), concurrence by material fact event (TC-R2-05), supplement gating (TC-R2-04), corroboration candidates |
| T8/T9 | GOVERNMENT COORDINATOR teams, DECLINE on behalf, region-null offers refused, attribution-lock release (TC-R2-08, TC-R2-03) |
| T13 | Receipt derived flags and highlight only; independent human review stays mandatory (TC-AUTO-01) |
| T14/T15 | Need auto FULFILLED, "prepare from commitments" with human approval only, auto reconcile, loss review table, settlement slimming (TC-AUTO-02/03/04, TC-R2-07) |
| T16 | `outcome_basis` resolution, skip Logistics when `logistics_admitted_at` is null (TC-R2-01/02) |
| After T15 (optional) | Delivery-carrier slice, plan §28.3 (TC-DEL-01) |

Automatic steps must write a SYSTEM event naming the rule; they never replace human verification, priority, rescue dispatch or the resolve command.

T0-S additionally follows 01 §9 (column and index cleanup, receipt-independence trigger, review-uniqueness indexes); its exit gate is §9.4.
