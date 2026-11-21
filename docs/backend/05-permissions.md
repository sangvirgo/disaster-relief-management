# 05 — Roles, permissions and scope rules

Roles are a code catalog. The current role set has six codes: `ADMIN`, `COORDINATOR`, `OPERATIONS_MANAGER`, `REVIEWER`, `CITIZEN`, `VOLUNTEER`. The role-to-permission map is shared by the three services through `@c48/identity-contracts`. Identity introspection returns the user's live grants; each service evaluates `permission ∧ scope ∧ object relationship`. Hidden UI is never a control.

**Role-set history.** [identity.sql](schema/identity.sql) is the historical Initial-migration baseline and is not edited. Its `role_grant.role_code` CHECK lists the earlier set (including `CAMPAIGN_MANAGER`, `INTAKE_STAFF` and `DISTRIBUTION_STAFF`), and `CAMPAIGN_COORDINATOR` is added by a later migration. The Identity role-consolidation migration changes the role set again: it deletes existing `DISTRIBUTION_STAFF` grants, maps `CAMPAIGN_MANAGER` grants to `COORDINATOR` and `INTAKE_STAFF` grants to `OPERATIONS_MANAGER` (scope preserved). A final migration (`RetireCampaignCoordinatorRole`) deletes all `CAMPAIGN_COORDINATOR` grants (holders must be re-granted `COORDINATOR` explicitly) and replaces the CHECK with the six-role set. Use the migrations, not the baseline, as the live schema.

## 1. Role-to-permission map

● = granted. Team leader/member is an explicit `team_member` relationship in Response. Citizen rights are based on ownership or a valid capability, not staff permissions.

| Permission | CITIZEN | VOLUNTEER | COORDINATOR | OPERATIONS_MANAGER | REVIEWER | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `USER_MANAGE`, `GRANT_MANAGE` |  |  |  |  |  | ● |
| `AUDIT_READ` (Identity and Logistics audit) |  |  |  |  |  | ● |
| `REQUEST_CREATE_PROXY` (needs live session) | ● | ● | ● | ● |  | ● |
| `REQUEST_QUEUE_READ`, `REQUEST_DETAIL_READ`, `MISSION_OVERDUE_READ` |  |  | ● |  |  |  |
| `REQUEST_UNASSIGNED_QUEUE` (shared intake queue; SYSTEM scope only) |  |  | ● |  |  |  |
| `TEAM_READ`, `TEAM_MANAGE_ANY` (team setup and skills only; ADMIN has system-wide team scope) |  |  | ● |  |  | ● |
| `REQUEST_VERIFY`, `REQUEST_TRIAGE`, `REQUEST_CANCEL`, `REQUEST_REOPEN`, `REQUEST_RESOLVE` |  |  | ● |  |  |  |
| `MISSION_ASSIGN`, `MISSION_RECORD_ON_BEHALF`, `TEAM_POSITION_SET_ANY` |  |  | ● |  |  |  |
| `MAP_READ` (heatmap, grouped queue) |  |  | ● | ● |  |  |
| `CAMPAIGN_READ` |  |  | ● | ● |  |  |
| `CAMPAIGN_MANAGE` (create needs SYSTEM scope; update and pause need SYSTEM or a matching campaign grant) |  |  | ● | ● |  |  |
| `DONATION_DRIVE_MANAGE` (donation drives) |  |  |  | ● |  |  |
| `CAMPAIGN_WAREHOUSE_VIEW` (campaign warehouse assignment read) |  |  | ● | ● |  |  |
| `CAMPAIGN_WAREHOUSE_MANAGE` (manual primary warehouse, re-evaluation) |  |  |  | ● |  |  |
| `SUPPLY_GAP_VIEW` (supply-gap warnings and suggestions, read-only; SYSTEM scope) |  |  | ● | ● |  |  |
| `SUPPLY_GAP_MANAGE` (accept a suggested donation drive or dismiss a gap; SYSTEM scope) |  |  |  | ● |  |  |
| `PICKUP_TICKET_VIEW` (pickup tickets and their read model; campaign or SYSTEM scope; REVIEWER reads so the independent close-out review can run) |  |  | ● | ● | ● |  |
| `PICKUP_TICKET_MANAGE` (create, reserve, confirm and cancel a mission pickup ticket; the inner commitment, distribution and dispatch steps keep their own permissions) |  |  | ● | ● |  |  |
| `PICKUP_CLOSEOUT_SUBMIT` (draft and submit a pickup close-out; the team lead acts through a coordinator in the demo) |  |  | ● | ● |  |  |
| `PICKUP_CLOSEOUT_REVIEW` (approve or reject a submitted close-out; reviewer differs from submitter and from the handover user) |  |  |  | ● | ● |  |
| `RESPONSE_REPORT_READ` (Response aggregates) |  |  | ● | ● |  | ● |
| `REPORT_READ` (Logistics aggregates) |  |  | ● | ● |  | ● |
| `CATALOG_MANAGE`, `ASSET_MANAGE` (items, warehouses; SYSTEM scope only) |  |  |  | ● |  |  |
| `DONATION_INTAKE` (count received goods) |  |  |  | ● |  |  |
| `DONATION_REVIEW` (approve and post receipts; may also create receipts, count, confirm a count independently and attach counting evidence — user decision 2026-11-21) |  |  |  |  | ● |  |
| `NEED_MANAGE` (define, reduce or cancel need) |  |  | ● | ● |  |  |
| `NEED_ESTIMATE_CONFIRM` (generate SOS need estimates, confirm or edit them, and read the manager proposal queue `GET /need-proposals`) |  |  |  | ● |  |  |
| `NEED_NORM_MANAGE` (need norm table; system scope) |  |  |  | ● |  |  |
| `COMMITMENT_MANAGE` |  |  |  | ● |  |  |
| `DISTRIBUTION_PREPARE` |  |  |  | ● |  |  |
| `DISTRIBUTION_REVIEW` (approve) |  |  |  | ● | ● |  |
| `DISTRIBUTION_DISPATCH` (issue stock) |  |  |  | ● |  |  |
| `HANDOFF_RECORD` (direct delivery, point receipt, household handout, return and loss recording) |  |  |  | ● |  |  |
| `LOSS_APPROVE`, `ADJUSTMENT_REVIEW` (independent review) |  |  |  | ● | ● |  |
| `STOCK_ADJUST_REQUEST` |  |  |  | ● |  |  |

