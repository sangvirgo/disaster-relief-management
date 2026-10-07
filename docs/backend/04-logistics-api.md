# 04 — Logistics service: API contract

Schema: [schema/logistics.sql](schema/logistics.sql). Conventions: [00](00-setup.md). Permissions: [05](05-permissions.md). Business rules: plan §6.4, §8.3, §22.3, §23.2/23.4, §25. Quantities are **decimal strings** validated against `unit.scale`; reject ≤ 0 and wrong scale (`QUANTITY_SCALE_INVALID`). Public routes live under `/public/…` so Nginx can rate-limit them separately; this refines the sketches in plan §25.9 (non-final). No cart, checkout, payment or money fields exist anywhere.

**Stock rule (implement as one function; details in 00 §3.1):** stock changes **only by inserting a `stock_movement`** — a database trigger applies its deltas to `stock_balance` and the balance CHECKs (`on_hand ≥ 0`, `reserved ≥ 0`, `reserved ≤ on_hand`) fire in the same statement; the application role has no UPDATE on `stock_balance`. Per command: pre-read ids, then lock in this order — `distribution` → `fulfillment_cycle` (request-linked only) → `relief_need` → `commitment` → `stock_balance` (sorted by `(warehouse_id, item_id)`, **pre-inserting missing balances** with `ON CONFLICT DO NOTHING` in that order) — insert the movements (unique `operation_ref`), update counters, audit, notice; one short transaction, no outbound call, ≤ 50 lines (`TOO_MANY_LINES`). `operation_ref` is derived from a business key (`RCPT:{receipt}:{item}`, `ADJ:{adjustment}`, `{command}:{key}:{line}`), so a replay inserts nothing. Counters on `commitment` and `distribution_line` are written only by this function and reconciled against ledger/settlement sums in tests.

**Contract rules for every endpoint below:** each non-GET carries `Idempotency-Key` (00 §3) and each PATCH/deactivate/approve/review-style command on a versioned row carries `expected_version`; every list is keyset-paginated; list rows mask donor phones (`09******45`), the full number appears only in detail views for staff with the right scope.

## 1. Catalog and assets (`CATALOG_MANAGE` / `ASSET_MANAGE`; reads need a session in scope)

| Method & path | Notes |
|---|---|
| `GET /item-types` · `GET /units` · `GET /items?type=&status=&query=&cursor=` | Vietnamese display names; `unit.scale` included |
| `POST /item-types` · `POST /units` · `POST /items` (Idem) | `{ item_type_code, unit_code, name }`; `ITEM_NAME_TAKEN` 409 (per unit). Unit/type/code immutable after use |
| `POST /items/{id}/deactivate` | blocked only for new use; history kept |
| `POST /warehouses` · `PATCH /warehouses/{id}` · `POST …/deactivate` | `{ organization_id, region_code, name, address_note?, location? }` |
| `POST /relief-points` · `PATCH` · `deactivate` | location required; inactive point cannot be chosen for a new need/distribution (`POINT_INACTIVE`) |
| `POST /vehicles` · `PATCH` · `deactivate` | `{ identifier, vehicle_type, capacity?, capacity_unit? }`; `VEHICLE_IDENTIFIER_TAKEN` |
| `POST /stock/opening` (Idem) | `OPERATIONS_MANAGER`: `{ warehouse_id, lines:[{item_id, quantity}], note }` → `OPENING` movements (no fabricated donor receipt) |
| `GET /stock?warehouse_id=&item_id=` | `{ on_hand, reserved, available }` per item/unit — never summed across units |
| `GET /stock/{balance_id}/movements?cursor=` | append-only ledger view |
| `POST /stock/adjustments` (Idem) | `STOCK_ADJUST_REQUEST`: `{ balance_id, delta_on_hand, reason }` → `stock_adjustment` PENDING |
| `POST /stock/adjustments/{id}/review` (Idem) | `ADJUSTMENT_REVIEW` ≠ requester: `{ decision: APPROVE\|REJECT, note }`. First statement `SELECT stock_adjustment … FOR UPDATE` and check `PENDING`; APPROVE sets the status then inserts exactly one `ADJUSTMENT` movement (`operation_ref = 'ADJ:'||id`, `adjustment_id` set; the DB refuses a second movement, a mismatching delta/balance, or a poster other than the reviewer) and must keep `0 ≤ reserved ≤ on_hand` (`ADJUSTMENT_VIOLATES_RESERVED` 409). REJECT requires a note. Reviewed adjustments are immutable |

