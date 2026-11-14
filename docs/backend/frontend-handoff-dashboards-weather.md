# Frontend handoff: dashboards, weather alerts, drive suggestions, validation errors

Date: 2026-11-14. Source: backend work in this session. Everything below is implemented, built into the running Compose stack, and checked with real calls against the seeded demo data. **No frontend code is part of this change.** Contracts are exported in `contracts/openapi/*.json` (217 operations: 39 Identity, 88 Response, 90 Logistics).

## 0. Conventions that apply to every endpoint

- Base: `/api/v1/identity`, `/api/v1/response`, `/api/v1/logistics` through Nginx on `:8080`. Use the existing `api(service, path)` helper (cookie session + CSRF already handled for GET).
- All endpoints below are `GET`, `Cache-Control: no-store` except weather (`public, max-age=300`). Poll no faster than every 60 s; the server also caches weather for 30 min.
- Machine-readable fields (codes, enum values, JSON keys) are English; **every label shown to users must be Vietnamese** (AGENTS.md policy). Map enums with a label table, never print the raw code. Suggested table for the new fields is in section 7.
- Error envelope is unchanged: `{ code, message (Vietnamese), correlation_id, field_errors?, details? }`. Branch on `code`, never on `message`.

## 1. Validation errors now carry `field_errors` (all three services)

