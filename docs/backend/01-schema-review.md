# 01 — Senior review of the C48 data model

Scope: the logical ERDs in plan §6.1.1–6.1.4 (v3.2) were reviewed against normalization, integrity, query patterns and PostgreSQL practice, then turned into the physical schemas in [`schema/`](schema/). **The physical schemas supersede the column lists in the plan's Mermaid ERDs**; the plan keeps the business meaning, this folder is the implementation contract.

**What was actually run** (not just read): all three DDL files loaded into PostgreSQL 17 + PostGIS 3.5 in Docker with `ON_ERROR_STOP`; **96 constraint assertions** in `schema/test-*.sql` (identity 16, response 31, logistics 49 — all PASS) plus a PostGIS proximity smoke test; 200,000 synthetic requests with `EXPLAIN (ANALYZE)` on the hot queries; an automated scan for foreign keys without a leading index; and — in §6 — four independent review agents, one of which reproduced six race conditions with parallel `psql` sessions. **Not run:** TypeORM migrations, multi-service crash injection, k6 load tests. Re-run the SQL tests after every schema change. §6 supersedes any statement in §1–5 that it contradicts.

## 1. Findings that changed the model

| ID | Sev | Finding in the logical ERD | Resolution in `schema/` |
|---|---|---|---|
| DB-01 | **High** | `RECEIPT_LINE.donation_line_id` was UNIQUE while counts must be immutable revisions — a second count revision cannot exist, so recounts are impossible. `DONATION_LINE.declaration_revision` had the same flaw (which row is "current"?). | Header + revision pattern: `donation_declaration(delivery_id,revision)` → `donation_line`; `receipt_count(receipt_id,revision)` → `receipt_count_line`. Natural composite PKs, no surrogate ids. Revisions are append-only (trigger). Counted items may differ from the declaration so unexpected goods are recorded, not dropped. |
| DB-02 | **High** | "Capacity one active mission per team" was only a transaction recheck; two racing offers could both pass. `RESCUE_TEAM.capacity` was a dead column (demo is fixed at 1). | Partial unique index `mission_team_one_active_uq (team_id) WHERE status IN (OFFERED,ACCEPTED,EN_ROUTE,ON_SCENE)`. `capacity` dropped. Re-add the column only when capacity > 1 is a real requirement (the index must then be replaced by a counted check). |
| DB-03 | **High** | `STOCK_MOVEMENT` had a single `quantity` whose sign depended on type, no link to the commitment/distribution that caused an ISSUE, and `occurred_at` duplicating `created_at`. Initial receipt posting could be replayed with a new key. | Signed `delta_on_hand` / `delta_reserved` with a per-type shape CHECK (ISSUE reduces both equally; RESERVE/RELEASE touch only reserved). `commitment_id` XOR `distribution_line_id` required on ISSUE. `compensates_movement_id`, unique `operation_ref`, and unique `(receipt_id, balance_id) WHERE movement_type='RECEIPT'` so a receipt credits stock once even with a different key. `occurred_at` removed. |
| DB-04 | **High** | `REFRESH_SESSION` had no family id, so "reuse revokes the family" (§23.1) was not implementable. | `family_id`, `rotated_at`, `client_kind`, `revoke_reason`; absolute expiry copied unchanged on rotation; unique `token_hash`. |
| DB-05 | **High** | `ASSISTANCE_REQUEST` lacked columns the plan's own flows need: public `tracking_code`, `description` (FR-REQ-01), `review_lane` (RATE_LIMITED_REVIEW / PROXY_QUOTA_REVIEW), `priority_basis`, `verification_basis`, `resolved_at` + `resolution_seal_id`. `input_revision` on VERIFICATION_DECISION served only the deferred AI feature. | Added; AI revision columns deferred with the AI tables. CHECKs: PROXY needs an account; `status='DUPLICATE'` ⇔ canonical set; no self-canonical; RESOLVED/CLOSED need seal + time; TWO_COORDINATOR_JUDGMENT needs a distinct second user. Partial unique on `tracking_secret_hash`. |
| DB-06 | Med | `TEAM_MEMBER` allowed several leaders and one user in several teams (breaks "active team leader", "solo volunteer = one-member team"). | Partial unique indexes: one ACTIVE LEADER per team; one ACTIVE team per user. |
| DB-07 | Med | `ROLE`, `PERMISSION`, `ROLE_PERMISSION` are three tables for a fixed seed; `ROLE_GRANT.scope_reference` was an untyped string; grants could not be revoked with history. | Role catalog lives in code (`05-permissions.md`); `role_grant.role_code` CHECK; typed scope columns with a shape CHECK; `revoked_at/by` (soft revoke keeps history); one live grant per exact scope via a COALESCE unique index. |
| DB-08 | Med | `ITEM.quantity_scale` is determined by the unit (3NF violation, can disagree with the unit). `ITEM.acceptance_criteria` is really per appeal. | `unit.scale`; `drive_item.acceptance_note`. |
| DB-09 | Med | `DONATION_DISPUTE.receipt_id` duplicates `delivery_id` (delivery ↔ receipt is 1:1). | Dropped. |
| DB-10 | Med | Uuid surrogate + UNIQUE code on tiny catalogs (`INCIDENT_CATEGORY`, `SKILL`, `ITEM_TYPE`, `UNIT`, `ROLE`) costs an extra column, index and join for nothing. | Natural text PK (`code`), FKs hold the code. Codes are immutable; labels (Vietnamese) can change. |
| DB-11 | Med | `MISSION` had no timestamps for "offered more than 10 min ago" or "missions in last 24 h"; `MISSION_EVENT.on_behalf_of_team_id` always equals the mission's team (redundant). | `created_at` (= offered), `accepted_at`, `ended_at` (CHECK: set ⇔ terminal); events carry `recorded_basis` + `reported_by` (non-null ⇒ coordinator recorded on the team's behalf). `RESCUE_TEAM.affiliation_verified` boolean replaced by `affiliation_verified_at/by` (a boolean beside a timestamp can disagree). |
| DB-12 | Med | `RELIEF_NEED` lacked organization/region attribution (§23.3), original quantity (reports need "original vs reduced") and the frozen `cancelled_remaining`. Two needs for the same item in one cycle were possible. | Added; partial unique `(cycle_id,item_id) WHERE status<>'CANCELLED'`; CHECKs tie `CANCELLED` ⇔ `cancelled_remaining`, target kind ⇔ designated point. |
| DB-13 | Med | "A handoff line must belong to the same distribution as its header" was prose only. | Composite FKs: `handoff_line(handoff_id,distribution_id)` → `handoff_record`, `(distribution_id,distribution_line_id)` → `distribution_line`. `distribution_id` on the line is a deliberate, DB-enforced redundancy. |
| DB-14 | Med | `COMMITMENT` keeps cumulative counters **and** `ISSUED_LINE_SETTLEMENT` rows — two sources of truth. | Kept on purpose (CHECKs and row locks need the counters) but documented: one writer function, CHECKs `released+issued ≤ quantity` and `delivered+returned+lost ≤ issued`, and a reconciliation test comparing counters to settlement sums. |
| DB-15 | Low | `REQUEST_EVENT`, `VERIFICATION_DECISION`, `CONTACT_ATTEMPT`, `AUTHORITY_REFERRAL` and a generic audit overlap. | Kept the structured tables (different columns/audience); `request_event.visibility` (`REPORTER`/`STAFF`) feeds the citizen timeline, `audit_log` is for non-request entities (grants, teams, campaigns, stock adjustments). Do not write the same fact to both. All are append-only (trigger). |
| DB-16 | Low | Doubt: separate `REQUEST_SUBJECT` and `TEAM_POSITION` 1:1 tables. | Keep. Subject isolates the geography column and contact fields from the queue rows (the reporter phone stays on `assistance_request` because the throttle index needs it); team position is rewritten often (hot row, 0 % HOT because of the geography column) while the team profile is not. Both PK = FK. §6 drops the GiST on `team_position`. |
| DB-17 | Low | Public drive pages need campaign status but Response may be down. | `donation_drive.campaign_status` + `campaign_status_at` cache (refreshed on each authenticated check); public pages show the cached value with its timestamp. |

