# Reliva Web UI Rules (binding, agent-executable)

Applies to `frontend/web`. Written for an implementing agent (Codex) and human reviewers. Read it fully before touching any file. Words MUST / MUST NOT are binding; anything not specified here is "keep what exists, do not invent".

Basis: static review of `frontend/web/src` on 2026-11-12. The app was not run (no browser/backend in the review environment), so the agent MUST view real screens itself (Section 12) and fix anything this document could not see.

Goal: a calm, clean, premium-feeling emergency-operations UI, visually identical in spirit to the Mobile app (`mobile/src/constants/theme.ts`), where every screen is built from the same few parts, aligned on the same grid, with no one-off styling.

Hard boundaries (`AGENTS.md`): this is a RESTYLE. Do NOT change API calls, request bodies, state transitions, permissions, ownership guards, idempotency, route/page ids, or Vietnamese wording meaning. All user-facing text stays Vietnamese. Prioritise SOS -> verification/priority -> assignment/progress -> resolution screens; Donations/Logistics only need to be consistent, not expanded.

---

## 1. Verified current state (do not re-discover; fix these)

| # | Fact (verified in code) | Consequence |
|---|---|---|
| F1 | Four stylesheets imported in `main.tsx` in this order: `style.css`(1051 lines), `sos.css`(380), `workflow.css`(898), `refinements.css`(1451). The last is a patch layer that overrides the others (e.g. `.button.secondary:hover` is redefined at `refinements.css:1415`). | Cascade conflicts; fixes must land in one place. |
| F2 | `:root` tokens exist (`--color-*`, `--radius-*`, `--shadow-*`, `--font-family`) and match Mobile `THEME`, but are bypassed: raw hex count `style.css` 53, `sos.css` 16, `workflow.css` 67, `refinements.css` 213. Many off-palette blues (`#8bb8ff #93c5fd #8cb2f2 #e8f1ff #eaf2ff #f8fbff #dce5f0 #174c9b #dbeafe`). | Colour drift. |
| F3 | 25+ font sizes; most used is 13px (39x), then 12 (28), 14 (22). Also `.83 .84 .87 .88 .9rem`, three `clamp()`. No spacing scale (gap 4,6,7,8,10,12,14,16,20; many odd paddings). Radius mix 8/10/12/14/16/50%/999px, and literal `12px` x23 beside `var(--radius-md)`. | No rhythm. |
| F4 | ~77 `box-shadow` declarations (`refinements` 41, `workflow` 17, `style` 15, `sos` 4), including coloured glows and `0 28px 70px #0b254455`. `.button:hover` moves `translateY(-2px)`. | Noisy, jumpy. |
| F5 | **Four unrelated badge systems:** `.priority-badge` (`PriorityBadge.tsx`), `.chip.status-badge-*` (`StatusBadge.tsx`; tone map covers only logistics statuses), `.queue-status-chip[data-status]` (`workflow.css` ~L380-450, 15 selectors), plus `.admin-status-badge`, `.admin-version-badge`, `.guest-badge`, `.user-role-badge`. | Same status looks different per screen. |
| F6 | Current priority colours: P1 red (`#fef2f2/#991b1b`), P2 orange (`#fff7ed/#9a3412`), P3 yellow (`#fefce8/#854d0e`), P4 blue (`#eff6ff/#1e40af`). Keep this mapping (it matches the urgency scale), but move values into tokens. | |
| F7 | Modal/overlay implementations: `.modal-card` (+`.auth-modal-card`), `DetailSurface` `<dialog class="record-detail-dialog">`, `confirmAction.ts` building `<dialog class="action-confirm-dialog">` imperatively. Three looks. | One `Dialog` look. |
| F8 | Loading is a bare `<p role="status">Đang tải…</p>` in ~40 places; empty is a bare `<div class="empty">` text; no skeletons, no icons, no retry. | Pages feel unfinished. |
| F9 | Page title is rendered once in `main.tsx` (`.heading` > `h1` + `.eyebrow` + `p`, ~L1961). Topbar already shows breadcrumb `Workspace / Page`. Page actions are NOT part of the heading; each feature invents its own action row (`section-header`, `list-action-header`...). | Header actions inconsistent. |
| F10 | `.tabs` is already used consistently (8 places) and is the right base. 15+ card-like classes (`card`, `record`, `*-card`, `*-panel`, `notice`, `queue-row`...) each set their own padding/border/radius. | Collapse into one Card. |
| F11 | 17 distinct `@media` widths (380...1181). Inline `style={{}}`: 4 in `main.tsx`, 4 in `Donations.tsx`. Giant files: `main.tsx` 2094, `Coordinator.tsx` 1940, `Operations.tsx` 1543, `Donations.tsx` 1049. | |
| F12 | Existing good parts to keep: global `:focus-visible` ring, `prefers-reduced-motion` blocks, sticky sidebar, light sidebar with blue active item, Plus Jakarta Sans, `DetailSurface` open/close behaviour, `confirmAction` promise API. | Do not regress. |

---

## 2. Visual direction ("what it should feel like")

