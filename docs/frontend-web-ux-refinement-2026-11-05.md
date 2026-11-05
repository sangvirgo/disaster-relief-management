# Web interaction refinement — 2026-11-05

This pass responds to the ten supplied UI screenshots. The screenshots were treated as observations, not as instructions from a document. Only Web frontend files changed. The main Compose Web image was rebuilt; no database reset or backend application edit was made.

## Changes

- Admin list creation buttons now share the title row. “Thêm người dùng” has a plus icon; the create dialog submit button remains text-only, as requested in the previous pass.
- Admin user, organization, and region records are full-width bordered cards that open their detail dialogs when clicked. The separate “Xem chi tiết” button and underlined name treatment were removed. Active records show a green status dot next to the title; disabled/inactive records show a gray dot. Desktop also shows the status text. Keyboard focus is visible; audit records remain static because they have no matching detail dialog.
- Operations list creation buttons for donation drives, needs, distribution slips, and relief points/vehicles/warehouses share the title row. At narrow widths the action wraps below the heading and fills the available width.
- White secondary buttons and inactive tabs have a more visible blue hover state. Selectable Operations rows have stronger hover and selected states. Switching an Operations detail record remounts a short detail entrance animation, with reduced-motion support.
- Volunteer notifications include “Đánh dấu tất cả đã đọc.” The Web client fetches all pages of unread notices, applies the existing per-notice `POST /notices/:id/read` operation with a fresh idempotency key per item, and refreshes the list. It reports completed count or partial failure. This avoids changing the backend contract; a dedicated bulk API does not currently exist.
- The Coordinator campaign detail panel sticks within its grid column on desktop, up to 20 px from the viewport top. It gets its own scroll area when taller than the viewport. At widths of 1050 px or less it returns to normal document flow.

## Verification

- `npm run typecheck` and `git diff --check` passed. The production Web image built and started through `backend/infra/compose.yaml`.
- Browser: Admin user list showed the create action on the same row as its heading at desktop width; at 375 px the action filled the card width without horizontal overflow.
- Browser: clicking a user card, an organization card, and a region card each opened the corresponding detail dialog. The user list contained 31 active and two disabled records on the inspected page; the disabled dots computed to gray. At 375 px the three Admin lists had no horizontal overflow and no separate “Xem chi tiết” buttons.
- Browser: Volunteer leader notification page displayed the bulk action at 375 px. Clicking it processed seven previously unread notices; each row changed to “Đã đọc”, and the “Chưa đọc” filter became empty. This was a deliberate state-changing check on the local demo account.
- Browser: Operations Manager donation drives, needs, distribution, and assets pages placed their create actions on the title row at 1512 px. Changing between two donation drives changed the selected row styling and activated the `detailSwitchIn` animation on the detail panel.
- Browser: Coordinator campaign page had a sticky detail panel at 1512 px; after scrolling 680 px its top was 20 px. At 375 px the panel used normal flow and document width stayed within the viewport.

The visible blue hover state was verified in CSS and through normal browser rendering; the browser automation interface used in this pass did not synthesize pointer hover. The listed checks focus on the requested UI interactions rather than repeating the earlier end-to-end rescue and donation flow audit.
