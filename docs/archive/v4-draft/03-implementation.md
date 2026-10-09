> **Superseded condensed draft — retained for history only.** The user requested the full plan and diagrams be preserved. Read the [active full plan](../../c48-technology-and-delivery-plan.md) and [current backend entry point](../../backend/README.md). This draft does not govern implementation.

# C48 Backend Implementation Plan

> For agentic workers: execute one task at a time using the available subagent-driven-development or executing-plans workflow; review each task against the design and API contract before proceeding.

**Goal:** implement the reviewed rescue and in-kind assistance workflows without inventing business rules.
**Architecture:** Identity, Response and Logistics own separate databases and local transactions; REST admission/seals protect shared request cycles.
**Stack:** NestJS/TypeScript, TypeORM, PostgreSQL/PostGIS, private S3 storage, Compose/Nginx; exact versions are verified and pinned at setup.
**Status:** documentation only. No application code or v4.0 migrations exist. Legacy SQL assertions were reported executed under v3.3; no claim is made that v4.0 SQL/runtime tests have passed.

## 1. Agent start and stop rules

- [ ] Read root AGENTS, project context, current main plan/Appendix A, backend README, `01-design.md`, `02-api-contracts.md`, then this file.
- [ ] Check current Git state and inspect actual files. The SQL files in `schema/` are **legacy input**, with all v4.0 changes enumerated in the design.
- [ ] Begin T0-S: verify supported PostgreSQL/PostGIS versions and pin the database image digest from primary sources, then revise schema/tests as a reviewed change, verify on real PostgreSQL/PostGIS, record output. Then T0 proves application/runtime compatibility.
- [ ] Do not start a dependent task before its exit evidence exists. Prototype terminal seal/abort/admission races in T0; finish the full workflow in T16.
- [ ] Generate OpenAPI per accepted slice. Client mocks use the same exported contract. Never return ORM entities.
- [ ] Before claiming completion, inspect the diff, run the task checks, read results, update evidence and leave the next task.

Documentation review permits starting schema/setup work; it does not waive the SQL, authorization, race, runtime or restore gates. Provider/retention decisions block only their affected integration or real-data use. Use synthetic data throughout.

## 2. Ordered tasks

Each task follows: define its exact contract/fixtures → add focused invariant checks → implement the smallest complete slice → execute relevant checks → review the diff → record evidence. Target source files live under `backend/apps/{identity,response,logistics}/src/modules/` by the module names in the design; migrations under each app's `src/database/migrations/`; integration cases under `backend/test/integration/`; workload under `backend/test/k6/`. Create only modules used by the active slice.