## 2. Conventions adopted

- **Ids:** uuid; generate **UUIDv7** in the application (time-ordered, avoids random B-tree insert fragmentation). `gen_random_uuid()` is only a fallback default.
- **Time:** `timestamptz`, UTC. Client capture times are separate columns (`location_captured_at`, `occurred_at`).
- **Enums:** `text` + CHECK, not native enum types (adding a value to a native enum is a migration hazard; CHECK is a plain `ALTER`). The TypeScript enum is the source of truth and a test compares it with the CHECK list.
- **Quantities:** `numeric(18,3)`; allowed scale comes from `unit.scale` (validated in the service); API carries decimal strings.
- **Optimistic locking:** `version int` on mutable aggregates only (request, mission, campaign, team, drive, delivery, receipt, need, commitment, distribution, cycle, user, organization).
- **Append-only:** triggers on ledgers/history. Also revoke `UPDATE, DELETE, TRUNCATE` on them from the application role in the migration (defence in depth; the trigger alone is bypassable by a superuser).
- **JSON:** `jsonb` only for opaque payloads (`notice.payload`, audit before/after, cached idempotent response), never for relational data.
- **Soft vs hard delete:** no hard delete of anything with history; catalog rows are set INACTIVE.
- **PII columns** (phones, names, locations, contact notes): listed in `05-permissions.md` §3; never in logs, maps or aggregates.