Notes:
- `REVIEWER` is the independent approver for receipts, distributions, losses and stock adjustments. It holds no other operational permission and no `REQUEST_CREATE_PROXY`.
- `OPERATIONS_MANAGER` holds the former `INTAKE_STAFF` and `DISTRIBUTION_STAFF` permissions in addition to its own. It has no `DONATION_REVIEW`, so it cannot approve donation receipts it counted or any other receipt; those go to `REVIEWER`.
- `CAMPAIGN_SETUP_MANAGE` (create a campaign, activate it, change its area) is held by `COORDINATOR` only, because coordinators draw campaigns from the SOS map. `OPERATIONS_MANAGER` does not create campaigns; it assigns a campaign's primary warehouse (`CAMPAIGN_WAREHOUSE_MANAGE`).
- `COORDINATOR` does not hold `DONATION_DRIVE_MANAGE` (user decision, 2026-11-19): donation drives are managed by `OPERATIONS_MANAGER` only. The coordinator holds `CAMPAIGN_SETUP_MANAGE` instead and creates campaigns from the SOS map.
- ADMIN has no request, victim or donor detail permission.
- The ADMIN team-management extension does not grant mission assignment, request detail, or team-position reporting. Self-grant is refused by Identity.
- `GET` endpoints with no row above need a valid session and object scope (e.g. own notices, own team).

## 2. Scope matching

A grant is `(role_code, scope_type, campaign_id?)`. The only Identity `scope_type` values are `SYSTEM` and `CAMPAIGN`. Which scope each role may hold:

| Role | Allowed scope | Notes |
|---|---|---|
| `COORDINATOR` | `SYSTEM` (primary coordinator) | A `CAMPAIGN` grant can exist only through migration of a former `CAMPAIGN_MANAGER` grant; its SOS effect is open (section 7). |
| `OPERATIONS_MANAGER` | `CAMPAIGN` (default) or `SYSTEM` | One campaign per `CAMPAIGN` grant. `SYSTEM` is an exception, issued by ADMIN and audited. |
| `REVIEWER` | `SYSTEM` or `CAMPAIGN` (validation accepts both) | Demo grants are SYSTEM; a campaign-scoped reviewer covers only that campaign. |
| `ADMIN`, `CITIZEN`, `VOLUNTEER` | `SYSTEM` only | |

A soft request claim (`handled_by`, 15-minute inactivity window) does not change scope. A primary coordinator (`COORDINATOR` + `SYSTEM`) can access every SOS and take over an active claim.