| # | Task | Depends | Deliverables | Exit evidence |
|---|---|---|---|---|
| T0-S | **Target schema v4.0** | — | Apply every v4.0 schema delta and index decision in `01-design.md` to all three `schema/{identity,response,logistics}.sql` files; add TC-LOGIC assertions below to `schema/test-{identity,response,logistics}.sql`; update the existing test inserts that need `organization_id` on `donation_delivery` / `donation_receipt` | Database support/image digest recorded first; all retained assertions plus new invariants PASS on the verified PostgreSQL/PostGIS baseline (`ON_ERROR_STOP`); `EXPLAIN` evidence for target queue/distribution/drive/delivery indexes on a ≥ 200 k-row fixture saved under `docs/backend/evidence/`; index inventory updated with measured results |
| T0 | **Spike + workspace** | T0-S | Monorepo skeleton, three Nest apps booting, Compose (3 DBs, PostGIS image digest pinned, MinIO AIStor Free, Nginx), `VERSIONS.md`; load `schema/*.sql` through TypeORM migrations; race test on `mission_team_one_active_uq`; `ST_DWithin` + `FOR UPDATE` demo; controlled admission/abort/delayed-seal prototype | TC-LOGIC-12 delayed-seal-after-abort and attribution admission race outputs recorded; migrated schema dump equals `schema/*.sql`; `schema/test-*.sql` pass; parallel-transaction test output; decision recorded if TypeORM is replaced |
| T1 | **Technical package** | T0 | Error envelope + exception filter loading 02-api-contracts.md, **central SQLSTATE mapper (23505/23514/40P01/55P03)**, idempotency interceptor (insert-first protocol, 01-design.md common contracts), purpose-bound secret hashing with versioned pepper, scope evaluator + role→permission constant (02-api-contracts.md), correlation id, **keyset helper with `(sort, id)` cursor + filter hash**, env validation, **pino redaction paths**, **job runner (advisory lock + SKIP LOCKED + jitter)**, **cross-service client (keep-alive, timeout, circuit breaker, single-flight)**, `UPDATE … WHERE version` helper | Unit tests; TC-L10N-01 skeleton (no English framework text leaks); idempotency replay/conflict/parallel replay tests on real DB |
| T2 | **Identity auth** | T1 | register/login/refresh/logout/change-password/me/csrf; Argon2id; family rotation + reuse detection; Web cookie vs Native transports | TC-BE-01 (partial), TC-BE-20, TC-BE-28; parallel-refresh test (loser gets `REFRESH_RACE`, family survives); disable-vs-rotation race leaves no live token |
| T3 | **Identity admin + internal** | T2 | users, orgs, memberships, grants, regions, audit, `/internal/token|introspect|users:lookup`, seeds | Grant change revokes sessions; last-admin guard; introspection p95 under k6 smoke; TC-BE-12 identity half |
| T4 | **Response: SELF intake** | T1,T3 | `POST /requests` (guest + signed-in; note optional, phone/headcount unknown allowed), tracking secret protocol, region derivation, soft/hard throttle (`RATE_LIMITED_REVIEW`), subject snapshot, event, idempotency | TC-01..05, TC-20, TC-BE-24 (intake part), TC-BE-12 (unassigned queue) |
| T5 | **Response: tracking, supplement, claim, evidence** | T4 | track, supplements, mine, claim, secret revoke, evidence upload/download via MinIO with quota + reconciler | TC-24, TC-BE-22, TC-BE-24 rest; storage-down keeps SOS |
| T6 | **Response: PROXY + abuse controls** | T4 | `POST /requests/proxy`, `PROXY_OPEN_CAP`, `PROXY_QUOTA_REVIEW`, informational flags | TC-REV-01..03, TC-REV-12; Identity-down ⇒ 503, never SELF fallback |
| T7 | **Response: verification, duplicates, priority** | T4 | start-verification, contact attempts, verify/reject/duplicate/concur, candidates, triage, source-referenced decisions, authority referral, pre-admission region correction, cross-lane SUBMITTED/VERIFYING alerts | TC-09..11, TC-BE-03/11/25, TC-REV-04; race: duplicate A→B vs B→C |
| T8 | **Response: teams, position, candidates** | T3 | APP/COORDINATOR teams, members/skills/position, affiliation verification and readiness acknowledgment, candidates query with priority-aware band | TC-12, TC-REV-05/06/13; unit tests of the band algorithm with the design §7 examples; `EXPLAIN` on candidate query |
| T9 | **Response: missions** | T7,T8 | Response attribution stamp on first offer; create/offer, accept/decline/transition, recorded radio outcome, safe cancel/fail and durable failure review, progress recompute, overdue offers, mission evidence | TC-07, TC-13, TC-14, TC-BE-04/10, TC-REV-07/11; races: two offers to one team and offer versus campaign/region edit (TC-LOGIC-13) |
| T10 | **Response: campaigns, map, reports, notices** | T7 | campaign lifecycle, public projection, heatmap, summary report, notices | TC-30, TC-BE-02/13/14 (Response half), TC-REV-08; heatmap on 10k seed < 2 s |
| T11 | **Logistics: catalog, assets, opening, adjustments** | T3 | items/types/units, warehouses, points, vehicles, opening stock, adjustment request/review, stock + movements read | TC-BE-21; ledger append-only + balance = Σ movements test; adjustment self-review denied |
| T12 | **Logistics: drives and declarations** | T11 | public drive pages, drive lifecycle, guest/signed-in deliveries, revisions, disputes, claim, assisted declaration, capability secret | TC-DON-01/02/06/07, TC-REV-09/14; guest works with Identity stopped |
| T13 | **Logistics: count, review, post** | T12 | receipts, count revisions, review, post (exactly once), independently reviewed held-release increments, dispute resolve | TC-DON-03/04/05/09; concurrent post and replay-with-new-key ⇒ one credit; self-review denied |
| T14 | **Logistics: needs, commitments, fulfillment** | T11,T9 | cycle, Response admission/attribution lock; needs, increase/reduce/cancel/confirm, commitments, release, fulfillment board, internal read | TC-15, TC-18, TC-19, TC-31, TC-BE-05/09/15/19/23/26; race: two commitments on one need |
| T15 | **Logistics: distribution and handoff** | T14 | prepare/independent approve/dispatch/cancel; target-aware settlements and post-target custody, return/pending-loss and independent loss review, reconcile | TC-16, TC-DIST-01..04; race: two dispatches on one stock; approval voided by edit |
| T16 | **Resolution/cancellation seal** | T9,T14,T15 | Response intents/adoption/recovery, Logistics terminal intent tombstones, freeze/seal/unseal, reasoned resolve/abort/close/reopen/cancel | TC-BE-17/18, TC-BE-07, TC-LOGIC-05/06/12, crash-recovery test (kill between seal and commit) — do this **early**, it is the riskiest part (distributed terminal-state risk) |
| T17 | **Reports and reconciliation** | T13,T15 | stock/fulfillment/donation reports, accepted-by-drive and distributed-by-campaign/warehouse summaries, reconciliation flags | TC-REC-01, TC-BE-14 (full), TC-23 |
| T18 | **Hardening + evidence** | T2–T17 (plus TC-PERF-02 scale seed) | security headers/CSP, throttling configs, log redaction, backup/restore runbook executed, k6 scenario, accessibility of API error copy | TC-BE-27/28/29/30, TC-29, TC-PERF-01 **and TC-PERF-02** (1 M-row seed, ≤ 1 % open) with hardware recorded; `pg_stat_statements` top-20 attached |
| T19 | **Contracts + handoff** | T18 | exported OpenAPI per service committed, traceability matrix updated, SRS/SDD derivations, user-guide inputs, session handoff note | OpenAPI diff clean; matrix lists executed vs planned |