## 3. Index policy and results

Rules used: (1) every foreign key used in a join or parent delete has a leading index (PostgreSQL does not create one); (2) partial indexes for "open work" queues so they stay small as history grows; (3) GiST only on columns used by `ST_DWithin`/`ST_Covers` with enough rows to matter (request subject, region boundary) — none on warehouse/relief-point locations and none on `team_position` (hundreds of rows scan faster than a hot-updated GiST is maintained); (4) no index "just in case"; (5) put the equality columns first, the sort column last.

Measured on 200,000 requests after the §6 index rework (PostgreSQL 17 + PostGIS 3.5, data cached; cold or 1 M-row times will be higher). **Caveat found in round 3 (§7):** that dataset had a large share of open requests; with 1 M rows and ~9 % open the same FIFO queue filtered by status took 201 ms, so the 0.05 ms figures below hold only while open requests are dense:

| Query | Before (round 1 schema) | After (§6 schema) |
|---|---|---|
| Queue, ORGANIZATION scope, `status IN (open)`, FIFO LIMIT 50 | 15.7 ms (seq scan) | **0.05 ms** `request_org_fifo_idx` |
| Queue, REGION scope, no status | 11.9 ms | **0.03 ms** index-only `request_org_region_fifo_idx` |
| Keyset page 2 `(received_at,id) > (…)` | 18 ms, row comparison only a Filter | **0.06 ms**, row comparison is an `Index Cond` |
| Unassigned-region queue | 0.3–0.4 ms | **0.05 ms** (ordered by `(received_at,id)`) |
| Overdue `VERIFYING` scan | not org-scoped, measured from `received_at` | **0.01 ms**, `request_verifying_idx` on `verifying_since` |
| Heatmap 1 km grid, 7 / 30 days | 94 / 212 ms (sequential scan) | unchanged — bounded by the API limits and a 30 s cache (03 §5) |

Foreign keys intentionally **without** their own index (there is no hard delete, so parent-delete scans never happen, and the column is not a join/filter path): the catalog references (`*.region_code`, `incident_category_code`, `team_skill.skill_code`, `vehicle.capacity_unit`), `role_grant.granted_by/revoked_by`, and composite FKs used only to *constrain* children (`distribution(warehouse_id, organization_id)`, `distribution_line(…)`, `handoff_line(…)`, `commitment(relief_need_id, item_id)`, the deferrable revision FKs on `donation_delivery`/`donation_receipt`), whose leading column is already indexed or whose parent is addressed by primary key. Add an index the day a report filters on one of them. Index counts: identity 27, response 61, logistics 116 (including primary keys and unique constraints).

Indexes deliberately **not** created: `assistance_request(status)` alone (low selectivity), `incident_category_code`, text-search/trigram on descriptions, any index on `notice.payload`/audit JSON.

## 4. Rules the database cannot express (service code + test required)

1. Receipt reviewer ≠ every count author (cross-row).
2. Duplicate-chain/cycle guard and inbound-link guard (row locks in sorted order).
3. `distribution_line.item_id` equals the commitment's need item.
4. `stock_balance` equals the sum of `stock_movement` deltas (test; optionally a deferred constraint trigger).
5. `commitment` counters equal the settlement sums.
6. Quantity scale per unit; `delivered + reserved + issued-unsettled ≤ requested`.
7. State-machine transitions (Section 8 of the plan); status columns are written only through command methods.
8. Region is derived from the boundary table at intake.

