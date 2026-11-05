# Reliva Web application

This is the responsive React Web client. The native Mobile application is separate. Product copy is Vietnamese; code and contracts remain English.

## Run

```powershell
cd frontend/web
npm.cmd ci
npm.cmd run contracts:generate
npm.cmd run dev
```

The development server runs on `http://localhost:5173` and proxies `/api/v1/*` to the **main** Nginx ingress at `http://127.0.0.1:8080` (override with `C48_INGRESS_URL`). The local proxy presents the ingress's localhost Origin to the backend. `WEB_ALLOWED_ORIGINS` in `backend/.env` must contain that Origin. For example, when `PUBLIC_PORT=8081`, set `C48_INGRESS_URL=http://127.0.0.1:8081` and `WEB_ALLOWED_ORIGINS=http://localhost:8081`. Set `WEB_ALLOWED_ORIGINS` for the real browser origin when deploying the built app; do not expose the dev server. Browser cookies remain HttpOnly for access/refresh. `Secure` cookies require a secure deployment or browser localhost exception. There is no standalone frontend Compose file.

The default SOS picker uses Leaflet and MapLibre with OpenFreeMap vector tiles, plus Photon place search matching the Mobile search provider. A debounced search starts after three typed characters without Enter; results are limited to Vietnam. Selecting a result immediately centers the map at street-level zoom 17. A fixed red pin stays at the map center while the user drags the map. The **Xác nhận địa chỉ** button stays over the map, above the attribution; mouse-wheel zoom remains enabled. Confirmation commits the center coordinates, plays a short pin-drop animation and updates the search field. After a moved pin, Photon reverse geocoding supplies an approximate address only on confirmation; the confirmed coordinates remain authoritative if that lookup fails. The Web sends only the confirmed coordinates. The default public OpenFreeMap instance is free and requires attribution, but offers no SLA; its source can be changed with `VITE_OPENFREEMAP_STYLE_URL`. `VITE_OSM_TILE_URL` optionally replaces it with a permitted raster tile endpoint and requires matching `VITE_OSM_TILE_ATTRIBUTION`. Photon’s public endpoint is a best-effort demo service with no availability guarantee or reserved capacity; configure a suitable hosted or self-managed search endpoint before wider deployment. The backend intake contract accepts coordinates and provenance, so no address string is persisted.

For optional Google Maps, copy `.env.example` to `.env` in `frontend/web/` and set `VITE_GOOGLE_MAPS_API_KEY`. Enable Maps JavaScript API and Places API (New) in the Google Cloud project, configure billing, and restrict the browser key by HTTP referrer and API. Restart Vite after editing `.env`. The key is embedded in browser assets; do not use a server secret here. Without a key, users can still search with Photon, use browser GPS for SELF, or choose a manual pin. The same picker can add a location to a reporter supplement; the backend already accepts `RequestSupplement.location` for human review.

For optional Google sign-in, set `VITE_GOOGLE_CLIENT_ID` to the browser OAuth client ID and configure the corresponding backend audience. Email registration uses the backend OTP delivery settings; without email delivery, verification remains pending until the service can send a code.

```powershell
npm.cmd run typecheck
npm.cmd run build
```

The generated TypeScript contract files are based on `contracts/openapi/{identity,response,logistics}.json`. First run `npm.cmd run contracts:check` in `backend/` after installing its dependencies; it validates the controller inventory. Then regenerate frontend types after snapshot changes.

Guest donation commands and tracking send `X-Donation-Secret` without browser cookies. Logistics currently interprets the Identity pre-session CSRF cookie as an authenticated credential and otherwise returns `UNAUTHENTICATED` for guest requests. Signed-in donation requests retain cookies and CSRF. The backend owner should narrow its optional-session check to the actual access credential so other cookie-based clients can use guest donations too.

## Implemented boundaries