**Additional binding task details:**

| Task | Required correction beyond legacy examples |
|---|---|
| T0-S | First verify supported database/PostGIS combination and pin digest; then every design schema delta, hardened trigger privileges, incident→required-skill mapping, accountless team fields, nullable unknown intake, verification source references, recovery fields, terminal cycle-intent fences, unique/quantity-matched settlements, finite decimals, attribution stamp and target indexes. Replace misleading old assertions; do not just append them. |
| T1 | Material state/data changes increment aggregate version even when automated; no-op jobs do not. Dual-auth headers from API contract; exact decimal-string validation before DB casting; scoped cursor hash including normalized filters/order and authorization scope; SQLSTATE mapping includes permission/config defects as internal errors, never disguises them as stock conflicts. |
| T4/T5 | Optional notes/media and unknown contact/headcount; private recovery code issue/redeem; old-secret invalidation and original-response replay (recovery-code issuance replays metadata only, never plaintext); all credential headers redacted. |
| T7 | Scoped verifiable source references; no same-account/phone proof, no IP-only verdict; urgent SUBMITTED reports across every lane; recorded verification revision and later material supplements flagged for review. |
| T8/T9 | Accountless external teams; no fake user or automatic accept; structured field outcome can satisfy completion evidence; active cancellation keeps team unavailable until readiness acknowledgment. |
| T9/T14 | Attribution admission under a Response row lock, lock stamp persists on failed Logistics creation, delayed writes meet Logistics cycle barrier; reopen assigns new-cycle attribution atomically. |
| T13 | Post-POSTED held-release revisions never demote previously posted inventory to unposted state; pending revisions do not replace approved public totals; only approved positive increment is credited. |
| T15/T16 | Intermediate/after-target handoffs do not settle the commitment; post-target custody is explicitly authorized after SEALED; immutable local ABORTED intent fence rejects duplicate seals that already passed remote precheck. |
| T10/T14 | TC-BE-33: authenticated scoped batch reads accept at most100 IDs, omit unauthorized/unknown identically, reject101 with Vietnamese400; query/call count fixed for5 versus50 results. |
| T17 | No fabricated per-drive distributed quantity; opening stock and multiple pooled drives are included in reconciliation fixtures. |

## 3. Current traceability and acceptance

Update this matrix/evidence at each slice; T19 assembles completed records rather than first creating traceability. UC IDs retain their original meanings; UC-14 is deferred.

