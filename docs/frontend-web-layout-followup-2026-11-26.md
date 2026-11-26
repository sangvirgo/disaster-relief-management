# Web layout follow-up — 2026-11-26

## Active scope

The owner paused the end-to-end scenario and prioritized four frontend corrections. No backend change or push is authorized.

1. Donation drive reason/action rows reserve validation space and use a fixed action column. Buttons align with the input rather than the variable-height label/error wrapper.
2. Team detail immediately renders the existing paginated member component, preserving read-only coordinator behavior.
3. Campaign map always exposes the citizen address lookup in its own broad overlay. Weather controls form a vertical rail on the left. Search pans/zooms without creating a campaign; drawing starts from the searched point when selected.
4. Verified SOS with a suggested priority exposes a direct confirmation action. The human clicks and confirms; the versioned triage request includes priority, basis and a recorded reason. The existing status refresh selects dispatch after TRIAGED. A separate manual-priority form remains available. Existing fast-track eligibility and proxy verification guards are unchanged.

## Verification

- Web TypeScript check and production build passed after the four changes. Build retains the existing large map bundle warning.
- git diff --check passed before the final one-line field-label alignment rule.
- Authenticated browser checks for the four latest corrections are pending. Panel login now returns the Vietnamese invalid-credentials message for coord1 despite this account working earlier in the same scenario; both fill and key entry were attempted. No credential reset or permission change was performed.

## Paused scenario evidence

Before the owner paused the run, the panel successfully created Kho cứu trợ Cồn Cỏ with three bottles of opening stock, updated Đội cứu hộ cơ động Bắc location, submitted a guest flood SOS for eight people, completed coordinator verification and human P1 selection, created/activated Cứu trợ ngập lụt Cồn Cỏ via address lookup, dispatched mission 0fec2f6c-0d26-4ee0-8a0e-11b27ba0bed7 and completed its volunteer lifecycle.

Operations reviewed the proposal for request ending e4fd4a97: changed water to 24 bottles and food to 16 noodle packs with recorded reasons; rejected blanket/first-aid defaults with reasons. Created/opened Tiếp tế nước và thực phẩm Cồn Cỏ for 21 bottles and 16 noodle packs. Guest declaration 9dfe7257-47b7-4535-b32e-f3323d8ce399 was received. First/independent counting, stock posting, commitments, distribution, handover and final SOS closure have not been executed. Do not describe the paused scenario as complete. No guest tracking capability or password is stored in this note.

## Compact campaign search and persistent SOS actions

The owner supplied updated coord1 credentials; authentication succeeded. The campaign lookup is now a single 360 x 42 CSS-pixel input without the large helper panel. Suggestions remain in a floating scrollable list. Panel search for Con Co returned suggestions and selection worked.

Authority referral moved into the SOS header beside the code, outside tab panels, retaining claim ownership and version checks. Campaign detach moved into a separate compact campaign context row. On C48CAM00A03, panel checks across Overview, Dispatch and History retained the action's header-relative position; History and Overview both measured x=548.95, y=0 at the current zoom. Final reload and screenshot verified the outlined referral action, campaign name and detach placement. No referral, detach or rescue command was submitted during these layout checks. TypeScript and whitespace checks passed.

## Integration with latest main

Local UI changes were stashed, main was fast-forwarded to 6e5fcd8, and the stash was reapplied without conflicts. The upstream sub-coordinator and automated supply-request implementation takes precedence over the historical distribution scenario above. The current combined frontend passed npm run build --prefix frontend/web and six existing sub-coordinator/supply-model unit tests via node --test --test-isolation=none. No end-to-end scenario was rerun after this integration.