## 5. Decisions left open (need the team, not the code)

- **Warehouse depth (plan §R-18).** The schema keeps every table the core flows need. Cut candidates, all isolated: `donation_dispute` (+ attachment owner), `handoff_record.kind IN (POINT_RECEIPT, HOUSEHOLD_HANDOUT)` custody, two-person approval of direct campaign distributions. Removing them deletes tables/endpoints without touching others.
- **Projection for the heatmap** (EPSG:32648 assumed, correct for ~102–108°E; Da Nang and east coast fall in zone 49 → EPSG:32649). Decide with the region seed.
- **Retention/erasure** of phones, names, locations and evidence (plan R-13); no column is added for it until a policy exists.
- **PII at rest:** the database holds phones in clear text; MinIO AIStor Free has no encryption at rest. Use disk-level encryption on the demo host and say so.

## 6. Round 2 — four independent reviewers (2026-10-07)

Four agents reviewed the pack in parallel, read-only: (A) normalization and integrity, (B) indexes and measured performance, (C) API contracts and anti-lag rules, (D) concurrency, with six races reproduced in parallel `psql` sessions. Every finding below was **applied** (schema/doc changed and tested), **deferred** with a trigger condition, or **rejected** with a reason. Rough volume: A 25 findings (2 critical), B 14, C 28 (3 critical), D 19 (4 high).

### 6.1 Applied to the schema (covered by `test-*.sql`)

| Finding | Evidence | Change |
|---|---|---|
| `TRUNCATE` bypassed every append-only trigger (`audit_log`, `request_event`, `stock_movement` CASCADE) | A, ran it | `BEFORE TRUNCATE` statement triggers on every append-only table; the migration also `REVOKE`s `TRUNCATE` |
| Ledger and balance were independent: `OPENING +500` left the balance unchanged; `ADJUSTMENT` accepted with no review | A, ran it | `AFTER INSERT` trigger on `stock_movement` applies the deltas; `movement_source` CHECK ties each type to its source; `stock_adjustment` is the only path for `ADJUSTMENT` (trigger requires APPROVED, same balance/delta, poster = reviewer); `adjustment_id` UNIQUE |
| Same adjustment applied twice with two keys (stock 10 → 4 instead of 7) | D, reproduced | UNIQUE `adjustment_id`, immutable reviewed adjustments, `ADJ:{id}` operation ref, lock-first rule (00 §3.1.5) |
| A disabled user kept a working refresh token for up to 7 days (revoke-all vs rotation) | D, reproduced | `session_family` parent table, `app_user.authz_version` barrier, one live token per family (partial unique), rotation takes `FOR SHARE` (02 §1) |
| `role_grant` accepted ADMIN/ORGANIZATION, CITIZEN/SYSTEM, `revoked_at` before `created_at` | A, ran it | `role_scope`, `revoke_after_create` CHECKs |
| Request lifecycle not tied to data (TRIAGED without priority, a seal on a SUBMITTED request, one seal on two requests) | A, ran it | `priority_pair`, `triaged_has_priority`, `resolved_pair`, `resolved_status` CHECKs; UNIQUE `resolution_seal_id`; `verification_basis` column removed (it duplicated the latest decision) |
| Cross-aggregate scope was code-only (drive organization ≠ warehouse organization; commitment item ≠ need item; line from another warehouse; review naming a non-existent revision) | A, ran it | Composite FKs: `donation_drive`/`distribution` → `warehouse(id, organization_id)`; `commitment` → `relief_need(id, item_id)`; `distribution_line` → `commitment(id, item_id, warehouse_id)` and `distribution(id, warehouse_id)`; `receipt_review` → `donation_declaration`; deferrable `current_*_rev` FKs |
| Reviewer independence only in service code | A | Triggers on `receipt_review` / `receipt_count`, both directions |
| Handoff rules in prose only (DIRECT with a point, settlement type vs handoff kind, settlement on another commitment, same line twice) | A, ran it | `check_handoff_route`, `check_settlement_kind` triggers; `handoff_line` carries `commitment_id` with composite FKs; UNIQUE `(handoff_id, distribution_line_id)` |
| Distribution approval could drift from its lines | A, D | `approved_version = version` while APPROVED; lines frozen unless DRAFT (trigger); `in_transit_quantity` / `at_point_quantity` counters with CHECKs; `approved_at/dispatched_at/reconciled_at` |
| Free-text statuses, one-sided paired-column checks, blank/NFD names, loose phone/code formats | A, ran it | DOMAINs `request_status`, `mission_status`; `is_clean_text` (non-blank, NFC) on every label; format CHECKs; paired CHECKs on evidence/attachment/mission/mission_event/stock_adjustment/dispute; `location_source_shape`, `proxy_has_relationship` |
| `btrim(NULL) <> ''` is NULL, so some of my own CHECKs let NULL through (found while testing this round) | this session | `coalesce(btrim(x),'')` in three CHECKs; tests added |
| `relief_need` carried request-level attributes and a column derivable from another | A | Attribution moved to `fulfillment_cycle`; `delivery_target_kind` dropped (derived from `designated_point_id`); `seal_id` UNIQUE |
| Delivery and receipt each had a status that could disagree | A | `donation_receipt.status` removed; `donation_delivery.status` is the single lifecycle |
| Region codes unvalidated; invalid polygons accepted | A | FK to `region_boundary`; `CHECK (ST_IsValid(geom))` |
| Missing columns the APIs need | A | `verifying_since`, `source_ip_hash`, `reason_kind`, `suggested_team_id`/`override_reason`, `team_position.note`, `team_member.left_at`, `warehouse.location_public`, `updated_at/version` on catalog tables, dispute actors |
| `*_by` vs `*_user_id` naming | A | normalised to `*_user_id` |

