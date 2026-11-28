# Le Thuy frontend remediation and verification — 2026-11-28

## Scope and delivery

Local frontend changes following `frontend-web-lethuy-audit-2026-11-28.md` and the user's screenshots. Keep the citizen SOS map at its existing size. Do not add a special input rule for manually typing `19.000`; normalize API decimal padding centrally while preserving meaningful decimal digits. No dependencies added, commit, push, deployment, reset or direct production database writes.

The running localhost:5173 frontend proxies the deployed backend through the previously restarted Vite process. Browser writes below therefore created synthetic records on production; they are not local-only fixtures. No passwords, tracking capabilities, pickup codes or signed URLs are included here.

## Changes

- Dashboard supply cards use three equal columns, with arrows inside every card and visible keyboard focus. The handed-over card now opens the handed-over queue. Queue status survives F5 and browser navigation; a status change resets pagination.
- API decimal strings populate numeric forms as `19`, `15`, `15.5`, preserving precision without converting through `Number`. Supply suggestion inputs, drive edits and shared command forms use this normalization; quantity displays retain Vietnamese grouping and meaningful decimal fractions.
- Water/noodle package labels read `chai`/`gói` across donation, stock, supply, estimates, catalog and report surfaces. The rollout adapter covers only three known legacy piece-counted seed item IDs; explicit cartons, litres and kilograms are unchanged. Quantities are not converted.
- Mission completion/failure/decline text is stored in sessionStorage per actor, mission and lifecycle status. Drafts expire after 30 minutes without refresh, clear after successful command, explicit confirmed discard or logout, and are not offered to members without management rights. Restoring a draft never submits it. Refresh keeps in-progress notes, command errors retain text, and unavailable storage enables the leave warning. Media and credentials are not stored in these drafts.
- Coordinator opens on **Xử lý SOS**, with a visible next-step bar for verification, priority and dispatch. Campaign-routing cards include receipt time. Human verification, priority and dispatch decisions remain explicit.
- Drive forms place goods before the location editor and fold optional instructions/dates. Existing draft edit links now sit inside the detail dialog, where users can reach them. The edit URL is consumed without losing the editor during React StrictMode's effect replay, preventing stale edit errors after navigation/F5.
- Intake/review lists use domain headings and a concise donor/drive/warehouse/state summary. Existing independent-count and ownership checks are preserved.
- Fixed-warehouse stock reports omit the redundant warehouse column and prioritize available, reserved and on-hand quantities. Zero availability uses neutral styling. Reconciliation explains that accepted donations exclude opening stock/adjustments; accounting totals are unchanged.
- Screenshot follow-up: drive action buttons no longer retain the 24px offset intended for static captions after captions become floating labels. Both reason inputs align with their action buttons, including validation feedback.
- Second screenshot follow-up: citizen tracking omits the first-verification description disclosure. Current-description update markers start separate paragraphs with a bold **Cập nhật:** label; the reported text and backend history remain unchanged. Reopened the original nine-person Le Thuy SOS on localhost:5173 and visually verified the single description plus distinct bold update paragraph.

## Narrow backend changes prepared, not applied to production

1. Campaign common-queue suggestions sort newest first with matching descending keyset pagination and a new cursor-order fingerprint. Coverage and distance ordering of campaign options is unchanged. FE does not fake a global sort by sorting one fetched page or fetching an unbounded list.
2. Logistics migration `UsePackagedItemUnits1796601600000` adds scale-zero CHAI/GOI units and updates only the three known water/noodle seed items still using CAI. It increments item versions and rejects incompatible pre-existing unit scales. Stock, movements and amounts are untouched. Seed data matches the new units; rollback retains potentially reused catalog units.

The unit migration has **not** been executed against a database. The new common-queue order has **not** been verified against the production API because that backend has not been released. The main SOS processing list already displayed the fresh browser-created request first during this run; this does not prove the separate common-queue endpoint changed on production.

