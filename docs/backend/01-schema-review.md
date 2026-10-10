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

Measured on 200,000 requests after the §6 index rework (PostgreSQL 17 + PostGIS 3.5, data cached; cold or 1 M-row times will be higher):

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
| Recovery-code columns for lost tracking/donation capability | **Adopted in focused logic review**, pending T0-S (§7); staff verification plus one-use account binding. |
| `progress_version` column for mission recompute (D) | **Rejected.** Material recompute now increments the existing aggregate version; no separate progress_version is needed. Every mission command still locks the request row (00 §3.1.2). |
| Quantities as integers in the smallest unit (A) | **Rejected.** `numeric(18,3)` plus the scale trigger is simpler to read in reports and in the API. |
| Heatmap materialisation (B) | **Deferred.** Limits + 30 s cache first; add a generated cell column if profiling shows > 500 ms. |
| Contracts for `GET /campaigns/{id}/summary`, staff edit of a request, team self-leave, CSV, AI, push (C) | **Out of the core scope**, consistent with plan §16 cuts; add contracts when scheduled. |

## 7. Focused logic-review target deltas — 2026-10-09

> **Superseded in part by §9 (2026-10-10).** Where this table conflicts with §8/§9 the later section wins: not added are `resolution_intent.mission_not_required` (replaced by `outcome_basis`), `verification_decision.concurrence_event_id` (event id stays in the event payload), the request/delivery recovery hash/expiry pairs (replaced by `capability_recovery`), `donation_receipt.organization_id`, `relief_need.target_reason`, `mission.kind`/`distribution_id` (delivery slice); the handoff `state`/`version` columns are replaced by `handoff_loss_review`; the 2026-10-10 SQL implements §9.

Plan §27 and corrected API paragraphs define the target; SQL files and prior successful assertions are the previous input, not implementation of this revision. Preserve the existing schema and evidence history; T0-S applies/reviews these deltas before application code.

