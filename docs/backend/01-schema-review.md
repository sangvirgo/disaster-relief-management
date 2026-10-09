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
