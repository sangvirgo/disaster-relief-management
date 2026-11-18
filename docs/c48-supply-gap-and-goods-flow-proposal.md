# C48 Proposal: Warehouse-aware supply gaps and simplified goods flow

Status: proposal, dated 2026-11-18. Nothing here is implemented. The warehouse and SOS request schemas have not yet been checked against this design.

## 1. Goal

- Stop the **COORDINATOR** from creating relief campaigns and donation drives. Only the **manager (OPERATIONS_MANAGER)** does that.
- Detect goods shortfalls automatically, warn the coordinator, and give the manager a prefilled draft donation drive to approve. Humans decide; the system never creates a drive by itself.
- Scope guard: per `AGENTS.md`, donations and Logistics are supporting capabilities with a short, optional demo. Do not expand warehouse or donation depth beyond this proposal.

## 2. What exists today

- A coordinator can `POST campaigns`, `activate` and `changeArea` (`backend/apps/response/src/campaigns/campaigns.controller.ts`, `frontend/web/src/features/coordinator/Campaigns.tsx`; the T12 smoke test does this).
- Campaigns already have `center` and `radius_m`.
- Drives: `DrivesService.create` requires `DONATION_DRIVE_MANAGE`. A drive has `intake_warehouse_id`, `campaign_id` and per-item `target_quantity`.
- Demand model: `relief_need` (per `fulfillment_cycle`, linked to a campaign).
- Reservations: `commitment` (with `issued`, `delivered`, `returned`, `lost` quantities).
- Stock balances (on_hand, reserved) with adjustments that need independent review.
- Warehouses appear to have only a name, so there is probably no location yet (to be confirmed).
- `CAMPAIGN_COORDINATOR` and `CAMPAIGN_MANAGER` were retired in earlier migrations. "Campaign manager" is taken to mean OPERATIONS_MANAGER.

## 3. Design

### 3.1 Warehouse location

Add `location` (PostGIS point) and `service_radius_m` to warehouses. Radii may overlap.

### 3.2 Campaign-warehouse assignment

```
campaign_warehouse(campaign_id, warehouse_id, role PRIMARY|BACKUP, source AUTO|MANUAL)
```

- A warehouse is eligible if the campaign area intersects its circle: `ST_DWithin(center, wh, wh.radius + campaign.radius)`.
- Exactly one PRIMARY per campaign. Only the primary's demand counts, so overlap never double-counts. Other eligible warehouses are BACKUP and informational only.
- Auto ranking: has stock, then lower load, then shorter distance, then warehouse id as a stable tie-break.
- The choice is **sticky**. Re-evaluate only when the primary is deactivated, its radius changes, the campaign area changes, or the manager overrides. A manual override is never auto-overwritten.

### 3.3 SOS goods demand (detailed or not)

```
request_need_line(request_id, item, quantity, unit, source DECLARED|ESTIMATED|CONFIRMED)
```

- If the SOS has no detail, the system estimates from a rule table, not AI:
  `estimate = people x days x norm x (1 + group modifiers)`
  Example norms: water 3 L per person per day, 3 meals of food, 1 blanket per person. The manager can configure them. Reason codes map to Vietnamese text.
- The coordinator reviews and confirms during verification. Only CONFIRMED and DECLARED lines feed the gap. ESTIMATED lines are shown as a separate forecast.

### 3.4 Gap calculation

```
unmet(item)        = sos_need - committed (reserved + issued + delivered)
warehouse_demand   = sum of unmet over campaigns whose PRIMARY is this warehouse
supply             = on_hand - reserved
                   + remaining target of open drives at this warehouse
gap                = warehouse_demand - supply
```

- `gap > 0`: red warning, plus one pending `supply_gap` (`OPEN/ACCEPTED/DISMISSED/EXPIRED`) with a draft drive.
- `demand/supply >= 0.8`: yellow warning.
- One OPEN gap per (warehouse, item), refreshed instead of duplicated, with a cooldown after dismissal.
- Goods in team custody and commitments held at another warehouse are counted once, at their own location.

### 3.5 Conflict cases