Before: `400 VALIDATION_FAILED` with no hint which field failed. Now:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại các trường được đánh dấu.",
  "correlation_id": "…",
  "field_errors": {
    "organization_id": ["Trường này là bắt buộc."],
    "team_kind": ["Giá trị không hợp lệ."]
  }
}
```

- Keys are request JSON field names (nested: dotted path, e.g. `position.location`).
- Texts are Vietnamese and generic: `Trường này là bắt buộc.`, `Giá trị không hợp lệ.`, `Trường này không được hỗ trợ.` (unknown property). Submitted values are never echoed.
- Business-rule failures still use their own codes (`LEADER_REQUIRED` 409, `FORBIDDEN` 403, `USER_IN_OTHER_TEAM`, …) and sometimes `field_errors` with a specific Vietnamese sentence (e.g. `skill_codes: ["Mã kỹ năng không hợp lệ hoặc không tồn tại."]`).
- **Frontend task:** render `field_errors[name]` next to the matching input in every form; fall back to `message` when absent.

## 2. Team creation (`POST /response/teams`)

- `skill_codes` is now **optional** (default `[]`). It was the cause of the generic 400 when a client omitted it.
- Required: `name`, `organization_id`, `team_kind` (`VOLUNTEER|MILITARY|GOVERNMENT|OTHER`), `reporting_mode` (`APP|COORDINATOR`).
- `reporting_mode=APP` requires `leader_user_id` (active volunteer member of that organization who is not already on a team) else `409 LEADER_REQUIRED`. `COORDINATOR` requires `external_contact_note` else `400`.
- Permission `TEAM_MANAGE_ANY`: coordinators (scoped to their organization) and, since the later team-setup change, system administrators (any organization; admins still cannot assign missions or read SOS details).
- Team fields can be changed with `PATCH /teams/{id}` (version-checked; `409 TEAM_BUSY` while the team has an active mission).
- The web app has a team-creation form (`TeamSetupForms.tsx`) that shows `field_errors` next to inputs.
- Requires header `Idempotency-Key: <uuid>`; reuse the key only for a retry of the same submission.

## 3. Dashboards by role

Pick one landing "Thống kê" page per workspace. Section 6 lists which role sees which call. Every number below is a count; no personal data is returned.

### 3.1 `GET /response/dashboard/overview` – coordinator and admin
Scope: coordinator = own organization grants; admin and others with `REPORT_READ` = per their grants (admin: system-wide). 403 when the user has no `REPORT_READ`.

```json
{
  "requests": {
    "open_total": 22,
    "open_by_status": {"SUBMITTED": 13, "VERIFYING": 5, "VERIFIED": 1, "TRIAGED": 1, "DISPATCHED": 1, "IN_PROGRESS": 1},
    "open_by_priority": {"P1": 1, "P2": 1, "P3": 1},
    "open_by_category": {"FLOOD": 6, "STORM": 3, "…": 0},
    "received_last_24h": 24,
    "resolved_total": 1,
    "verification_overdue": 15,
    "declared_danger_waiting": 1,
    "awaiting_team_assignment": 2
  },
  "missions": {"active_by_status": {"OFFERED": 1, "ACCEPTED": 1}, "overdue_offers": 1},
  "teams": {"total": 13, "available": 13, "unavailable": 0, "awaiting_readiness": 0, "on_mission": 1, "position_missing_or_stale": 2},
  "thresholds": {"verification_overdue_minutes": 15, "offer_overdue_minutes": 10, "team_position_fresh_minutes": 30},
  "recent_open_requests": [{"id": "uuid", "status": "SUBMITTED", "priority": null, "category": "UNKNOWN", "received_at": "ISO"}],
  "generated_at": "ISO"
}
```
Open = not `RESOLVED|REJECTED|DUPLICATE|CANCELLED`. Missing `priority` is `null`; the map objects only contain keys with at least one row (render zeros yourself). `recent_open_requests[].id` can deep-link to the existing request detail view (needs `REQUEST_DETAIL_READ`, which ops managers lack: only link for coordinators).

Suggested tiles: SOS đang mở, Quá hạn xác minh (warning), Khai báo nguy hiểm đang chờ (warning), Chờ giao đội, Nhiệm vụ đang chạy (+ `overdue_offers`), Đội sẵn sàng `available/total`, Đội thiếu vị trí mới (warning). Then breakdown grids for status/priority/category/mission status and the recent list.

### 3.2 Removed: citizen and volunteer dashboards
The planned `GET /response/dashboard/mine` and `GET /response/dashboard/team` were dropped: citizens and volunteers have no statistics page. Do not call them.

### 3.3 `GET /logistics/dashboard/operations` – all operations roles
Sections appear **only if the caller's grants carry the matching permission**, and are limited to the grant's organization (admin: all). The frontend must treat each section as optional. `403` when nothing is visible (citizens, volunteers).

```json
{
  "intake": {"deliveries_by_status": {"DECLARED": 5, "PENDING_REVIEW": 1, "POSTED": 2}, "awaiting_count_or_review": 6, "pending_review": 1,
             "open_disputes": 1, "drives_by_status": {"DRAFT": 1, "OPEN": 2}, "reviews_last_7d": {"APPROVE": 3}},
  "distribution": {"by_status": {"DRAFT": 2, "DISPATCHED": 1, "RECONCILED": 1}, "dispatched_not_reconciled": 1, "handoffs_last_7d": 4},
  "stock": {"warehouses": 3, "tracked_item_lines": 20, "out_of_stock_lines": 4, "low_stock_lines": 4, "pending_adjustments": 1, "low_threshold_units": 50},
  "needs": {"by_status": {"OPEN": 0, "PARTIALLY_FULFILLED": 1, "CANCELLED": 1}, "outstanding": 1},
  "generated_at": "ISO"
}
```
Observed visibility with demo accounts: `admin`, `coord1`, `ops_mgr`, `campaign_mgr` → intake, distribution, stock, needs; `intake1`, `reviewer1` → intake, distribution, stock; `dist1` → distribution, stock; `citizen1`, `vol_*` → 403.
A "line" in `stock` is one item in one warehouse. `low_threshold_units` echoes the server setting (`STOCK_LOW_THRESHOLD`, default 50).

### 3.4 `GET /identity/dashboard/admin` – admin only (`USER_MANAGE`)
```json
{
  "users": {"total": 30, "by_status": {"ACTIVE": 30}, "pending_email_verification": 0, "must_change_password": 30, "active_last_24h": 2},
  "active_users_by_role": {"ADMIN": 1, "COORDINATOR": 4, "VOLUNTEER": 13, "…": 0},
  "active_organizations_by_kind": {"COORDINATION": 1, "VOLUNTEER": 1},
  "recent_audit": [{"action": "SEED_LOADED", "entity_type": "SYSTEM", "created_at": "ISO"}],
  "generated_at": "ISO"
}
```
The admin page should combine this with `GET /response/dashboard/overview` (system-wide for admin). `recent_audit` has no actor or entity ids; the full log stays at `GET /identity/audit-logs`.

## 4. Weather alerts (`GET /response/weather/alerts`) – public

Query: `active_only=true` (only locations that have alerts). No login needed, safe for citizens and guests.

```json
{
  "source": "Open-Meteo",
  "attribution": "Dữ liệu dự báo: Open-Meteo.com (CC BY 4.0).",
  "disclaimer": "Đây là dự báo mô hình tham khảo, không thay thế cảnh báo chính thức của Trung tâm Dự báo khí tượng thủy văn quốc gia và chính quyền địa phương.",
  "horizon_hours": 24, "fetched_at": "ISO", "stale": false, "alert_count": 1,
  "locations": [{
    "id": "ca-mau", "name": "Cà Mau", "latitude": 9.176, "longitude": 105.15,
    "rain_24h_mm": 5.5, "peak_rain_1h_mm": 2.1, "max_gust_kmh": 29.5,
    "alerts": [{"code": "THUNDERSTORM", "level": "WATCH", "message": "Có dông, sét, …", "value": null}],
    "hourly": {"time": ["2026-11-14T14:00", "…"], "rain_mm": [0.2, 0], "gust_kmh": [29.5, 31]}
  }]
}
```
- 15 fixed provincial centres. `alerts` is sorted most severe first. `code`: `HEAVY_RAIN | STRONG_WIND | THUNDERSTORM`. `level`: `WATCH` (lưu ý) < `WARNING` (cảnh báo) < `SEVERE` (nguy hiểm). `value` is mm for rain, km/h for wind, `null` for thunderstorm.
- Thresholds: rain 24 h ≥ 50 / 100 / 200 mm (or ≥ 30 mm in one hour → WATCH); gust ≥ 50 / 62 / 89 km/h; thunderstorm weather codes ≥ 95.
- `message` is already Vietnamese and safe to display as-is. `stale: true` means the provider failed and the last good result is returned: show "Dữ liệu có thể đã cũ". If the provider never succeeded: `503 RESPONSE_UNAVAILABLE`: show "Chưa tải được cảnh báo thời tiết" and keep the rest of the page working.
- **Always show `disclaimer` and `attribution`** wherever alerts appear (Open-Meteo licence requires attribution).
- Map use (implemented in `HeatmapPanel.tsx` with a show/hide checkbox): each location has `latitude/longitude`; draw a marker per location that has alerts, colour by the highest level (suggest vàng/cam/đỏ), popup = name, `rain_24h_mm`, `max_gust_kmh`, and all `alert.message`. The citizen SOS page shows the same alerts as a banner (`SosWeatherAlerts.tsx`).
- Cached 30 min on the server, `Cache-Control: public, max-age=300` for browsers.

### 4.1 Forecast for one point: `GET /response/weather/at?latitude=&longitude=` (public)
Returns the same fields as one location above (no `id`/`name`) plus `latitude`, `longitude` (echo), `source`, `attribution`, `disclaimer`, `horizon_hours`, `fetched_at`, `stale`. Latitude must be 7.5–24.5 and longitude 101.5–112, otherwise `400 VALIDATION_FAILED` (show "vị trí nằm ngoài vùng có dự báo"). `503 RESPONSE_UNAVAILABLE` when the provider is down and nothing is cached. Privacy: the backend snaps coordinates to a 0.1° cell (~11 km) before calling Open-Meteo and caches per cell for 30 min.

Used by the citizen SOS form: the banner no longer shows national city alerts (it could not know where the user is). It shows weather only for the position the person confirmed on the form, with the 24 h rain/gust chart, and a neutral hint while no position is chosen.

### 4.2 Chart and map layers (implemented in the web app)
- `components/WeatherChart.tsx` draws the hourly series as an SVG (rain bars mm/h, gust line km/h); it is used in the SOS form banner and in the coordinator map popups.
- Coordinator heatmap (`HeatmapPanel.tsx`): checkbox layers for weather markers (all 15 cities; coloured when alerts exist, grey-blue otherwise, popup with stats, messages and chart) and for the RainViewer rain radar. The radar and its tile host need `https://api.rainviewer.com` (connect-src) and `https://tilecache.rainviewer.com` (img-src) in the Nginx CSP, already added; reload Nginx after pulling (`docker exec reliva-nginx nginx -s reload`).
- The SOS location picker places the pin where the person clicks; panning does not change the chosen point.

