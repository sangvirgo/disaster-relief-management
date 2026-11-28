# Production workflow retest and subsequent frontend repair

## Scope and state

User-authorized exploratory testing on the deployed Reliva UI, followed by frontend repairs and localhost:5174 verification. Existing volunteers/teams were reused; no production reset or audit deletion was performed. This record separates executed scenario evidence, implemented repairs and explicit remaining coverage gaps. Do not retain passwords, pickup codes or tracking capabilities in this report.

## Scenario and observations so far

- Created Kho tiep te Kien Giang through address suggestions; declared 3 bottles of water and 2 noodle packets. Map read-back showed correct quantities and units.
- Reused Nguyen Van Minh's Le Thuy boat team (leader plus Nguyen Thi Lan, boat/first-aid skills, no active mission). Searching citizen accounts in the member selector returned an accurate empty state without a pager.
- Team location search and map click both worked; saved the pin and refreshed. Last-location timestamp persisted. The location editor itself did not restore the saved pin/address after F5 (needs source confirmation).
- Citizen submitted a new natural flood narrative: 10 people, 3 children, 2 elderly people, one unable to walk; rescue and relief supplies requested. No phone or image supplied. SOS draft restored all inputs and confirmed location after F5; submission succeeded.
- SOS automatically attached to the existing Le Thuy campaign. Coord2 engaged that campaign and saw the new SOS in its scoped queue, claimed it, verified with an explicit note of missing phone/evidence, chose P1, and offered the existing boat team.
- AI advisory matched the described people and situation. Its suggested P1 remained advisory until a human confirmed priority. Rule-score display initially showed a dash while the expanded AI result showed risk 85/100.
- After offer, coord2's active-mission controls attempted to read team reporting mode and displayed FORBIDDEN plus a retry button. Offer itself succeeded. This is a frontend permission/read-projection integration defect to repair without widening grants.
- User requested two layout fixes during testing: remove the black SOS submit-helper sentence and align the submit action; place priority decision buttons immediately below the AI card, with consistent size and clear secondary styling.
- Volunteer accepted the mission. Relief request UI exists, but appears far below mission details and directions. Suggestion was initially empty, then appeared after asynchronous need extraction. Empty copy repeated the same instruction twice.
- Entered a water quantity and pressed F5 before submitting: unsent supply draft was lost. Submitted supply/pickup data subsequently persisted across F5.
- User explicitly approved changing the Le Thuy campaign's primary warehouse from the previous Le Thuy warehouse to Kien Giang. Applied through ops UI with an audit reason; new primary read-back succeeded. An earlier automatic tool review blocked this change before approval; no workaround was used.
- Invalid negative noodle quantity was rejected on submit and no partial request was sent. Corrected request selected Kien Giang and reserved available 3 water / 2 noodles, showing shortage 19 water / 13 noodles / 4 blankets.
- Ops handover rejected a wrong pickup code, accepted the valid code, moved the row to handed-over history and reported stock deduction. History showed exactly 3 water and 2 noodles for this request. These are UI read-backs, not direct ledger SQL proof.
- Supply proposal page initially showed no pending proposal, with accurate copy that Refresh reads the last scan rather than executing the scan. Recheck after the configured scheduler cycle and campaign warehouse change.

## Initial checklist (historical)

The initial checklist covered accepted reporter updates after assignment, citizen progress, supply-gap proposal -> draft/open drive, donation declaration, independent count/review (including mismatch/recount), posting, subsequent supply handover, mission completion note F5 persistence, resolution guards and citizen final state. Subsequent sections record the actual results and the remaining coverage gaps.

## Subsequent evidence

