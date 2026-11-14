# Frontend Web feedback — 2026-11-03

Scope: static review of `frontend/web/src` (shell in `main.tsx`, `api/client.ts`, `app/catalog.ts`, and the Coordinator, Volunteer, Operations, Admin, Citizen features). Findings come from reading the code. I did not run the app in a browser, so each item notes how to reproduce it. Priorities: **P1** blocks the user or loses data, **P2** wrong behaviour or bad UX, **P3** polish.

## 1. Bugs

### P1-1. Logout fails once the access token has expired, so the user is stuck signed in
- `auth/session.ts` `logout()` calls `POST /auth/logout` with `retryAuth: false`, and the backend guards it with `IdentitySessionGuard`.
- When the access cookie has expired, the call returns 401, `signOut()` in `main.tsx` goes to `catch`, and the UI only shows "logoutError". `setUser(null)` is never called.
- The refresh cookie is still valid but never used, so every later logout click fails the same way. The only way out is to clear cookies by hand.
- Fix: on any logout result (401, 403, `CSRF_INVALID`, network error) clear local state and go to guest. Make a best-effort server call, try `refresh()` once first if you want server-side revocation, and never block the UI on the server.

### P1-2. No global handling of an expired session
- `api()` throws after a failed refresh. No component catches `SESSION_EXPIRED`, `UNAUTHENTICATED` or `REFRESH_REUSED`.
- The user stays on a signed-in screen (name and role badge visible) while every list shows a red error. Examples: the Coordinator queue polls every 20 s and shows an error banner each time; the GPS sharing timer in `App` keeps firing.
- Fix: one session-expired event from `client.ts` (for example `window.dispatchEvent(new Event('c48:session-expired'))`). `App` listens, clears `user`, stops `sharingTeamId`, and opens the login dialog with the message "Phiên đã hết hạn".

### P1-3. "Xem thêm" replaces the list instead of appending, and there is no way back
Affected: `LivePage` (`main.tsx`, which also calls `setData(null)` on every fetch, so the list blanks), `Coordinator` queue, `Admin`, `Operations`, `Campaigns`, `Volunteer` (`Notices` and the missions/team list). All of them do `setItems(value.items)` when the cursor changes.
- Press "Xem thêm" on the SOS queue: the first 50 rows disappear and are replaced by rows 51–100. There is no "Quay lại", and changing a filter is the only way to return.
- `CitizenAccount.tsx` already does it correctly (append plus dedupe by id). Reuse that pattern in one shared `useCursorList` hook.
- The Coordinator also polls with `setRevision` every 20 s. After a refresh with a cursor set, the list silently shows only the second page.

### P1-4. Dropdown reference data only loads the first page
- `Operations.tsx` (~L100–140) loads `/organizations`, `/warehouses`, `/donation-drives`, `/items`, `/campaigns`, `/relief-points`, `/vehicles` and `/requests` once with no `limit` or `cursor`. Backend default page size is 50.
- Anything beyond 50 items is missing from the selects, so users cannot pick a warehouse, item or SOS. `Campaigns.tsx` and `Coordinator.tsx` already loop with `limit=100`.
- `ReceiptCountForm.tsx` reads `/items?status=ACTIVE&limit=100` once and drops item 101 onwards.
- `Dashboard.tsx` requests `stock-summary?limit=10`, so the stock overview is silently truncated with no hint. The reconciliation and fulfillment reports have the same problem.
- Fix: a shared `fetchAll()` for reference lists, or a searchable async select. Show "Hiển thị 10/…" when truncating on purpose.

### P1-5. Operations loads 8 API calls on every tab change
- `main.tsx` mounts `<Operations key={selected.id}>`, so each tab switch remounts it and re-runs the 8-request `Promise.allSettled`.
- It includes `/requests` on the Response service. Roles without a coordinator grant (intake staff, reviewer, distribution staff) always get a 403, which is wasted load and noisy in logs.
- Fix: hoist the reference cache above the tab (context or a module-level cache with a short TTL), and only fetch the sources the current page needs.