### 6.2 Applied to indexes and storage

| Finding | Change |
|---|---|
| No index returned the queue in `(received_at, id)` order for ORGANIZATION scope; keyset row comparison was only a Filter (B, measured 15.7 ms → 0.05 ms) | `request_org_fifo_idx`, `request_org_region_fifo_idx` replace the status-first partial index; campaign index is `(campaign_id, received_at, id)` |
| Most list indexes ended in a timestamp without the tiebreaker | `id` appended to reporter, notice, delivery, audit, event, movement, user, distribution indexes; cursor definition in 00 §3 |
| `relief_need.cycle_id` had no usable index (CANCELLED needs excluded by the partial unique) | `need_cycle_idx` |
| Keyset on nullable `closes_at` drops open-ended drives after page 1 | public drive list ordered by `(created_at DESC, id DESC)` |
| HOT updates 0 % on `idempotency_record` / `notice`; slow retention deletes | `fillfactor` 70–85 and aggressive autovacuum on hot tables; idempotency key typed `uuid`, response ≤ 4 KiB, partitioning threshold documented |
| `refresh_session` live index held every rotated token | `rotated_at IS NULL` unique partial index plus purge job |
| `GET /users?query=` seq-scanned 500k users (42–119 ms) | `(created_at, id)` index and prefix-only search with `text_pattern_ops` indexes (no pg_trgm dependency) |
| `audit_log` browse by `entity_type` seq-scanned | `(entity_type, created_at, id)`; monthly partitioning documented for retention |
| Redundant or low-value indexes | dropped: `role_grant_user_live_idx` (covered by the unique index), `request_proxy_open_idx` (served by `request_reporter_idx`), `team_skill_skill_idx`, `request_danger_overdue_idx` (replaced by `request_verifying_idx`), GiST on `team_position` |

### 6.3 Applied to the contracts (docs 00–07)

Introspection single-flight + circuit breaker and no synchronous call cycles (00 §3.2); scheduler advisory-lock/`SKIP LOCKED` rules; pool, timeout and Nginx limits; global SOS ceiling and review lane separated from the default queue; tracking credentials moved to headers; upload hardening; pagination for every list and nested array with caps and bounded report windows; cursor/`filter_hash` definition; idempotency insert-first protocol (the "in progress" state was not implementable — proven); `UPDATE … WHERE version` rule; lock order and modes (00 §3.1); `07-error-catalog.md` with every code and Vietnamese message; missing permission codes; refresh-race semantics; seal/freeze/unseal fencing; stock single-writer rule; masked phones in lists; DTO whitelist; CSRF on cookie-authenticated `POST /requests`; log redaction moved to T1.