| Target change | Writer → reader / invariant purpose |
|---|---|
| assistance_request.description/phone and request_subject.people_affected nullable | Optional intake/supplement → scoped detail/assessment; validate supplied values, count1..10000; null means unknown. No citizen item fields. |
| rescue_team.reporting_mode APP/COORDINATOR, external_contact_note nullable; readiness_required boolean NOT NULL DEFAULTfalse | Team create/maintain, active cancellation and ready → mode-specific eligibility/readiness. COORDINATOR needs nonblank contact (CHECK must not allow SQL NULL); APP needs active leader; generic PATCH cannot bypass readiness latch. |
| incident_category_skill(category_code,skill_code), composite PK and local FKs | Seed required capability mapping → candidate/offer all-required-skills check. No duplicate secondary PK index. |
| request.verification_revision nullable UUID FK request_event; mission.verification_revision required UUID FK request_event | Verify/approved supplement review and offer → authoritative approved revision and fixed mission destination. Check event belongs to same request and represents approved snapshot. Existing subject facts are spatial/list projection, updated atomically on approval. Immutable snapshots use existing event payload. |
| verification_decision.concurrence_event_id nullable UUID FK request_event | Verify → links same-request CONCURRENCE event; payload records reviewed_version/resulting_version, distinct scoped actor. Required for two-coordinator basis; intervening material version invalidates. |
| mission_event.outcome_note nullable nonblank; recorded_at NOT NULL DEFAULTnow() | Direct/recorded completion → human outcome review/timeline; COMPLETED requires outcome_note, reported occurred_at remains distinct. Media optional. |
| assistance_request.attribution_locked_at nullable timestamptz | First offer/internal admit → rejects mid-cycle attribution mutation; cleared only by atomic reopen. Stamp remains after failed Logistics creation. |
| request/donation_delivery.recovery_code_hash and recovery_expires_at nullable paired fields, unique non-null hash | Staff verified issuance/redeem → purpose-bound30min one-use binding. Audit stores issuance/basis, no plaintext; redemption clears pair/old secret. |
| cycle_intent(intent_id UUID PK,cycle_id UUID NOT NULL FK,kind,state,created_at NOT NULL DEFAULTnow()) | Seal/freeze/unseal → local race fence. kind RESOLUTION/CANCELLATION, state SEALED/FROZEN/ABORTED with valid pairing; binding immutable; retain abort tombstones, no TTL. |
| resolution_intent.version positive integer DEFAULT1; reason nonblank; mission_not_required NOT NULL DEFAULTfalse | Intent create/adopt/abort/recovery → exact operation state/version and reasoned zero-mission resolution; cancellation requires false. expected_request_version stores resulting post-barrier request version. Failure reviews live in immutable same-request events and are checked during resolution. |
| donation_delivery/donation_receipt.organization_id NOT NULL, same-organization reference integrity | Intake creation → scoped work queue, drive/delivery/warehouse consistency. Derive from authenticated owner data, not arbitrary citizen input. |
| Receipt exact current revision guard; POSTED never demoted; unique release revision/item business reference | Count→independent review→post → ledger approved cumulative ceiling. Review status is derived from current count/declaration matching receipt_review; public accepted from posted ledger, no redundant pending-status columns. |
| relief_need target_reason when point target; remove requested<=original CHECK | Scoped need create/increase → valid target reason and initial-quantity history. Require point/commitment warehouse org=cycle org. |
| issued_line_settlement UNIQUE(handoff_line_id), exact quantity/commitment/kind guard | Eligible target handoff → once-only target counters; intermediate/after-target has no settlement. Replace redundant nonunique handoff index. |
| handoff_record.state RECORDED/PENDING_LOSS/REJECTED, positive version DEFAULT1, review_reason nullable nonblank | Field loss submit→independent review → only approved RECORDED changes accounting. Non-LOSS RECORDED; pending/rejected LOSS no approved_by, approved LOSS distinct authenticated reviewer+reason. Update legacy mandatory immediate LOSS-approver CHECK accordingly. |
| vehicle.region_code NOT NULL; explicit affiliation verification action; warehouse.location_public PATCH | Asset/team maintenance → region-scoped assets, verified affiliation metadata and permitted public collection-location projection. Expiry_date is informational receipt detail only, not FEFO/batch tracking. |
| stock_adjustment.compensates_movement_id nullable FK stock_movement | Adjustment/review → one full inverse for nonoperational OPENING/ADJUSTMENT with reserved delta0; same balance, unique compensation reference. Operational source movements are corrected by owning workflow. |
| Finite numeric constraints and trusted pre-cast lexical validation | Every quantity writer → avoids excess-scale rounding/NaN/Infinity; numeric(18,3) CHECK alone cannot recover original input scale. |
| Dedicated SECURITY DEFINER balance writer owner, trusted search_path and app privileges | Valid movements/controlled zero-balance creation → usable restricted app role; app cannot directly mutate balance or history/own replacement writer. |

**Column audit:** T0-S must produce table.column→writer endpoint/job/seed→reader/report or integrity purpose, null/default, ownership and PII treatment for every target column. Keep constraint/audit fields with explicit purpose; remove unused proposals. Do not claim that this delta table is the completed exhaustive physical inventory.

**Index audit:** record exact scoped query WHERE/ORDER BY or constraint, duplicate/leading-prefix overlap and measured plan. Add open-request partial FIFO indexes beside needed history indexes, explicit open predicates; include SUBMITTED alert path across all lanes. Ordered lists use id tie-breakers. Distribution/drive organization lists order by created_at/id rather than status-first when status omitted; delivery work index uses organization/time/id and requires new organization attribution. Keep composite FK unique targets. Drop item_unit_idx, vehicle_unit_idx and audit_log_actor_idx unless an actual endpoint needs them. Do not create one index per FK/filter by habit. Deduplicate overlapping grants before LIMIT, use bounded parent keysets then batched children; no N+1. Validate generic/custom prepared plans for partial predicates.

**Evidence:** actual app-role privilege checks, valid fixtures followed by targeted invalid writes asserting expected SQLSTATE+constraint, positive ledger/counter assertions that raise on mismatch, controlled two-session admission/offer/abort/settlement/post races. EXPLAIN(ANALYZE,BUFFERS) on representative history/open data with fixed seed/hardware and page2; no performance claim without measurements. Plan TC-LOGIC-01..14 and existing IDs are planned, not executed in this documentation revision.

