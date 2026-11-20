# Mobile app review checklist (consistency with Web and backend)

Audience: coworkers reviewing `mobile/` (Expo, React Native).
Initial review: 2026-10-29. A post-merge review was added on 2026-11-15 against the current OpenAPI contracts and the `mobile` branch merge commit. The app was not run on a device or emulator.

Mobile is the citizen and volunteer client. Coordinator, operations, and admin features are Web-only by design; their absence on mobile is not a defect.

## Post-merge review — 2026-11-15

This section supersedes the older route-gap classifications below where they differ. The review compared citizen and volunteer workflows with the current Identity, Response, and Logistics OpenAPI contracts. Mobile remains scoped to citizen and volunteer actions; coordinator, campaign-management, operations, and admin routes are not mobile gaps.

- The main citizen flow is covered: native registration/login/session refresh, SELF and PROXY SOS, tracking and reporter events, report updates/supplements, evidence, claim/recovery, personal requests, campaigns, and notices.
- The volunteer flow is covered: own teams and missions, detail, accept/decline/progress including `FAILED`, evidence, availability/readiness/position/profile, and member add/remove.
- `POST /missions/{id}/fail` is a coordinator `MISSION_ASSIGN` action. Volunteers report failure through `POST /missions/{id}/transition` with `to: FAILED`; the mobile app already uses that contract.
- `POST /teams/{id}/leader` is coordinator-level `TEAM_MANAGE_ANY`; leader transfer is not a team-leader mobile action.
- `POST /requests/{id}/tracking-secret/revoke` requires scoped `REQUEST_VERIFY`; it clears the legacy guest-create retry hash and does not revoke tracking-code access. It is a staff-only maintenance action, not a citizen self-service operation.
- Member removal was already wired in `TeamMembersSection`; the 2026-10-29 note that it was missing is stale.
- Citizen tracking correctly uses `GET /requests/track` and the reporter projection of `GET /requests/{id}/events`. `GET /requests/{id}` is the scoped staff detail and should not replace those calls.
- The public `GET /weather/at` forecast was missing from the SOS forms. Mobile now shows the 24-hour forecast for the selected SELF or PROXY location, uses the backend's 0.1° cell, and keeps SOS submission available when the forecast is unavailable or outside coverage.
- The notices empty state no longer claims forecast warnings appear in the inbox; weather forecasts are read through the weather endpoint, not the notice feed.
- Incident category labels now match the backend seed catalog. Donation intake/tracking remains supported by public Logistics APIs and is optional supporting scope.

TypeScript completed successfully. ESLint completed with no errors and one existing warning for the default `DateTimePicker` import in `ProxySOSScreen.tsx`. No backend files were changed.

## 1. API coverage (backend vs mobile)

The route counts in the 2026-10-29 review are historical and should not be used as current coverage totals. Check only operations reachable by a citizen or volunteer:

| Route | Role | Purpose | Mobile disposition |
|---|---|---|---|
| `POST /missions/{id}/fail` | Coordinator | Record a mission failure on behalf of a team | Staff-only; volunteer failure uses `/missions/{id}/transition` with `to: FAILED` |
| `POST /teams/{id}/leader` | Coordinator | Transfer team leadership | Staff-only; not a mobile team-leader action |
| `POST /teams/{id}/members/{user_id}/remove` | Volunteer leader | Remove a member | Implemented in `TeamMembersSection` |
| `POST /requests/{id}/tracking-secret/revoke` | Coordinator | Clear a legacy guest-create retry hash | Staff-only; tracking code remains valid |
| `POST /requests/{id}/supplements/{eventId}/review` | Staff | Review a supplement (Web-only; confirm no mobile need) | Low |
| `POST /missions/{id}/cancel` | Staff | Web-only; confirm | Low |
| `GET /requests/{id}` and `GET /requests/{id}/events` | Staff / reporter capability | Staff detail versus reporter event projection | Mobile correctly uses `/requests/track` and the reporter projection of `/requests/{id}/events` |
| `GET /weather/at` | Citizen | Forecast at the selected SOS location | Implemented in SELF and PROXY forms |

