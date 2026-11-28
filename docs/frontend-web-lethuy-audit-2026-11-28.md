# Reliva production flow audit — Le Thuy, 2026-11-28

## Status and scope

**The requested core rescue-and-relief scenario completed end to end. This is not a claim that every feature or failure mode passed.** This is a new browser run against https://reliva.tansang.dpdns.org/, separate from the earlier Nghi Loc scenario in [the initial audit](frontend-web-flow-audit-2026-11-28.md). Historical findings were used to select checks, not presented as newly reproduced results. The visible production run started around 10:25 and final localhost verification finished at 11:10 on 28 November 2026, Asia/Saigon. Earlier preparation and credential takeovers are part of this same task.

Reference: [project context](c48-project-context.md), [technical plan, Appendix A and section 28.8](c48-technology-and-delivery-plan.md), and [backend guide](backend/README.md). The current goods flow is a mission supply request, reservation, six-digit pickup code and warehouse handover. Retired distribution slips must not be used.

All incident narratives and new operational records in this run are synthetic, with natural Vietnamese content. Mutations were made through the visible production UI. No database reset, direct API business mutation, audit deletion, deployment or application-source edit was performed. Credentials and tracking capabilities are deliberately excluded.

## Observed progress

| Stage | Evidence from this run |
|---|---|
| Warehouse | `ops_mgr` created **Kho tiếp tế Lệ Thủy**, 5 km radius, using address search `Lệ Thủy, Quảng Bình`. Map read-back showed actual and available water stock both **2**. |
| Location | Search selected **17.223280, 106.790110**. Reverse geocoding displayed Le Thuy, Quang Tri. The two providers' province labels differ; coordinates were used as the authoritative selected point. Administrative-name correctness was not researched in this run. |
| Volunteer account | The previously created `minh_nghiloc` had no grants. After explicit owner confirmation, admin granted VOLUNTEER/SYSTEM. The account required a password change; the owner performed that through browser takeover. |
| Team | Admin created **Đội xuồng cứu hộ Lệ Thủy**, APP reporting, led by `minh_nghiloc`, with boat-handling and first-aid skills. Leader UI confirmed management authority. |
| Member search | Default `vol` search produced an empty first page with a next-page action, then an empty final page. No existing unassigned volunteer could be added. The owner requested a new account from admin instead of granting citizen3 another role. |
| Team location | Leader searched the same address, selected the suggestion and saved the manual position. UI confirmed the update at **10:34:27 28/11/2026**, source manual map pin. F5 retained the Position tab and saved position. Continuous device GPS was not enabled. |
| Citizen SOS | `citizen1` submitted SELF, flood, rescue and supplies, life-danger flag, **9 people / 3 children / 2 elderly**. Vietnamese narrative describes rising water, shelter on an upper floor, **one** elderly person unable to walk, a rear-yard approach and water/noodles/blankets needed. Contact name synthetic; phone omitted. Server acknowledgment at **10:31:05**. |
| SOS draft refresh | Before submitting, F5 retained category, confirmed coordinates, counts, narrative, supply text, danger flag and reporter name. No evidence file was selected. |
| SOS acknowledgment refresh | F5 after success returned to an empty new-SOS form. Coordinator subsequently saw the submitted request once as the newest row. This does not establish all retry/idempotency cases. |
| AI | Suggested P1. In this sample it correctly retained **one** elderly person unable to walk, rather than expanding it to both. Vietnamese explanation included forecast context. This single sample is not a factuality or triage-accuracy evaluation. |
| Verification | `coord1` used **Xác nhận P1 và chọn đội**, read and confirmed the confirmation dialog. Result: officially prioritized P1, separate from the advisory. |
| Candidate team | Before campaign creation, coordinator suggested the new Le Thuy team, distance 0 m, recent position and zero previous missions. The subsequent campaign and mission are recorded below. |
| New member account | Owner created **lan_lethuy / Nguyễn Thị Lan** through the prepared admin form. Admin then granted VOLUNTEER/SYSTEM for the requested member setup; leader searched `lan` and added her. Roster read-back: **2 people**, Minh leader and Lan member. Lan's login was subsequently verified, but the account is still behind mandatory first-login password change; her mission-view and command permissions were not exercised. The agent made no credential changes. |

