# 05 — Roles, permissions and scope rules

Roles are a **code catalog** (`role_grant.role_code` CHECK in [identity.sql](schema/identity.sql)); the role → permission map below is a TypeScript constant shared by the three services through `packages/technical` (data only, no logic). Identity introspection returns the user's live grants; each service evaluates `permission ∧ scope ∧ object relationship`. Hidden UI is never a control.

## 1. Role → permission map

● = granted. Team leader/member is **not** a role: it is the `team_member` relationship in Response. Citizen/guest rights are ownership/capability based, not grants.

| Permission | CITIZEN | VOLUNTEER | COORDINATOR | CAMPAIGN_MANAGER | OPERATIONS_MANAGER | INTAKE_STAFF | REVIEWER | DISTRIBUTION_STAFF | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `USER_MANAGE`, `GRANT_MANAGE`, `ORG_MANAGE` (session revocation happens as a side effect of these) |  |  |  |  |  |  |  |  | ● |
| `AUDIT_READ` (Identity audit) |  |  |  |  |  |  |  |  | ● |
| `REQUEST_CREATE_PROXY` (needs live session) | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `REQUEST_QUEUE_READ`, `REQUEST_DETAIL_READ`, `TEAM_READ`, `MISSION_OVERDUE_READ`, `CAMPAIGN_READ` |  |  | ● |  |  |  |  |  |  |
| `REQUEST_VERIFY`, `REQUEST_TRIAGE`, `REQUEST_CANCEL`, `REQUEST_REOPEN`, `REQUEST_RESOLVE` |  |  | ● |  |  |  |  |  |  |
| `REQUEST_UNASSIGNED_QUEUE` (org-wide scope only) |  |  | ● |  |  |  |  |  |  |
| `MISSION_ASSIGN`, `MISSION_RECORD_ON_BEHALF`, `TEAM_MANAGE_ANY`, `TEAM_POSITION_SET_ANY` |  |  | ● |  |  |  |  |  |  |
| `MAP_READ` (heatmap, grouped queue) |  |  | ● |  | ● |  |  |  |  |
| `CAMPAIGN_READ` (also granted independently to managers) |  |  | ● | ● | ● |  |  |  |  |
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
| `HANDOFF_RECORD` (all handoff kinds incl. RETURN) |  |  |  |  |  |  |  | ● |  |
| `LOSS_APPROVE`, `ADJUSTMENT_REVIEW` |  |  |  |  | ● |  | ● |  |  |
| `STOCK_ADJUST_REQUEST` |  |  |  |  |  | ● |  | ● |  |

○ = only when the grant row carries the explicit extra permission `DONATION_REVIEW` (stored as an additional `role_grant` with role `REVIEWER`; there is no implicit review right for managers or intake staff). ADMIN has **no** request/victim/donor detail permission.

Role/scope pairs are enforced by the `role_scope` CHECK in `identity.sql`: ADMIN only `SYSTEM`; CITIZEN/VOLUNTEER `SYSTEM` or `ORGANIZATION`; every staff role `ORGANIZATION`, `REGION` or `CAMPAIGN` (never `SYSTEM`). Self-grant is refused by the service. `GET` endpoints with no row above need only a valid session plus object scope (e.g. own notices, own team).

## 2. Scope matching

A grant is `(role, scope_type, organization, region?, campaign?)`.

1. Alternative grants combine with **OR**; within one grant, action ∧ owning organization ∧ selected scope combine with **AND**.
2. `ORGANIZATION` scope covers all regions/campaigns of that organization; `REGION` covers requests/assets with that `region_code`; `CAMPAIGN` covers objects whose `campaign_id` matches. `SYSTEM` is an explicit, named-action exception, never implied by ADMIN.
3. Region and campaign grants always carry the parent organization — geographic overlap never crosses organizations.
4. `REQUEST_UNASSIGNED_QUEUE` and region correction require `ORGANIZATION` or `SYSTEM` scope; REGION/CAMPAIGN grants cannot read `region_code IS NULL` rows.
5. Region/campaign values in a grant are validated through the owning catalog/API at grant time.

## 3. Object-level rules (checked in addition to permission)

| Object | Rule |
|---|---|
| Assistance request | Reporter (account owner or valid tracking secret) sees own request, REPORTER-visibility timeline, may supplement in permitted states. Staff need `REQUEST_*` + scope. Assigned team leader/members see only the task fields in 03 §"Mission view". Contact phones: reporter, scoped coordinators, assigned team **leader** only. |
| Mission | Read: active team members and scoped coordinators. Accept/decline/advance/result: **active leader only**. Cancel/fail/record-on-behalf: scoped coordinator with reason. |
| Team | Edit own team: active leader. `TEAM_MANAGE_ANY`: scoped coordinator. |
| Evidence | Download requires current authorization on the owning request/mission/donation/handoff; signed URL TTL 60 s. |
| Donation | Account owner or valid donation secret; staff via drive/intake-site scope. Receipt number/name/phone alone grants nothing. |
| Distribution | Approver differs from preparer and dispatcher; preparer may dispatch (DB CHECK + service). Recorder of a handoff ≠ its receiver. LOSS approver ≠ recorder. |
| Receipt | Reviewer ≠ every count author (service rule + test). |
| Notices | Only the recipient. |

## 4. PII inventory (never in logs, maps, heatmap cells, dashboards, AI input, signed-URL names)

`assistance_request.reporter_name/reporter_contact_phone`, `request_subject.*contact*`, `alternate_contact_*`, `location` (exact), `contact_attempt.note`, `donation_delivery.donor_name/donor_phone`, `handoff_record.receiver_label`, `rescue_team.external_contact_note` (commander/unit phone; never in list rows), free-text descriptions. Public endpoints expose none of these.

## 5. Guest and public surface (the only unauthenticated routes)

`POST /identity/auth/register|login|refresh` · `POST /response/requests` (SELF) · `GET /response/requests/track` · `POST /response/requests/{id}/supplements` · `POST /response/requests/{id}/evidence` (guest, secret) · `GET /response/public/campaigns` · `GET /logistics/public/donation-drives[/{id}]` · `POST /logistics/public/donation-drives/{id}/deliveries` · `GET|POST /logistics/public/donations/{id}…` (capability). Everything else requires a session.

Focused logic: COORDINATOR teams need no account/leader; scoped coordinator records sourced progress. APP direct actions retain active-leader guards. Ready cannot bypass the active-cancel latch. RETURN warehouse recorder may use DONATION_INTAKE or DISTRIBUTION_DISPATCH + receiving-site scope, distinct from dispatcher. LOSS_APPROVE is exercised through authenticated independent review, never a supplied actor id. Public request-category catalog contains no victim data; recovery redemption requires a live session plus purpose-bound code.

Round-2 (plan §28): `MISSION_CLAIM_DELIVERY` is an object relationship (active leader of an eligible APP team), not a role grant. Coordinator `record-on-behalf` also covers DECLINE and delivery handoffs through Response; the carrier needs no Logistics grant (Response calls Logistics with the signed actor). System actor `SYSTEM` appears only in automatic events (cascades only) and holds no login.