## 2. Donation drives

| Method & path | Auth | Behaviour |
|---|---|---|
| `GET /public/donation-drives?cursor=` · `GET /public/donation-drives/{id}` | public | OPEN drives only, ordered `created_at DESC, id DESC` (`drive_public_idx`; not by the nullable `closes_at`): title, description, items (name, type, unit, `target_quantity`, `acceptance_note`), `accepted_total` and `distributed_total` per item/unit, dates, intake location (warehouse name + `address_note` only, no exact point unless the manager marks it public), `campaign_status`, `generated_at`. If `campaign_id` is set and its cached status is not ACTIVE the drive is shown as not accepting handovers. |
| `POST /donation-drives` (Idem) | `DONATION_DRIVE_MANAGE` | `{ title, description, intake_warehouse_id, campaign_id?, opens_at?, closes_at?, items:[{item_id, target_quantity, acceptance_note?}] }` → DRAFT; campaign validated through Response internal API **before** the transaction (`CAMPAIGN_NOT_ACTIVE`/`RESPONSE_UNAVAILABLE`); caches `campaign_status` |
| `PATCH /donation-drives/{id}` · Ver | same | DRAFT only (items replaced as a set) |
| `POST /donation-drives/{id}/open` · `/pause` · `/resume` · `/close` (Idem · Ver) | same | pause/close need `reason`; open/resume re-check campaign (a PAUSED/CLOSED campaign ⇒ `CAMPAIGN_NOT_ACTIVE`); closing keeps receipts/disputes/returns operable |
| `GET /donation-drives?status=` | `DONATION_DRIVE_MANAGE`/`DONATION_INTAKE`/`DONATION_REVIEW` in scope | staff list incl. DRAFT/CLOSED |
| Scheduler | | every 5 min re-checks cached `campaign_status` of OPEN drives; campaign CLOSED ⇒ drive closed with reason `CAMPAIGN_CLOSED`; Response unreachable ⇒ keep cache, show `campaign_status_at` |

## 3. Donor declaration and private tracking (guest or signed-in)

| Method & path | Auth | Behaviour |
|---|---|---|
| `POST /public/donation-drives/{id}/deliveries` (Idem) | public; `Authorization: C48-Donation <secret>` (guest) or session | `{ donor_name, donor_phone, lines:[{item_id, declared_quantity}] }` → `201 { id, public_code, status: "DECLARED", declaration_revision: 1 }`. Drive must be OPEN and each item must be on the drive (`ITEM_NOT_ON_DRIVE`). Declaration **never changes stock**. Throttled per IP/phone; may reject at quota (not life-safety). |
| `GET /public/donations/{id}` | capability or owner | `{ public_code, status, declaration { revision, lines }, receipt? { count revision, per line: declared, counted, accepted, held, rejected, condition_note }, disputes[], progress }` — private; no other donors, no staff names |
| `POST /public/donations/{id}/declarations` (Idem · Ver) | capability or owner | new revision `{ lines }` only while `DECLARED` (before counting starts); later changes go through staff |
| `POST /public/donations/{id}/disputes` (Idem) | capability or owner | `{ reason }` → OPEN dispute; never deletes or alters counts; silence is not agreement |
| `POST /public/donations/{id}/evidence` · multipart (Idem) | capability or owner | §7; owner = delivery or dispute (`dispute_id` optional) |
| `POST /public/donations/{id}/claim` (Idem) | session + capability | binds `donor_user_id`, clears `capability_hash`, audited; `ALREADY_CLAIMED` |
| `POST /donation-deliveries/{id}/assisted-declaration` (Idem · Ver) | `DONATION_INTAKE` in scope | walk-in/lost-secret: staff-created revision with `created_by_kind = STAFF_ASSISTED` (shown as "chưa có xác nhận của người quyên góp") |
| `POST /donation-deliveries/{id}/capability/revoke` (Idem) | `DONATION_INTAKE` | audited recovery: clears hash; donor then claims via account |

