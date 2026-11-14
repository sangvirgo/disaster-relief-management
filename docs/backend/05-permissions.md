# 05 — Roles, permissions and scope rules

Roles are a code catalog (`role_grant.role_code` CHECK in [identity.sql](schema/identity.sql)); the role-to-permission map is shared by the three services through `@c48/identity-contracts`. Identity introspection returns the user's live grants; each service evaluates `permission ∧ scope ∧ object relationship`. Hidden UI is never a control.

## 1. Role-to-permission map

● = granted. Team leader/member is an explicit `team_member` relationship in Response. Citizen rights are based on ownership or a valid capability, not staff permissions.

| Permission | CITIZEN | VOLUNTEER | COORDINATOR | CAMPAIGN_MANAGER | OPERATIONS_MANAGER | INTAKE_STAFF | REVIEWER | DISTRIBUTION_STAFF | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `USER_MANAGE`, `GRANT_MANAGE` |  |  |  |  |  |  |  |  | ● |
| `AUDIT_READ` (Identity and Logistics audit) |  |  |  |  |  |  |  |  | ● |
| `REQUEST_CREATE_PROXY` (needs live session) | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `REQUEST_QUEUE_READ`, `REQUEST_DETAIL_READ`, `TEAM_READ`, `MISSION_OVERDUE_READ`, `CAMPAIGN_READ` |  |  | ● |  |  |  |  |  |  |
| `REQUEST_VERIFY`, `REQUEST_TRIAGE`, `REQUEST_CANCEL`, `REQUEST_REOPEN`, `REQUEST_RESOLVE` |  |  | ● |  |  |  |  |  |  |
| `MISSION_ASSIGN`, `MISSION_RECORD_ON_BEHALF`, `TEAM_MANAGE_ANY`, `TEAM_POSITION_SET_ANY` |  |  | ● |  |  |  |  |  |  |
| `MAP_READ` (heatmap, grouped queue) |  |  | ● |  | ● |  |  |  |  |
| `CAMPAIGN_READ` |  |  | ● | ● | ● |  |  |  |  |
| `CAMPAIGN_MANAGE` |  |  | ● | ● | ● |  |  |  |  |
| `REPORT_READ` (Response/Logistics aggregates) |  |  | ● | ● | ● |  |  |  | ● |
| `CATALOG_MANAGE`, `ASSET_MANAGE` (items, warehouses, vehicles, points) |  |  |  |  | ● |  |  |  |  |
| `DONATION_DRIVE_MANAGE` |  |  |  | ● | ● |  |  |  |  |
| `DONATION_INTAKE` (count) |  |  |  |  |  | ● |  |  |  |
| `DONATION_REVIEW` (approve/post) |  |  |  |  | ○ | ○ | ● |  |  |
| `NEED_MANAGE` (define/reduce/cancel need) |  |  | ● |  | ● |  |  |  |  |
| `COMMITMENT_MANAGE` |  |  |  |  | ● |  |  |  |  |
| `DISTRIBUTION_PREPARE` |  |  |  |  | ● | ● |  | ● |  |
| `DISTRIBUTION_REVIEW` (approve) |  |  |  |  | ● |  | ● |  |  |
| `DISTRIBUTION_DISPATCH` (issue stock) |  |  |  |  |  | ● |  | ● |  |
| `HANDOFF_RECORD` (direct delivery, point receipt, household handout, return and loss recording) |  |  |  |  |  |  |  | ● |  |
| `LOSS_APPROVE`, `ADJUSTMENT_REVIEW` |  |  |  |  | ● |  | ● |  |  |
| `STOCK_ADJUST_REQUEST` |  |  |  |  |  | ● |  | ● |  |

○ = only when a separate `REVIEWER` grant is present; there is no implicit review right for managers or intake staff. ADMIN has no request, victim or donor detail permission. Self-grant is refused by Identity.

## 2. Scope matching

A grant is `(role_code, scope_type, campaign_id?)`. The only `scope_type` values are `SYSTEM` and `CAMPAIGN`.