Already wired and worth a quick regression pass: register, login, logout, Google sign-in and link, email resend and verify, change password, `/me`, create SOS, proxy SOS, track, claim, recover, supplements, report updates, evidence upload/download, selected-location weather, notices and read, public campaigns, skills, teams (list, detail, position, members, member candidates, add/remove), missions (mine, detail, accept, decline, transition including volunteer `FAILED`, evidence), donation drives, deliveries, declarations, disputes, claim, recover, evidence, donation summary.

## 2. Contract and data-shape checks

1. Request status labels in `src/constants/labels.ts` match the backend enum (`SUBMITTED, VERIFYING, VERIFIED, REJECTED, DUPLICATE, TRIAGED, DISPATCHED, IN_PROGRESS, RESOLVING, RESOLVED, CLOSED, CANCELLED`). Confirm the TypeScript `RequestStatus` in `src/types/api.ts` is generated from or checked against the OpenAPI. Types are hand-written (440 lines); they can drift from `contracts/openapi`.
2. Mission statuses in the mobile labels match the schema (`OFFERED, ACCEPTED, EN_ROUTE, ON_SCENE, COMPLETED, FAILED, DECLINED, CANCELLED`). Good; keep this in sync.
3. Idempotency key and `expected_version` on every write, with a fresh key after conflict. Search `responseApi.ts`, `logisticsApi.ts`, `identityApi.ts` for writes without them.
4. Branching on error codes, not on Vietnamese text. Search for message string comparisons.
5. Token refresh (`client.ts:215`) must not loop on 401 and must clear the session on refresh failure.
6. Production base URL must be HTTPS (`client.ts:39`); confirm the dev default for emulators and physical devices.
7. Offline and retry behavior for SOS submission: the draft restore code in `CreateSOSScreen` (`restoringPending`) should be tested with airplane mode.

## 3. Consistency with Web (the main purpose of this file)

Same product, same backend, same words. Compare each row side by side.

### 3.1 Already aligned

- Color tokens: mobile `src/constants/theme.ts` and web `src/style.css` use the same palette (emergency red `#DC2626`, warning `#F59E0B`, success `#10B981`, primary `#2563EB`, slate surfaces and text). Keep them in sync.
- Product name: both use "Reliva".
- Core validation rules: email, username 3-64, password length at least 10, SĐT 8-15 digits.

### 3.2 Differences to resolve (pick one wording or rule and apply to both)

| Topic | Web | Mobile | Action |
|---|---|---|---|
| Request status copy | Short: "Đã tiếp nhận", "Đang xác minh", "Đã xử lý" (`frontend/web/src/i18n/labels.ts`) | Long: "Đã gửi - Chờ tiếp nhận", "Cứu hộ hoàn tất thành công" (`mobile/src/constants/labels.ts`) | Decide a single glossary; the same status must read the same on both clients |
| Enum values present in one client only | Web has `ASSIGNED`, which the backend does not define | Mobile matches the backend list | Remove or explain `ASSIGNED` on Web |
| Incident category names | FLOOD "Ngập lụt", LANDSLIDE "Sạt lở đất" | Now uses the backend seed labels | Aligned in the 2026-11-15 review |
| Priority labels | "Mức P1".."Mức P4" | "P1 - Khẩn cấp" with a long description | Align short badge text at least |
| Username rule | Not lowercased at registration | Lowercased with `toLowerCase()` at registration | Make both follow the backend rule, then test login on the opposite client |
| Password rules on the client | Length only | Length, not equal to username, not common | Same checks on both, or rely on the backend with a clear message |
| Validation presentation | SOS form shows one banner error | Per-field errors with `FormFieldError` | Use the per-field style everywhere |
| Confirmation | `window.confirm` | `Alert.alert` (about 115 uses) | Both are native dialogs; decide whether to use in-app modals for the important ones |
| Time zone text | Check | "Ngày giờ hiển thị theo múi giờ trên điện thoại" | Same date-time format and time zone note on both |