## Browser checks on localhost:5173

| Check | Observed result |
|---|---|
| Dashboard arrows and focus | All three arrows inside card boundaries; focused card visibly outlined. |
| Handed-over shortcut and reload | Correct tab selected; records showed 13 gói, 17 chai, 19 gói and 25 chai without decimal padding. Reload retained the selected tab. |
| Stock report, Le Thuy warehouse | Three compact number columns visible together; water/noodle units correct, zero quantities neutral. |
| Drive detail | Water target 19 chai, received 17 chai; noodle target/received 13 gói. |
| Draft drive editor from list | Existing medical draft opened directly with numeric inputs 40 and 50, goods before map, optional sections folded. Closed without saving. F5 returned to map without reopening the old editor or retaining edit_drive. |
| Coordinator sequence | Default SOS tab, verification step, priority step, dispatch step and matching team with fresh position all usable. No auto-dispatch. |
| Mission note recovery | Typed full completion note, F5: identical text and restored-draft notice. Refresh and list/reopen also retained it. |
| Discard and command success | Confirmed discard then F5: no restored note. Re-entered note and completed mission; F5 then history showed the saved outcome, without a stale draft. |
| Latest alignment screenshot | In the Le Thuy noodle/blanket dialog, both input/button pairs measured identical top edges (difference 0px), input and button height 44px. Still aligned with a required-field error and with valid entered text. No pause/close command was submitted; temporary text cleared. |

For the mission regression, created one additional natural-language flood SOS (two people at the already used Le Thuy point). Refreshed the existing team's manual map position, verified/triaged/dispatched through coordinator UI, then accepted, travelled, arrived and completed through the leader UI. Mission `863a4352-f66c-4fc4-afc3-16b534ff225c` completed; request `cdb67b84-a868-44fb-8b49-f539ec6b4e44` resolved and closed through guarded coordinator commands. No supplies, donations or evidence files were created for this regression. Records/audit history remain intact. These are synthetic test actions, not evidence of an actual rescue.

Some older sample logins rejected the supplied password. Used accessible seeded accounts and the existing Le Thuy leader account instead; no password changes or new access grants were needed. Browser review used the desktop panel's default viewport; this is not a full responsive, accessibility, security or outage test suite. No new screenshot files were exported; visual evidence was inspected live.

## Automated verification

- Frontend tests: **76 passed, 0 failed**, including decimal/package-label tests and mission-draft lifecycle/isolation/expiry tests.
- Frontend production build: TypeScript and Vite passed; existing large MapLibre bundle warning remains.
- Targeted response tests: **3 suites, 17 tests passed** (`campaign-coordination.service`, `campaign-area`, `request-queue-order`). The new common-queue test checks SQL order, cursor direction and page handling using mocks, not a live PostgreSQL integration.
- Response and Logistics application builds passed.
- ESLint passed for the changed backend service, service test, data source and new migration.
- `git diff --check` passed (line-ending normalization warnings only).

No full backend suite, live migration/integration run, or load test was run. Existing unrelated workspace edits and files were preserved. Next release work is to run the reviewed migration through the normal deployment process and verify the new common-queue pagination against the released backend; do not claim these two backend changes are deployed based on localhost frontend testing.

## Pre-push verification follow-up

At the owner's subsequent request to push main and rebuild the local stack, reran the full backend Jest suite: **170 suites passed, 1 skipped; 1,121 tests passed, 8 skipped**. Frontend tests again passed **76/76**. Both complete builds passed; backend lint had 0 errors and 14 existing unused-symbol warnings. OpenAPI checks and the main Compose environment check passed. The subsequent `node:test` deployment/script suite failed on this Windows host, including malformed `D:\\D:\\...` paths, Bash/Unix filesystem assumptions and symlink permissions; it is not reported as passing. No unrelated script/test changes were made to hide these failures. The earlier no-full-backend-suite statement describes the initial UI remediation phase, before this follow-up.