## 5. Donation-drive suggestions (`GET /logistics/reports/drive-suggestions`)

Needs `REPORT_READ` in scope (operations manager, coordinator, admin; others 403). Rule-based advice (not AI). It only suggests; a person still creates the drive through the existing drive screens.

```json
{
  "open_drives": [{"id": "uuid", "title": "…", "closes_at": "ISO|null"}],
  "suggestions": [{
    "code": "STOCK_OUT", "severity": "URGENT",
    "item_ids": ["uuid"], "message": "Đã hết hàng: Nước đóng chai, … Chưa có đợt tiếp nhận đang mở cho các mặt hàng này, nên cân nhắc tạo đợt quyên góp."
  }],
  "weather_available": true,
  "thresholds": {"stock_low_units": 50},
  "generated_at": "ISO"
}
```
- `code`: `STOCK_OUT` (available ≤ 0), `STOCK_SHORTFALL` (open needs exceed available), `STOCK_LOW` (≤ threshold), `WEATHER_NO_DRIVE` (a `WARNING/SEVERE` weather alert exists and no open drive is listed; `item_ids` empty), `NO_OPEN_DRIVE` (nothing to flag and no open drive).
- `severity`: `URGENT` (red) > `WARNING` (orange) > `INFO` (neutral). Already sorted most severe first.
- Items already covered by an open drive in the same organization are not flagged.
- `weather_available=false` means the weather lookup failed; stock advice is still valid, show a small note.
- `message` is Vietnamese, display as-is. `item_ids` can pre-select items in the "create drive" form (`POST /donation-drives` takes items; see `04-logistics-api.md`).
- Placement: top of the operations overview, above the existing report cards.