### P2-6. Free-text IDs in report filters
- Operations → Đối soát: "Mã kho cần đối soát" is plain `<input>` fields. Users have to paste a UUID, and the page stays empty with "Nhập bộ lọc bắt buộc…" until they do. The warehouse list is already loaded, so use a `<select>`, default to the first entry and load immediately.

### P2-7. Reverse geocoding sends victim coordinates to a third party
- `Coordinator.tsx` ~L149 calls `https://photon.komoot.io/reverse?lat=…&lon=…` from the browser for every SOS. This contradicts the privacy wording on the map page ("không hiển thị vị trí nạn nhân công khai") and the backend ownership model. It also has no timeout, rate limit or fallback beyond "Chưa tìm được địa chỉ".
- Fix: do reverse geocoding on the backend, or store the address from the form (`LocationPicker` already has one), or at least document this as a deliberate exception.

### P2-8. Stale state after sign-out and role changes
- `signOut()` does not reset `selectedTrackingCode`, `selectedMissionId`, `showPasswordModal` or `sharingMessage`. After logout and login as another user, the Tracking page can open on the previous user's code.
- `changeWorkspace()` and `changePage()` in `signOut` use closures over the old `user`.
- Fix: put the app state in a reducer with a single `resetSession()`.

### P2-9. `Operations` clears the list before each fetch
- `setItems([])` runs before every request, so lists flash empty on each filter change or 20 s revision. The Coordinator does not do this, so behaviour differs. Keep the previous rows until the response arrives and show a thin loading bar instead.

### P3-10. Dead and duplicate code paths
- `main.tsx` routes `queue`, `verify`, `triage` and `assign`, but `catalog.ts` only defines `queue` for the coordinator.
- `LivePage` still renders generic `RecordCard` lists for `/users`, `/requests` and `/missions/mine`, although dedicated screens now exist. Check which pages still reach it and remove the rest.
- Two near-identical Google/auth paths and two copies of the heatmap clustering maths (`HeatmapPanel.tsx` ~L180 and ~L265).
- `main.tsx` is 1,650 lines, with auth modal, shell, LivePage and Tracking together. Split it, or the next change will hit merge conflicts.

## 2. Navigation: too many tabs and steps

Current menu size per role, plus sub-tabs inside pages:

| Role | Sidebar items | Extra sub-tabs inside pages |
|---|---|---|
| Citizen | 4 (+ account) | none |
| Volunteer | 4 | notice filter (2) |
| Coordinator | 6 | queue lanes (2–3), map scope switch, heatmap layers |
| Operations | **11** | asset tabs (3), review tabs (2), report tabs (3) |
| Admin | 6 | audit type select |

Problems:
1. **Duplicate pages.** Admin "Tổng quan", "Người dùng" and "Phân quyền" all call `GET /users` and render the same list. Volunteer "Tổng quan" and "Nhiệm vụ" both call `/missions/mine`. Operations "Phân phối" and "Bàn giao" both use `/distributions`. Merge each group into one page.
2. **Operations has 11 entries.** Suggested grouping, which keeps the same screens:
   - *Việc cần làm* (dashboard plus the pending-review and pending-intake counts)
   - *Quyên góp* (campaigns, drives, intake, review as tabs on one page)
   - *Kho và vật tư* (stock, assets, needs)
   - *Phân phối* (distribution and handoff as steps in one detail view)
   - *Báo cáo* (stock, fulfillment, reconciliation)
   This gives 5 items, and AGENTS.md says donations and Logistics should stay a short optional demo.