- Reporter changed 10 -> 12 people and added a blocked approach/alternative alley. Coord2 accepted the supplement. Volunteer mission refreshed to 12 people and highlighted the new access instructions. AI narrative also changed to 12; official priority remained P1.
- Leader notifications contained the offer, but no new accepted-supplement notice was observed. This is a backend/event coverage issue rather than evidence that the current mission projection is stale.
- Premature resolution was disabled with a link to the active mission. Leader progressed to EN_ROUTE and ON_SCENE. An unsent outcome note survived F5 with an explicit restored-draft notice; no completion was submitted yet.
- Read source scheduler configuration: need extraction every 5 minutes, gap recomputation every 15 minutes. Gap list eventually displayed the 14:30 scan: 19 water, 13 noodles, 5 blankets at Kien Giang. The blankets demand increased after the accepted people update; further supply requests must be reviewed as human commands.
- Accepted the water gap with a natural drive name/description. It created a DRAFT with 21-bottle target (buffer), campaign and warehouse prefilled. Editing required manually selecting a collection point; address search/confirmation and saving succeeded, then explicit opening succeeded.
- Map markers at the same coordinates were difficult to target: attempting the new drive marker selected the old Le Thuy warehouse. Switched to the paginated drive list to open the exact new drive. Investigate overlap/click targeting before choosing a fix.
- Citizen2 declared 21 bottles. Own-donation tracking correctly showed DECLARED and explained that stock had not increased. Upcoming count will include 13 noodle packets and 5 blankets brought without prior declaration to exercise out-of-drive lines.
- User additionally requested compact citizen SOS history/layout and redesigned supply quantity inputs with clear units and a concise explanation of the receiving warehouse and handover step.
- Prepared six small PNG table documents for upload boundary testing. Each explicitly says it is a simulated upload-workflow document; none is a real photograph or proof of physical rescue/goods.

## Counting, posting and final production handover

- Reviewer1 counted 21 water bottles: 20 accepted, 1 held; also accepted 13 noodle packets and 5 blankets outside the drive. All quantities, notes and extra lines survived F5. Selecting six evidence images retained five with a Vietnamese limit message; removing one and adding another retained five, and submission succeeded.
- Reviewer2 received a blind form without the first counter's figures/evidence. An intentional water mismatch (22 instead of 21) required recount and did not post stock. A new revision was counted by reviewer1, then independently matched by reviewer2. The old second-counter draft did not leak into the new revision.
- Receipt reached POSTED. Operations receipt and stock report showed 5 blankets, 13 noodle packets, 20 available water bottles; 1 held bottle remained excluded. These are UI read-backs, not ledger SQL proofs.
- The leader requested the remaining 5 blankets / 13 noodles / 19 water, cancelled the reserved request, then recreated it successfully. Operations handed over the recreated request. History confirmed both this handover and the initial 2 noodles / 3 water.
- Leader progressed through travel/on-scene and completed with a natural note covering 12 people and cumulative goods. The unsent completion note survived F5 before submission.
- Coord2 attempted resolution twice on production; both attempts returned LOGISTICS_UNAVAILABLE. Production SOS remains unresolved, although the mission and handovers are complete. No production deployment, reset, forced closure or audit deletion was performed.

## Repairs in this working tree

- Removed the redundant citizen SOS footer sentence; kept field validation.
- Compact citizen tracking history, with shared ten-entry navigation and inline timestamps.
- Supply quantity inputs now have static readable labels, consistent height and visible units; moved supplies above route information and explained the warehouse handover step.
- Per-user/per-mission supply drafts survive F5 for 30 minutes, clear on logout/success/discard, and never submit automatically. Unknown catalog items remain visible and block submission rather than being silently dropped.
- Restored the saved team map pin from the existing nested position projection without treating it as a new unsaved location.
- Coordinator priority actions use a separate AI-tool area and secondary styling; completed/queued AI evaluations no longer show a useless disabled retry action. Decision controls are placed below the AI column.
- Resolution form uses a compact two-column desktop layout and one column on small screens; user-requested completed-mission banner reduced to status + optional additional-team action, without the redundant anchor link.
- Authority referral uses one confirmation titled “Xác nhận chuyển giao”, with an exclamation warning about the receiving agency's responsibility. Required backend text fields use generic defaults; no specific agency/contact is fabricated and no external message is sent. Existing resolution guards remain authoritative.
- Fixed the blank-looking referral button: secondary command tone was missing when the modal form was removed, leaving light text on a transparent background.
- A restricted team-profile read no longer produces a useless retry error on coord2; the actual mission status remains visible. Coordinator-reported-team progress permissions require further review before claiming full coverage.

## Narrow backend corrections and evidence

1. The resolution preflight was authorized by Response's live engagement scope, but Logistics only saw the floating Identity grant, lacking NEED_MANAGE. Response now forwards its canonical campaign assertion on the service-authenticated internal fulfillment call. Logistics still introspects the live actor, restricts this exception to a floating coordinator and the exact request/campaign/cycle, and ignores the header on public reads. No general logistics permission is added.
2. Local resolution then correctly exposed a stale legacy failure review. FE hid the required review action based on mission ID alone; it now compares the mission version published in the existing history projection.
3. Retrying that review hit PostgreSQL request_event_failure_review_uq: the index allowed only one review per mission, while the service requires an exact-version review. The additive migration keys uniqueness by mission + version (legacy records retain one legacy slot). It preserves all records and refuses rollback once multiple revisions exist. Applied through the declared response-migrate job on local only; one migration, exit 0, no reset.

