# Frontend remediation follow-up — 2026-11-28

## Boundary

This follows the live flow audit and the first UI patch. All application changes are under `frontend/web/`. No backend source, API contract, migration, infrastructure or deployment files were changed. `git diff --name-only -- backend contracts` returned no paths. No commit or push was performed. Existing unrelated workspace changes, including the report PDF, were preserved.

The local Vite server remains at http://localhost:5173, using `C48_INGRESS_URL=https://reliva.tansang.dpdns.org`. Writes made through this local UI reach the deployed system.

## Changes requested during review

- Warehouse directions are a prominent primary action inside a separate receiving-point card. Warehouse name, address, directions and pickup instructions have distinct visual roles. Request history uses the shared styled button rather than a browser-default control.
- Mission evidence selection starts uploading immediately. Multiple files have independent state and command keys; ambiguous failures retain their key, definitive storage failures get a fresh key on retry. Valid saved files are not resent when another file fails. Invalid file metadata is rejected before upload. Duplicate selections within the mounted upload queue are skipped with feedback.
- Progress and completion now use one evidence component. The completion action no longer performs a second hidden upload. Completion notes are preserved when an evidence upload refreshes mission data. Pending/failed files block mission commands until upload completes or the failed file is explicitly discarded. The picker has no separate upload button; retry appears only after a failure.
- Saved mission evidence renders immediately as image thumbnails or playable video. The shared `EvidenceGallery` also serves coordinator SOS evidence. Signed URLs stay in component memory; the preview automatically requests them, retries a media failure once, and obtains a fresh URL when an old image is expanded. Clicking an image opens an in-page lightbox. There is no “Lấy liên kết xem” step.
- Reconciliation has its own table and model: item, unit, accepted intake, ledger balance, ledger reservations, current reservations, delivered quantity and named discrepancies. Zero stays zero; absent audit flags never imply a successful reconciliation. The table supports horizontal scrolling and uses the existing list pagination.

## Audit issue coverage

| Finding | Frontend work | Remaining boundary |
|---|---|---|
| F02 | All visible supply lines pass the same preparation/validation function. Any invalid line blocks the entire command; inline row errors identify the problem. Regression tests cover mixed valid/invalid rows and decimal scale. | Backend validation remains authoritative. |
| F03 | Added the COUNTING “Cần đếm lại” queue. Independent count confirmation gives explicit match/mismatch/posting feedback. | No new receipt posting was performed in this follow-up. |
| F04 | Removed prominent self-reported AI confidence percentages from decision/summary surfaces; reinforced comparison against reporter facts. | This does not fix model factuality. AI hallucination remains a backend/provider validation issue. |
| F05 | Reporter editing explains that an accepted description replaces the current one and asks the reporter to retain still-valid details. | Reporter tracking does not supply the current narrative, and the intake timeline event does not contain the original narrative. Recovering/presenting the complete original context needs an authoritative data contract; no fabricated client reconstruction was added. |
| F06 | Mission ID and detail tab live in the URL. Removed duplicate parent selection state and the second detail-fetch path. URL navigation selects the authoritative mission and resets command/form state between records. Deep-link loading/error states allow retry or returning to the list. | SPA navigation with an in-flight upload still needs broader navigation-guard verification. Reload has a pending-file warning. |
| F08 | Warehouse creation has address search feeding the same placement path as a map click. Compact icons at wider zoom, named edit handles, an input for creation radius, and localized zoom controls improve usability. Point placement no longer depends on a fly animation's `moveend` event. | Full map interaction regression remains to be run. No clustering library or provider changes were introduced. |
| F09 | Shared location-picker validation blocks out-of-area confirmation and suppresses success text for an invalid point. The drive form separately retains its submit validation. | Boundary and geocoder interaction require browser regression beyond the checks below. |
| F10 | Drive modal tracks actual form changes, including map selection, and warns on close/F5. Generic surface change capture is a fallback; drive forms provide explicit dirty state. | The form remains one bounded scrolling form; a multi-step redesign was not implemented. |
| F11 | Gap success/detail and the drive list expose direct draft editing. The warehouse manager uses the existing drive editor and authorizes through existing APIs. | Grouping multiple gap acceptances into one drive is not implemented; it needs a separately defined acceptance contract. |
| F12 | First count initializes identities from the actual donation declaration. Independent confirmation still initializes only identities and blank quantities. Catalog reload does not overwrite initialized count rows. | New first-count/confirmation posting not rerun here. |
| F13 | Suggestion empty/failure states explain what is unavailable and allow choosing goods manually. Gap refresh explains it reads the latest processed scan. | No unsupported claim about scanner timing or extraction success is made. |
| F14–F15 | Removed duplicate handover/gap headings. Filter changes clear old queue rows; row commands are disabled while refreshing or after a load failure. Routine refresh retains layout instead of flashing a full skeleton. | Normal backend version checks remain intact. |
| F16–F17 | Domain-specific reconciliation table and exact flag labels replace generic blank record columns. Removed the empty stock “Số liệu” tab. | Catalog units are not rewritten in the browser. |
| F18 | Manual team location opens immediately, applies a chosen point without another map-confirm click, then has one save. Success is inline with time rather than a dismissible modal. GPS accuracy zero remains GPS. | This follow-up did not change a seed team's saved position. |
| F19–F20 | Donation wording describes goods brought to the site, and signed-in own donations appear before identifier lookup in DOM order. | No change to donation credentials or independent review rules. |
| F21 | Operational/public Leaflet zoom controls and campaign/warehouse edit handles have Vietnamese names. | Full keyboard and screen-reader coverage is not claimed. |
| F23 | Known active missions are named before resolution, link to their control cards and prevent a knowingly invalid submission. | Exact unknown supply blockers still require authoritative backend detail; the server guard remains. |
| F24 | Terminal SOS records hide claim and campaign-detachment actions while retaining reopening. | No terminal-state mutation was attempted. |