3. **Two navigation levels for the same thing.** "Xem theo vai trò" buttons at the top of the sidebar switch workspace, and the list below changes entirely. A user with two roles has to learn both. A single grouped menu (role as a section header) or a role dropdown in the topbar would be simpler.
4. **"Tài khoản" is hidden** in the profile menu while "Đổi mật khẩu" is another click inside it. "Đăng xuất" is two clicks away (avatar, then menu). Keep logout visible at the bottom of the sidebar.
5. **The core flow takes too many steps.** Coordinator: Xử lý SOS → choose a row → read the detail panel → verify → set priority → open candidates → assign, with the lane, status and overdue filters on top. Show the next action as one primary button per request state ("Xác minh", "Đặt ưu tiên", "Giao đội") and hide the rest.
6. **Citizen "Gửi yêu cầu SOS" is the home page but also an emergency form**, while "Theo dõi SOS" asks for code and secret as free text for guests. Offer "Dán liên kết theo dõi" or auto-fill from the last submission (local state already holds it).
7. The emergency bar (113/114/115) is shown on every page for every role, including admin and operations. Show it only in the citizen workspace.

## 3. UI consistency and visual quality

- **Four stylesheets layered on one another**: `style.css` (987 lines), `refinements.css` (1,209), `workflow.css` (770), `sos.css` (374). `refinements.css` overrides earlier rules, which is why spacing, card radius and button sizes differ between pages. Consolidate into tokens (colour, spacing, radius, type scale) and delete overrides.
- **Inline styles** remain in `main.tsx` (4), `LocationPicker.tsx` (9), `Volunteer.tsx` (2), `Donations.tsx` (3), including `style={{ cursor: 'pointer' }}` on non-button elements in `Volunteer.tsx` ~L558 and ~L592. Clickable non-buttons break keyboard use. Use `<button>` or add `role`, `tabIndex` and key handlers.
- **Inconsistent patterns for the same job:**
  - detail views: `DetailSurface` (modal on review, side panel elsewhere), `DetailPanel`, `PublicCampaignDialog` and `confirmAction` (hand-built DOM dialog);
  - "load more" label: "Xem thêm", "Xem thêm yêu cầu";
  - list loading: "Đang tải…" text, skeleton nowhere;
  - the generic fallback error says "Yêu cầu chưa hoàn tất" in some places and "Không thể tải…" in others.
  Pick one detail pattern, one load-more component, and one loading/empty/error component.
- **Raw identifiers shown to users**: Operations labels fall back to `Mã …${id.slice(-8)}`, queue items show `priority` as a raw code, and `donation-drives` show `intake_warehouse_id` as a label. Map every code and identifier to Vietnamese text or hide it.
- **Heatmap** and Coordinator screens each define their own buttons/tabs (`heatmap-layer-tabs`, `map-scope-switch`, `queue-review-tabs`), so there are three tab styles in one workspace.
- `confirmAction` builds DOM by hand, outside React, with no focus trap and no Escape handling beyond `cancel`. It works but is a third modal system next to the React ones.
- `ContentErrorBoundary` says "Trang có thể vừa được cập nhật" for every crash, which hides real bugs. Log the error and show a reference code.

## 4. Smaller issues worth a ticket
- Auth dialog: the Escape key handler calls `onClose` even while a request is `busy`, so the user can close the dialog mid-login and end up logged in with no UI update.
- `refresh()` in `client.ts` rejects with `REFRESH_RACE` on a second tab. The caller just shows the error instead of retrying after a short delay.
- Upload (`upload()`) does not set `Content-Type` (correct), but it also has no progress, size pre-check or cancel; the Volunteer form checks size, the Citizen SOS form should too.
- The bundle is one chunk above 500 kB (known from the 2026-10-21 audit). Lazy loading is used for features but not for the map libraries; split them.

## 5. Suggested order of work
1. P1-1, P1-2: logout and global session expiry (small, most visible).
2. P1-3: shared `useCursorList` + one "Xem thêm" component, then replace the six copies.
3. P1-4, P1-5, P2-6: shared reference-data loader and selects for report filters.
4. Navigation merge (section 2.1, 2.2, 2.4, 2.7), because it removes whole pages.
5. CSS consolidation and component unification (section 3).

## 6. What I did not check
- No browser run, so spacing, colours and responsive behaviour are judged from CSS and markup only.
- Backend pagination shape was read from the services: Identity returns `next_cursor` (no `more`), Response returns `more` + `cursor`, Logistics is mixed. The FE already tolerates both in `Operations` and `LivePage`, but the other screens each assume one shape.
- Mobile app is out of scope here.