| UC | Current behavior / requirements | Task owner | Acceptance IDs |
|---|---|---|---|
| UC-01 | SELF intake/track/supplement, optional note and unknown facts; UR-01/02, FR-REQ-01/02/03/07 | T4/5 | TC-01..05/20/24, TC-BE-24, TC-LOGIC-01/11/17 |
| UC-02 | Verify/source/duplicate/triage; UR-03, FR-REQ-04/05/10 | T7 | TC-09..11, TC-BE-03/11/25, TC-REV-04, TC-LOGIC-04/05/16/17 |
| UC-03 | APP/external mission offer/progress/safe cancel; UR-03/04, FR-MSN-01..06 | T8/9 | TC-07/12/13/14, TC-BE-04/10, TC-REV-05/06/07/11/13, TC-LOGIC-02/03/13 |
| UC-04 | Need/commit/partial fulfillment and guarded resolution; UR-05/07, FR-LOG-03/05, FR-REQ-09 | T14/16 | TC-15/18/19/31, TC-BE-05/09/15/17/18/19/23/26/31/33, TC-LOGIC-05/06/12/13/14 |
| UC-05 | Scoped reports/reconciliation; UR-06/07, FR-RPT-01, FR-REC-01 | T10/17 | TC-23/30, TC-BE-13/14/30/33, TC-REC-01, TC-LOGIC-07/15 |
| UC-06 | Accounts/grants/revocation; UR-06, FR-IAM-01..03 | T2/3 | TC-BE-01/12/20, TC-LOGIC-15 |
| UC-07 | Optional human-reviewed AI, FR-AI-01..07 | Conditional after T18 | Existing TC-AI IDs reserved; no runtime AI claim until separate evaluated contract |
| UC-08 | Campaign lifecycle/scope; UR-05, FR-CAM-01 | T10 | TC-BE-02/23, TC-REV-14, TC-LOGIC-13 |
| UC-09 | Basic vehicles/points/assets; UR-05, FR-LOG-01 | T11 | TC-BE-21, TC-LOGIC-10 |
| UC-10 | Publish/manage in-kind drive; UR-08/09, FR-DON-01 | T12 | TC-DON-01, TC-REV-09/14 |
| UC-11 | Guest declaration/private receipt/recovery/dispute; UR-08, FR-DON-02/05 | T12 | TC-DON-02/06/07, TC-REV-09, TC-LOGIC-11 |
| UC-12 | Count/independent review/post/held release; UR-09, FR-DON-03/04 | T13 | TC-DON-03/04/05/09, TC-BE-32, TC-LOGIC-08/10/14 |
| UC-13 | Approved issue/target handoff/custody/return/loss; UR-10, FR-LOG-02/04/06/07 | T15 | TC-16, TC-DIST-01..04, TC-LOGIC-06/09 |
| UC-14 | Stocktakes/source/transfer depth; FR-REC-02/FR-DON-06 | Deferred | Historical cases retained, excluded from core gate |
| UC-15 | Signed-in PROXY/alternate contacts; UR-01, FR-REQ-11 | T6/7 | TC-REV-01..04/12, TC-LOGIC-04 |
| UC-16 | Heatmap/grouped scoped queue; UR-03/07, FR-MAP-01/REQ-06 | T10 | TC-REV-08/10, TC-BE-30/33, TC-LOGIC-15 |
| UC-17 | Assigned-team read access only; UR-04, FR-IAM-02/MSN-01 | T9 | TC-07, TC-BE-04, role/object matrix |
| UC-18 | Team profile/position/readiness/affiliation; UR-04, FR-TEAM-01/MSN-06 | T8/9 | TC-REV-05/11/13, TC-LOGIC-02/03 |
| Cross-cutting | FR-FILE/AUD/NOT, NFR-SEC/REL/L10N/PERF/OPS | T1/5/18, every slice | TC-BE-20/22/27/28/29/30/33, TC-L10N-01, TC-PERF-01/02, TC-LOGIC-10/12/14/15 |

### 3.1 Logic-review acceptance cases

These cases supplement existing identifiers; all are **planned**, not executed. Existing TC-01..31, TC-BE-01..33, TC-DON/TC-DIST/TC-REC/TC-REV, TC-L10N and TC-PERF identifiers remain reserved. The archived detailed cases are historical context; expected behavior comes from the current design/API and the assertions below. A task referencing an older case must write its current steps/expected results into its integration test before coding.