## Completed continuation

| Stage | Actual outcome |
|---|---|
| Campaign | Created and activated **Cứu hộ và tiếp tế vùng ngập Lệ Thủy** from the unassigned SOS card. The SOS was attached. The supply-gap detail later showed the campaign using the new warehouse, with no stocked backup. |
| Mission | Coordinator offered **f60fb96a-1bd8-44d7-93dc-1006fddbefef** to the new team at **10:43:53**. Leader accepted at **10:44:53**, travelled at **10:48:18**, arrived at **10:48:25**, and completed at **11:03:38**. |
| Supply suggestion | The leader's form prefilled **water 19, noodles 13, blankets 5**, labelled as AI suggestions from the SOS. It did not require manual catalog reconstruction. |
| Invalid supply input | Water **-1** and then blank each blocked the entire form with Vietnamese inline/summary errors. No partially submitted request was observed. Restoring 19 allowed sending. |
| First reservation | Selected **Kho tiếp tế Lệ Thủy**, reserved water **2**, showed shortages **17 water / 13 noodles / 5 blankets**. F5 retained the same request and pickup code. Codes are deliberately omitted here. |
| First handover | Operations queue showed team and goods, without the SOS narrative, household details or pickup code. A wrong six-digit code was rejected. Correct code handed over water **2** at **10:46:09**. |
| Accepted update | Citizen submitted a full replacement narrative warning of a fallen electrical wire at the rear yard and requiring approach through the eastern window. Coordinator accepted with reason at **10:47:57**. Leader re-opened the mission and saw the new approved text and the label that facts changed after dispatch; original assignment facts were separately available as history. |
| Gap proposals | Initially empty immediately after verification/request; a later snapshot (**10:46:59**) produced red proposals for **17 water, 13 noodles, 5 blankets**. Refresh reads the latest completed sweep; it does not synchronously run the sweep. |
| Suggested drive | Accepted the water proposal, named the drive **Nước uống cho bà con vùng ngập Lệ Thủy**, target **19**. A draft was created, not automatically opened. Followed its edit link, set a collection point by address search and useful arrival instructions. Saving initially failed on the untouched generated quantity `19.000`; changing it to `19` succeeded. Then opened the drive. |
| Manual drive/map | Created **Góp mì và chăn cho bà con Lệ Thủy** by clicking a point inside the warehouse service circle. Warehouse was selected automatically. Linked the campaign, targets **noodles 13 / blankets 5**, then opened it. This exercised both address selection and direct map pin placement. |
| Donations | `citizen1` declared **water 17** and a separate **blankets 5 / noodles 13**, synthetic donor Lê Thị Hạnh, against the two named drives. Declaration alone did not post stock. Lookup identifiers are omitted because the current UI permits their use for tracking. |
| First counts | `reviewer1` counted both. Closing and re-opening the water count restored the unsent value from a draft. Self-review was unavailable, with an explicit Vietnamese explanation. |
| Independent confirmation | `reviewer2` saw blank quantities and no first-count figures. Water **17** matched and posted. Entering **noodles 12** against the earlier **13**, with blankets 5, returned the other receipt to COUNTING, with an explicit mismatch message and **Xem phiếu cần đếm lại** action. |
| Recount | The receipt appeared in **Cần đếm lại** and stayed there after F5. Reviewer1 re-counted **5 / 13**; reviewer2 independently entered matching **5 / 13**. It posted once. No self-review or stock-posting bypass was used. |
| Restocked balance | Operations map read-back: actual and available **water 17 / noodles 13 / blankets 5**. |
| Second reservation | Leader reopened suggestions: **remaining water 17 / noodles 13 / blankets 5**, all labelled confirmed needs. Reserved all from the new warehouse; no extra water 2 was added again. |
| Second handover | Operations handed over all remaining goods at **10:58:20**. F5 showed no repeated handover; history contained exactly the two new Le Thuy handovers. |
| Final stock | Operations map and stock report both showed **actual 0 / reserved 0 / available 0** for all three items. Reconciliation said all three matched: accepted donations **17 / 13 / 5**, goods handed to team **19 / 13 / 5**. Water's opening 2 explains the difference. |
| Mission media | Invalid TXT rejected with Vietnamese type validation and a remove action. Removing it restored mission actions. Uploaded a synthetic solid-colour 640x360 PNG (not a real incident photograph). The saved image survived F5, displayed inline and opened in the image viewer. One mission attachment remained; no retry duplicate observed. |
| Completion draft | Entered a detailed completion note, pressed F5, reopened the completion form: note was blank. Re-entered the note and submitted successfully. |
| Guarded SOS ending | Before mission completion, coordinator saw the active-mission blocker and disabled resolution action. After completion and handovers, a reasoned proposal with the completed-mission basis resolved at **11:04:40** and closed at **11:04:58**. |
| Citizen final state | Own list and detail showed **Đã đóng**, current accepted situation and complete received/verified/offered/accepted/travel/arrival/completed/resolved/closed timeline. The supplement controls were unavailable after closure. |
| Donor/operations receipt | Citizen's two contributions showed **Đã ghi sổ** and accepted quantities **17**, and **5 / 13** (revision 2 for the recount). `ops_mgr` could also open the posted receipt and see accepted figures and matched independent-review outcome. |
| Logistics media | Uploaded the same synthetic PNG privately to the second donation. Server acknowledged it; after F5/reopening, the server attachment list still showed one image and an obtain-link action. The signed download itself was not exercised. |