- **Light, airy, trustworthy.** Page background slate-50, content on white cards with a hairline border, generous whitespace, one blue accent. Think modern SaaS ops console, not a form dump.
- **Colour means something.** Blue = action/selection. Red = emergency/P1/destructive only. Amber = needs attention. Green = done. Everything else is neutral slate. No decorative colour, no gradients, no coloured shadows, no emoji.
- **Hierarchy by weight and size, not by colour or boxes.** Titles bold, values medium, labels regular-secondary. Group with whitespace and hairline dividers instead of nested bordered boxes.
- **Quiet motion.** Colour/shadow fades 150 ms. Nothing moves on hover. Dialogs fade in.
- **Alignment is the beauty.** Everything sits on a 4 px grid; left edges line up; cards in a row are equal height; icons and text share baselines; numbers use tabular figures.

---

## 3. Tokens (create `src/styles/tokens.css`; this is the ONLY place raw values exist)

Keep every existing token name working (alias old -> new) so migration can be incremental, then delete aliases when done. Do not add hues.

```css
:root {
  /* colour: keep existing values, add only the missing neutral steps */
  --color-primary:#2563eb; --color-primary-dark:#1d4ed8; --color-primary-bg:#eff6ff; --color-primary-border:#bfdbfe;
  --color-emergency:#dc2626; --color-emergency-dark:#991b1b; --color-emergency-bg:#fef2f2; --color-emergency-border:#fecaca;
  --color-warning:#f59e0b;   --color-warning-dark:#b45309;   --color-warning-bg:#fffbeb;   --color-warning-border:#fde68a;
  --color-success:#10b981;   --color-success-dark:#047857;   --color-success-bg:#ecfdf5;   --color-success-border:#a7f3d0;
  --color-surface-bg:#f8fafc; --color-surface-card:#ffffff; --color-surface-subtle:#f1f5f9; /* new: table header, hover, disabled */
  --color-surface-border:#e2e8f0; --color-surface-divider:#cbd5e1;
  --color-text-primary:#0f172a; --color-text-secondary:#475569; --color-text-muted:#64748b; /* changed from #94a3b8, see rule C3 */
  --color-text-placeholder:#94a3b8; /* placeholders and disabled only */
  --color-text-inverse:#ffffff;
  --color-overlay:rgba(15,23,42,.45);
  /* priority (keep current look) */
  --priority-p1-bg:#fef2f2; --priority-p1-border:#fca5a5; --priority-p1-text:#991b1b;
  --priority-p2-bg:#fff7ed; --priority-p2-border:#fdba74; --priority-p2-text:#9a3412;
  --priority-p3-bg:#fefce8; --priority-p3-border:#facc15; --priority-p3-text:#854d0e;
  --priority-p4-bg:#eff6ff; --priority-p4-border:#93c5fd; --priority-p4-text:#1e40af;
  /* type */
  --font-family:'Plus Jakarta Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  --text-caption:12px/16px; --text-body:14px/20px; --text-subtitle:16px/24px; --text-title:20px/28px; --text-page:24px/32px; --text-display:32px/40px;
  /* space (4px grid) */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px; --space-7:48px;
  /* shape */
  --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-full:9999px;
  --shadow-sm:0 1px 2px rgba(15,23,42,.06);
  --shadow-md:0 4px 12px rgba(15,23,42,.08);
  --shadow-lg:0 16px 40px rgba(15,23,42,.16);
  --shadow-emergency:0 4px 14px rgba(220,38,38,.35); /* SOS submit only */
  /* motion, layers, sizes */
  --ease:150ms ease;
  --z-sticky:10; --z-drawer:40; --z-modal:50; --z-toast:60; --z-popover:70;
  --control-h:40px; --control-h-sm:32px; --control-h-lg:48px;
  --sidebar-w:272px; --content-max:1280px;
}
```