Errors: `DRIVE_NOT_OPEN`, `ITEM_NOT_ON_DRIVE`, `DONATION_SECRET_INVALID` 400, `DONATION_SECRET_IN_USE` 409 (generic), `DECLARATION_LOCKED`, `ALREADY_CLAIMED`.

## 4. Receipt: count → independent review → post once

| Method & path | Perm | Behaviour |
|---|---|---|
| `GET /donation-deliveries?drive_id=&status=&cursor=` | `DONATION_INTAKE`/`DONATION_REVIEW` (intake-site scope) | work queue ordered `(created_at, id)` (`delivery_work_idx`); donor phone **masked**, full only in the detail view. `status` is the delivery's single lifecycle (the receipt has no separate status) |
| `POST /donation-receipts` (Idem) | `DONATION_INTAKE` | `{ delivery_id, warehouse_id }` (warehouse = drive's intake site unless an authorized override) → creates the receipt (unique per delivery) and sets `delivery.status = COUNTING` |
| `POST /donation-receipts/{id}/counts` (Idem · Ver) | `DONATION_INTAKE` | `{ lines:[{ item_id, counted_quantity, accepted_quantity, held_quantity, rejected_quantity, condition_note?, expiry_date? }], note? }` → new immutable `receipt_count` revision N+1 (computed **after** `donation_receipt … FOR UPDATE`; a unique violation ⇒ `STALE_REVISION`), `delivery.status → PENDING_REVIEW`, any earlier approval invalidated. `counted = accepted + held + rejected` (`COUNT_SPLIT_MISMATCH`). Unexpected items allowed. |
| `POST /donation-receipts/{id}/review` (Idem · Ver) | `DONATION_REVIEW` | `{ count_revision, declaration_revision, decision: APPROVE\|REJECT\|REQUEST_RECOUNT, reason? }`. Checks: reviewer ∉ authors of **any** count revision (`SELF_REVIEW_FORBIDDEN` — also enforced by a DB trigger in both directions), revisions equal the current ones (`STALE_REVISION` 409); the review row references real declaration/count revisions by composite FK. APPROVE ⇒ `delivery.status = APPROVED`. Differences between declared and counted are **recorded and notified to the donor**, never hidden; reasoned approval may proceed while a dispute remains open. |
| `POST /donation-receipts/{id}/post` (Idem · Ver) | `DONATION_REVIEW` | One transaction: re-verify APPROVE on the exact current revisions; lock balances sorted; upsert `stock_balance`; insert `RECEIPT` movements for `accepted_quantity` per item (`operation_ref = RCPT:{receipt}:{item}`; unique index also blocks a replay under a new key); `delivery.status = POSTED`; audit; donor notice. Balances are locked in `(warehouse_id, item_id)` order after pre-inserting missing ones, so two posts with items (A,B) and (B,A) cannot deadlock. `RECEIPT_NOT_APPROVED`, `ALREADY_POSTED` (returns the original result on replay). |
| `POST /donation-receipts/{id}/release-held` (Idem · Ver) | `DONATION_REVIEW` | later accept held goods: `{ lines:[{item_id, quantity}], reason }` posts only the additional quantity as `RECEIPT_HELD_RELEASE` (`operation_ref` unique; the service checks cumulative releases ≤ held under the receipt-row lock) and records the reduced held quantity in a **new count revision** (never edits the old one) |
| `GET /donation-disputes?status=` · `POST /donation-disputes/{id}/resolve` | `DONATION_REVIEW` | `{ resolution_note }`; donor notified; dispute rows are never deleted |

## 5. Needs, commitments and fulfillment (request-linked aid)

Response is authoritative for the request; Logistics validates it through `GET /internal/requests/{id}` on Response (service token, 2 s, **before** opening a transaction): status ∈ {VERIFIED, TRIAGED, DISPATCHED, IN_PROGRESS}, `work_cycle`, organization/region/campaign for attribution, caller's scope.

| Method & path | Perm | Behaviour |
|---|---|---|
| `POST /needs` (Idem) | `NEED_MANAGE` | `{ request_id, work_cycle, item_id, quantity, delivery_target_kind?: FINAL_RECIPIENT, designated_point_id?, reason? }`. Creates the `fulfillment_cycle` on first use (unique constraint, then lock the winner) and copies organization/campaign/region attribution onto the **cycle** (one per request, not per need). Cycle must be OPEN (`CYCLE_FROZEN`/`CYCLE_SEALED` 409). The delivery target is **derived**: no `designated_point_id` ⇒ FINAL_RECIPIENT, otherwise RELIEF_POINT (requires an active point, a reason and the grant); it is immutable once any commitment exists. The API echoes it as `delivery_target_kind`, but there is no stored column. One live need per item per cycle (`NEED_EXISTS`). |
| `POST /needs/{id}/reduce` (Idem · Ver) | `NEED_MANAGE` | `{ quantity, reason }` down to `delivered + reserved_remaining + unsettled_issued` only (`BELOW_PROTECTED_QUANTITY` 409) ; `original_quantity` unchanged |
| `POST /needs/{id}/cancel` (Idem · Ver) | `NEED_MANAGE` | releases all unissued reservations atomically; rejects while issued goods are unsettled (`UNSETTLED_ISSUED_GOODS`); sets `cancelled_remaining = requested − delivered`, status CANCELLED |
| `POST /needs/{id}/confirm-fulfilled` (Idem · Ver) | `NEED_MANAGE` | only when `delivered = requested`; status FULFILLED |
| `POST /needs/{id}/commitments` (Idem · Ver need) | `COMMITMENT_MANAGE` | `{ warehouse_id, quantity }`; locks cycle→need→balance; enforces `delivered + reserved_remaining + unsettled_issued + quantity ≤ requested` and `available ≥ quantity` (`INSUFFICIENT_STOCK`, `NEED_OVER_COMMITTED` 409); inserts commitment + `RESERVE` movement. Campaign PAUSED ⇒ `CAMPAIGN_PAUSED` for campaign-linked needs. |
| `POST /commitments/{id}/release` (Idem · Ver) | `COMMITMENT_MANAGE` | `{ quantity, reason }` unissued part only; `RELEASE` movement |
| `GET /needs?request_id=&work_cycle=&cursor=` | scope | needs with derived totals (index `need_cycle_idx`) |
| `GET /requests/{request_id}/fulfillment?work_cycle=` | `NEED_MANAGE`/`REPORT_READ` in scope | `{ needs:[{ item, unit, original, requested, committed_reserved, issued_unsettled, delivered, returned, lost, outstanding, cancelled_remaining, status, contributions: first 20 + `more` (full list via `GET /needs/{id}/contributions?cursor=`) }], cycle_state, generated_at }` (`outstanding = requested − delivered` for non-cancelled, else 0) |
| `GET /internal/requests/{request_id}/fulfillment?work_cycle=` | service token | same, for Response's resolution checks |
| `POST /internal/requests/{request_id}/cycles/{cycle}/freeze` · `/seal` · `/unseal` | service token (Response only) | Idempotent on `intent_id`. **seal / freeze** first confirm with Response (`GET /internal/operations/{intent_id}`) that the intent is still `PENDING` (a delayed seal for an aborted intent must fail), then **seal**: lock cycle; refuse if any need OPEN/PARTIALLY_FULFILLED, any `reserved_remaining > 0`, any `unsettled_issued > 0` (`409 CYCLE_NOT_SETTLED` with reasons); creating a missing cycle then sealing handles empty cycles; sets SEALED + `seal_id`. **freeze** (upserts the cycle if missing, so a delayed `POST /needs` finds a FROZEN cycle): block new needs/increases/commitments/issues; allow release, cancel, physical settlement. **unseal**: only if `fulfillment_cycle.intent_id` equals the presented intent **and** Response confirms that exact intent is ABORTING and the request is not RESOLVED/CLOSED (a stale unseal of an old intent can never undo a newer seal). No TTL, no auto-unseal. |

Every command above that is request-linked first locks `fulfillment_cycle` (SEALED ⇒ `CYCLE_SEALED`, FROZEN ⇒ only release/cancel/settlement allowed), including previously validated delayed calls.

## 6. Distribution, dispatch and handoff

`purpose`: `REQUEST_AID` (lines reference commitments), `CAMPAIGN_DISTRIBUTION` (direct, no commitment), `POINT_REPLENISHMENT` (target relief point). Each unit leaves stock by exactly one `ISSUE`.

| Method & path | Perm | Behaviour |
|---|---|---|
| `POST /distributions` (Idem) | `DISTRIBUTION_PREPARE` | `{ warehouse_id, relief_point_id?, vehicle_id?, purpose, campaign_id?, lines:[{ item_id, quantity, commitment_id? }] }` → DRAFT. The organization comes from the warehouse (composite FK; point and vehicle must belong to the same organization); the DB also refuses a line whose item or warehouse differs from its commitment's, and freezes lines once the distribution leaves DRAFT. REQUEST_AID lines need `commitment_id` whose need item equals `item_id` and quantity ≤ commitment's reserved_remaining; vehicle/point must be ACTIVE and in scope |
| `PUT /distributions/{id}/lines` (Idem · Ver) | `DISTRIBUTION_PREPARE` (preparer) | replaces lines; **version increments and any approval is voided** (status back to DRAFT) |
| `POST /distributions/{id}/approve` (Idem · Ver) | `DISTRIBUTION_REVIEW` | approver ≠ preparer; stores `approved_version = version` (`SELF_APPROVAL_FORBIDDEN`) |
| `POST /distributions/{id}/dispatch` (Idem · Ver) | `DISTRIBUTION_DISPATCH` | dispatcher ≠ approver; requires `approved_version = version` (`APPROVAL_STALE`); stock transaction per the stock rule: REQUEST_AID ⇒ `ISSUE` with `commitment_id` (reserved already held; `commitment.issued_quantity += q`); direct ⇒ `RESERVE` then `ISSUE` with `distribution_line_id` in the same transaction (insufficient ⇒ whole command rolls back, `INSUFFICIENT_STOCK`); status DISPATCHED. Concurrent dispatches against the same stock: exactly one wins (TC-16). |
| `POST /distributions/{id}/cancel` (Idem · Ver) | preparer/approver | before dispatch only (`ALREADY_DISPATCHED`) |
| `POST /distributions/{id}/handoffs` (Idem) | `HANDOFF_RECORD` (kinds DIRECT_HOUSEHOLD, POINT_RECEIPT, HOUSEHOLD_HANDOUT, RETURN) · `LOSS_APPROVE` co-sign for LOSS | `{ handoff_kind, source_stage?, receiver_user_id?, receiver_label?, confirmation_basis, occurred_at, approved_by?, lines:[{ distribution_line_id, quantity }] }`; rules below |
| `POST /distributions/{id}/reconcile` (Idem · Ver) | `DISTRIBUTION_REVIEW` | status RECONCILED only when every line has `in_transit = 0` and `at_point = 0` |
| `GET /distributions/{id}` · `GET /distributions?status=` | scope | lines with `dispatched, received, handed_out, returned, lost, in_transit, at_point` |

**Handoff arithmetic (per distribution line; the command takes `distribution … FOR UPDATE` itself because handoffs carry no `expected_version`, and the same figures are kept as `in_transit_quantity` / `at_point_quantity` counters with `≥ 0` CHECKs):**
`in_transit = dispatched − POINT_RECEIPT − DIRECT_HOUSEHOLD − (RETURN+LOSS with stage IN_TRANSIT)` and `at_point = POINT_RECEIPT − HOUSEHOLD_HANDOUT − (RETURN+LOSS with stage AT_POINT)`; both must stay ≥ 0 (`HANDOFF_EXCEEDS_BALANCE`). `DIRECT_HOUSEHOLD` requires the distribution to have **no** relief point; `POINT_RECEIPT`/`HOUSEHOLD_HANDOUT` require one (`HANDOFF_KIND_INVALID`). Recorder ≠ receiver; LOSS needs `approved_by` ≠ recorder with `LOSS_APPROVE`; RETURN is recorded by warehouse staff only after the physical receipt and inserts a `RETURN` movement with `handoff_line_id` set (credit on_hand; a unique index allows one RETURN movement per handoff line) — a return never credits stock before this record. The DB refuses a DIRECT_HOUSEHOLD handoff when the distribution has a relief point (and POINT_RECEIPT / HOUSEHOLD_HANDOUT when it has none), a settlement whose type disagrees with the handoff kind, and a settlement pointing at a different commitment than the handoff line. For a request-linked line, each handoff inserts `issued_line_settlement` + increments the commitment counter: `DELIVERED` for DIRECT_HOUSEHOLD/HOUSEHOLD_HANDOUT when the need's target is FINAL_RECIPIENT, or for POINT_RECEIPT when the target is RELIEF_POINT (a point receipt never satisfies FINAL_RECIPIENT); `RETURNED` for RETURN; `LOST` for LOSS. Settled total ≤ issued (`SETTLEMENT_EXCEEDS_ISSUED`). Households need no account or phone: record `receiver_label` and `confirmation_basis`; optional private evidence upload. After each settlement recompute the need's status (OPEN → PARTIALLY_FULFILLED → [coordinator confirm] FULFILLED).

Errors (messages in [07-error-catalog.md](07-error-catalog.md)): `SELF_APPROVAL_FORBIDDEN`, `APPROVAL_STALE`, `ALREADY_DISPATCHED`, `HANDOFF_EXCEEDS_BALANCE`, `HANDOFF_KIND_INVALID`, `SETTLEMENT_EXCEEDS_ISSUED`, `LINE_ITEM_MISMATCH`, `POINT_INACTIVE`, `VEHICLE_INACTIVE`.

## 7. Attachments

`POST …/evidence` (donation, dispute, handoff) follows the Response evidence procedure (plan §23.5): reserve quota under the owner row lock, stream outside any transaction, detect real content type, then mark READY; limits ≤ 5 files and 100 MiB per owner, JPEG/PNG ≤ 10 MiB, MP4 ≤ 50 MiB; Logistics bucket and credentials only; downloads re-authorize then issue a 60 s signed URL. Guest/capability uploads use a lower per-IP quota and may reject at it.

## 8. Reports and reconciliation (each response has `generated_at`)

| Method & path | Auth | Content |
|---|---|---|
| `GET /public/donation-reports/summary?drive_id=` | public | per item/unit: **accepted** and **final-distributed** totals; no contacts, evidence or locations. Aggregated live from `receipt_count_line`, so it is **cached 60 s** per drive (an unauthenticated route must not run a large aggregate per hit) |
| `GET /reports/stock-summary?warehouse_id=&cursor=` | `REPORT_READ` | on_hand/reserved/available per warehouse and item/unit; held and in-transit shown separately; units never added across |
| `GET /reports/fulfillment?campaign_id=&region_code=&from=&to=` | `REPORT_READ`; scope filter + window ≤ 366 days required | per need: original, reduced/cancelled, active requested, delivered, active outstanding in **separate columns** |
| `GET /reconciliation?warehouse_id=&item_id=` | `REPORT_READ`/`DISTRIBUTION_REVIEW`; `warehouse_id` required (index-only scan on `movement_balance_idx`) | intake accepted, posted movements, reserved, issued-in-transit, at-point, delivered, returned, lost; flags any `balance ≠ Σ movements` or `commitment counter ≠ Σ settlements` |
| `GET /notices` · `POST /notices/{id}/read` | recipient | stock/task notices |

## 9. Tests (planned)

TC-15..19, TC-31, TC-DON-01..07/09, TC-DIST-01..04, TC-REC-01, TC-BE-05/09/15/17/18/19/21/22/23/26, TC-REV-09/14. Race tests with two real connections: two dispatches on one stock; two commitments on one need; commitment vs seal; post receipt twice with different keys; self-review attempt; handoff over-balance; approval then line edit then dispatch.
