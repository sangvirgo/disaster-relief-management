# Sub-coordinator workspace and compact team views — 28 November 2026

## Implemented scope

Primarily frontend. The follow-up history refinement adds optional read-only Response history filters; no grants, migrations, stock accounting, verification rules or automatic dispatch changes.

- Campaign selection now uses a full-width map by default. Selecting a map marker or campaign name opens one campaign detail panel with scope-appropriate engage/open actions. Closing the panel expands the map again. The former column of large cards is replaced by a compact, paginated comparison table below the map. Search and filters apply to the map, table and suggested campaign together.
- The sub-coordinator has three clear work areas: campaign selection, SOS processing and history. Duplicate headings, repeated refresh controls and large session cards were reduced. Active campaigns have quick return buttons, a workspace switcher and an expiry indicator; disengaging asks for confirmation.
- Switching campaigns clears the prior SOS and detail tab. The selected campaign survives reload. Entry links resolve their campaign through the existing scoped request API before opening details; they never grant or engage a campaign automatically. Returning to the queue clears the entry request so changing tabs does not reopen it.
- Sub-coordinators no longer see global team-readiness or team-position editing controls. Empty dispatch results explain who can update the team and provide an in-place retry. Closing/cancelling a SOS is folded while rescue work is pending; existing completion and ownership guards remain authoritative.
- Campaign history uses the shared page size (10) and pager instead of 30/50 event pages or an accumulating load-more list. Timeline rows are compact and longer notes can be expanded. The sub-coordinator reuses the same campaign/session history view.
- Team location controls use a compact sharing bar, an always-open map without a redundant hide toggle, aligned status information and a clear save area. The team-management badge sits beside the pause button. Citizen SOS map sizing is unchanged.
- Notice references no longer display identical first-eight-character UUID prefixes. A real tracking code is displayed when supplied; mission references use the same distinguishable trailing-id convention as mission lists.
- Dashboard campaign totals do not shrink or wrap their numeric values. Labels may wrap. Verified that `10`, `21` and `17` remain intact at 320px viewport width.

## Verification performed

- Web unit suite: 83 passing tests, including three campaign-switching URL regressions (different campaign, same campaign, last campaign removed).
- Web TypeScript/Vite build passed; `git diff --check` passed. No backend changes were made for this task.
- Browser on localhost:5174 using local synthetic accounts/data: campaign search with matches and no matches; engage/open two campaigns; switch via picker; claim/release an existing SOS; empty dispatch and retry; history and own sessions; reload preserving campaign, SOS and detail tab; resolve an entry link whose saved campaign differs from the SOS campaign.
- Map workflow: select marker, display the correct campaign, close details and regain full width, select a compact table row, and open that campaign's queue from the detail panel.
- Browser measurements at desktop: map width equals frame width with no selection; with a selection, map and detail panel share the frame. Responsive checks at 390px and 320px found no page-wide horizontal overflow; the comparison table scrolls within its own region.
- Team view: management badge and pause button have the same vertical center. Location search returns Nghi Loc suggestions; mobile location map remains present without page-wide overflow. History next/previous pages were exercised.
- Local demo mutations: started short-lived engagements for coord2 in Ho Chi Minh City and Da Nang; claimed then released a seeded SOS. No new role grants, production requests, rescue dispatches, verification decisions or inventory mutations were performed in this UI pass.

Full rescue completion, GPS permission acquisition, and expired-session fault injection were not repeated in this UI pass. These results do not claim that every backend workflow was rerun.


## Meaningful campaign history follow-up

- Default web view is Milestones: verified/triaged requests, priority changes (including reductions), supplements and review, referrals, takeover, rescue mission transitions and resolution outcomes.
- Receipt/attribution, routine coordination sessions and technical events remain available under Full. No audit records are modified or deleted.
- Optional Response query parameters: view=full|milestones (API default full for compatibility), kind=sos|mission|coordination. Both filter before keyset pagination. Cursors are bound to filters and caller/campaign scope.
- Milestones uses canonical mission_event transitions rather than duplicate request-level mission aggregate events; distinct missions and legitimate repeated transitions are preserved.
- Backend change is limited to the history read query, validated DTO, controller and OpenAPI contract. Existing history access guards remain unchanged.
- Local Response Docker image rebuilt and service healthy. On 5174, coord2 HCM history shows a priority decision under Milestones; Full retains ten raw events per page. Full page 2 -> Milestones returns to the filtered first page without cursor errors. A campaign without decisions shows an honest empty state without pagination.
- Checks: Response history service suite 11 passed; OpenAPI script suite 39 passed; contracts check 225 operations validated; backend ESLint passed; full FE suite 83 passed; FE TypeScript/Vite build passed. No production mutation or push in this follow-up.

## Scope guidance and final interface pass

- Replaced the collapsed role-specific description with an always-visible shared CampaignScopeNotice. Self-selected campaign coordinators see the three-engagement scope; explicitly assigned campaign coordinators see their assigned-campaign scope. No permission or role-code changes.
- Grouped quick-return actions on a subtle background and aligned the workflow caption, session count and refresh action. Guidance uses a compact information card with primary capabilities and secondary ownership text.
- Replaced the user-facing median-response label with Vietnamese wording describing the time until a team accepts. The metric and API field are unchanged; its title explains the measurement and midpoint meaning.
- Verified direct guidance and the renamed statistic on local 5174 after reload, then visually checked the campaign-selection layout. Full Web tests: 83 passed; TypeScript/Vite production build passed.
- Full backend `npm test` on Windows: Jest 170 suites / 1,127 tests passed, 8 tests skipped. Script/deployment suite: 109 passed, 48 failed from existing Windows path/Bash/symlink compatibility failures (including doubled drive prefixes). Linux CI must verify this suite; these failures are not reported as passing. Backend ESLint and the 225-operation contract check passed.