### 3.3 Things to compare visually (screenshots side by side)

1. SOS creation: field order, helper text, required marks, error placement, submit button wording.
2. Tracking: timeline step names and icons for the same events (`TIMELINE_EVENT_LABELS` vs Web labels).
3. Status badges and priority chips: color, shape, text.
4. Campaign and donation drive lists: card layout, empty state, loading state.
5. Mission lifecycle buttons for volunteers: same verbs and same order (accept, start moving, arrive, complete, report failure).
6. Notices: wording and read/unread style.
7. Login, register, verify email, change password: same fields and same messages.
8. Typography and spacing scale; Web uses CSS variables, mobile uses `THEME.fontSizes`.
9. Empty, loading, and error states: all text in Vietnamese on both.

## 4. Validation checks

- Strong already: per-field errors on register, login, change password, create SOS, proxy SOS, donation, tracking, mission outcome, and decline reason. Shared helpers live in `src/utils/formValidation.ts` (email, phone, UUID, tracking code of 10 characters, one-time support code of 43 characters, common passwords).
- No unit tests exist for `formValidation.ts` and the repository has no `test` script. Recommend tests for the helpers.
- Verify Vietnamese copy for each error path, and that server field errors from the backend (`fieldErrors`) are mapped to the same inputs.

## 5. Build, tooling, and quality items

1. Current check: `npx tsc --noEmit` succeeds; `expo-router` and `expo-clipboard` are installed.
2. The previous implicit-`any` observation in `ProxySOSScreen.tsx` is stale; strict TypeScript checking now succeeds.
3. Direct ESLint completes with no errors and one existing `DateTimePicker` import warning. The `npx expo lint` wrapper printed the same result but did not exit in this environment.
4. Accessibility: only 14 `accessibilityLabel` and 23 `accessibilityRole` across 19 files that use pressables. Check icon-only buttons, choice cards, and the SOS button for labels, roles, and touch target size.
5. Oversized screens: `DonationScreen` 2478 lines, `SOSTrackingScreen` 1538, `TeamDashboardScreen` 1494, `ProxySOSScreen` 1385, `MissionDetailScreen` 1318, `CreateSOSScreen` 1096, `EmergencyHomeScreen` 1048, `LocationPickerModal` 1037. Hard to review; propose splits.

## 6. Screens to hand to a designer

Give these a visual review. Flag anything that looks cluttered, inconsistent with Web, or hard to read in sunlight or under stress:

- `EmergencyHomeScreen`, `CreateSOSScreen`, `ProxySOSScreen` (long forms; consider steps and grouping)
- `SOSTrackingScreen` (very long screen; check timeline legibility)
- `DonationScreen` (largest file; check flow clarity)
- `TeamDashboardScreen`, `MissionDetailScreen` (volunteer decision screens; actions must be unambiguous)
- `LocationPickerModal` (map plus manual coordinate entry)

Suggested handoff format: screenshot of Web and mobile for the same flow, a short note on what feels off, and a proposed direction. Do not change colors or labels on one client alone; update the shared glossary first.

## 7. How to record findings

One row per finding: screen or route, observed behavior, expected behavior (cite the OpenAPI path, a Web screen, or a doc section), severity, and suggested owner. Reference UR/FR/NFR/UC/TC identifiers where they apply. User-facing text stays Vietnamese; technical identifiers stay English.

## 8. Defects found so far (fix list for coworkers)

Confirmed by reading code (not by running the app):