1. Alternative grants combine with **OR**. Each grant must independently match the action and object scope.
2. `SYSTEM` is an explicit grant that covers all eligible objects, including SOS requests without a campaign. It is not implied by ADMIN.
3. For roles other than the coordinator, `CAMPAIGN` covers only objects whose `campaign_id` matches the grant. It never covers an unassigned SOS.
4. A `COORDINATOR` may start a campaign engagement (at most three ACTIVE campaigns concurrently). Engagement is a presence and history record only; it never narrows SOS access. Coordination commands do not refresh engagement activity; a session expires 60 minutes after it starts or is renewed by calling `engage` again. Expired sessions remain in the history.
5. Campaign identifiers are validated by the owning API. They are opaque references without cross-service foreign keys.
6. Logistics assets without campaign attribution are shared catalog resources and require a SYSTEM grant. Campaign-attributed drives, fulfillment cycles and distributions may be accessed through the matching campaign grant or SYSTEM.

Only a primary system coordinator sees the shared intake queue. `unassigned=true` includes `UNMATCHED` and `CONFLICT` SOS, both of which have `campaign_id IS NULL`. When a primary coordinator attaches or removes a campaign manually, the request match state becomes `MANUAL` and an attaching claim is released.

### 2.1 Campaign versus system scope for OPERATIONS_MANAGER

- **CAMPAIGN scope (default).** One grant binds `OPERATIONS_MANAGER` to one campaign. It covers campaign-attributed donation drives, deliveries, receipts and their reviews, fulfillment cycles, needs and commitments under that campaign, and distributions whose `campaign_id` matches. Use it for staff who work on one campaign's intake and dispatch.
- **SYSTEM scope (exception).** Covers every campaign and the shared resources. Issued only by ADMIN, recorded in the audit log, and reserved for managers who coordinate across campaigns (for example `ops_mgr`).
- **Shared resources need SYSTEM.** `CATALOG_MANAGE` and `ASSET_MANAGE` (items, units, warehouses) are usable only with a SYSTEM grant, whatever the campaign.
- **Campaign creation needs SYSTEM.** `CAMPAIGN_MANAGE` on a new campaign is checked without a campaign identifier, so only a SYSTEM grant passes. Update and pause of an existing campaign pass with a SYSTEM grant or a matching CAMPAIGN grant.

## 3. Separation of duties

| Rule | Enforcement | Error |
|---|---|---|
| Distribution approver differs from its preparer. The preparer may dispatch the same distribution. | Database CHECK plus service | `SELF_APPROVAL_FORBIDDEN` (403) |
| The user who dispatched a distribution cannot record any handoff for it (direct delivery, point receipt, household handout, return or loss). | Service rule (new) | `SELF_HANDOFF_FORBIDDEN` (403) |
| A handoff recorder differs from its receiver. | Service rule | — |
| LOSS approver differs from the LOSS recorder. | Service rule | — |
| Receipt reviewer differs from every count author. | Service rule and test | — |
| Pickup ticket: the confirming user approves the draft; the reserving user is its preparer, so the existing self-approval rule applies. Handover dispatches the draft; the dispatcher differs from the approver (existing rule) and holds `DISTRIBUTION_DISPATCH`. A volunteer records no staff permission; the dispatcher may name the collector, who must be an active mission team member. | Existing distribution rules plus pickup-ticket facade (Step 6a). | `SELF_APPROVAL_FORBIDDEN`, `FORBIDDEN`, `PICKUP_COLLECTOR_NOT_MEMBER` |
| Need extraction sweep: a SYSTEM job with a null actor. It creates ESTIMATED lines only (through the same core as the manual estimate) and never confirms, cancels, admits or reviews anything. Its audit rows have a null actor. | Step 7 (need-extraction sweep). | — |
| Pickup close-out: the reviewer differs from the submitter (`SELF_REVIEW_FORBIDDEN`) and from the user who handed the goods over (`SELF_HANDOFF_FORBIDDEN`). Returns post a RETURN handoff with the reviewer as recorder, so the existing dispatch-actor rule applies as well. | Step 6b (pickup-goods service). | `SELF_REVIEW_FORBIDDEN`, `SELF_HANDOFF_FORBIDDEN` |

A single `OPERATIONS_MANAGER` account can prepare, dispatch and record different distributions, but it cannot approve its own preparation and cannot record the handoff of a distribution it dispatched. Demo seeds keep the four actors of one distribution distinct (see [seed-logistics.sql](seed/seed-logistics.sql)).

## 4. Object-level rules