| ID | Traceability / tasks | Concrete expected result |
|---|---|---|
| TC-LOGIC-01 | UR-01, FR-REQ-01/02/03; T4/5 | Submit location/category with omitted description/media/items, null phone/headcount: one SUBMITTED report and subject, private tracking after ACK; supplied invalid phone/nonpositive count rejected; lost response replay returns the original resource. |
| TC-LOGIC-02 | UR-03/04, FR-MSN-01/02/06, FR-TEAM-01; T8/9 | COORDINATOR team has external contact and zero accounts: offer→radio acceptance→travel→scene→reported outcome; valid source/person/time/outcome suffice without media. APP team without active leader rejected. No automatic acceptance. |
| TC-LOGIC-03 | FR-MSN-02/05/06; T9 | Cancel OFFERED frees capacity. Cancel ACCEPTED/EN_ROUTE/ON_SCENE marks team UNAVAILABLE atomically; a second offer is refused until authorized field readiness acknowledgment. A stale readiness acknowledgment cannot clear a newer unavailable decision. |
| TC-LOGIC-04 | FR-REQ-10; T7 | Danger-flagged SUBMITTED in RATE_LIMITED_REVIEW/PROXY_QUOTA_REVIEW appears in cross-lane alerts immediately; old SUBMITTED becomes overdue from received_at; routine lane still independently filterable; alerts never dispatch or choose priority. |
| TC-LOGIC-05 | FR-REQ-04/09, FR-MSN-04; T7/16 | No current-cycle mission + recorded mission_not_required/reason can resolve with settled needs; empty data alone cannot. A failed assigned mission with no completed outcome cannot use this branch. Source-referenced verification rejects unauthorized/mismatched references. |
| TC-LOGIC-06 | FR-LOG-05/07, TC-BE-31; T15/16 | FINAL_RECIPIENT need10: point receipt10 does not settle, household handout6 settles6, remaining4 visible. RELIEF_POINT need10: point receipt10 settles10; after seal handout8/return2 updates custody/stock, not delivered10+returned2 on commitment. |
| TC-LOGIC-07 | FR-REC-01, TC-REC-01; T17 | DriveA50+driveB50+opening20 pooled; dispatch/final handout30: accepted totals A50/B50, actual distribution30 at recorded warehouse/campaign scope; never claim A30 and B30. Different units never summed. |
| TC-LOGIC-08 | FR-DON-03/04, TC-DON-04/05, TC-BE-32; T13 | Accepted50/held5 posted; intake proposes accepted55/held0 revision; independent approval then release posts exactly5. Before approval no stock increment. POSTED history survives pending revision. Retry/new key cannot credit the same approved increment twice. |
| TC-LOGIC-09 | FR-LOG-02/05/07; T15 | One eligible handoff line quantity4 yields exactly one settlement4. A different operation_ref cannot insert another settlement; quantity5 or another commitment rejected. Intermediate/after-target handoff has no fulfillment settlement. LOSS remains pending without accounting until a distinct reviewer approves; repeat approval cannot settle twice; rejected pending loss never changes counters. |
| TC-LOGIC-10 | FR-LOG-02, NFR-SEC-02/REL-01; T0-S/T11 | Real non-owner app role inserts a valid ledger movement and trigger changes balance; direct UPDATE balance and mutation/TRUNCATE ledger refused. Function cannot resolve attacker-created objects through search_path. |
| TC-LOGIC-11 | FR-REQ-02/07, FR-DON-05; T5/12 | Lost secret: staff verifies contact through recorded process, issues code30min, authenticated user redeems once, account binds and old secret/code stop working. Wrong/expired code leaks no existence; name/phone/code identifier alone insufficient. Native dual-auth sends Bearer plus dedicated secret header. |
| TC-LOGIC-12 | FR-REQ-09, TC-BE-17/18; T0/T16 | Pause a duplicate seal after remote PENDING precheck; complete seal→abort→local unseal fence→ABORTED; resume delayed duplicate: local fence refuses it. Unseal of old intent cannot undo new seal. Test empty-cycle abort and adoption after actor revocation. |
| TC-LOGIC-13 | FR-CAM-01/LOG-03, TC-BE-23; T9/14 | First mission/admission sets attribution stamp; competing campaign/region change either wins before stamp or conflicts after. Failed Logistics creation leaves conservative stamp; retry creates same cycle. Reopen assigns new cycle while old stock/report attribution stays unchanged. |
| TC-LOGIC-14 | FR-LOG-05, NFR-REL-01; T1/14 | Unit PIECE rejects decimal string1.0004 before cast; KG allows documented scale3 only; NaN/Infinity/exponent/overflow rejected. Need starts10, explicitly increases15, retains original10/history; reduction below protected quantities refused. |
| TC-LOGIC-15 | FR-IAM-02/03, NFR-PERF-01/02; all list tasks | Overlapping org/region/campaign grants return each row once before LIMIT; no scope leak; stable keyset page2 has no repeated boundary row. List SQL/service-call budgets independent of page size; manager can read its managed campaign. |
| TC-LOGIC-16 | FR-REQ-04/09, FR-CAM-01; T7/16 | Canonical request with inbound duplicates can be rejected from VERIFYING or safely cancelled with a reason; historical duplicate links remain. It cannot itself become DUPLICATE. Concurrent new linker either commits before terminal transition or rejects the terminal target; no cascade deletes or fabricated aid. |
| TC-LOGIC-17 | FR-REQ-07/MSN-02, NFR-REL-01; T1/5/7/9 | Post-verification supplement preserves authoritative location until scoped review; changed reported facts are visible as pending review; a pending danger=true supplement immediately raises the unverified alert marker without waiting for acceptance. Material automatic progress/job changes bump version, stale concur/commands fail, no-op retries create no new version. |