Local UI retest on 5174: edited an unsent supply quantity, F5 restored it, corrected and submitted it, operations handed over 8 first-aid kits, leader advanced and completed using a completion note restored after F5. Coord2's resolution reached the real failure-review guard rather than LOGISTICS_UNAVAILABLE. After the index migration, REPLACED review succeeded, the button disappeared for the reviewed version, resolution succeeded, and explicit closure succeeded. Citizen1's list/detail showed CLOSED; its ten-entry history navigated to the remaining five entries.

Final visual checks: the referral button visibly renders dark text on a white background (44 px measured desktop height), with the requested warning title and icon inside the one-step dialog. The priority buttons have equal width/height and sit directly below AI; at a 390 px viewport they stack at equal width with no horizontal overflow. The viewport override was reset. The completed-team block contains only the status and optional additional-team button. Supply-request history now also uses the shared ten-entry navigation.

Checks: Web 88/88 unit tests and production build passed, including the final copy and map hit-area changes. Backend final full Jest run: 171 suites passed, 1 skipped; 1,133 tests passed, 8 skipped. Targeted fulfillment/resolution tests: 30 passed; later HTTP/failure-review suites: 9 passed (one invocation also named a nonexistent test path and exited 1; no test failure was hidden). Contracts check passed. Both local API images built and recreated, and are healthy; the migration and local UI resolution/close succeeded. No destructive schema suite/reset was run. The Windows Node script suite was not rerun; these counts refer to Jest, not a full `npm test` including those scripts.

Additional final fixes: a first `pan:false` map-resize fix alone did not solve incorrect selection at nationwide zoom. A local retest reproduced a drive click selecting the Mekong warehouse. A deterministic, global pixel layout now separates warehouse and drive hit areas and connects displaced icons to their true geographic points; coordinates remain unchanged. The exact previously failing drive click then opened the correct Ho Chi Minh drive, followed by the correct warehouse. Tests cover forty colocated/nearby pins, stable ordering and unchanged inputs. Posted held-release editing is collapsed, and restored/independent-count extra items derive their outside-drive badges from the actual drive catalog. The seeded POSTED receipt had no held stock, so the held-release disclosure itself was not exercised with a live held fixture. Reporter progress copy also no longer combines a completed mission with a misleading “waiting for a team” instruction.

## Remaining audit follow-up

- Production final stock report and donor POSTED tracking read-back were not revisited after the last handover; do not claim them as checked.
- Post-count evidence read-back and accepted-supplement notifications remain follow-up findings. The production flow did not exhaust every administrative, rejection, expiry, recovery or offline branch.

Recommended next priorities: provide evidence access after posting without leaking the first count into blind review; give campaign coordinators scoped mission-reporting metadata so they do not need a global team-profile read; verify held-release editing with a dedicated held fixture. These remain open findings, not completed repairs in this batch.

## Map display rollback requested after review

The global pin spreading and dashed connector experiment was removed at the user's request. Warehouse and drive marker placement now uses the previous display logic; the resize pan:false correction remains. The earlier exact-selection result for the removed layout no longer describes the current implementation; marker overlap at nationwide zoom remains an open finding. Local 5174 visual inspection confirmed compact markers around their original locations with no connector lines. Web unit tests after removal: 86 passed; the two tests belonging solely to the removed layout were removed with that implementation.


## Pre-push verification and upstream merge

Merged upstream ced0d12 after reporting two conflicting header/next-step regions in Coordinator.tsx. The user chose to retain upstream's compact header and auto-claim behavior while preserving this batch's fixes and one-step referral dialog. Visual retest on 5174 confirmed the new header and requested dialog. No conflict markers remain.

Final merged source checks: Web 86/86 tests and build passed; backend Jest 171 suites passed, one skipped, 1,136 tests passed and eight skipped. Backend script tests: 156 passed, one skipped, no failures on Linux. The initial full Windows npm test invocation passed Jest but failed 48 script checks due to Windows paths, Bash and line endings. The script group was rerun from a tracked-source LF archive inside the existing local Response container, without a new container/database/volume. It used a blank fixture .env and an OpenSSL binary/libraries already available in the local Postgres container, scoped to a temporary directory. Initial Linux attempts exposed missing fixture/tool prerequisites; the complete rerun passed after those prerequisites were provided. Docker/AWS/database commands in these script tests are doubles, not live operations. Contracts check passed after merge; lint had zero errors and 14 existing warnings.