## 8. Round-2 target deltas — 2026-10-09 (plan §28 governs)

Apply with §7 in T0-S. Each row names writer → reader/integrity purpose; a column without both is removed. (Implemented in the SQL on 2026-10-10; see §9.5.)

| Target change | Writer → reader / purpose |
|---|---|
| (removed 2026-10-10) `distribution.approval_kind` | Not added: distribution approval is always a real person; existing CHECKs stay |
| `distribution.carrier_mission_id` nullable opaque uuid, unique among non-cancelled | Response claim call → handoff authorization of the carrier; null for warehouse-staff delivery (slice after T15) |
| `handoff_loss_review(id, handoff_id UNIQUE-final, reviewer_user_id, decision, reason, reviewed_at)` append-only; `handoff_record` loses `state`/`version`, keeps its immutability trigger | LOSS review endpoint → custody arithmetic (counts only APPROVE), reviewer ≠ recorder |
| `capability_recovery` per service (see plan §28.2.5); drop the recovery hash/expiry pair deltas of §7 | Staff issuance / authenticated redemption → one-time binding, API `issuance_id`, audit |
| `idempotency_record`: drop `response_body`, add `resource_type`, `resource_id` | Idempotency interceptor → replay by re-reading resource |
| `assistance_request.logistics_admitted_at` nullable; `resolution_seal_id` nullable only when it is null; `resolved_pair` CHECK reworked | Admit endpoint → cancel/resolve skip Logistics when null |
| `assistance_request.attribution_locked_at` (from §7) plus release command | First offer/admit set; coordinator release when no mission and no Logistics cycle with needs |
| `mission.kind` RESCUE/DELIVERY, `mission.distribution_id` nullable (required iff DELIVERY); capacity-one unique index becomes per `(team_id, kind)` | Offer/claim → delivery slice; state machine unchanged |
| `mission_event.recorded_basis` accepts DECLINE transition (to DECLINED) | Record-on-behalf → workload count excludes DECLINED/CANCELLED |
| `request_subject.location_source` drops `GEOCODED`; seed `incident_category.UNKNOWN` | Intake → no dead enum value; category never forced |
| `resolve` request gains `outcome_basis` RESCUE_COMPLETED/SUPPLY_ONLY/NO_ACTION_REQUIRED stored on the RESOLVED request event payload | Resolve → audit and reports (no extra column) |
| `fulfillment_cycle.intent_id` removed; `cycle_intent` is the only fence | Seal/freeze/unseal → race fence |
| Concurrence stores latest material fact event id in the event payload | Concur/verify → staleness check without a version column |

**Index plan (replaces the §7 index paragraph where it differs):** `assistance_request` merges `request_review_lane_idx`, `request_verifying_idx` and the planned SUBMITTED-alert index into one partial index on `(organization_id, received_at, id) WHERE status IN ('SUBMITTED','VERIFYING')`; `request_phone_idx` becomes partial on non-null phone; the foreign-key-only indexes listed in plan §28.4 are dropped; add `(region_code, created_at)` on `fulfillment_cycle` for region reports; delivery work list gets organization first. Each retained index keeps a one-line query justification and an EXPLAIN (ANALYZE, BUFFERS) result with a fixed seed. An index that no endpoint or constraint uses is removed in the same migration.

**Column audit order:** produce the table.column → writer → reader → null/default → PII list for all three schemas first; it is the T0-S exit gate together with restricted-role privilege tests and two-session race tests.

## 9. Column and index cleanup decisions — 2026-10-10

Result of the three read-only audits (Identity, Response, Logistics). "Remove" means the T0-S migration must not carry the column; a "keep" always names its purpose. Quantities are numeric(18,3) strings as before. No SQL file has been changed yet.