A soft request claim (`handled_by`, 15-minute inactivity window) does not change scope: a coordinator may claim only requests inside the coordinator's own campaign scope (or unattached requests with a SYSTEM grant). Another coordinator's active claim blocks coordination commands except for a SYSTEM coordinator, whose takeover is audited (`CLAIM_TAKEN_OVER`).

1. Alternative grants combine with **OR**. Each grant must independently match the action and object scope.
2. `SYSTEM` is an explicit grant that covers all eligible objects, including SOS requests without a campaign. It is not implied by ADMIN.
3. `CAMPAIGN` covers only objects whose `campaign_id` matches the grant. It never covers an SOS request whose `campaign_id` is `NULL`.
4. A user may receive both SYSTEM and CAMPAIGN grants; the demo coordinator does so to exercise both queues.
5. Campaign identifiers are validated by the owning API. They are opaque references without cross-service foreign keys.
6. Logistics assets without campaign attribution are shared catalog resources and require a SYSTEM grant. Campaign-attributed drives, fulfillment cycles and distributions may be accessed through the matching campaign grant or SYSTEM.

The coordinator's shared intake queue is filtered by `unassigned=true` and contains only rows where `campaign_id IS NULL`. The request scope predicate is still applied first: a campaign-only coordinator receives no unassigned rows.

## 3. Object-level rules

| Object | Rule |
|---|---|
| Assistance request | Reporter (account owner or valid tracking secret) sees their own request, reporter-visible timeline and permitted supplements. Staff need the relevant `REQUEST_*` permission and matching scope. An unassigned request is visible only through SYSTEM scope. |
| Mission | Read: active team members and appropriately scoped coordinators. Accept, decline, advance and report result: active leader only. Cancel, fail and record-on-behalf: authorized coordinator with a reason. |
| Team | Team resources are shared system-wide. Membership and active-leader checks remain separate from campaign access. Mission suggestions use skills, distance, availability and active-mission capacity; they never assign a team. |
| Evidence | Download requires current authorization on the owning request, mission, donation or handoff; signed URL TTL is 60 seconds. RETURN evidence needs `DONATION_INTAKE` or `DISTRIBUTION_DISPATCH`; other handoff reads need `HANDOFF_RECORD`, except LOSS reads also allow `LOSS_APPROVE` for independent review. Recording or uploading LOSS evidence still needs `HANDOFF_RECORD`. |
| Donation | Account owner or valid donation capability may use public tracking. Staff need the drive's campaign scope or SYSTEM. Receipt number, name and phone grant no access. |
| Distribution | Approver differs from preparer and dispatcher; preparer may dispatch (database CHECK plus service). A handoff recorder differs from its receiver. LOSS approver differs from recorder. |
| Receipt | Reviewer differs from every count author (service rule and test). |
| Notices | Only the recipient. |

## 4. PII inventory

Never log or expose in maps, heatmap cells, dashboards, AI input or signed-URL names: `assistance_request.reporter_name/reporter_contact_phone`, `request_subject.*contact*`, `alternate_contact_*`, exact `location`, `contact_attempt.note`, `donation_delivery.donor_name/donor_phone`, `handoff_record.receiver_label`, `rescue_team.external_contact_note`, and free-text descriptions. Public endpoints expose none of these.

## 5. Guest and public surface

`POST /identity/auth/register|login|refresh` · `POST /response/requests` (SELF) · `GET /response/requests/track` · `POST /response/requests/{id}/supplements` · `POST /response/requests/{id}/evidence` (guest, secret) · `GET /response/public/campaigns` · `GET /logistics/public/donation-drives[/{id}]` · `POST /logistics/public/donation-drives/{id}/deliveries` · `GET|POST /logistics/public/donations/{id}…` (capability). Everything else requires a session.

Coordinator teams need no account or leader; scoped coordinators record sourced progress. APP direct actions retain active-leader guards. Readiness cannot bypass the active-cancel latch. RETURN warehouse recording requires `DONATION_INTAKE` or `DISTRIBUTION_DISPATCH`; LOSS approval is an independent authenticated review, never a supplied actor ID. Public request-category catalogs contain no victim data; recovery redemption requires a live session plus a purpose-bound code.
