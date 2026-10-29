# Web frontend review checklist (API completeness)

Audience: coworkers reviewing `frontend/web`. Read-only review; no code changes are implied.
Date of review: 2026-10-29. Method: static comparison of `contracts/openapi/*.json` against paths used in `frontend/web/src` (non-generated files), then grep by endpoint leaf name to remove false positives from dynamically built paths. The app was not run and no browser testing was done, so every item below must be confirmed by a human before it is treated as a defect.

Scope note from `AGENTS.md`: the SOS -> verification/priority -> assignment/progress -> resolution workflow is the priority. Donations and Logistics are optional, short-demo capabilities; do not expand their depth. Items are tagged accordingly.

## 1. API coverage (backend vs web)

Operations excluding `/internal/*`: Identity 38 total, Response 84, Logistics 86. Routes below have no caller in the web source (leaf-name grep returned nothing).

How to verify an item: open `contracts/openapi/<service>.json`, find the path, then search `frontend/web/src` for the leaf name. Check the matching role in `frontend/web/src/app/catalog.ts` (menu) and the feature file.

### 1.1 Response (core workflow, check first)

| Route | Purpose | Likely owner screen | Priority |
|---|---|---|---|
| `GET/POST /requests/{id}/contact-attempts` | Log and read contact attempts with the reporter | Coordinator request detail | High |
| `GET /requests/{id}/verification-candidates` | Candidates for independent verification | Coordinator detail (verify step) | High |
| `POST /requests/{id}/authority-referrals` | Refer request to an authority | Coordinator detail | High |
| `POST /requests/{id}/correct-region` | Correct the request region | Coordinator detail | Medium |
| `GET /requests/unassigned` | Queue of requests with no team | Coordinator queue | High |
| `GET /missions/overdue-offers` | Offers not answered in time | Coordinator queue | Medium |
| `POST /missions/{id}/fail` | Mark a mission failed | Volunteer mission detail | High |
| `POST /missions/{id}/review-failure` | Coordinator review of a failed mission | Coordinator | High |
| `POST /operations/{operationId}/abort`, `/adopt` | Resolve a stuck async operation | Coordinator | Medium |
| `POST /requests/{requestId}/resolve/abort` | Abort a resolution in progress | Operations or coordinator | Medium |
| `GET /skills` | Skill catalog for team forms | Team forms | Medium |
| `POST /teams/{id}/leader` | Change team leader | Volunteer or coordinator team page | High |
| `GET/POST /teams/{id}/members`, `POST .../members/{user_id}/remove`, `GET /teams/{id}/member-candidates` | Team membership | Same | High |
| `POST /requests/{id}/ai-advisories/{advisoryId}/retry` | Retry an AI advisory | Coordinator (AI is optional) | Low |
| `POST /requests/{id}/tracking-secret/revoke` | Revoke the one-time tracking secret | Citizen tracking | Medium |

### 1.2 Identity

| Route | Purpose | Priority |
|---|---|---|
| `POST /organizations/{id}/members` and `.../members/{userId}/remove` | Add or remove organization members | Medium |
| `POST /auth/google/link` | Link a Google account | Low |
| `POST /regions/{code}/deactivate` | Needs a `version`, which the region list does not expose | Medium (known contract gap) |

### 1.3 Logistics (optional capability; keep the demo short)

| Route | Priority |
|---|---|
| `GET/POST /item-types`, `GET/POST /units` (catalog) | Low |
| `POST /stock/opening`, `GET/POST /stock/adjustments`, `GET /stock/{balanceId}/movements` | Low |
| `PUT /distributions/{id}/lines`, `POST /distributions/{id}/handoffs/{handoffId}/review-loss`, `POST /commitments/{id}/release` | Low |
| `POST /donation-receipts/{id}/release-held`, `POST /donation-deliveries/{id}/assisted-declaration`, `POST /donation-deliveries/{id}/capability/revoke` | Low |
| `GET /needs/{id}/contributions`, `GET /public/donation-reports/summary` | Low |

Do not treat the rest of this list as defects without checking: many other routes are built with template strings (for example `/${asset}/${id}/deactivate`, campaign actions in `Campaigns.tsx`), so a plain path grep reports them as missing even though they are wired.

### 1.4 Known gaps already recorded

