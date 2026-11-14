# Web/backend contract review — 2026-11-05

> **Lưu ý (2026-11-14):** Tài liệu lịch sử này đã lỗi thời sau 2026-11-14: tổ chức (organization) và membership đã bị gỡ khỏi hệ thống; phạm vi hiện tại chỉ còn SYSTEM và CAMPAIGN. Xem [05-permissions](backend/05-permissions.md).


## Scope and method

Reviewed the current Web client on the `mobile` branch after the user's merge against the Response, Identity, and Logistics OpenAPI snapshots, backend controller/DTO implementations, and the Web integration notes. The review focused on the user-facing workflows and authorization/state rules; it did not try to expose every backend operation as a Web screen.

The priority was the SOS lifecycle: intake and tracking, human verification, priority decision, team assignment/progress, and resolution. Donations and Logistics remain supporting workflows under the project scope.

## Fixes made in this review

| Area | Contract/UI mismatch | Web change |
|---|---|---|
| Verification contact | `POST /requests/{id}/contact-attempts` accepts `contact_target`, `outcome`, and optional `note`; the Web had no form to record an attempt during `VERIFYING`. | Added the form with the backend enums, idempotent command submission, current contact history, and older-page loading through the contact-attempt cursor API. |
| Recovery code eligibility | The existing coordinator only exposed recovery when a `REPORTER` attempt was reached, while the recovery UI/backend also accept a reached `ALTERNATE` contact. | Recovery is available for a reached reporter or alternate contact and uses the selected contact-attempt ID required by the API. |
| Async request operation | After reload in `RESOLVING`, the Web did not poll or recover the pending operation. Operation creation events store the identifier as `intent_id`; later adoption/abort events store it as `operation_id`. | The coordinator finds either event shape, polls `GET /operations/{operationId}`, and exposes the backend's adopt/abort commands with the current request version. Both `COMPLETED` and `ABORTED` results refresh the request. |
| Staff event history | The request detail projection returns only the newest 50 events, and the Web omitted event reasons and did not expose the older-event cursor. | Added older-event paging and displays the stored staff reason alongside each event. |
| Request evidence review | The coordinator showed READY metadata but did not offer access to the file, even though the backend provides an authorized, short-lived URL from `GET /evidence/{id}/download`. | Added “get view link” and “open file” actions. The Web does not persist signed URLs outside the current page state; backend authorization is checked when requesting each URL. |
| Documentation | The README described team-leader capabilities as missing although the current Web already consumes `can_manage_mission`. | Updated the capability matrix and next-slice list to match current code and project scope. |

## Current workflow alignment

- **Citizen SOS and tracking:** Web uses the existing public intake/tracking contracts, confirmed coordinates, server acknowledgement, private evidence flows, and account/capability tracking. Categories remain the versioned demo seed because there is no public category-list route.
- **Coordinator:** The Web supports the main human-controlled state transitions and now exposes contact recording, full paged staff history, request evidence links, and recovery for an in-flight resolution/cancellation operation. AI output stays advisory and human review remains required.
- **Volunteer:** Mission/team access is scoped by the API; leader-only commands use the backend-provided `can_manage_mission` flag. The API still enforces permissions.
- **Admin:** User, organization, grant, and audit actions use the existing admin routes.
- **Operations and reports:** Main campaign, intake/review, distribution, handoff creation, and scoped report flows are present. These remain supporting workflows and are intentionally not expanded into exhaustive logistics management in this slice.

## Known contract gaps and limits

- Donation declaration revision is still blocked because the owner projection does not expose the delivery version required by the write contract.
- Web cannot reopen handoffs for loss review from a distribution screen: the current backend does not expose a discoverable handoff collection there, and the creation view does not retain the returned handoff identifier for later use.
- Broad catalog and stock-adjustment screens remain outside the prioritized demo path. CSV export is not exposed because there is no corresponding backend route.
- The Web implementation does not need a separate button for every API operation; unsupported or machine-only operations are not represented as fake actions.

## Checks

- `npm.cmd run contracts:generate` completed; the generated API bindings contain no content diff against the current contracts.
- `npm.cmd run typecheck` passed after the changes.
- `npm.cmd run build` passed after the changes. Vite still reports the existing 1.21 MB `LocationPicker` chunk as above its 500 kB warning threshold.
- `git diff --check` passed. No backend, Mobile, Compose, database, or seed files were changed by this review. No live browser/API scenario was run in this review.