### Accounting read-back

| Item | Opening | Accepted donation | Handed over | Final actual | Final reserved | Final available |
|---|---:|---:|---:|---:|---:|---:|
| Water | 2 | 17 | 2 + 17 = 19 | 0 | 0 | 0 |
| Noodles | 0 | 13 | 13 | 0 | 0 | 0 |
| Blankets | 0 | 5 | 5 | 0 | 0 | 0 |

These are UI read-backs and arithmetic reconciliation, not a new SQL invariant suite or proof of real physical delivery.

## Reproduced functional findings

### L01 — P1 — A new P1 SOS is buried on the final page of the unassigned campaign queue

**Reproduce:** submit and prioritize the new SOS P1 outside existing campaign regions; open Phan vung SOS. The first page contains eight older records. The new P1 request is the fourth and last record on page 2, although it needs supplies and has declared danger.

**Impact:** urgent campaign attribution can be delayed by older routine work. The SOS-processing list itself did show the new SOS at the top; this finding is specific to the unassigned campaign queue, not all coordinator lists.

**Direction:** keep shared cursor pagination, but sort the operational queue by a defined urgency tuple (official priority, relevant attention signals, then age/id). Offer explicit prioritization controls and a clear urgent count. Backend cursor ordering must change consistently; sorting only the current FE page would not fix buried P1s.

**Source corroboration:** `backend/apps/response/src/campaigns/campaign-coordination.service.ts:305` orders the paginated queue by received time ascending and ID, with its matching cursor at line 294. This is a prioritization design/contract concern, not a failed database write. No policy or code was changed.

### L02 — P1 — Generated draft quantity fails unchanged when edited

**Reproduce:** create water drive from the shortage proposal (target 19) → follow **Mở và chỉnh sửa bản nháp** → fill required collection point and arrival notes without editing quantity → save. The form shows **19.000** and returns **Số lượng có quá nhiều chữ số thập phân so với đơn vị tính.** Changing only the quantity to **19** lets the same draft save.