### 6.4 Deferred or rejected (with reason)

| Finding | Decision |
|---|---|
| Introspection cache of 5 s (C) | **Deferred.** It contradicts plan §10.3 ("no positive cache", immediate revocation). Single-flight + breaker adopted; add the cache only if k6 shows Identity as the bottleneck and amend plan R-09 and the revocation SLA together. |
| Move the reporter phone off the hot request row (A) | **Rejected.** The row is a few hundred bytes wider at most; the throttle index needs the phone there. |
| `throttle_hit` counter table (C) | **Rejected.** Per-IP limits live in Nginx; per-phone uses `request_phone_idx` (index-only, 0.3 ms); a table adds write load on the flood path. |
| Partition `idempotency_record` / `audit_log` now (B) | **Deferred** until ~1 M rows/day (idempotency) or a retention policy exists (audit). Primary keys would then include `created_at`. |
| DB trigger "team must keep an active leader" (D) | **Rejected.** Row lock on `rescue_team` plus demote-then-promote and a race test cover it without a deferred trigger. |
| `CHECK` on lat/lng of `geography` (A) | **Rejected.** PostGIS coerces out-of-range values before a CHECK sees them; validated in the API and by TC-02. |
| CHECK "SELF request needs a secret or an account" (A) | **Rejected.** The coordinator's secret-revoke flow legitimately clears the hash. |
| Recovery-code columns for re-binding a lost tracking secret | **Deferred** with the UX decision (03 §1). |
| `progress_version` column for mission recompute (D) | **Rejected.** Recompute does not bump `version`, and every mission command locks the request row (00 §3.1.2). |
| Quantities as integers in the smallest unit (A) | **Rejected.** `numeric(18,3)` plus the scale trigger is simpler to read in reports and in the API. |
| Heatmap materialisation (B) | **Deferred.** Limits + 30 s cache first; add a generated cell column if profiling shows > 500 ms. |
| Contracts for `GET /campaigns/{id}/summary`, staff edit of a request, team self-leave, CSV, AI, push (C) | **Out of the core scope**, consistent with plan §16 cuts; add contracts when scheduled. |

## 7. Round 3 — required schema changes (2026-10-07) — **specified, NOT yet applied to `schema/*.sql`**

Found by reading the backend pack against plan v3.3 and measuring on PostgreSQL 17 + PostGIS 3.5 (synthetic: 1 M requests, 300 k distributions, 300 k deliveries). Plan §27 holds the rules; this section is the exact change list for the agent that owns task **T0-S** (06). Apply to `schema/response.sql` / `schema/logistics.sql`, add the tests named here to `schema/test-*.sql`, and re-run **all** existing assertions (96) plus the new ones. Do not change anything else in the same commit.

### 7.1 `response.sql`

| # | Change | Evidence / why |
|---|---|---|
| R1 | Add `CREATE INDEX request_open_org_fifo_idx ON assistance_request (organization_id, received_at, id) WHERE status IN ('SUBMITTED','VERIFYING','VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING');` and `request_open_org_region_fifo_idx ON assistance_request (organization_id, region_code, received_at, id) WHERE <same predicate>;`. Keep the two full indexes for history views. | Queue with `status IN (open subset)` + region, 1 M rows, 9 % open: 201 ms (165,531 rows filtered) → 0.05 ms. The planner proves an `IN` subset implies the partial predicate (confirmed). |
| R2 | Keep `request_campaign_idx`, `request_unassigned_idx`, `request_review_lane_idx`, `request_verifying_idx` unchanged. Document in the 03 §2 queue row that a mixed REGION+CAMPAIGN grant list is built as one query per grant kind merged by `(received_at,id)` (plan §27.2 item 4). | A single `OR` walked the whole organization range. |
| R3 | Rare-value filters (`priority='P1'`, `category`, `declared_danger`) stay as filters on the open partial index; do not add per-filter indexes. Record the measurement (≈19 ms, 65 k rows scanned, 1 M rows) as an accepted limit in §3. | Avoid index sprawl; demo volume is far lower. |

### 7.2 `logistics.sql`