Rules:
- **C1** No raw hex/`rgb()/rgba()` outside `tokens.css` (exceptions: map marker SVG, brand logo files).
- **C2** No new colour. If a needed shade is missing, use the nearest token. The off-palette blues in F2 map to: any light blue fill -> `--color-primary-bg`; light blue border -> `--color-primary-border`; blue text -> `--color-primary-dark`.
- **C3** `#94a3b8` on white is 2.6:1 (fails AA). Real information (timestamps, labels, counts, helper text) MUST use `--color-text-secondary` or `--color-text-muted` (#64748b, 4.8:1). Only placeholders and disabled use `--color-text-placeholder`.
- **C4** Typography: only the six sizes above. Weights only 400, 500, 600, 700 (no 800). `line-height` as listed (Vietnamese diacritics need it). Delete every other `font-size` (incl. `rem`, `clamp`). Letter-spacing 0, except brand wordmark `-0.01em`. `font-variant-numeric: tabular-nums` on numbers in tables, KPIs and timers.
- **S1** Spacing only from `--space-*`. Replace 6/7/10/14/18/20 with the nearest step (6,7->8; 10->8 or 12 by context; 14->16; 18,20->16 or 24).
- **R1** Radius only `--radius-sm|md|lg|full`. Controls and badges-rect 8, cards/rows/notices 12, dialogs/drawers 16, avatars/dots/pills full.
- **SH1** Shadow only the four tokens. Cards `--shadow-sm` or none; popover/menu `--shadow-md`; dialog/drawer `--shadow-lg`; SOS submit `--shadow-emergency`. No inset, glow, coloured or custom shadows.
- **M1** Transitions only `background-color, border-color, color, box-shadow, opacity` at `--ease`. NO `transform` on hover/active for buttons, cards or rows. Dialog open: opacity .18s. Keep `prefers-reduced-motion` neutralising everything.
- **B1** Breakpoints (mobile-first, `min-width`): `720px` (tablet), `1080px` (desktop, sidebar becomes permanent), `1440px` (wide). Replace all 17 existing values. The sidebar is an off-canvas drawer below 1080.
- **Z1** z-index only from tokens.
- No dark mode, no gradients (including `auth-modal-card`'s), no `backdrop-filter`.

---

## 4. Layout system

```
┌ sidebar 272 ┬ topbar (56 high, sticky, white, bottom hairline) ──────────────┐
│ brand       │ ☰  Workspace / Page                          [profile ▾]       │
│ workspace   ├────────────────────────────────────────────────────────────────┤
│ switch      │ [emergency-bar: citizen workspace only, 40 high]               │
│ nav groups  │ content: padding 32 (24 <1080, 16 <720), max-width 1280, centred│
│ …           │   PageHeader                                                    │
│ profile     │   (gap 24)                                                      │
│             │   page body: 12-col grid, gap 24                                │
└─────────────┴────────────────────────────────────────────────────────────────┘
```

- **L1 PageHeader (new shared component, replaces `.heading`).** Left: optional eyebrow (12/600 primary, only for SOS/tracking public pages), `h1` (`--text-page`, 700, margin 0), description (14/20 secondary, max 720). Right: `actions` slot, vertically aligned with the title block, `gap 8`, wraps below 720 with primary button full width. Exactly ONE primary button per page header; max two secondary. Features pass actions into PageHeader instead of building their own `section-header` row at the top of the page. Bottom margin 24.
- **L2** `section-header` inside a card = card header (title 16/24 700, right actions), never a page-level header.
- **L3 Page body patterns (use only these):**
  1. *Queue + detail* (Coordinator requests, Volunteer missions, Operations lists): grid `minmax(0,7fr) minmax(0,5fr)`, gap 24, detail card sticky `top: 72px`, `max-height: calc(100dvh - 96px)` own scroll. Below 1080: single column; selecting an item opens the detail in the shared Drawer (full width <720).
  2. *Dashboard*: KPI row `repeat(auto-fit, minmax(220px,1fr))` gap 16, then 2-column card grid (`repeat(2,minmax(0,1fr))`, gap 24), 1 column <1080.
  3. *Form page*: one column `max-width: 640`, or two columns `minmax(0,1fr) 320px` where the right column is a sticky summary/help card. Centre-aligned inside content only for SOS/auth/tracking.
- **L4** Cards in one grid row MUST stretch to equal height (`align-items: stretch`, card is a flex column, body `flex:1`). Left/top edges align across rows. Min card width 280.
- **L5** Never put a bordered box inside a card. Use sub-headings + 1px `--color-surface-border` dividers, or a `--color-surface-subtle` inset block (no border) for secondary info.
- **L6** Content never causes horizontal page scroll. Wide tables scroll inside their card.
- **L7** Vertical rhythm: card padding 24 (compact 16); gap between stacked blocks inside a card 16; between sections 24; heading to its content 12.

---

## 5. Component specs (build once in `src/components/ui/`, each with its own `.css`; pages compose them)

Every spec below is exact. Pages MUST NOT restyle `color, background, border, font-*, radius, shadow, padding` of these; only placement (grid/flex/margin) and variant props.

### 5.1 Button (`Button`, keeps `.button` class names working during migration)
| Variant | Spec |
|---|---|
| `primary` (default) | bg `--color-primary`, text white, 1px border same as bg. Hover/active bg+border `--color-primary-dark`. No shadow. |
| `secondary` | bg white, text `--color-text-primary`, border `--color-surface-divider`. Hover bg `--color-surface-subtle`. |
| `ghost` | transparent, text `--color-primary`, no border, padding 0 12. Hover bg `--color-primary-bg`. Replaces `.text-button`, `.secondary-action-button`. |
| `danger` | bg `--color-emergency`, white text; hover `-dark`. Only for irreversible actions (and then via the confirm Dialog). |
| `emergency` | same as danger + `--shadow-emergency`, size `lg`. SOS submit only. |

Size: `md` height 40, padding 0 16; `sm` 32, padding 0 12 (tables/rows only); `lg` 48, padding 0 24. Font 14/600 (`lg` 16/600). Radius 8. `gap 8` icon(16)+label. `white-space: nowrap` except `lg`. Disabled: opacity .5, `cursor:not-allowed`, no hover. Loading: label stays, leading spinner 16, width does not change, `aria-busy`. Under 720px primary actions are height 44 min. Icon-only: 40x40, `aria-label` Vietnamese.
Delete page-specific button classes (`list-create-button`, `location-confirm-button`, `team-card-add`, `queue-refresh-button`, `mission-directions`, `heatmap-refresh`...). Map each to a variant + a layout class that only sets margin/width.

### 5.2 Card
`bg white; border 1px --color-surface-border; radius 12; padding 24 (compact 16); box-shadow --shadow-sm`. Optional `CardHeader` (title 16/24 700 + right slot, bottom margin 16, no divider unless content is a table) and `CardFooter` (top hairline, padding-top 16, actions right). Variants: `selected` (border + 1px ring `--color-primary`, bg `--color-primary-bg`), `interactive` (hover border `--color-primary-border`, bg `--color-surface-subtle`, cursor pointer, no movement). Replaces `.card`, `.record`, `.*-panel`, `.*-card`. Card titles use a real heading level (h2 inside page, h3 inside card).

### 5.3 Notice (inline message) and Toast
`Notice` variants `info|warning|error|success`: padding 12 16, radius 12, 1px border (`-border`), bg `-bg`, text `-dark`, leading icon 20, title 14/600 + body 14/400. `role="alert"` for error, `role="status"` otherwise. Replaces `.notice`, `.success-banner`, `.field` error banners.
`Toast` (replaces transient `SuccessBanner`): fixed bottom-right 24, width 360, white card + `--shadow-md` + left 4px semantic bar, auto-dismiss 4 s (errors stay until closed), `aria-live`. Mobile: full width minus 16.

### 5.4 Form field (`Field`)
Label above, 14/600 primary, gap 4 to control; required `*` (emergency colour, `aria-hidden`) plus `aria-required`; help 12/16 secondary below, gap 4; error replaces help: 12/16 `--color-emergency-dark` with 16 icon, control border `--color-emergency`, `aria-invalid`, linked by `aria-describedby`.
Control (input/select/textarea): height 40 (textarea min 96, vertical resize), padding 0 12 (textarea 8 12), bg white, 1px `--color-surface-divider`, radius 8, 14/20. Placeholder `--color-text-placeholder`. Focus: border `--color-primary` + `0 0 0 3px` ring of `--color-primary-bg` + global outline kept. Disabled: bg `--color-surface-subtle`, text muted. Select has a custom chevron (consistent across browsers). Checkbox/radio 18x18, accent `--color-primary`, label to the right with gap 8, whole row clickable (min height 40).
Layout: fields stacked, gap 16; related fields in `<fieldset>` with 14/600 legend + 12 secondary hint; two columns (`repeat(2,minmax(0,1fr))` gap 16) only >=720 and only when fields are short (name/phone, date/time). Form actions: top hairline, padding-top 16, right-aligned, primary rightmost, secondary "Huỷ"/"Quay lại" left of it; in dialogs/drawers the footer is sticky. Existing `.form-stack` stays as the vertical container.

### 5.5 Table and list rows
- `Table`: inside a Card with padding 0 and `overflow-x:auto`. Header row bg `--color-surface-subtle`, 12/16 600 secondary, height 40, sticky if page-long. Body row height 48 (compact 40), cell padding 0 16, bottom hairline, hover bg `--color-surface-subtle`, selected bg `--color-primary-bg`. Numeric columns right-aligned + tabular-nums; actions column last, right-aligned, `sm` buttons. No zebra, no vertical rules, no outer double border. <720: render as stacked label/value cards.
- `QueueRow` (requests, missions, teams, receipts): one grid: `[PriorityBadge] [title 14/600 + meta 12 secondary single line, ellipsis] [StatusBadge] [relative time 12 secondary] [chevron 16]`; height >= 64, padding 12 16, bottom hairline, hover subtle, selected = Card `selected` look + 3px left bar `--color-primary`. Same column order on every queue. Rows are `<button>`/`<a>` with focus ring.
- Pagination / "Tải thêm" is one right-aligned ghost/secondary button under the list with a muted "Hiển thị n mục".

### 5.6 Badge (ONE component, replaces all in F5)
`Badge` props `tone: neutral|info|success|warning|danger` and `kind: status|priority|role|meta`.
Spec: inline-flex, height 24, padding 0 8, radius `full` (status, role, meta) or 8 (priority, min-width 32, centred), 12/16 600, 1px border, bg `-bg`, border `-border`, text `-dark`. Status badges show a 6px dot before the label. Never wrap to two lines (ellipsis, `max-width`, full text in `title`).
- Priority uses `--priority-p*` tokens (F6). `PriorityBadge` renders Vietnamese `aria-label` as now.
- **Single status-to-tone map** in `src/components/statusTone.ts`, covering ALL statuses used anywhere (request statuses from `workflow.css` ~L380-450: VERIFYING/RESOLVING -> warning, VERIFIED/TRIAGED -> info, DISPATCHED/IN_PROGRESS -> info, RESOLVED -> success, REJECTED -> danger, DUPLICATE/CANCELLED/CLOSED -> neutral; plus the existing logistics map in `StatusBadge.tsx`). Labels always from `i18n/labels.ts`. `queue-status-chip`, `admin-status-badge`, `guest-badge`, `user-role-badge`, `team-leader-badge` become `Badge` usages; delete their CSS.
- Verify the request-status colours against the actual current `workflow.css` values before replacing; keep the same meaning, not necessarily the same hex.

### 5.7 Dialog and Drawer (one look, three uses)
- Shared base: overlay `--color-overlay` (no blur); panel white, `--shadow-lg`; header = title 20/28 700 + close button (existing `DetailCloseButton`, 40x40 ghost icon) with bottom hairline, padding 16 24; body padding 24, scrolls; footer top hairline, padding 16 24, actions right-aligned (sticky). Opens with opacity .18s only. Focus is trapped, restored on close, Esc closes unless `explicitCloseOnly`.
- `Dialog` (centered): width `min(480px, 100vw-32px)` for confirm, `min(640px, …)` for forms, radius 16, max-height `100dvh-64px`.
- `Drawer` (right): width 560 (full width <720), full height, radius 0 on the left edge 16.
- Keep `DetailSurface` API and `confirmAction()` promise API; only restyle: `confirmAction` content = title (16/700), message (14/20 secondary), actions `Quay lại` (secondary, left) + `Xác nhận` (primary; `danger` variant when the message is destructive). `.modal-card`, `.auth-modal-card`, `.record-detail-dialog`, `.action-confirm-dialog` all collapse into this base. The auth dialog keeps its logo header but with white background (no gradient).

### 5.8 Tabs and segmented filters
Keep `.tabs` markup. Style: row with bottom hairline; tab = height 44, padding 0 16, 14/600, text secondary, active text `--color-primary` + 2px bottom bar `--color-primary`; hover text primary-dark; focus ring; counts shown as `Badge neutral` after the label. Horizontal scroll (no wrap, hidden scrollbar) on <720. Do not mix pill/segmented styles; if a small on/off group is required (map layers) use the same tab style at height 32.

### 5.9 Filter bar and search
One row directly under PageHeader, inside a Card `compact` (or bare on page bg): search control (min 240, max 360, leading 16 search icon), selects, then ghost "Xoá bộ lọc" shown only when filters are active. Wraps with gap 8/16. `.filter` labels become visually hidden labels or 12 secondary captions above controls, consistently.

### 5.10 States (every list/detail/data section MUST implement all)
| State | Component | Spec |
|---|---|---|
| Loading | `Skeleton` | Shape-matching blocks (`--color-surface-subtle`, radius 8, shimmer 1.2 s, disabled under reduced-motion). Lists: 5 skeleton rows of real row height. Cards: title bar + 3 lines. Replaces every bare "Đang tải…" `<p>` (F8). Keep a visually-hidden `role="status"` Vietnamese text for screen readers. Section height must not jump on load. |
| Empty | `EmptyState` | Centered inside the section, padding 48 24: 40px muted icon, 16/600 title, 14 secondary one-sentence explanation, optional primary/secondary action. Replaces `.empty`. |
| Error | `Notice error` or `ErrorState` | Vietnamese plain message, error code in 12 muted, "Thử lại" secondary button when retry is possible. |
| Success | `Toast` / `Notice success` | As 5.3. |
| Disabled/forbidden | `EmptyState` with lock icon | For role-limited sections; never show actions the user cannot use. |

### 5.11 KPI tile and key-value
- `KpiTile`: Card compact; label 12/16 secondary, value 24/32 700 tabular-nums, optional 12 secondary delta/subtext; equal heights; 16 icon top-right in `--color-primary` on `--color-primary-bg` 32x32 radius 8 (optional).
- `KeyValueList` (detail screens): two-column grid `160px 1fr`, row gap 12, labels 12/16 secondary, values 14/20 primary; collapses to stacked <720. Replaces ad-hoc `.detail-grid`.
- `Timeline` (`RequestTimeline`): vertical line 2px `--color-surface-border`, 12px dots (semantic fill), entries 14/20 with 12 secondary timestamps, gap 16.

### 5.12 Icons, avatars, map
- One icon set only: `public/icons` or an inline SVG set with `currentColor`, stroke 1.75, sizes 16/20/24 (40 for empty states). No emoji or text glyphs as icons (replace `☰`, `✓`, `!` in `main.tsx`/`SuccessBanner`).
- Avatar 32/40 circle, initials 14/600 on `--color-primary-bg` text primary-dark.
- Map containers (`LocationPicker`, `HeatmapPanel`): radius 12, 1px border, min-height 320 (SOS picker 360), controls top-right inside the map with 8 inset, legend bottom-left in a white card compact with `--shadow-sm`, marker colours = priority tokens. Map never overlaps form controls or labels.

---

## 6. Page recipes (follow these skeletons; copy and wording stay Vietnamese)

**Citizen SOS** (`content--sos`): emergency-bar stays. Single centred column `max-width: 720`. Order: PageHeader (eyebrow "Khẩn cấp", title, description) -> Card "Vị trí" (map + confirm location) -> Card "Thông tin" (fields, 2-col short ones) -> Card "Liên hệ" -> sticky bottom action bar (white, top hairline, `--shadow-md`, `emergency` lg button full width on <720, right-aligned >=720). One-glance progress (steps 1-3) as a simple stepper above the cards, 12/600 labels, completed = success, current = primary.

**Tracking** (`content--tracking`): centred `max-width: 720`; lookup Card at top; result = Card with `Badge` status + `Timeline` + `KeyValueList`; actions in CardFooter.

**Coordinator**: PageHeader (actions: "Tải lại" secondary). Tabs by queue type with counts. Filter bar. Pattern *Queue + detail* (L3-1). Detail Card order: header (code, PriorityBadge, StatusBadge) -> KeyValueList -> evidence -> Timeline -> contact attempts -> AI advisory (Notice info, labelled as suggestion) -> sticky footer actions in workflow order (Xác minh -> Ưu tiên -> Phân công -> Giải quyết), only one primary visible per step.

**Volunteer**: current mission Card pinned top (Card `selected` look, big status Badge, primary next-step button `lg`); team readiness Card; list of other missions as QueueRows; members as Table.

**Operations**: Dashboard pattern (KPI row + 2 cols); operational lists as Tables in Cards; detail via Drawer. Donations/logistics forms follow Form page pattern; do not add features.

**Admin**: Filter bar + Table in Card; create/edit in Dialog; audit log as Table with monospace `Badge meta` for version/id.

**Auth dialog / account**: Dialog 480, white, logo (existing `.brand-mark` crop kept) + title, one primary button, ghost links; Google button = secondary with Google mark, same height 40.

**Sidebar**: keep structure. Item height 40, padding 0 12, radius 8, icon 20, label 14/500; active = `--color-primary-bg` bg + `--color-primary` text/icon + 600 weight (no left bar thicker than 3). Nav group label 12/600 muted uppercase 0.04em (the only uppercase). Workspace switch segmented control height 36.

**Topbar**: height 56, white, bottom hairline, no shadow; breadcrumb 14 (workspace secondary / page primary 600); profile trigger 40 high with avatar 32.

---

## 7. Copy and Vietnamese rules (UI text)

- Sentence case; no full stop on buttons/labels/titles; short helper text may end with a period.
- Buttons start with a verb: "Gửi yêu cầu", "Xác minh", "Phân công đội", "Lưu thay đổi". Cancel = "Huỷ" (dialogs: "Quay lại"); destructive confirm repeats the verb.
- One term per concept; add/lookup in `src/i18n/labels.ts`; never hard-code enum labels in TSX.
- Dates `dd/MM/yyyy HH:mm`; relative times < 24 h ("5 phút trước"); Vietnamese numeric separators; use existing `timeLabel`.
- Long text: one-line ellipsis in lists with full text in `title`/detail; never overflow.
- Do not change meaning, error codes, or machine values. Do not add English fallbacks.

---

## 8. Accessibility and responsive acceptance

- Keyboard reachable everywhere; visible focus (global 2px ring kept); dialogs trap/restore focus; Esc closes.
- AA contrast for text, 3:1 for meaningful borders/icons (re-check `--color-text-muted` uses).
- Targets >= 40 (>= 44 under 720), 8 px between adjacent targets.
- Landmarks `header/nav/main`, exactly one `h1` per page, no skipped heading levels (cards use h2, inside cards h3), labelled form fields, `aria-describedby` for errors/help, status colour never alone (text/dot label always present).
- Test widths **360, 768, 1280, 1920**: no horizontal page scroll, no clipped/overlapping text, no layout jump on load, cards aligned.

---

## 9. CSS/code architecture rules

1. Target structure:
   ```
   src/styles/tokens.css   src/styles/base.css   src/styles/layout.css
   src/components/ui/<Component>.tsx + <Component>.css      (Button, Card, Notice, Toast, Field, Table, QueueRow, Badge, Dialog, Drawer, Tabs, FilterBar, Skeleton, EmptyState, KpiTile, KeyValueList, Timeline, PageHeader, Icon)
   src/features/<area>/<area>.css                              (placement only)
   ```
   Import order in `main.tsx`: tokens, base, layout, ui components, features. The old four files are deleted at the end (Section 11).
2. Class naming BEM: `block`, `block__part`, `block--variant`. Existing classes that tests, ARIA or other code rely on may keep working through alias selectors until their page is migrated.
3. Feature CSS MUST NOT set `color, background*, border*, font*, border-radius, box-shadow, padding` on shared-component classes. Missing variant -> add to the shared component.
4. NO `!important`, ID selectors, inline `style={{}}` (dynamic geometry may use a CSS custom property, e.g. `style={{'--progress': '40%'}}`), or raw colours.
5. No selectors deeper than 2 levels; no element selectors inside components (`.card h2`).
6. One definition per selector across the whole codebase.
7. Split big files while migrating: page files = data wiring + composition; repeated markup -> `ui` components. Do not alter logic while moving.
8. Run `npm run format`, `npm run typecheck`, `npm run build`, and the existing tests in `tests/` after each page; all must pass.

---

## 10. Mechanical gates (agent runs these; all must return zero hits for migrated files)

```bash
cd frontend/web/src
# raw colours outside tokens
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(' --include=*.css --include=*.tsx . | grep -v 'styles/tokens.css'
# banned declarations
grep -rnE '!important|backdrop-filter|linear-gradient|radial-gradient' --include=*.css .
grep -rnE 'translate(Y|X)?\(' --include=*.css . | grep -v 'prefers-reduced' # only dialog/drawer slide-in may remain
# off-scale type / radius / spacing
grep -rnE 'font-size: *[^;]*(rem|clamp|px)' --include=*.css . | grep -vE 'font-size: *(12|14|16|20|24|32)px'
grep -rnE 'border-radius: *[0-9]+px' --include=*.css . | grep -vE 'border-radius: *(8|12|16)px'
# inline styles
grep -rn 'style={{' --include=*.tsx .
# breakpoints
grep -rhoE '@media[^{]+' --include=*.css . | sort -u   # only 720 / 1080 / 1440 and prefers-reduced-motion/hover
```
(`font-size`, `gap`, `padding` should come from tokens/vars; raw numbers that equal a token are tolerated only inside `tokens.css`.)

---

## 11. Migration procedure (strict order, one page per PR)

1. Add `tokens.css`, `base.css`, `layout.css`; alias the old token names; no visual change expected beyond `--color-text-muted` darkening.
2. Build the `ui` components and a dev-only showcase route/page that renders every variant and state side by side (remove before release or keep behind a dev flag). Review it at the four widths first; fix the system before touching pages.
3. Migrate in this order: App shell (sidebar, topbar, PageHeader) -> Citizen SOS + tracking -> Coordinator queue/detail -> Volunteer -> Operations dashboard/lists -> Admin -> Donations/Logistics -> Auth dialog and account.
4. Per page: replace markup with `ui` components, delete that page's rules from the four legacy files, run gates (Section 10), screenshot at 4 widths, run typecheck/build/tests.
5. When all pages are migrated: delete `style.css`, `sos.css`, `workflow.css`, `refinements.css` and the token aliases; run the gates over the whole tree.
6. Mirror token changes back into `mobile/src/constants/theme.ts` only if values changed (the colour palette should stay identical; this task should not change Mobile).

---

## 12. Verification the agent must do itself

- Start the stack per `backend/README` / `docs/backend/README.md` (single `backend/infra/compose.yaml`; do NOT add Compose files or test databases, see `AGENTS.md`), run `npm run dev`, and open each migrated page in a real browser at 360, 768, 1280, 1920. If no browser is available, say so explicitly and do not claim visual verification.
- For each role workspace, walk the primary flow once (SOS -> verify -> assign -> progress -> resolve) and confirm no behaviour changed.
- Attach screenshots (before/after) to each PR. Report honestly: what was checked, what was not.
- If this document conflicts with something observed in the running UI, follow the intent (Section 2), keep consistency, and note the deviation in the PR.

---

## 13. Definition of done (per page; every line must be true)

- [ ] Built only from `ui` components; `PageHeader` with one `h1` and at most one primary action.
- [ ] Zero gate hits (Section 10) in the files touched; legacy CSS for the page deleted.
- [ ] Only the six type sizes, the 4-px spacing scale, radius 8/12/16/full, four shadows.
- [ ] Single Badge system; statuses and priorities via the shared map and `labels.ts`.
- [ ] Loading skeleton, empty, error (with retry) and success states present, in Vietnamese.
- [ ] Equal-height aligned cards, no nested bordered boxes, no hover movement.
- [ ] Contrast AA, keyboard walkthrough OK, focus visible, targets >= 40/44.
- [ ] Screenshots at 360/768/1280/1920 show no overflow, clipping or overlap.
- [ ] `format`, `typecheck`, `build`, tests pass; no API/behaviour change in the diff.

---

## 14. Addendum from the current Web source (2026-11-13)

This section adds coverage for screens and states observed after the static review in F1–F12. It does not remove the earlier rules. Counts, line numbers and claims marked “current” in Section 1 are a snapshot from 2026-11-12; inspect the live source and the working-tree diff before using them as a migration checklist. The Coordinator `teams` page and `CoordinatorTeams.tsx` are present. The 2026-11-14 upstream update removed region-based scopes; follow the current code and API contracts where older recipes mention regions.

### 14.1 Shared navigation and page-state patterns

- **N1 Workspace and subview state.** The five workspaces are access-filtered in `app/catalog.ts`; several pages also have tabs or steps in URL parameters (`view`, `step`) and selected records in component/session state. Style workspace switching, page navigation, tabs and selected rows with one visual hierarchy. Keep existing route ids, permitted-route normalization, browser Back/Forward behaviour, and valid selections. An unavailable workspace or subview must display the existing permission/session explanation rather than a blank selected tab.
- **N2 Shell states.** Give the initial session loader, expired-session prompt, forced password-change view, guest header, profile menu and cross-tab sign-out the same spacing, typography, Button, Notice and Dialog treatment. The topbar's active GPS-sharing control needs a visible on state, current status text and a clear stop action; it must remain distinct from a passive badge. On narrow screens, opening the sidebar must not cover an open dialog or leave an invisible overlay intercepting taps; close and restore focus through the existing navigation behaviour.
- **N3 Page headers and local actions.** The single page-level `h1` remains owned by `main.tsx`. A feature's first `section-header` is a CardHeader, not another page header. Put refresh, create and other page-level actions in the PageHeader slot where their role is genuinely page-wide; keep record-specific and permission-specific actions beside their record or in its detail footer. Do not create an action slot for users without that grant.
- **N4 Selection and focus.** When a list opens a detail card/drawer, keep the selected row identifiable by text/`aria-current` or `aria-pressed` as well as colour. A refresh should retain a still-valid selection; a missing or forbidden record should clear it with a Vietnamese status message. After opening a detail on a narrow screen, move focus to its heading; after closing, return focus to its originating row when it still exists.

### 14.2 Workflow components not covered by the original recipes

- **W1 Coordinator teams.** `CoordinatorTeams.tsx` belongs to the Coordinator workspace. Use the same QueueRow/Card selection pattern as the request and volunteer team lists. The detail presents team name, organization, readiness, position age and members as one ordered KeyValueList plus sections. Place “Giao vai trò đội trưởng” and member management in separate clearly titled action groups; show each only with its existing grant and eligibility checks. A fresh GPS position, skills, availability and organization attribution remain distinct eligibility conditions.
- **W2 Coordinator queue detail.** Verification, contact attempts, duplicates, supplements, priority, team candidates, mission progress and resolution have conditional forms and review gates. Use compact section headers and dividers inside the detail, with a persistent request identity/status/priority summary at the top. For each available command, show its prerequisite or blocking reason close to that command; do not turn all commands into one permanent footer or imply a fixed four-step sequence. Keep `202` cancel/resolve operation polling as a persistent pending Notice with the operation id/status and retry/reload affordance; it is neither success nor failure until the backend returns a terminal result.
- **W3 Volunteer team and mission.** The team view currently selects a team card and expands its details and position map below the list. Preserve that full-width map composition, including at tablet widths; use the shared selected-card style. Offer, accepted, en route, on scene, completed, declined and failed mission states use the same Badge and action hierarchy. Keep leader-only commands, record-on-behalf explanation, stale-position warning, completion note and evidence controls visually adjacent to the mission they affect. Do not make a terminal mission look actionable.
- **W4 Operations review and custody.** The `intake` page has intake/review steps and reviewer-specific default state. Its receipt detail must keep the selected record through a successful count, review or post, then show the new status and revision. Use a compact quantity matrix for declared, counted, accepted, held and rejected values with units visible in each context; keep the horizontally scrollable table, caption and scroll hint on narrow widths. For distribution, separate prepared, approved, dispatched, in transit, at point, handed out, returned and loss-review facts with headings and a custody timeline. Do not style “at point” as final household delivery or declaration as posted stock.
- **W5 Administrative role setup.** In the user dialog and team-management guidance, show the account → organization-scoped Volunteer grant → team membership/leader sequence as readable help, using the same Field/Notice styles. Keep team leadership controls in Coordinator, not Admin. Admin lists and dialogs must show explicit scope and role labels; the Admin workspace must never visually imply automatic access to SOS or donor details.

### 14.3 Maps, location and data freshness

- **MAP1 One location-picker pattern.** The shared `LocationPicker` is used for citizen SOS and team position. Give search, suggestions, selected suggestion, resolving, map interaction, approximate reverse address, coordinate summary and final confirmation distinct states. A suggestion moves a draft pin; only “Xác nhận vị trí” establishes the confirmed selection. Preserve a previously confirmed point until a new point is confirmed. Label nearby reverse-geocoded text as approximate and show coordinates as the reliable location fact. A lookup error must leave manual map selection and confirmation visible.
- **MAP2 Suggestion popup.** Style the listbox like a shared popover: anchored to the field, maximum height with its own scroll, visible active/hover/focus row and no emoji pin. Keep it above the map but below dialogs. Match the 40/44 px target rule. The input, suggestion list and status/error text must remain readable over map tiles at 360 px. The Google and OSM picker variants should share the same surrounding controls and labels where both are available.
- **MAP3 Heatmap.** Treat layer tabs, incident category select, refresh, seven-day period, resolution/zoom and opacity as one map toolbar. Place the legend and total count in a consistent map footer or compact overlay without covering map controls. Show selected SOS pin separately from aggregate cells; a cluster count is not an exact household position. Preserve zero-result state, loading and last-updated time. Auto refresh should not obscure the map or erase a selected SOS. The heat gradient is a data encoding exception to the decorative-gradient ban in Section 3; keep its scale labelled “Ít → Nhiều” and never use it as a background decoration.
- **MAP4 Freshness language.** On team cards and candidate lists, present last position time and stale/missing GPS in stable positions. A fresh GPS point does not replace organization, skill or readiness checks. On reports and map panels, distinguish a server-provided `generated_at` from a client-side fetch/update time in the visible label; do not present client fetch time as a server timestamp.

### 14.4 Asynchronous, private and dense content

- **D1 Upload/evidence.** Use one evidence field pattern across SOS tracking, missions and donations: selected filename/type/size, preview when supported, busy state (or progress only where measured), server-confirmed success, retryable error and quota/format error. After a successful upload, clear the native file input so selecting the same file again works; after failure retain the selection for retry. Keep private download/open controls within the authorized detail. A storage outage or signed-link failure is an error state, not proof that the upload succeeded or failed. Never put tracking secrets or signed file URLs in public-facing copy, page URLs or screenshots.
- **D2 Command lifecycle.** Style command forms consistently for idle, validating, submitting, confirmed, version conflict, permission loss and retry. Keep the form and its record visible while a command runs; prevent duplicate submission without changing idempotency-key reuse. A stale-version conflict shows a Vietnamese explanation and the existing refresh path near the affected form. A temporary service failure must not clear entered values or show a success Toast.
- **D3 Dynamic forms.** Repeating receipt, drive and distribution lines use one row grid: item/quantity/unit/condition fields in a stable order, add/remove controls aligned at the end, per-row error directly below its input. At 360 px the row stacks in that same order. The form footer must remain visible without hiding the last field when the keyboard opens. Do not let a long select option, UUID or uploaded filename widen the page.
- **D4 Scoped and partial data.** An organization/warehouse-scoped report or list should show its active filter and source before the figures. Distinguish zero records from a failed or incomplete read. If one service fails while others load, keep available data visible with a warning naming the missing portion; do not present a partial total as complete. Pagination and “Tải thêm” preserve current filters and selected record.
- **D5 Identifiers and long values.** In lists, use a short human code or a labelled suffix only when the full identifier has no useful human form; show the full machine id in detail with a copy affordance when needed. Apply tabular numerals to quantities, dates and version values. Preserve user-entered names, notes and addresses without translation; wrap them in detail views instead of truncating the authoritative content.

### 14.5 Review additions for the migration

For each migrated page, check the role/grant variants that actually use it, plus guest and expired-session states where applicable. Include the Coordinator `teams` page and both OSM/Google picker surfaces in the page inventory. Verify at 360, 768, 1280 and 1920 px with long Vietnamese text, a populated list, an empty list, a selected detail, a validation error and a pending command. For the core SOS flow, verify draft pin versus confirmed point, map lookup failure, team GPS age, partial heatmap data, a `202` resolution and a stale-version conflict without changing backend commands. Use synthetic data and redact private codes and signed URLs from screenshots. Record visual checks separately from typecheck/build/tests.
