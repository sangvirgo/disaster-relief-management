# C48 Web design system — initial visual direction

## Product and source of truth

Emergency Response and Disaster Relief Management System, web frontend only. Five audience workspaces: Citizen, Volunteer/Rescue Team, Coordinator, Operations Manager, Administrator. Mobile app is developed separately. The web must work well on desktop and phone browsers. Current backend is three NestJS services: Identity, Response, Logistics. Use API contracts as behavior source. All visible copy is Vietnamese.

The Figma reference is the coordinator page “Xác Minh SOS & Điều Phối Đội Cứu Hộ”, node 0:3 of file `0odUVYiPvYyRqvxGYgcWms`. It demonstrates a left navigation, SOS queue, request facts, candidate teams, and explicit coordinator confirmation. Retain its information architecture and human decision boundary, but soften its heavy red palette and simplify dense panels on smaller screens.

Style source: Superdesign `mosaic-grid-architecture-style`, adapted for an emergency service. Borrow restrained structure, neutral surfaces, and thin dividers. Operational readability and calmness take precedence.

## Visual foundations

- Font: `Inter` or a comparable Vietnamese-capable sans-serif for all UI text. No decorative display or monospaced body typography. Body 16px/1.5 on mobile, 15–16px on desktop; headings 22–32px.
- Colors: warm off-white `#F7F8F5` background; white `#FFFFFF` surfaces; calm blue `#315F77` primary action; deep blue `#244B5F` heading and selected text; pale blue `#EAF3F8` feature surfaces; slate `#304350` body text; muted slate `#637682` secondary text; border `#DCE5E3`. Sidebar is pale sky blue `#EAF2F6`, subtly different from the page background. Selected navigation uses muted blue `#D1E5EF` and a narrow blue indicator `#578BA3`. Never use red as the selected navigation color.
- Status: information blue `#3C6E9A`; caution amber `#B77723`; danger muted coral `#B94F4A`, used for real danger/urgent markers only. Never flood panels or navigation with red.
- Contrast: at least WCAG AA for normal text; status never encoded by color alone. Pair color with Vietnamese text and an icon.
- Spacing: 4px base scale; content cards 16–24px padding; 12px minimum gaps between controls; 44px minimum touch targets.
- Shape: 10–14px cards and controls, subtle 1px borders, very light shadow only when needed for separation. Avoid aggressive gradients and pulsing alerts.
- Iconography: use locally authored SVG image assets in `frontend/prototype/assets/icons/` for the navigation, with a clear pictogram matched to each workflow. Light sky, mint, and warm sand fills give the small illustrations depth without visual noise. Do not use Unicode symbols, emoji, or an icon font in the sidebar. Navigation labels remain visible and accessible.
- Motion: short 150–200ms state transitions, respect reduced motion. No flashing urgency animation.

## Responsive layouts

- Desktop >= 1200px: role shell with left navigation. Coordinator can use queue + detail + team comparison, but columns remain resizable or allow scroll without truncating critical data.
- Tablet 768–1199px: collapsible navigation, queue/detail split or tabbed third panel.
- Mobile <= 767px: single-column task flow, bottom navigation for the highest-frequency destinations, sticky primary action, progressive disclosure, large tap targets, map as an optional focused view rather than a mandatory background.
- SOS intake must work with one hand on a phone. Location offers “Dùng vị trí hiện tại” and “Chọn vị trí trên bản đồ/nhập địa chỉ mô tả”; proxy reports must use the affected household location, not the reporter location.
- Present network errors, saved draft state, submission acknowledgment, and retry truthfully. An unsent draft must never look server-received.

## Key screen families

1. Citizen: home, SOS method choice, structured SOS form, quick-message draft and extraction review, submission acknowledgment, tracking, campaigns, donation drives, donation declaration and progress.
2. Volunteer/Rescue: personal mission list/detail, accept/decline, progress, evidence, team profile/availability/position for eligible leaders.
3. Coordinator: scoped SOS queue, verification/detail/duplicate review, priority decision, team comparison and mission assignment, map, campaigns, notices.
4. Operations Manager: campaigns and donation drives, catalog/assets/stock, intake review with separate staff authority, needs/commitments, distributions/handoffs, reports/reconciliation.
5. Administrator: users, organizations, memberships, grants, regions, audit. No SOS victim or donor detail by default.

## SOS interface rules

- Let a user choose “Điền biểu mẫu” or “Viết tin nhắn nhanh”. Both converge on the same editable review form before submit.
- Quick-message extraction is optional and must label missing/uncertain fields. Never invent location, headcount, contact information, or danger claims. Preserve the original message in the visible review flow.
- Show reporter and affected-person details separately. Proxy reporting requires a signed-in account under current backend contract.
- Any displayed severity score or urgency suggestion is advisory. The citizen does not set official P1–P4; coordinator verification and triage remain separate human steps. If no scoring API exists, a concept prototype must clearly mark the suggestion as illustrative and never save it as official priority.
- SOS acknowledgment states the server received the request only after successful API response, shows tracking code and safe recovery guidance. Guest capability secret is presented once and never placed in analytics or logs.

## Content tone

Plain, reassuring Vietnamese. Say what happened and what the person can do next. Reserve urgent copy for immediate danger and emergency call guidance. Avoid gamified scores, alarming animations, and claims that AI has verified or dispatched help.