Every case includes representative Vietnamese success, validation, authentication, permission and conflict responses; notifications use Vietnamese; AI-output checks apply only if AI is implemented. Use real PostgreSQL for constraints and two-connection races, not mocks.

## 4. Schema and index review gates

Before T0-S is accepted, the migration/DDL review must account for **every target table, column and index**:

| Artifact | Required content |
|---|---|
| Field inventory in T0-S evidence | table.column; writer endpoint/job/trigger/seed; reader/report or integrity purpose; nullability/default; owning service; retention/PII treatment when applicable. A constraint-only or audit field is legitimate; an unexplained future field is removed. |
| Index inventory in T0-S evidence | index name; constraint or exact scoped WHERE/ORDER BY/query; overlap with existing indexes; reason retained/changed/dropped; measured fixture/plan for large tables. No blanket index-per-FK rule. |
| SQL assertions | Valid fixtures followed by one targeted invalid change, expected SQLSTATE and constraint/trigger name. Positive balance/counter/ledger assertions raise on mismatch; printed values are not assertions. |
| Permission fixture | Separate migration-owner and restricted app roles. Test under app role; superuser-only success does not prove deployability. |
| Race fixture | Two actual sessions, controlled synchronization point, both outcomes recorded. No arbitrary sleep as the only ordering guarantee. |
| Scale evidence | EXPLAIN(ANALYZE,BUFFERS), fixed seed, PostgreSQL/PostGIS versions/digest, row counts, hardware, warm/cold treatment, sort/filter/heap/buffer work and page2. |

Large-table list target: ≤5ms SQL time and filtered rows ≤20×page size, except documented rare filters; heatmap ≤500ms. Record all exceptions with exact query/filter/dataset. A partial index requires an explicit eligible-status predicate in the actual parameterized query; test generic/custom plans where prepared statements are used. Small catalogs may deliberately scan; index count is not an acceptance score.

## 5. Documentation review ledger and execution handoff

| Gate | Current status |
|---|---|
| User-approved logic changes incorporated | Reviewed 2026-10-09; corrections integrated in main/design/API/tasks |
| Active design/API/task references and identifier checks | Checked 2026-10-09: 34 Markdown files, 140 local links, code fences and active heading links; no missing references; git diff --check clean |
| Independent semantic review of v4.0 pack | Completed 2026-10-09: independent task/main and final design/API cross-review; identified defects corrected and re-reviewed, no remaining P0/P1 detected |
| Every-column/index target DDL inventory | Design purpose/delta/query rules reviewed; exhaustive target-DDL mapping and measurements remain a mandatory T0-S deliverable |
| v4.0 SQL / migrations / role / race / EXPLAIN execution | Not executed; T0-S/T0 ownership |
| Runtime/dependency/storage compatibility and restore | Not executed; corresponding setup/integration tasks |
| Application implementation | Not started |

Documentation checks used a temporary Python checker for local Markdown paths/fences/active heading anchors, a search for obsolete active plan references, and git diff --check; schema/ has no diff. These checks establish documentation consistency, not runtime correctness. The approved implementation starting point is T0-S; later tasks retain their evidence dependencies.

For each executed task, record commit, exact command, exit code, concise output, environment, linked TC IDs and remaining gaps under `docs/backend/evidence/`; pin versions in `docs/backend/VERSIONS.md`. Those files are evidence created by execution, not additional competing plans.

**Next concrete task after documentation review:** T0-S. Implement the target schema and focused assertions from `01-design.md`, run real restricted-role/concurrency tests, and inspect measured query plans. Do not scaffold all three application services before that gate.