F01 (mission assignment snapshot versus latest accepted SOS facts), F07 (citizen progress projection) and F22 (canonical item units) were not disguised with client-side guesses. They remain backend/data work. Historical assignment facts and canonical accounting units were preserved.

## Verification actually completed

- `npm run typecheck`: passed during implementation.
- `npm run build`: passed, including TypeScript. The existing map bundle size warning remains.
- `node --experimental-strip-types --test tests/supply-draft.test.ts tests/reconciliation.test.ts tests/evidence.test.ts tests/supply-requests.test.ts tests/quantity.test.ts tests/pagination.test.ts`: **18 passed, 0 failed**.
- `git diff --check`: passed after removing trailing whitespace.
- Local browser: selected a mission, refreshed it, selected the history tab and refreshed again. Both ID and tab were restored; existing evidence stayed at one item after reload.
- Local browser: choosing a JPEG automatically uploaded it with visible pending/saved state. No upload button was needed. History showed one READY attachment. This added one diagnostic UI screenshot to the pre-existing ACCEPTED synthetic seed mission; no mission progress, stock handover, donation posting or location change was made.
- Local browser: selected a TypeScript test file through the file chooser; the picker rejected its type before upload, showed a Vietnamese error, blocked progress and recovered when “Bỏ tệp lỗi” was clicked.
- Local browser: mission image appeared automatically and opened in an in-page lightbox. No link-generation action was required.
- Local browser: Nghi Loc reconciliation displayed water delivered 28, noodle delivered 19, blanket delivered 6, first aid delivered 1 and zero remaining ledger/reservation balances. The water accepted-intake column remained 25 because the original 3 units were opening stock, not a donation receipt. No accounting values were changed by the UI.
- Local browser: team manual-position tab opens the map immediately without a map-confirm button. Returned to the team's overview without saving a position.
- Local browser: at a 390 × 844 viewport, the mission page had no horizontal page overflow. A clipped second mission tab was corrected with wrapping, equal-width buttons; tab content width then equalled its visible width (276 px). The team name/badge mobile row was changed to stack. The viewport override was reset afterward.
- Local browser after the final navigation-state cleanup: returning to the mission list and pressing browser Back restored the same mission and history tab in one step, with an explicit loading state while its authorized detail was fetched.

Screenshots are in `test-artifacts/uiux-2026-11-28/`: `local-reconciliation-table.jpg` and `local-inline-evidence.jpg`. They contain no pickup code or signed URL. The inline evidence image itself is the harmless diagnostic UI screenshot uploaded above.

## Remaining verification / handoff

The changes are ready for local review, not claimed as a fully repeated production flow. Verify additional mobile breakpoints, map search/coverage boundaries, drive close/F5 dirty warnings, draft editing from both entry points, first-count identities and independent recount completion with fresh synthetic records. These checks must use the main stack and preserve stock/audit history. Keep BE work separate, keep the local server running and do not push unless requested.