| Case | Handling |
|---|---|
| Campaign in 2+ radii | One PRIMARY, others BACKUP |
| Primary short, backup has stock | Warning shows the backup; manager can reassign. No auto-transfer. |
| Campaigns compete for one item | Demand summed per warehouse, one gap listing all campaigns |
| Outside every radius | "No serving warehouse" flag; manager picks a warehouse or extends a radius |
| Warehouse deactivated or radius shrunk | Re-evaluate, audit the change |
| Drive already covers the gap | Pledged quantity is subtracted |
| Concurrent recomputation | Lock per warehouse, idempotent writes |
| Unit mismatch | Compare only same item and unit, using existing unit scale |
| Declared quantity far from estimate | Flag for the coordinator with the estimate shown |
| Item not in catalog | Free-text line; coordinator maps it to a catalog item |
| SOS cancelled or resolved early | Release the reservation back to stock |
| Volunteer does not pick up in time | Reservation expires and is released; coordinator warned |
| Out of stock on arrival | Volunteer reports it; system suggests a BACKUP warehouse |
| Duplicate SOS for one household | Merge needs so demand is not counted twice |

### 3.6 Team custody and retire

Teams can carry a field kit.

- Issue: warehouse stock moves to the team's custody.
- Use: recorded per SOS (delivered).
- Close-out: leftovers are **returned** if the item is returnable and undamaged, otherwise **retired** with a reason (`CONSUMED, EXPIRED, DAMAGED, LOST, NOT_RETURNABLE`).
- Add a `returnable` flag (optionally `perishable` / `expires_at`) to the item catalog.
- Invariant: `issued = delivered + returned + retired`. A mission cannot close with unaccounted goods.
- Retire needs independent approval, as stock adjustments already do.

### 3.7 Simplified goods flow

Collapse need, commitment, distribution (create, prepare, approve, dispatch), return and adjustment into **one pickup ticket per mission**:

```
OPEN -> READY -> HANDED_OVER -> CLOSED
```

- OPEN: auto-created from the SOS lines.
- READY: auto-reserved from the primary warehouse on assignment; the coordinator confirms once.
- HANDED_OVER: the volunteer taps pickup and goods move to team custody.
- CLOSED: the close-out screen for return or retire.

Build it as a thin facade over the existing tables, not a rewrite of stock accounting. Distribution approval is required only above a quantity threshold or for restricted items such as medicine. Vehicle capacity checks become optional (T15 shows they are only warnings).

Keep strict: the reconciliation invariant, independent retire approval, the audit log, and idempotency.

| Before | After (user view) |
|---|---|
| need, commitment, distribution (create, prepare, approve, dispatch), return, adjustment | pickup ticket with 4 states, plus a close-out screen |
| about 8 actions across 3 roles | about 3 actions: confirm ticket, volunteer pickup, close-out |

## 4. Implementation plan

1. **Permissions.** Move campaign `create`, `activate` and `changeArea` to OPERATIONS_MANAGER. Update the guards, hide the create UI for coordinators in `Campaigns.tsx`, switch the T12 smoke test to `ops_mgr`, and update seeds and tests.
2. **Warehouse location and radius.** Migration, DTOs, OpenAPI, and a map picker on the web form.
3. **Campaign-warehouse assignment.** Table, eligibility query, primary selection, sticky re-evaluation, manager override endpoint, and the no-warehouse flag.
4. **SOS need lines and norm table.** Declared, estimated and confirmed lines, with coordinator confirmation in verification.
5. **Gap calculation and suggestions.** `supply_gap` table, scheduled job (about every 15 minutes) plus triggers on stock or need changes, `GET supply-gaps`, `accept` (manager only, through the existing `DrivesService.create`) and `dismiss` (reason required).
6. **Pickup ticket, custody and close-out.** Auto-reserve, volunteer pickup list, return or retire screen, and retire approval.
7. **UI in Vietnamese.** Coordinator warning badges (read-only) and a manager "Đề xuất quyên góp" inbox.
8. **Verification and docs.** Unit tests for the formula and radius matching. A smoke test where the coordinator gets 403, a gap appears, and the manager accepts it and a drive exists. Cover the conflict table and Vietnamese message checks for success, validation, permission and conflict paths. Update the plan and backend docs, keeping UR/FR/UC/TC traceability.

**Demo scope guard:** seed a small norm table (water, food, blankets, medicine). Skip forecasting, push notifications, automatic warehouse switching and per-team kit limits.

## 5. Open questions

- Should warehouse capacity be a single total, per item type, or just current stock? Recommendation: per item type.
- Overlap rule: nearest warehouse only, or split by stock? Current default is one sticky PRIMARY by the ranking above.
- Confirm "campaign manager" means OPERATIONS_MANAGER.
- Confirm the warehouse schema has no location column, and check how SOS requests currently store need data.

## 6. Next concrete step

Step 1 (the permission change), then Steps 2 and 3.