From `docs/frontend-web-audit-2026-10-21.md`, still open unless a newer commit fixed them:
- Volunteer members see leader-only actions (for example "start moving to scene") because the Response projection does not say whether the current user is the leader. Needs a backend field first, then UI hiding.
- Donation declaration revision cannot be offered: the owner projection lacks the delivery `version`.
- Handoff history and loss review have no list or returned identifier in the web flow.

## 2. Contract and data-shape checks

1. Enum drift: `frontend/web/src/i18n/labels.ts` has a request status `ASSIGNED`, but the Response schema (`docs/backend/schema/response-initial.sql`, `request_status`) has no such value. The real values are `SUBMITTED, VERIFYING, VERIFIED, REJECTED, DUPLICATE, TRIAGED, DISPATCHED, IN_PROGRESS, RESOLVING, RESOLVED, CLOSED, CANCELLED`. Check whether `ASSIGNED` is used for a different enum or is dead code, and make sure every backend enum value has a Vietnamese label.
2. Generated types in `src/api/generated/*.ts` must match the current OpenAPI. Run `npm run contracts:generate` in `frontend/web` and review the diff.
3. Every command should send `expected_version` and an idempotency key, and clear the key on `VERSION_CONFLICT` or `STATE_TRANSITION_INVALID`. `CommandForm` does this; check hand-written calls in `Volunteer.tsx`, `Coordinator.tsx`, and `Operations.tsx` that bypass it.
4. Clients must branch on error codes, never on Vietnamese message strings. Search for `.message ===` or `includes('` comparisons.
5. `CommandForm` applies `min = 1` to every `number` field unless `min` is set. Verify each number field that can legitimately be 0 (counts, opening stock, adjustments).

## 3. Validation checks

- Well covered: login/register (email, username 3-64, password at least 10, OTP of 6 digits), `CommandForm` (required, length, number, integer, per-field server errors), SOS form rules.
- SOS form (`features/citizen/SosForm.tsx:103-141`) throws one banner error instead of marking the failing field. Compare with the per-field errors in login and `CommandForm`.
- `SosForm.tsx:107`: the phone length check runs on the raw string, the format check on the normalized string.
- Web does not block common passwords or a password equal to the username on the client; mobile does. The backend still rejects them, but the message path should be checked (`main.tsx:219`).
- Forms with many inputs and no visible `required` or per-field handling: `Donations.tsx` (10 inputs), `Operations.tsx`, `Admin.tsx`. Confirm each has client validation that matches the OpenAPI constraints (`minLength`, `maxLength`, `pattern`, `minimum`).
- Seven places use `window.confirm` (`AsyncRequestForm`, `Volunteer` x2, `Donations`, `TrackingActions`, `CommandForm`, `RecoveryIssue`). See the UI list in section 4.

## 4. UI and maintainability items to review

Mark each as OK, needs polish, or recommend redesign.

| Area | What to look at | Why |
|---|---|---|
| Confirmation dialogs | The 7 `window.confirm` calls | Native browser dialogs look off-brand and are inconsistent with the rest of the UI |
| Initial load | Main JS chunk is about 1.6 MB; no `lazy`/`Suspense` | Slow first paint; split map libraries and role workspaces |
| Large files | `main.tsx` 1595 lines, `Coordinator.tsx` 1522, `Operations.tsx` 1264, `Volunteer.tsx` 1126, `Donations.tsx` 698 | Hard to review and change safely |
| CSS layering | `style.css`, `refinements.css`, `workflow.css`, `sos.css` | Rules overriding rules; check for duplicated or conflicting selectors |
| Empty, loading, error states | Every list and detail screen | Must exist and be in Vietnamese |
| Narrow screens | 320, 390, 768 px for the four management workspaces | Previously fixed overflow at 320 px; recheck after later commits |
| Tables | Stock tables and reports on narrow widths | Horizontal scroll only, no clipped headers |
| Accessibility | Keyboard focus order, focus ring, contrast, screen reader labels | Never verified; the 2026-10-21 audit explicitly excluded it |
| Map screens | SOS map, heatmap panel, location picker | Check loading failure and missing Google key behavior |
| Visual quality | Coordinator queue/detail, operations dashboard, admin | Flag anything dense, cramped, or confusing for design follow-up |

## 5. How to record findings

Create one row per finding: file or route, observed behavior, expected behavior (cite the OpenAPI path or doc section), severity (High/Medium/Low), and a suggested owner. Use stable identifiers (UR/FR/NFR/UC/TC) from `docs/c48-project-context.md` when a finding maps to a requirement. Keep all user-facing text Vietnamese and technical identifiers English.
