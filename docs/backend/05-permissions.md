# 05 — Roles, permissions and scope rules

Roles are a code catalog (`role_grant.role_code` CHECK in [identity.sql](schema/identity.sql)); the role-to-permission map is shared by the three services through `@c48/identity-contracts`. `identity.sql` is the historical Initial-migration baseline; `CAMPAIGN_COORDINATOR` is added by a later migration. Identity introspection returns the user's live grants; each service evaluates `permission ∧ scope ∧ object relationship`. Hidden UI is never a control.

## 1. Role-to-permission map

● = granted. Team leader/member is an explicit `team_member` relationship in Response. Citizen rights are based on ownership or a valid capability, not staff permissions.

| Permission | CITIZEN | VOLUNTEER | COORDINATOR | CAMPAIGN_COORDINATOR | CAMPAIGN_MANAGER | OPERATIONS_MANAGER | INTAKE_STAFF | REVIEWER | DISTRIBUTION_STAFF | ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `USER_MANAGE`, `GRANT_MANAGE` |  |  |  |  |  |  |  |  |  | ● |
| `AUDIT_READ` (Identity and Logistics audit) |  |  |  |  |  |  |  |  |  | ● |
| `REQUEST_CREATE_PROXY` (needs live session) | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `REQUEST_QUEUE_READ`, `REQUEST_DETAIL_READ`, `MISSION_OVERDUE_READ` |  |  | ● | ● |  |  |  |  |  |  |
| `TEAM_READ`, `TEAM_MANAGE_ANY` (team setup and skills only; ADMIN has system-wide team scope) |  |  | ● | ● |  |  |  |  |  | ● |
| `REQUEST_VERIFY`, `REQUEST_TRIAGE`, `REQUEST_CANCEL`, `REQUEST_REOPEN`, `REQUEST_RESOLVE` |  |  | ● | ● |  |  |  |  |  |  |
| `MISSION_ASSIGN`, `MISSION_RECORD_ON_BEHALF`, `TEAM_POSITION_SET_ANY` |  |  | ● | ● |  |  |  |  |  |  |
| `MAP_READ` (heatmap, grouped queue) |  |  | ● | ● |  | ● |  |  |  |  |
| `CAMPAIGN_READ` |  |  | ● | ● | ● | ● |  |  |  |  |
| `CAMPAIGN_MANAGE` (Response mutation additionally requires COORDINATOR + SYSTEM) |  |  | ● |  | ● | ● |  |  |  |  |
| `RESPONSE_REPORT_READ` (Response aggregates) |  |  | ● | ● | ● | ● |  |  |  | ● |
| `REPORT_READ` (Logistics aggregates) |  |  | ● |  | ● | ● |  |  |  | ● |
| `CATALOG_MANAGE`, `ASSET_MANAGE` (items, warehouses, vehicles, points) |  |  |  |  |  | ● |  |  |  |  |
| `DONATION_DRIVE_MANAGE` |  |  |  |  | ● | ● |  |  |  |  |
| `DONATION_INTAKE` (count) |  |  |  |  |  |  | ● |  |  |  |
| `DONATION_REVIEW` (approve/post) |  |  |  |  |  | ○ | ○ | ● |  |  |
| `NEED_MANAGE` (define/reduce/cancel need) |  |  | ● |  |  | ● |  |  |  |  |
| `COMMITMENT_MANAGE` |  |  |  |  |  | ● |  |  |  |  |
| `DISTRIBUTION_PREPARE` |  |  |  |  |  | ● | ● |  | ● |  |
| `DISTRIBUTION_REVIEW` (approve) |  |  |  |  |  | ● |  | ● |  |  |
| `DISTRIBUTION_DISPATCH` (issue stock) |  |  |  |  |  |  | ● |  | ● |  |
| `HANDOFF_RECORD` (direct delivery, point receipt, household handout, return and loss recording) |  |  |  |  |  |  |  |  | ● |  |
| `LOSS_APPROVE`, `ADJUSTMENT_REVIEW` |  |  |  |  |  | ● |  | ● |  |  |
| `STOCK_ADJUST_REQUEST` |  |  |  |  |  |  | ● |  | ● |  |

○ = only when a separate `REVIEWER` grant is present; there is no implicit review right for managers or intake staff. `CAMPAIGN_COORDINATOR` has no Logistics permission. ADMIN has no request, victim or donor detail permission. The ADMIN team-management extension does not grant mission assignment, request detail, or team-position reporting. Self-grant is refused by Identity. `GET` endpoints with no row above need a valid session and object scope (e.g. own notices, own team).

## 2. Scope matching

A grant is `(role_code, scope_type, campaign_id?)`. The only Identity `scope_type` values are `SYSTEM` and `CAMPAIGN`. `CAMPAIGN_COORDINATOR` grants are restricted to `SYSTEM`; their Response request access is narrowed by active campaign engagements instead.

A soft request claim (`handled_by`, 15-minute inactivity window) does not change scope. A primary coordinator (`COORDINATOR` + `SYSTEM`) can access every SOS and take over an active claim. A campaign coordinator can access SOS only for campaigns with their own active engagement; their takeover attempt returns `409 REQUEST_ALREADY_CLAIMED`.

1. Alternative grants combine with **OR**. Each grant must independently match the action and object scope.
2. `SYSTEM` is an explicit grant that covers all eligible objects, including SOS requests without a campaign. It is not implied by ADMIN.
3. For non-coordinator roles, `CAMPAIGN` covers only objects whose `campaign_id` matches the grant. It never covers an unassigned SOS.
4. A `CAMPAIGN_COORDINATOR` grant must be `SYSTEM` and grants no SOS access by itself. The shared `requestScopeFilter` checks for an engagement with `ended_at IS NULL` and `last_active_at > now() - 60 minutes`; without one, list and aggregate queries return no SOS and item operations return `403 FORBIDDEN`.
5. A campaign coordinator can engage at most three ACTIVE campaigns concurrently. Successful coordination commands refresh `last_active_at`; read requests do not. Expired sessions remain in the history.
6. Campaign identifiers are validated by the owning API. They are opaque references without cross-service foreign keys.
7. Logistics assets without campaign attribution are shared catalog resources and require a SYSTEM grant. Campaign-attributed drives, fulfillment cycles and distributions may be accessed through the matching campaign grant or SYSTEM.

Only a primary system coordinator sees the shared intake queue. `unassigned=true` includes `UNMATCHED` and `CONFLICT` SOS, both of which have `campaign_id IS NULL`. Campaign coordinators never see either state. When a primary coordinator attaches or removes a campaign manually, the request match state becomes `MANUAL` and an attaching claim is released.

## 3. Object-level rules

| Object | Rule |
|---|---|
| Assistance request | Reporter (account owner or valid tracking secret) sees their own request, reporter-visible timeline and permitted supplements. Staff need the relevant `REQUEST_*` permission and matching scope. An unassigned request is visible only through SYSTEM scope. Assigned team members see only permitted mission fields; contact phones are limited to the reporter, scoped coordinators and assigned team leader. |
| Mission | Read: active team members and appropriately scoped coordinators. Accept, decline, advance and report result: active leader only. Cancel, fail and record-on-behalf: authorized coordinator with a reason. |
| Team | Team resources are shared system-wide. Active leaders may edit their team; `TEAM_MANAGE_ANY` permits authorized coordinators and system ADMIN to manage team setup and skills. Membership and active-leader checks remain separate from campaign access. Mission suggestions use skills, distance, fresh position (at most 30 minutes), radius and availability; they never filter by campaign or assign a team. |
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
