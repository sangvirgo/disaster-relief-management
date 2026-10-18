# C48 Web application

This is the responsive React Web client. The native Mobile application is separate. Product copy is Vietnamese; code and contracts remain English.

## Run

```powershell
cd frontend/web
npm.cmd ci
npm.cmd run contracts:generate
npm.cmd run dev
```

The development server runs on `http://localhost:5173` and proxies `/api/v1/*` to the **main** Nginx ingress at `http://127.0.0.1:8080` (override with `C48_INGRESS_URL`). The local proxy presents the allowed demo Origin `http://localhost:8080` to the backend. Set `WEB_ALLOWED_ORIGINS` for the real browser origin when deploying the built app; do not expose the dev server. Browser cookies remain HttpOnly for access/refresh. `Secure` cookies require a secure deployment or browser localhost exception. There is no standalone frontend Compose file.

For the optional Google location picker, copy `.env.example` to `.env` in `frontend/web/` and set `VITE_GOOGLE_MAPS_API_KEY`. Enable Maps JavaScript API and Places API (New) in the Google Cloud project, configure billing, and restrict the browser key by HTTP referrer and API. Restart Vite after editing `.env`. The key is embedded in browser assets; do not use a server secret here. Without a configured key, SOS still accepts browser GPS or manual coordinates. The place search is limited to Vietnam; choosing a search result only moves the map. The user must tap the exact point or choose the map center before its coordinates are sent. The same picker can add a location to a reporter supplement; the backend already accepts `RequestSupplement.location` for human review. No address string is persisted because the backend intake contract accepts coordinates and provenance, not an address field.

```powershell
npm.cmd run typecheck
npm.cmd run build
```

The generated TypeScript contract files are based on `contracts/openapi/{identity,response,logistics}.json`. First run `npm.cmd run contracts:check` in `backend/` after installing its dependencies; it validates the controller inventory. Then regenerate frontend types after snapshot changes.

## Implemented boundaries

| Area | Status | Contract |
|---|---|---|
| Shared shell, 5 workspaces, responsive layout | Implemented | Workspace visibility from `/identity/me` grants. Object scope remains enforced by APIs. |
| Identity Web auth | Implemented | CSRF, register, login, refresh, logout, forced password change, `/me`. No token storage. |
| Citizen SOS | Demo implementation | SELF guest/account and signed-in PROXY, GPS/manual coordinates, idempotency key retained for retry, server-only acknowledgement, one-time guest tracking secret. Category list is the versioned demo seed in `docs/backend/seed/seed-response.sql`; there is no public category API. |
| Citizen tracking | Implemented main flow | Private tracking with secret/code headers or account ownership, supplements, evidence upload/list/download, older event pages, account claim and one-use assisted recovery; no secret URL or storage. |
| Public campaigns and donation drives | Implemented readers | Public Response and Logistics lists plus drive detail. |
| Donation declaration/tracking | Implemented main flow | Guest/account declaration, capability tracking, declared/count/accepted distinction, donor dispute, evidence upload, account claim and one-use assisted recovery. Declaration revision remains blocked by the missing delivery version in the owner projection. |
| Volunteer | Live readers | Scoped mission/team lists, progress, notices and mark-read. Leader-only mission commands are deferred because the current mission/team projections do not identify the current user's leadership relation. |
| Coordinator | Implemented core flow | Queue and review lanes, request detail, contact record, two-coordinator proxy concurrence, manual duplicate decision, verification, manual triage, team candidates, mission offer, aggregated heatmap, campaign lifecycle and polling for asynchronous cancel/resolve commands. |
| Operations | Implemented core flow | Scoped drives, intake and multi-line count, independent review/post, donor disputes, stock, assets, needs, distribution approval/dispatch, physical handoff and report lists. Handoff history/loss review needs a discoverable handoff list or a returned handoff identifier retained in the UI. |
| Admin | Implemented core flow | User/organization/region lists and creation, user enable/disable/reset, scoped grants/revoke, organization deactivate, audit list. Region deactivation needs a version in the region list or a detail endpoint. |
| Reports | Implemented core views | Operations overview composes separate Response and Logistics panels; coordinator 7-day Response summary and Logistics stock, fulfillment and reconciliation reports use required filters. Each unavailable panel reports its own error. |

The 38 prototype pages are represented as navigation destinations or page families; a campaign management destination is also available to Operations roles. A destination with no completed backend adapter presents an explanatory state; it does not offer a fake action. The prototype's illustrative counts and fake map are not in the product.

## Next implementation slices

1. Complete Phase A acceptance with live signed-in/denied/revoked sessions and visual checks at phone, tablet and desktop widths. This workspace has no `backend/.env`, so HTTP smoke and browser session verification could not run here.
2. Add donation declaration revision after the owner projection exposes the delivery version required by its write contract. Replace the versioned demo incident-category list with a public API before production use.
3. Add volunteer leader commands when the backend supplies an ownership relation in an authorized projection. Expand coordinator operation recovery/adoption controls if they become part of the demo workflow.
4. Add discoverable handoff history/loss review and broader catalog and stock adjustment management. Do not implement CSV export until a route exists.
5. Run Phase F Vietnamese, keyboard, contrast and live API checks against the primary C48 databases without reset unless explicitly requested.

No AI scoring, automatic priority/dispatch, cash payments, offline ACK, or fake CSV export is exposed.