| # | Type | Where | Problem | Severity |
|---|---|---|---|---|
| M1 | Build (historical) | `package.json` / `node_modules` | Dependencies are installed and current TypeScript check passes | Resolved |
| M2 | Type (historical) | `ProxySOSScreen.tsx` | Previous implicit-`any` observation; strict TypeScript check passes | Resolved |
| M3 | Tooling (historical) | `eslint.config.js` | Direct ESLint passes with one existing import warning; Expo wrapper did not exit | No lint errors |
| M4 | Testing | repo | No `test` script; no unit tests for `formValidation.ts` | Medium |
| M5 | Accessibility | whole app | Only 14 `accessibilityLabel` and 23 `accessibilityRole` for 19 files with pressables | Medium |
| M6 | Maintainability | `DonationScreen` (2478 lines) and 7 other screens above 1000 lines | Hard to review and change | Medium |
| M7 | Consistency | `labels.ts` vs Web `labels.ts` | Status and priority wording still differs; category names now match the backend seed | Medium |
| M8 | Consistency | `RegisterScreen.tsx` | Username lowercased on mobile only | Medium |
| M9 | Consistency | validation | Password rules differ between Web and mobile | Low |
| M10 | Feature gap (historical) | section 1 | Member removal is wired; leader transfer and legacy guest-create retry hash cleanup are staff-only; volunteers report failure through the transition operation. See the 2026-11-15 review above. | Resolved as mobile gaps |
| M11 | UI | `Alert.alert` (about 115 uses) | Heavy use of system popups instead of inline messages | Low |
| M12 | Types | `src/types/api.ts` | Hand-written types (440 lines) can drift from OpenAPI | Medium |

## 9. Extra things to check by hand (not verified yet)

- Small phones (width 320-360) and large font sizes: clipped text or buttons.
- Keyboard covering inputs, and scrolling to the first error on submit.
- Android hardware back and iOS swipe back inside forms and modals.
- Safe areas (notch, home indicator) on every screen and modal.
- Offline, slow network, and airplane mode: SOS draft restore, retry, and clear messages.
- Token expiry while on a screen: refresh once, then return to login without losing a draft.
- Location permission denied or GPS off: fallback to manual coordinates works.
- Image picker and camera permission denied; large image upload.
- Dark mode: the theme defines only light colors, so check what happens on a dark-mode device.
- Loading skeletons or spinners, pull to refresh, and empty states on every list.
- Touch target size (at least 44 px) for icon buttons and the SOS button.
- Any English text, raw error code, or technical message shown to the user.
- Double tap on submit or accept mission: duplicate requests prevented?

## 10. Backend alignment follow-up (2026-11-20)

Compared the mobile reporter and volunteer workflows with the current backend response contracts and source. The follow-up changes are limited to `mobile/`; no backend source or contract was changed.

- Self SOS and proxy SOS now send the optional `relief_items_text` field only when relief supplies are requested, with the backend's 500-character limit.
- Self SOS keeps an `X-Tracking-Secret` only for guest create retries. Tracking, event history, supplements, evidence uploads, and evidence downloads use the tracking code capability in `X-Tracking-Code`; legacy locally saved tracking secrets are removed after a successful lookup or account binding.
- The tracking form now supports the reporter fields exposed by the contracts, including household reference, affected-person count, manual map location, and danger declaration. `SUBMITTED` and `VERIFYING` use the unverified report update route; later eligible states submit immutable reporter facts for review through the supplement route.
- Reporter evidence upload responses are typed and the device stores only the returned evidence references, never the signed download URL. Opening an image or MP4 requests a fresh 60-second URL. Since there is no reporter-facing endpoint to list previously uploaded evidence, references can be reopened on the device that uploaded them; another device cannot discover those files through the current API.
- The client counts locally known uploaded and selected evidence against the five-file per-request limit. The backend remains authoritative when files were added from another device.
- Checks run for this follow-up: `npx tsc --noEmit` passed; `npx eslint .` passed with no errors and the existing `DateTimePicker` import warning in `ProxySOSScreen.tsx`; `git diff --check` passed. No mobile app runtime or API smoke was run.