**Impact:** the normal suggested-drive path fails on system-generated input; the manager has to discover and correct a numeric formatting issue before publishing.

**Direction:** normalize display/command quantities against the item's scale. Preserve exact decimal strings; trim insignificant trailing zeros rather than use unsafe floating-point arithmetic or relax stock precision rules. Apply consistently to seeded/read-back/new drive lines and mark the offending field inline.

**Source corroboration:** current local `DriveCreateForm.tsx:58` and `:89` ignore trailing zeros during FE validation, but `:95` sends the original `target_quantity` string unchanged. Thus an apparently valid read-back value can still fail the backend boundary. The deployed commit was not independently established.

### L03 — P2 — Completion report text is lost on F5

**Reproduce:** on an ON_SCENE mission, open **Báo cáo hoàn thành nhiệm vụ**, enter a substantial result note, press F5, re-open the form. The note is empty and completion confirmation disabled. The mission itself and already-uploaded image remain intact.

**Direction:** save a scoped local draft by account/mission/action, show restoration and clear it only after server acknowledgment or explicit discard. Guard navigation when necessary; do not let a generic evidence-only guard imply all mission edits are protected.

**Source corroboration:** `frontend/web/src/features/volunteer/Volunteer.tsx:277` stores `outcomeNote` in component state. This run tested completion notes, not every failure/decline-note form.

### L04 — P2 — A consumed draft-edit URL can display an unrelated error in the warehouse popup

After opening and publishing the suggested water draft, returning to **Kho và đợt quyên góp** and opening the warehouse showed **Đợt này không còn là bản nháp. Hãy chọn trên bản đồ để xem trạng thái mới.** alongside otherwise correct stock. It did not block reading the warehouse, and a later normal return no longer showed it.

**Direction:** consume/clear `edit_drive` after opening/completing the edit and scope errors to the operation that produced them; do not render a drive-edit error inside an unrelated warehouse card. Current local `WarehouseMapManager.tsx:68` reads `edit_drive` without clearing it, while `:303` displays shared `actionError` with warehouse actions. Treat the exact navigation sequence as a retest requirement before claiming all entry paths affected.

## Confirmed UX issues and recommendations

1. **P2 — Empty volunteer result pages impose unnecessary work.** The search explains that only unassigned accounts can be added, but `vol` required navigating two pages containing zero candidates. Pagination works; this is not the previously fixed missing-next-button defect. Prefer applying eligibility before pagination server-side, while retaining scoped results and the shared pager.
2. **P2 — Canonical water quantity is shown as “cái”.** Warehouse read-back displayed `Nước đóng chai 2 cái`. This is misleading for packing and handover. Review the canonical catalog unit and show bottle/can/carton identity consistently through suggestions, donation declarations and pickup. This is a catalog/contract concern as well as UI copy; do not silently convert quantities in FE.
3. **Accessibility investigation — unnamed map menu controls in the automation accessibility output.** The map Add menu visibly contained Kho and Đợt quyên góp, but its two actions were unnamed in the observed accessibility tree. A screenshot was used to choose them. Current local source already has explicit Vietnamese `aria-label` values at `WarehouseMapManager.tsx:273`, so do not assume the observed tree establishes a source-level accessibility defect. Verify the deployed DOM and a screen reader before claiming a WCAG failure.
4. **UX follow-up — Success receipt disappears after F5.** After SOS acknowledgment, refresh reopened a blank form. Preserve a clear route to the just-submitted request for an authenticated reporter, or offer the own-SOS list prominently. Do not persist or expose tracking capabilities in URLs. No duplicate submission was observed in this check.

