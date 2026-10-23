# Web integration audit — 2026-10-21

## Scope and environment

The working tree already contained uncommitted Web, Mobile, and backend changes before this audit. This review used that state without resetting the main PostgreSQL databases. The only Compose file was `backend/infra/compose.yaml`; the primary Identity, Response, Logistics, PostgreSQL, and Nginx services were built and started. Nginx served `127.0.0.1:8081`, and Vite proxied `/api/v1` from `localhost:5173` to it. MinIO AIStor Free was not available and the optional `storage` profile was not started.

The Web client has five workspaces. Mobile has citizen, tracking, donation, auth, notice, and volunteer screens. Neither Mobile's navigator nor Identity's public contract contains a self-service forgot-password route. Identity supports authenticated password change and admin-issued temporary password reset. The Web login now explains that path; it does not promise an unsupported email/SMS recovery flow.

## Implemented in this pass

| Area | Change | Evidence |
|---|---|---|
| Citizen home | Added direct actions for SOS, tracking, and donation drives | Desktop and 390 px Chrome views rendered with no horizontal overflow or page errors |
| SOS receipt | Navigation destination now displays the latest server-confirmed tracking code and status for the current page session; it never repeats the one-time secret | Guest Web submission returned an ACK; receipt showed its code and no secret |
| Account | Added a password-change entry for signed-in users and a login help view for forgotten passwords | Browser registration, login, authenticated password change, logout, and login with the new password passed |
| Location picker | Removed user-facing Google API key entry and localStorage persistence; deployment configuration remains through `VITE_GOOGLE_MAPS_API_KEY` | Web build passed |
| Private tracking | Editing the SOS tracking code/secret or donation ID/secret now clears the old result and its command controls. Successful lookups retain the exact credentials used for subsequent commands; stale lookup responses cannot restore a result after input changes. A confirmed supplement or dispute is reported as accepted even if the follow-up read fails. | Browser regression with intercepted tracking responses passed for both flows; production build passed |

## Checks actually run

- `docker compose --env-file backend/.env -f backend/infra/compose.yaml up -d --build`: primary services started; API containers healthy. This did not reset databases or start storage.
- `npm.cmd run build` in `frontend/web`: TypeScript and Vite production build passed. Vite warned that the main JavaScript chunk exceeds 500 kB.
- `npm.cmd run contracts:check` in `backend`: 33 Identity, 79 Response, and 86 Logistics operations validated.
- `npm.cmd run check:compose-env` in `backend`: passed.
- `npm.cmd test` in `backend`: 108 Jest suites and 529 tests passed, then the Node script suite failed (88 passed, 7 failed of 95). The seven failures concern Windows-specific shell/path/permission assumptions in secret generation, image mode, schema-proof regex, MinIO config permission/symlink, and restore safety tests. The full backend test command is therefore **not green** on this host.
- Chrome/Playwright through the live Vite proxy: guest home, login help, receipt empty state, public campaigns at 1280 px and 390 px; guest SOS submission, server ACK, private tracking timeline, public donation-drive reader, guest declaration and private donation tracking; citizen registration/login/logout, password change and login with the new password; citizen request to `/identity/users` denied with Vietnamese `403 FORBIDDEN`. No page exceptions in the covered paths.
- Nginx ingress: anonymous Identity, Response, and Logistics protected routes returned Vietnamese 401 messages; malformed public campaign query returned Vietnamese 400.
- Follow-up role audit: all seventeen seed accounts logged in with the shared local seed credential; eleven representative accounts (citizen, volunteer leader/member, organization/regional coordinator, campaign manager, operations manager, intake staff, reviewer, distribution staff, admin) returned their expected `/identity/me` grants. For read-only navigation inspection only, the browser test changed `must_change_password` in its intercepted `/identity/me` response; the accounts and backend were not modified. The sidebar showed only the role's workspace plus the shared citizen workspace. Representative cross-role GET checks returned 403 for citizen access to management routes; volunteer mission access, coordinator queue/need access, intake delivery access, and admin user access returned 200 only for the corresponding grants. Admin need read also returned 200 because its `REPORT_READ` grant is explicitly permitted by the Logistics contract, although the Web admin workspace does not expose that view.
- Four role layouts (volunteer, coordinator, operations manager, admin) were inspected at 320, 390, and 768 px. A 2 px horizontal overflow at 320 px in the coordinator view was fixed in the narrow topbar; all twelve combinations now have `scrollWidth === clientWidth`. This checks layout overflow, not keyboard or screen-reader behavior.
- Follow-up on 2026-10-21: live Vite root and proxied Identity CSRF each returned HTTP 200; all five main Compose services were healthy. A focused Chrome regression confirmed that editing either private lookup credential removes the previously displayed SOS/donation result and controls without a page error. This regression used intercepted lookup responses to isolate UI behavior, so it does not add another live backend write-path check. Web production build and `git diff --check` passed; Vite's >500 kB chunk warning remains.