## 6. Which role calls what (suggested navigation)

| Workspace / role | Landing "Thống kê" page calls |
|---|---|
| Citizen, volunteer | no statistics page; the citizen SOS page shows the weather banner (`GET /response/weather/alerts?active_only=true`) |
| Coordinator | `GET /response/dashboard/overview`, plus the weather layer on the heatmap |
| Operations manager, campaign manager | `GET /logistics/dashboard/operations` + existing report cards + `GET /logistics/reports/drive-suggestions` |
| Intake staff, reviewer, distribution staff | `GET /logistics/dashboard/operations` only (they lack `REPORT_READ`: do not call `reports/summary`, `reports/stock-summary` or `drive-suggestions`, they return 403) |
| Admin | `GET /identity/dashboard/admin` + `GET /response/dashboard/overview` |

Notes for the existing web navigation (`app/catalog.ts`): the operations `overview` page is currently hidden from intake/reviewer/distribution staff (it falls through to a manager-only rule), so those roles have no landing page; the existing `OperationsDashboard` would also 403 for them. This is implemented: the staff section is independent of the report cards. The dashboard pages are deliberately not the first entry of the coordinator and admin workspaces, so the default landing page is unchanged (`reports` and `users`; `allowedPages(...)[0]`).

## 7. Vietnamese label tables to add (enum → text)

