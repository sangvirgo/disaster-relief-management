# Web UI: eleven-issue retest — 2026-11-26

## Scope

Frontend only, served at http://localhost:5173 with the configured remote ingress. No push, backend changes, account changes or submitted operational commands. The user deferred supplying further credentials. The existing operations session was signed out while preparing role tests; subsequent checks used guest access. Primary/secondary coordinator, volunteer, reviewer and administrator authenticated browser checks remain pending.

## Evidence by reported image

| Image | Change / finding | Browser evidence and remaining checks |
|---|---|---|
| 1 | Append selected files, preserve prior selection on invalid input, deduplicate already selected files, cap at five. | Previous pass: two separate picks showed 1/5 then 2/5. This pass: six files capped at 5/5 with Vietnamese warning; remove one and pick an existing plus a new file returned 5/5 without duplicate. Test attachments removed; no SOS submitted. Invalid type/size path not exercised in browser. |
| 2 | Management dialog gains vertical space and header/close button layout. | Previous panel pass: opening-stock dropdown opened and all twelve options were accessible with scrolling. Desktop authenticated retest pending. |
| 3 | Warehouse hover card shows recorded address or reverse-geocoded locality. | Previous pass showed address and stock table. Provider initially returned nearby POI; request subsequently restricted to Locality. Final locality response not rechecked after sign-out. |
| 4 | Reuse citizen LocationPicker search in campaign drawing; selected result updates center and animation. | TypeScript/build checked; authenticated search/zoom and save remain pending. |
| 5 | Coordinator sees skills and paginated members without edit controls; campaign-scoped coordinator cannot create/manage campaigns. | Source checked. Existing routing already gates common/conflict queue to SYSTEM coordinator. Actual primary/secondary accounts and their current grants remain unverified. |
| 6 | Mission timestamp moved to heading; compact facts and action layout. | Corrected label to assignment time because created_at is not acceptance time. Volunteer browser retest pending. |
| 7 | Readiness controls merged into team Overview; separate readiness tab removed. | Source/build checked. Leader/member browser retest pending. |
| 8 | Compact action-row buttons and closeout submit buttons. | Found component CSS still forced 56px/full-width buttons despite earlier generic override; fixed component selectors. Authenticated visual retest pending. |
| 9 | Opening stock accessed inside Edit warehouse. | Previous panel pass: hover offered Edit only, Edit opened opening-stock form through its management button. No stock command submitted. |
| 10 | acceptance_note is user-authored data, not a generated number. Label source explicitly. | Current guest browser showed 1122 in both drive items and declaration form as creator-provided guidance. Declaration dialog opened; no donation submitted. Stored content preserved. |
| 11 | Receipt/dispute selector and status filters use compact pressed buttons instead of stacked underline tabs. | Source/build checked; reviewer authenticated browser retest pending. |

## Checks

- npm run typecheck --prefix frontend/web: passed in earlier pass.
- npm run build --prefix frontend/web: passed after component action sizing and timestamp changes; existing large map bundle warning.
- Final typecheck after receipt selector markup adjustment: passed.
- git diff --check: no whitespace errors at last check.

## Next concrete test

Use existing authorized logins in the panel to verify SYSTEM primary coordinator versus CAMPAIGN-scoped secondary coordinator, then volunteer leader and ordinary member. Do not interpret a username such as coord2 as proof of secondary permissions. Continue with operations/reviewer/admin screens and desktop/mobile visual checks. Do not report all eleven as browser-passed until the pending checks above are executed.

## Follow-up: donation guidance removed at owner request

The owner explicitly requested removal of reception guidance from donation displays. Operations drive detail and citizen drive item table now show exactly item, target quantity and received quantity. Declaration form no longer displays acceptance_note. Stored data and backend contracts are preserved. Drive action forms use compact buttons beside reason inputs on desktop and stack on small screens. The dialog minimum height is scoped to opening-stock forms rather than every operations dialog.

Panel 5173 verified the public item table with three headers and actual values 12 target / 10 received, then opened the declaration dialog: no creator guidance was displayed, and the submit button occupied its content width. Operations action layout was checked in source; authenticated browser retest is still pending. TypeScript passed after content changes.