5. **P2 — SOS mobile hierarchy makes the emergency facts secondary.** At an explicit 390x844 viewport, essentially the whole first screen was header, title, search and map; incident category, danger, headcount and narrative were below the fold. Weather-layer choices competed inside the map and extended beyond its visible width. There was no document-wide horizontal overflow in this check (document client/scroll width both 375 px). Recommend compact confirmed-location summary, an expandable map/weather section, incident facts early, and a persistent submit/status region that remains accessible without covering inputs. Retain the clear GPS/manual choice and honest server acknowledgment.
6. **P2 — Stock report requires horizontal travel at panel width and repeats a fixed warehouse.** The 835-pixel panel screenshot cut the available-stock column and required horizontal table scroll even with only three records. Hide the redundant warehouse column when one warehouse is selected, prioritize available/reserved/actual, and use compact numeric alignment. A green badge around zero available stock is an ambiguous operational signal; prefer a neutral empty-stock label or demand-aware severity.
7. **P2 — Reconciliation omits the opening-stock explanation.** Water correctly showed accepted donations 17 and handover 19 with **Khớp số liệu**, but no opening-2 column or visible formula explained why. Add opening/adjustment movement context or a focused ledger drill-down. Do not change the correct ledger to make the two displayed totals equal.
8. **P2 — Closed SOS lacks a compact outcome summary.** Citizen timeline correctly showed closure and completion, but the prominent **Tình huống đang ghi nhận** still led with the historical rising-water narrative. Surface a clearly attributed final rescue result and resolution time before historical danger details. Do not expose private staff notes wholesale.
9. **P3 — Donation tracking asks users to distinguish two technical identifiers.** A short receipt code is prominently presented, while manual lookup requires a 36-character UUID and explains that it is different from the code. Account-owned list navigation worked. Prefer one safe user-facing lookup concept, with a copy/share-safe receipt action and an authenticated recovery route. Review capability/privacy implications before changing contracts; this audit did not validate anonymous authorization.
10. **P3 — Reviewer/intake lists use generic table headings.** Headings such as **Tên bản ghi / Thông tin chính** force users to infer which column means receipt, donor or drive. Use domain headings and a compact detail header summarizing receipt/drive/warehouse/state; keep independent-count values hidden until allowed.
11. **P3 — Success/error feedback could be more local.** Opening a second donation declaration briefly showed the required-at-least-one-quantity error before entering anything. Several workflows use distant page statuses and large nested cards. Show validation after relevant interaction/submission and place next-step feedback at the task being completed.

### Recommended redesign order

| Order | Page family | Concrete direction |
|---|---|---|
| 1 | Citizen SOS | Reduce first-screen map/weather dominance, bring danger and facts into immediate reach; keep location confirmation and draft recovery. |
| 2 | Coordinator campaign/SOS workspace | Urgency-first unassigned queue, fewer stacked tab layers, one obvious next action, compact original/approved comparison; retain human confirmation for priority/dispatch. |
| 3 | Volunteer mission | Put current approved facts, next progress action and remaining supply summary together; persist result drafts; reveal evidence/history secondarily. |
| 4 | Warehouse/drive map and forms | Separate browse versus create/edit modes clearly, consume deep links, normalize quantities, collapse weather unless useful, prefill a valid collection point with an explicit confirmation. |
| 5 | Donation intake/reviewer | Replace generic columns, give distinct count/recount/independent-confirmation outcomes, preserve draft recovery and self-review guards. |
| 6 | Stock/reconciliation reports | Remove redundant columns under fixed filters, explain opening stock, prioritize usable quantities, use compact responsive rows and demand-aware colour. |

These are workflow and visual-hierarchy recommendations, not a claim that a particular aesthetic style is objectively correct. The current UI has consistent typography, spacing and recognisable status treatments; the larger problems are long vertical travel, nested containers/tabs, generic labels and avoidable state-recovery work.

## Previously reported issues rechecked