| # | Change | Evidence / why |
|---|---|---|
| L1 | Replace `distribution_scope_idx (organization_id,status,created_at,id)` with `(organization_id, created_at, id)` and add partial `distribution_open_idx (organization_id, created_at, id) WHERE status IN ('DRAFT','APPROVED','DISPATCHED')`. | No-status and multi-status lists used Seq Scan + Sort, 26–27 ms at 300 k. |
| L2 | Replace `drive_scope_idx` with `(organization_id, created_at DESC, id DESC)`. | Same order mismatch. |
| L3 | Add `donation_delivery.organization_id uuid NOT NULL`; add `UNIQUE (id, organization_id)` on `donation_drive`; FK `(drive_id, organization_id) → donation_drive(id, organization_id)`; replace `delivery_work_idx` with `(organization_id, created_at, id) WHERE status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED')`. Add `UNIQUE (id, organization_id)` on `donation_delivery`. | Staff work queue joined through the drive: Parallel Seq Scan, 23 ms at 300 k. |
| L4 | Add `donation_receipt.organization_id uuid NOT NULL` with FKs `(warehouse_id, organization_id) → warehouse(id, organization_id)` and `(delivery_id, organization_id) → donation_delivery(id, organization_id)`. | A receipt could be booked into another organization's warehouse (no constraint existed). |
| L5 | Add `relief_need.target_reason text`; CHECK `designated_point_id IS NULL OR coalesce(btrim(target_reason),'') <> ''`. Add trigger `BEFORE UPDATE OF designated_point_id ON relief_need` that raises `check_violation` when the value changes and a `commitment` exists for that need. | Plan §25.7 (target fixed once a commitment exists; point target needs a reason) was code-only; `delivery_target_kind` was dropped. |
| L6 | Extend `check_settlement_kind`: join `commitment → relief_need` and `handoff_record → distribution`. `DELIVERED` with `POINT_RECEIPT` requires `need.designated_point_id IS NOT NULL AND = distribution.relief_point_id`; `DELIVERED` with `DIRECT_HOUSEHOLD`/`HOUSEHOLD_HANDOUT` requires `need.designated_point_id IS NULL`. | Plan §25.7 / 04 §6: a point receipt never satisfies a final-recipient need, a household handout never settles a point-targeted need. |
| L7 | New `BEFORE INSERT` trigger on `stock_movement` for `movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')`: (a) `SELECT … FROM donation_receipt WHERE id = NEW.receipt_id FOR UPDATE`; (b) require the balance's `warehouse_id` = receipt `warehouse_id`; (c) find the latest APPROVE `receipt_review` (max `count_revision`) — none ⇒ `check_violation`; (d) require balance `item_id` to have a `receipt_count_line` in that revision; (e) `already_posted + NEW.delta_on_hand ≤ accepted_quantity`, where `already_posted` sums `delta_on_hand` of both types for the same receipt and balance. | Rule 01 §4 had no row for it: nothing stopped posting more than approved or into the wrong warehouse/item; two concurrent posts serialize on the receipt row. |

### 7.3 New SQL assertions (must be written with the changes; all PASS)

R1: `EXPLAIN (FORMAT JSON)` of the open-queue query on a ≥ 200 k-row fixture with ≤ 2 % open uses `request_open_org_region_fifo_idx` and removes no more than 20 × `LIMIT` rows. L1–L3: the distribution list (no status), the drive list and the delivery work queue use an `Index Scan` (no `Sort`) on the fixture. L3/L4: a delivery whose organization differs from its drive, and a receipt whose warehouse belongs to another organization, are refused. L5: point target without reason refused; changing `designated_point_id` after a commitment refused. L6: four combinations (point receipt on a final-recipient need; household handout on a point need; point receipt at a different point; the two valid cases). L7: no approval, over-posting, wrong warehouse, wrong item, replay with a new key, and a two-session race (second post waits, then fails the cap).

### 7.4 Rules the database still cannot express (add to §4)

9. **Cross-service reads are batched** (plan §27.3); a per-request loop over another service is a defect.
10. **List endpoints respect a query budget** (00 §3.4) — verified by TC-BE-30, not by SQL.
11. Quantity posted for a receipt equals approved accepted quantity **over time** (cap is enforced by L7; the equality at the end of the receipt lifecycle is a reconciliation check in T17).