### 9.1 Identity
- Remove: `idempotency_record.response_body` (add `resource_type`, `resource_id`), `app_user.updated_at`, `refresh_session.created_at`, `refresh_session.id` (PK = `token_hash`), `membership.id` and `membership.created_at` (PK = `(user_id, organization_id)`), `role_grant.granted_by` and `revoked_by` with `revoke_pair` (actor lives in `audit_log`; self-grant stays a service rule), `session_family.revoke_reason = 'ADMIN'`.
- Keep with purpose: `role_grant.scope_type` (explicit discriminator checked by `scope_shape`), `session_family.created_at` (absolute-expiry CHECK) and `revoke_reason` (selects `REFRESH_REUSED` vs `SESSION_EXPIRED`), `membership` table (organization roster and `ORGANIZATION_IN_USE` guard), `organization.created_at` (keyset key).
- Add: `region.version` (deactivate uses `expected_version`), revoke reason `PASSWORD_CHANGE`, index `organization(created_at, id)`.
- Indexes: drop `audit_log_actor_idx`; `role_grant_org_idx` partial on live grants with an organization; `membership_org_idx` partial on active; username/display-name prefix indexes lose the trailing `id`; `GET /audit-logs` requires `entity_type`; session cleanup deletes children before the family.

### 9.2 Response
- Remove: `request_subject.report_mode` and the `(id, report_mode)` unique/composite FK (PROXY-needs-relationship becomes a trigger), `team_member.status` and `joined_at` (membership is `left_at IS NULL`; both partial unique indexes use that predicate), `evidence_metadata.ready_at` and the UNIQUE on `object_key`, table `authority_referral` (becomes `request_event` type `AUTHORITY_REFERRED`), `mission_event.note`, `mission.accepted_at` and `ended_at` (events hold the times; the terminal-state CHECK uses `status`), `notice.source_type`, `team_position.note`, `incident_category.status`, `region_boundary.source_note` (moves to the seed README), `updated_at` everywhere except `resolution_intent`, `GEOCODED` location source.
- Keep with purpose: `verifying_since` (age of the current VERIFYING stint), `verification_decision.concurring_user_id` (CHECK needs it; the event id stays in the event payload), `team_position.set_by_user_id` (last reporter on a hot row), `evidence_metadata.checksum` (backup/integrity manifest) and `uploader_user_id` (shown in the coordinator evidence list), `audit_log.*` (read by the new audit endpoint), `campaign.starts_at/ends_at` (display only), `household_reference_note` (added to the leader's mission view), `request_event (id, request_id)` unique target for same-request snapshot FKs.
- Add: `rescue_team.reporting_mode`, `external_contact_note`, `readiness_required`; nullable `reporter_contact_phone` and `people_affected`; `attribution_locked_at`, `logistics_admitted_at` (CHECK admitted ⇒ locked); `verification_revision` on request and mission; `resolved_pair` allows NULL seal only when `logistics_admitted_at IS NULL`; `POST /teams/{id}/deactivate` (writer for `rescue_team.status`); affiliation fields in `GET /teams/{id}`; partial unique expression indexes for one supplement review per event and one failure review per failed mission; `capability_recovery.request_id` FK instead of object_type/object_id.
- Indexes: one attention partial on `(organization_id, received_at, id)` covering SUBMITTED/VERIFYING and open reports with declared danger (predicate must equal the query; measure); phone index partial on non-null; drop `request_review_lane_idx`, `request_verifying_idx`, `campaign_scope_idx`, `campaign_public_idx`, `rescue_team_scope_idx`, `mission_offer_overdue_idx`, `authority_referral_req_idx`; one `notice(recipient_user_id, created_at DESC, id DESC)` index. Keep `request_unassigned_idx` only if EXPLAIN shows a gain over the org FIFO index. Target: assistance_request ≤ 12 physical indexes including constraint indexes.

### 9.3 Logistics
- Remove: `donation_delivery.current_declaration_rev` and `donation_receipt.current_count_rev` with their deferred FKs (latest revision by key order), `issued_line_settlement.id`, `quantity`, `actor_user_id`, `operation_ref` (PK = `handoff_line_id`; quantity is the handoff line's; the recorder is the actor), `fulfillment_cycle.version`, `intent_id` and `seal_id` (seal identifier = the sealing intent id from `cycle_intent`, which Response stores as its seal id), `handoff_record.approved_by_user_id` and its LOSS CHECK, `handoff_loss_review.id` (PK = `handoff_id`), `donation_dispute.status = 'WITHDRAWN'`, `logistics_attachment.ready_at` and `uploader_kind` (NULL uploader = capability), `notice.source_type`, `stock_movement.compensates_movement_id` (stays only on `stock_adjustment`, unique), `created_by_user_id` on drive and need (audit holds the actor), `updated_at` except `stock_balance` (shown as "as of"), `ADJUSTMENT` reason copy on the movement (OPENING keeps its note).
- Keep with purpose: commitment counters, `commitment.item_id`, `distribution_line.warehouse_id`, `handoff_line.distribution_id` and `commitment_id`, `distribution.organization_id` (composite FKs and lock-time CHECKs; reconciliation test mandatory); `distribution_line.in_transit/at_point` counters (race-review result; revisit only after measurement); `relief_need.cancelled_remaining` (cancel-time snapshot for reports); `fulfillment_cycle.state` (hot guard, test that it matches the latest non-aborted intent); `receipt_review.delivery_id` (commented as denormalised for the composite FK); `receipt_count.counted_at` and `note` (reviewer and donor timeline); `settlement_type` (reconciliation grouping key); `logistics_attachment.checksum` (integrity manifest); `donation_delivery.organization_id` (org-first work queue); distribution `approved_at/dispatched_at/reconciled_at` (returned by `GET /distributions/{id}`); `relief_point.contact_note/operating_note` (added to POST/PATCH and detail, contact note added to the PII inventory).
- Add: database trigger refusing `RECEIPT`/`RECEIPT_HELD_RELEASE` without an `APPROVE` review on the exact current revisions and by a non-author; evidence ownership clarified (delivery xor dispute xor handoff); `GET` lists for warehouses, relief points, vehicles and `GET /stock/adjustments?status=` for the review queue.
- Indexes: drop `need_item_idx`, `donation_line_item_idx`, `receipt_count_line_item_idx`, `distribution_line_item_idx`, `drive_item_item_idx`, `stock_balance_item_idx`, `item_unit_idx`, `vehicle_unit_idx`, `drive_warehouse_idx`, `commitment_warehouse_idx`, `receipt_warehouse_idx`, `receipt_review_decl_idx`, `stock_adjustment_balance_idx`, `settlement_handoff_idx`, `distribution_point_idx`, `distribution_vehicle_idx`, `need_point_idx`, `drive_campaign_idx`, `delivery_donor_idx` (unless a "my donations" endpoint is added); keep `distribution_warehouse_idx` (campaign/warehouse report), `movement_receipt_idx` (held-release sums); rewrite `drive_scope_idx`, `distribution_scope_idx` as organization → created_at → id and `delivery_work_idx` with organization first; one notice index; add `(region_code, created_at)` on `fulfillment_cycle` for region reports.

### 9.4 Exit gate for T0-S
No migration merges unless: the removals above are applied or a written reason keeps a column; each index has a named query or constraint and an EXPLAIN (ANALYZE, BUFFERS) result with a fixed seed; the receipt-independence trigger is exercised under a restricted application role; the review-uniqueness indexes are exercised by a two-session race. A separate writer/reader table is not required.

### 9.5 Implementation status of T0-S (2026-10-10)

**Result: the T0-S gate of §9.4 is met for the SQL layer.** `identity.sql`, `response.sql`, `logistics.sql` and their `test-*.sql` were rewritten to §9 and run on `postgis/postgis:17-3.5` (pulled digest `sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6`, 2026-10-10; host `psql` 18.4 against server 17.5). Fresh databases load with `ON_ERROR_STOP=1`; assertions pass: identity 37, response 95, logistics 133 (old baseline 16/31/49). Zero ERROR lines.

**Privileges.** Each service has a NOLOGIN application role (`c48_identity_app`, `c48_response_app`, `c48_logistics_app`) that deployments grant to the login user. Tests run as that role and assert SQLSTATE 42501 for UPDATE/DELETE/TRUNCATE on every append-only table, for creating or replacing functions, and (Logistics) for any direct write to `stock_balance`. `apply_stock_movement()` is SECURITY DEFINER, owned by the NOLOGIN `c48_logistics_owner` (not a superuser, app role not a member), with a pinned `search_path = pg_catalog, public` and schema-qualified references; the app can insert a movement and create a zero balance (`id, warehouse_id, item_id` only) but cannot set or update balances. DELETE is granted only for retention cleanup (`idempotency_record`, `notice`, Identity sessions, `evidence_metadata`) and for the "replace as a set" commands (`distribution_line` while DRAFT, `drive_item`, `team_skill`). The append-only table list exists in two places per file (trigger block and grant block) and must be kept in sync.

**Races** (two real `psql` sessions, session B starts 0.3 s after A, A holds 1.0 s; scripts `race-tests-response.sh`, `race-tests-logistics.sh`): duplicate supplement review, duplicate failure review, two OFFERED missions for one team, duplicate recovery code hash, request lock order against RESOLVING (B waits, sees RESOLVING, creates no mission); concurrent RESERVE 6+6 on 10 (one wins, never over-reserved), approved adjustment applied twice (one movement), same receipt posted twice with different operation refs (one movement), two loss reviews on one handoff (one row). All pass; the loser gets 23505 or 23514 as intended.

**Measured plans** (synthetic data, cache warm, single host, PostgreSQL 17; scripts `explain-response.sql`, `explain-logistics.sql`):

| Query | Data | Time | Plan node |
|---|---|---|---|
| Attention queue LIMIT 50 | 200k requests | 0.04 ms | Index Only Scan `request_attention_idx` |
| Overdue VERIFYING scan | 200k | 0.04 ms | `request_attention_idx` + filter |
| Phone throttle count | 200k | 0.02 ms | Index Only Scan `request_phone_idx` |
| Keyset page 2 open queue | 200k | 0.04 ms | `request_org_fifo_idx` row comparison as Index Cond |
| Candidate teams (10 km, available, skills) | 3k teams, 2.9k positions | 4.5 ms | Seq Scan `rescue_team` anti-join active missions, ST_DWithin as filter (no GiST by design) |
| Heatmap 1 km, 30 days, one region | 10k verified+ requests | 23.7 ms | Bitmap Scan `request_org_region_fifo_idx` + grid aggregate (budget 500 ms) |
| Duplicate candidates | 200k | 0.16 ms | `request_subject_loc_gix` |
| Timeline newest 50 | 617 events on one request | 0.03 ms | Index Scan Backward `request_event_req_idx` |
| My requests page 2 / unassigned / campaign queue | 200k | 0.04 / 0.02 / 0.18 ms | `request_reporter_idx` / `request_unassigned_idx` / `request_campaign_idx` |
| Ledger keyset by balance | 200k movements | 0.18 ms | `movement_balance_idx` |
| Reconciliation by warehouse | 10k ledger rows | 4.3 ms | Index Only Scan `movement_balance_idx`, heap fetches 0 |
| Delivery work queue / public drives / distributions by organization | 50k / 2k / 20k | 0.09 / 0.03 / 0.06 ms | `delivery_work_idx` / `drive_public_idx` / `distribution_scope_idx` |
| Fulfillment board for one cycle | 100k needs, 60k commitments | 0.07 ms | `need_cycle_idx` + `commitment_need_idx`, no N+1 |

Possible indexes, not added because nothing exceeded its budget: a partial `(organization_id, region_code, received_at)` for the heatmap, and `(organization_id, status, created_at, id)` for status-filtered distribution lists. No unplanned sequential scan was found on a large table.

**Still open (outside the SQL layer):** the Response ↔ Logistics admission/offer race and the seal/abort fence need the services (cross-database) and belong to T9/T14/T16; the service-level rules (`attribution_locked_at`, `outcome_basis`, orphaned-duplicate cascade, auto reconcile/FULFILLED, delivery-carrier columns) have no SQL by design; TypeORM migrations equal to these files are T0. Index counts and plans must be re-measured on the real deployment hardware.