| Earlier finding | This run |
|---|---|
| Accepted citizen changes absent from assigned mission | **Not reproduced:** leader saw the newly approved eastern-window/electrical-wire warning and dated update marker, with original snapshot separate. Member projection remains untested. |
| Invalid supply quantities silently dropped | **Not reproduced:** negative and blank blocked the full form. |
| Recount disappears from actionable queues | **Not reproduced:** explicit mismatch outcome, recount action and queue survived F5. |
| AI expands one immobile elderly person to both | **Not reproduced in this one sample:** advisory preserved one. This does not establish model-wide accuracy. |
| Uploaded evidence unavailable after F5 | Mission image and donation attachment list both persisted in this run. Logistics signed download was not tested. |
| SOS draft lost on refresh | Draft fields and confirmed point persisted before submission. Completion-note draft is a separate newly reproduced gap. |

## Port 5173 — completed

- Identified listener PID 32972 on `::1:5173`; command line matched this workspace's Vite and `--port 5173 --strictPort` before stopping it.
- Preserved the separate Vite process on port 5174.
- Started new Vite PID **25360** from `frontend/web`, binding localhost:5173, with process environment `C48_INGRESS_URL=https://reliva.tansang.dpdns.org`.
- Existing `vite.config.ts` proxy sets the upstream Origin and Host for the selected ingress. No proxy source or backend config was changed.
- Verified with host HTTP requests: frontend `/` **200**, `/api/v1/identity/auth/csrf` through Vite **200**, expected JSON field present. No CSRF value or cookie was logged.
- Logs: `test-artifacts/uiux-lethuy-2026-11-28/vite.stdout.log` and `vite.stderr.log`; stderr empty on verification.
- Browser verification completed afterward: logged in as `ops_mgr` through **http://localhost:5173**, opened the newly created Le Thuy warehouse stock report, read all three zero balances and retained authenticated access and the warehouse filter after F5. This confirms more than a static page or CSRF-only health check.
- This is a process-level override. A later plain `npm run dev` without `C48_INGRESS_URL` will use the existing default local ingress. To restart the same connection, from `frontend/web` use PowerShell: `$env:C48_INGRESS_URL = 'https://reliva.tansang.dpdns.org'; npm.cmd run dev -- --port 5173 --strictPort`. No backend-origin or cookie protection was disabled.

## Final limits and artifacts

- Lan's account was created and added to the team; login succeeded but mandatory first-login password change prevented checking her mission access. No further manual takeover was requested because the main leader-driven scenario could finish. The agent did not enter new credentials or bypass that gate.
- No full network-outage/lost-response simulation, real phone GPS, background location, OTP/email, Google sign-in, MP4 upload, expired pickup code, cancellation/expiry reservation release, proxy/two-coordinator verification, duplicate-link, claim/recovery, dispute-resolution, stock-adjustment, campaign pause/close or load/security suite was executed in this new scenario. Those are separate follow-up acceptance cases; do not mark them passed based on historical reports.
- The 390x844 review covered citizen SOS and contribution-list layout only; it is not a full responsive/accessibility audit. The viewport override was reset before finishing.
- Local source reads corroborate selected causes. No source fix, dependency change, database mutation outside the UI, commit, push or deploy was performed. Consequently no build/unit-test suite was run as a claim of remediation. Browser observations, host HTTP probes and source inspection are the actual checks.
- Synthetic PNG fixture and Vite logs: `test-artifacts/uiux-lethuy-2026-11-28/`. One image remains attached to the mission and one to the donation. Invalid TXT was removed locally and not uploaded. No new screenshot files were saved; visual review used the live browser screenshots, not reused historical images.
- Created warehouse, campaign, team, member grant/roster entry, SOS, two drives, two donations, two handed-over supply requests and their audit history remain on production. SOS closed; campaign and drives left active/open. No records were deleted or reset.
- Production and authenticated localhost tabs were retained in the panel. Credentials, tracking codes, pickup codes, tokens and signed URLs are omitted from this report.
- Next concrete task: fix L01–L03 first, then L04 and the high-friction page hierarchy. Retest the same cases using fresh synthetic records and the shared main-stack databases; preserve independent count, stock accounting and guarded resolution.