| Object | Rule |
|---|---|
| Assistance request | Reporter (account owner or holder of a valid tracking code) sees their own request, reporter-visible timeline and permitted supplements. Staff need the relevant `REQUEST_*` permission and matching scope. An unassigned request is visible only through SYSTEM scope. Assigned team members see only permitted mission fields; contact phones are limited to the reporter, scoped coordinators and assigned team leader. |
| Mission | Read: active team members and appropriately scoped coordinators. Accept, decline, advance and report result: active leader only. Cancel, fail and record-on-behalf: authorized coordinator with a reason. |
| Team | Team resources are shared system-wide. Active leaders may edit their team; `TEAM_MANAGE_ANY` permits authorized coordinators and system ADMIN to manage team setup and skills. Membership and active-leader checks remain separate from campaign access. Mission suggestions use skills, distance, fresh position (at most 30 minutes), radius and availability; they never filter by campaign or assign a team. |
| Evidence | Download requires current authorization on the owning request, mission, donation or handoff; signed URL TTL is 60 seconds. RETURN evidence needs `DONATION_INTAKE` or `DISTRIBUTION_DISPATCH`; other handoff reads need `HANDOFF_RECORD`, except LOSS reads also allow `LOSS_APPROVE` for independent review. Recording or uploading LOSS evidence still needs `HANDOFF_RECORD`. |
| Donation | Account owner or valid donation capability may use public tracking. Staff need the drive's campaign scope or SYSTEM. Receipt number, name and phone grant no access. |
| Distribution | Separation of duties per section 3. Staff act on a distribution through its campaign scope or SYSTEM. |
| Receipt | Reviewer differs from every count author (service rule and test). |
| Notices | Only the recipient. |

## 5. PII inventory

Never log or expose in maps, heatmap cells, dashboards, AI input or signed-URL names: `assistance_request.reporter_name/reporter_contact_phone`, `request_subject.*contact*`, `alternate_contact_*`, exact `location`, `contact_attempt.note`, `donation_delivery.donor_name/donor_phone`, `handoff_record.receiver_label`, `rescue_team.external_contact_note`, and free-text descriptions. Public endpoints expose none of these.

## 6. Guest and public surface

`POST /identity/auth/register|login|refresh` · `POST /response/requests` (SELF) · SOS reporter operations authorized by `X-Tracking-Code`: `GET /response/requests/track`, `GET /response/requests/{id}/events`, `POST /response/requests/{id}/supplements`, `PUT /response/requests/{id}/report`, `POST /response/requests/{id}/evidence`, and `GET /response/evidence/{id}/download` · `GET /response/public/campaigns` · `GET /logistics/public/donation-drives[/{id}]` · `POST /logistics/public/donation-drives/{id}/deliveries` · `GET|POST /logistics/public/donations/{id}…` (donation capability). Account claim, recovery, and all other operations require a session.

Coordinator teams need no account or leader; scoped coordinators record sourced progress. APP direct actions retain active-leader guards. Readiness cannot bypass the active-cancel latch. RETURN warehouse recording requires `DONATION_INTAKE` or `DISTRIBUTION_DISPATCH`; LOSS approval is an independent authenticated review, never a supplied actor ID. Public request-category catalogs contain no victim data; recovery redemption requires a live session plus a purpose-bound code.

## 7. Open items

- **Campaign-scoped COORDINATOR.** Migrating a `CAMPAIGN_MANAGER` grant with `CAMPAIGN` scope yields a `COORDINATOR` grant with `CAMPAIGN` scope. The SOS rules in section 2 describe only the primary `COORDINATOR` + `SYSTEM` case, so the effect of a campaign-scoped coordinator on the request queue, verification and claims is not defined. Decide whether such grants should be converted to `OPERATIONS_MANAGER` or stay as campaign coordinators before relying on them. The demo seeds do not create one.
- **Stock scope.** Warehouse balances are shared resources. Whether `STOCK_ADJUST_REQUEST`, `DISTRIBUTION_DISPATCH` and `ADJUSTMENT_REVIEW` on a shared balance are allowed with a CAMPAIGN grant is not decided. Until it is, the demo  confirm this against the Logistics service before the demo.
- **Aggregate reads.** `MAP_READ`, `REPORT_READ` and `RESPONSE_REPORT_READ` with a CAMPAIGN grant: whether results are filtered to the grant's campaign is an implementation detail to confirm in each service.
- **Adjustment separation.** The rule that a stock adjustment reviewer differs from its requester is not stated in the current rules; confirm before treating it as enforced.