| Area | Status | Contract |
|---|---|---|
| Shared shell, 5 workspaces, responsive layout | Implemented | Workspace visibility from `/identity/me` grants. Object scope remains enforced by APIs. |
| Identity Web auth | Implemented supported flow | CSRF, register, login, refresh, logout, forced and voluntary password change, `/me`. No token storage. Forgotten-password help points to the supported admin temporary-reset process; there is no public self-service reset API. |
| Citizen SOS | Demo implementation | SELF guest/account and signed-in PROXY, GPS/manual coordinates, idempotency key retained for retry, server-only acknowledgement, one-time guest tracking secret. The receipt destination shows the latest acknowledged code in page memory without repeating the secret. Category list is the versioned demo seed in `docs/backend/seed/seed-response.sql`; there is no public category API. |
| Citizen tracking | Implemented main flow | Private tracking with secret/code headers or account ownership, supplements, evidence upload/list/download, older event pages, account claim and one-use assisted recovery; no secret URL or storage. |
| Public campaigns and donation drives | Implemented readers | Public Response and Logistics lists plus drive detail. |
| Donation declaration/tracking | Implemented main flow | Guest/account declaration, capability tracking, declared/count/accepted distinction, donor dispute, evidence upload, account claim and one-use assisted recovery. Declaration revision remains blocked by the missing delivery version in the owner projection. |
| Volunteer | Implemented main flow | Scoped mission/team lists, leader-gated mission actions, progress, evidence actions, notices and mark-read. The mission projection's `can_manage_mission` flag controls leader-only commands; the API remains authoritative. |
| Coordinator | Implemented core flow | Queue and review lanes, request detail, paginated contact history and event timeline, contact-attempt recording during verification, two-coordinator proxy concurrence, manual duplicate decision, verification, manual triage, team candidates, mission offer/progress, scoped need management, aggregated heatmap, campaign lifecycle, evidence review through short-lived authorized links, async cancel/resolve polling and recovery/adoption controls after a reload. |
| Operations | Implemented core flow | Scoped drives, intake and multi-line count, independent review/post, donor disputes, stock and asset summaries, needs, distribution approval/dispatch, physical handoff and report lists. Handoff history/loss review and catalog/stock adjustment screens remain limited by discoverability and supporting-scope priorities. |
| Admin | Implemented core flow | User/organization/region lists and creation, user enable/disable/reset, scoped grants/revoke, organization deactivate, versioned region deactivation and audit list. |
| Reports | Implemented core views | Operations overview composes separate Response and Logistics panels; coordinator map/summary and operations Response summary select a region because the API requires `region_code` or `campaign_id`. Logistics stock, fulfillment and reconciliation reports use required filters. Each unavailable panel reports its own error. |

The 38 prototype pages are represented as navigation destinations or page families; a campaign management destination is also available to Operations roles. A destination with no completed backend adapter presents an explanatory state; it does not offer a fake action. The prototype's illustrative counts and fake map are not in the product.

## Next implementation slices

1. Complete Phase A acceptance with revoked sessions, remaining command submissions, and visual checks at tablet width. A 2026-10-19 local Docker/Chrome smoke covered seven seeded roles' navigation and read-only detail, guest SOS creation/tracking, guest donation declaration/tracking, signed-in donation declaration, and desktop/phone screenshots. Anonymous 401, denied 403, malformed-query 400, and stale-version 409 returned Vietnamese messages. It did not cover every command or media upload; the optional AI path is not implemented. The seeded accounts still require a real password change. Browser navigation inspection temporarily changed only the `/identity/me` response in its test context to access read-only workspaces without changing those accounts.
2. Add donation declaration revision after the owner projection exposes the delivery version required by its write contract. Replace the versioned demo incident-category list with a public API before production use.
3. Add discoverable handoff history/loss review when the backend exposes a collection route or the handoff creation flow can retain and reopen its returned identifier. Keep catalog and stock adjustment work optional within the supporting Logistics scope. Do not implement CSV export until a route exists.
4. Run Phase F Vietnamese, keyboard, contrast and live API checks against the primary databases without reset unless explicitly requested.

The coordinator can review an AI advisory, but priority and dispatch remain human decisions. Cash payments, offline ACK, and fake CSV export are not exposed.

The [2026-10-21 Web integration audit](../../docs/frontend-web-audit-2026-10-21.md) records a historical implementation snapshot. The [2026-11-05 Web/backend contract review](../../docs/frontend-web-contract-review-2026-11-05.md) records the current comparison and remaining gaps. An earlier full backend test run on this Windows host passed 529 Jest tests, then encountered seven Node script-test failures involving host-specific shell/path/permission assumptions; that historical result was not rechecked in this Web review.
