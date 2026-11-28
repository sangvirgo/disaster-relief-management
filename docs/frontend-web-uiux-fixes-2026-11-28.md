# Web UI/UX follow-up — 2026-11-28

The subsequent frontend review is recorded in `frontend-web-fe-remediation-2026-11-28.md`. It replaces the explicit mission upload button with automatic upload and automatic inline evidence previews, and records broader FE fixes and their actual verification limits.

## Scope and delivery

Local frontend changes only. No backend, contract, database or production deployment changes. No commit or push was performed. The earlier flow audit remains in `frontend-web-flow-audit-2026-11-28.md`; this follow-up does not mark every audit finding as resolved.

The Vite development server runs at http://localhost:5173 with `C48_INGRESS_URL=https://reliva.tansang.dpdns.org`. Its API calls use the production ingress and production records. The initial proxy failures were caused by restricted network access for the server process; restarting the authorized dev process with network access fixed login without changing proxy or backend security settings.

## Implemented changes

- Warehouse handover: compact 560 px dialog, warehouse context, concise goods list, a static accessible pickup-code label, rounded numeric input, field-level error, and disabled editing/back action during submission. Editing the code clears the previous error. The six-digit requirement and backend verification remain intact.
- Volunteer evidence: compact citizen-style file control, one filename, no large arrow tile or duplicate empty-file message. Upload and remove actions appear only after selection. The separate evidence form is hidden while completion/failure forms are open. Existing file type/size validation and explicit upload behavior remain.
- Coordinator terminal actions: close/reopen share a wrapping flex row; duplicate close heading removed; reopen uses an amber secondary background. The action-popup trigger now respects its declared tone. Existing state transitions and confirmation/reason requirements remain.
- Supply request validation: validate every visible item before submitting; an empty, zero, negative, non-finite or incompatible quantity blocks the request instead of silently dropping the line.
- Review queue: explicit “Cần đếm lại” filter for COUNTING receipts, alongside first-count and independent confirmation filters.
- Receipt count form: initialize all applicable item identities with blank quantities instead of only the first drive item. Independent counters still do not receive the first counter's quantities.
- Warehouse queue: remove duplicated page heading, show loading placeholders during filter transitions and clear old rows immediately when the status/warehouse changes.

## Checks actually run

- `npm run typecheck`: passed.
- `npm run build`: passed; existing large map bundle warning remains.
- `node --experimental-strip-types --test tests/supply-requests.test.ts tests/quantity.test.ts tests/pagination.test.ts`: 10 passed, 0 failed.
- Local browser login/logout and production data loading: passed for operations manager, coordinator and volunteer accounts.
- Handover dialog: visually checked against a READY seed request; empty/three-digit code keeps submission disabled, six digits enables it. Returned to the list without handing over the unrelated seed goods.
- Coordinator CLOSED SOS: amber reopen control visually checked. The RESOLVED two-button arrangement is implemented but was not exercised by changing the closed production SOS state.
- Volunteer ACCEPTED seed mission: compact empty-state upload control visually checked. The file-chooser automation was interrupted before a file selection could be verified. No evidence file was uploaded and no mission progress transition was performed in this follow-up.

Evidence: `../test-artifacts/uiux-2026-11-28/local-pickup-dialog.jpg`, `local-mission-upload.jpg`, and `local-sos-actions.jpg` in the same directory.

## Remaining work and limits

- The earlier mission/current-SOS snapshot discrepancy remains unresolved. A frontend-only change must not pretend that historical assignment facts are the latest approved SOS facts. Review an additive authorized current-facts contract before making the minimal backend change if required.
- AI factual consistency and the other audit findings are not claimed fixed by this patch.
- Browser retesting of actual evidence selection/removal/upload, a RESOLVED SOS showing both terminal buttons, independent recount completion and mobile breakpoints remains necessary. No new receipt posting, stock movement or rescue transition was made merely to obtain screenshots.

Next concrete task: review the three UI changes locally, finish the listed interactive checks, then address the remaining audit findings in frontend-first increments. Preserve the running local server and do not push until requested.