Synthetic test records were added to the primary databases by the browser registration, SOS, and donation-declaration flows. They were not deleted or reset.

## Remaining Web and contract gaps

| Priority | Gap | Dependency / acceptance condition |
|---|---|---|
| High | Full role-based write journeys are not yet demonstrated for coordinator, volunteer leader/member, intake staff, reviewer, distribution staff, operations manager, and admin. Existing Web forms compile, but the current run did not execute every command, conflict, notification, and media path. | Exercise each command with authorized and denied accounts against the primary stack; record state changes and Vietnamese success/error output. Keep the database intact unless an explicit reset is requested. |
| High | Private evidence upload/download and restore are unverified with the selected MinIO AIStor Free deployment. | Obtain and configure the selected artifact/license, private buckets, accessible signed-download origin, then run scoped upload/download and isolated restore checks. Do not substitute the old Community image for the selected product. |
| Medium | Donation declaration revision cannot be safely offered because the owner projection does not expose the delivery version required by its write command. | Add the version to the authorized Logistics projection and OpenAPI contract, regenerate Web types, then add conflict-aware revision UI. |
| High | Volunteer team and mission projections do not identify whether the current member is the leader. In the live seed, `vol_member1` and `vol_leader1` both saw “Bắt đầu di chuyển tới hiện trường” for the same accepted mission, although only the leader can execute it. This is a UI permission overlap; the Response API remains the authorization boundary. | Add the current user's leader/member relationship to authorized Response team and mission projections, regenerate contracts, then hide or disable leader-only actions for members. Recheck both accounts on the same mission. |
| Medium | Handoff history and loss review lack a discoverable list or a durable returned handoff identifier in the Web flow. Region deactivation lacks a version in the list or a detail endpoint. | Extend the respective Logistics and Identity read contracts, then add their Web actions. |
| Medium | SOS incident categories are copied from a versioned demo seed, with no public catalog route. Catalog and stock-adjustment management and CSV export are not complete Web flows. | Add public category/catalog and supported export contracts before exposing these as production functions. |
| Medium | Self-service password reset does not exist in Identity or Mobile. | Decide and implement a verified delivery and recovery policy across Identity and clients if this becomes a requirement. The current supported path is an admin temporary password reset. |
| Medium | Accessibility and performance acceptance is incomplete. | Run keyboard/focus, screen-reader, contrast, tablet-width, slow-network, and representative-volume report/map checks; split the large Web bundle where measured loading justifies it. |
| Optional | AI advisor is not active. | Follow Section 12 evaluation and human-review gates before exposing suggestions; never auto-prioritize or dispatch. |

The backend README and Web README describe additional backend acceptance gates. A successful build and the covered smoke paths do not establish complete system acceptance.

## UI follow-up

- Replaced the generic citizen account record list with an authenticated profile and `/requests/mine` list. The API contract returns requests owned by the active account, not other users. The shared citizen workspace remains available to every signed-in role; management workspaces depend on grants.
- Separated login help and registration controls. Rendered mission/request facts as horizontal label/value rows, including the team name.
- Redesigned Response reports and the operations dashboard with a scoped region selector, muted metric cards, status groups, and Vietnamese P1–P4 labels. Campaign management now uses status filters, selectable summary cards, and structured details. Stock summary and stock inventory use full-width tables with separate on-hand, reserved, and available columns; narrow screens can scroll the table horizontally.
- `npm run build` passed. Browser checks at 1365 px and 390 px covered the account view, coordinator report and campaigns, operations dashboard and stock, region selection, campaign filtering, account-to-tracking navigation, and login footer spacing. These browser checks used intercepted role and feature responses for visual and interaction isolation; each covered page had no horizontal document overflow or page exception. They do not establish live authenticated write-path acceptance.
- Live login attempts with `citizen1` and `coord1` using the current local seed credential were rejected with the Vietnamese invalid-credential message. No password or database reset was performed. The current credential state must be resolved before another live role journey is claimed.