- Delivery status: `DECLARED` Đã khai báo · `PENDING_REVIEW` Chờ duyệt kiểm đếm · `POSTED` Đã nhập kho.
- Review decision: `APPROVE` Đã duyệt · `REJECT` Từ chối.
- Drive/distribution/need: `OPEN` Đang mở · `CLOSED` Đã đóng · `DRAFT` Bản nháp · `APPROVED` Đã duyệt · `DISPATCHED` Đã xuất kho (distribution) · `RECONCILED` Đã đối soát · `PARTIALLY_FULFILLED` Đáp ứng một phần · `FULFILLED` Đã đáp ứng đủ · `CANCELLED` Đã hủy. (`DISPATCHED` on a *request* already has the label "Đã giao nhiệm vụ": keep context-specific labels.)
- Roles: `ADMIN` Quản trị viên · `COORDINATOR` Điều phối viên · `CAMPAIGN_MANAGER` Quản lý chiến dịch · `OPERATIONS_MANAGER` Quản lý vận hành · `INTAKE_STAFF` Nhân viên tiếp nhận · `REVIEWER` Người xác minh · `DISTRIBUTION_STAFF` Nhân viên phân phát · `VOLUNTEER` Tình nguyện viên · `CITIZEN` Người dân.
- Organization kind: `COORDINATION` Điều phối · `VOLUNTEER` Tình nguyện. User status: `PENDING_EMAIL` Chờ xác minh email · `DISABLED` Đã khóa.
- Incident category: `FLOOD` Ngập lụt · `LANDSLIDE` Sạt lở đất · `STORM` Bão, gió lốc · `MEDICAL` Cấp cứu y tế · `TRAPPED` Người bị mắc kẹt · `FIRE` Hỏa hoạn · `SUPPLY_SHORTAGE` Thiếu nhu yếu phẩm · `OTHER` Khác · `UNKNOWN` Chưa rõ.
- Mission: `OFFERED` Chờ đội nhận · `ACCEPTED` Đã nhận · `EN_ROUTE` Đang di chuyển · `ON_SCENE` Đang tại hiện trường · `COMPLETED` Hoàn thành.
- Weather level: `WATCH` Lưu ý · `WARNING` Cảnh báo · `SEVERE` Nguy hiểm. Suggestion severity: `INFO` Tham khảo · `WARNING` Cần chú ý · `URGENT` Khẩn.

Check the existing `i18n/labels.ts` first: `label()` returns "Có cập nhật mới" for unknown codes, which would be misleading on these screens.

## 8. Demo data changes (after `bash backend/scripts/db/reset-demo --reset` or a fresh volume)

- Seed assertion bug fixed: the full seed now succeeds (it previously aborted on a hard-coded "15 teams" check).
- Six expansion teams renamed to one style: `Đội xuồng cứu hộ Bắc (demo)`, `Đội sơ cứu lưu động Nam (demo)`, `Đội hỗ trợ cơ động Trung (demo)`, `Đội y tế cộng đồng Bắc (demo)`, `Đội xuồng cứu hộ Nam (demo)`, `Đội cứu hộ cơ động Bắc (demo)`. Team ids are unchanged.
- Two volunteers without a team, in the coordination organization: `vol_free1`, `vol_free2` (ids `…0123`, `…0124`). Use them as leaders when demonstrating team creation by `coord1`/`coord2`. Password is the usual `SEED_PASSWORD`; all seeded users have `must_change_password=true`.
- Demo accounts per role: `admin`, `coord1`, `ops_mgr`, `campaign_mgr`, `intake1`, `reviewer1`, `dist1`, `vol_leader1`, `vol_free1`, `citizen1`.
- Login body needs `client_kind` (`WEB` or `NATIVE`).
- With demo data the suggestions endpoint returns 4 items (hết hàng, tồn kho thấp) and weather returns real forecast data: alerts only appear when the forecast crosses a threshold, so the map may legitimately show none. To demo the UI offline, mock the response shape in section 4.

## 9. Not implemented (do not assume)

- No AI in suggestions or counting: suggestions are deterministic rules. `GEMINI_API_KEY` is empty in the local `.env`.
- Teams cannot carry relief items on missions; SOS only has `needs_rescue` / `needs_relief_supplies` booleans (specific items are created later by staff through `POST /needs`).
- Team matching during assignment is by GPS position (30 min freshness, 10 km radius) and skills; no province field exists on teams.
- Weather is forecast-model data for 15 city points, not an official warning feed and not a continuous map.
