# C48 Web Frontend Implementation Plan

## 1. Objective and current state

Build the **responsive Web application only** in a separate `frontend/web/` React + TypeScript + Vite workspace. The native Mobile application is owned separately. The current `frontend/prototype/` is a static, interactive design reference with **38 screens** and illustrative data; its buttons do not call the backend. The current Superdesign canvas is a review artifact, not source code or an API contract.

Use the existing three NestJS services and their [OpenAPI snapshots](../contracts/openapi/) as the machine contract. Read the [project context](../docs/c48-project-context.md), [technology plan](../docs/c48-technology-and-delivery-plan.md) including Appendix A, [backend implementation pack](../docs/backend/README.md), [permissions](../docs/backend/05-permissions.md), and the relevant service API document before implementing a slice. Current backend snapshot: Identity 33, Response 79, Logistics 86 operations. Regenerate/check snapshots before generating client types; do not infer a request shape from the prototype.

Design references: [prototype](prototype/README.vi.md), [design system](../.superdesign/design-system.md), [Vietnamese UX plan](UX_PLAN.vi.md), [Figma coordinator frame](https://www.figma.com/design/0odUVYiPvYyRqvxGYgcWms/Untitled?node-id=0-3), and [Superdesign canvas](https://superdesign.dev/teams/b004acb3-e22c-4dff-b18f-a07831aef849/projects/44bcd4b9-88e7-4731-a0fb-833c655183c9).

## 2. Product and design invariants

- All visible Web copy, validation, statuses, dialogs, accessibility labels, notifications, and report headings are Vietnamese. Keep API paths, JSON fields, codes, enum values, and source identifiers in English. Branch on stable codes, never on translated messages.
- Use one responsive Web design at desktop, tablet, and phone browser widths. Do not create a native Mobile project or a separate Mobile design set.
- Carry the approved calm palette into production tokens: page `#F7F8F5`, surface `#FFFFFF`, sidebar `#EAF2F6`, selected nav `#D1E5EF`, primary action `#315F77`, deep blue text `#244B5F`, selected indicator `#578BA3`. Coral `#B94F4A` is for actual danger or exceptions, never the default navigation or primary action. The prototype's 31 softly colored SVG assets are a starting point; preserve semantic labels and 44 px targets.
- The five UI workspaces are Citizen, Volunteer/Rescue Team, Coordinator, Operations, and Admin. Backend role codes are more granular. A workspace, menu item, record, and action appear only when live grants, scope, and object relationships allow them. Hiding a button is not authorization.
- AI never verifies, prioritizes, or dispatches a request automatically. Official P1–P4 is a coordinator decision after verification. Requests remain in the backend's declared queue order.
- Donation means **in-kind supplies only**. A donor declaration does not increase stock. Intake count, independent review, posting, and later handoff have separate state and authority.
- An unsent draft, pending HTTP request, server acknowledgment, and retryable failure must look different. Do not show a tracking code or "received" until the API confirms it.

## 3. Proposed frontend structure

```text
frontend/
  web/
    src/
      app/            routing, providers, error boundaries, workspace shells
      api/            generated OpenAPI types, typed fetch client, service adapters
      auth/           Web cookie session, CSRF, /me, grant/scope helpers
      components/     design tokens, forms, status chips, tables, timelines, dialogs
      features/
        citizen/ volunteer/ coordinator/ operations/ admin/
      assets/icons/   selected SVG image assets from prototype
      i18n/           Vietnamese status/error/enum labels
    public/
    package.json
```

Use same-origin `/api/v1/identity`, `/api/v1/response`, and `/api/v1/logistics` through the existing Nginx ingress in the integrated environment. Configure Vite's development proxy to those paths; inspect `backend/infra/nginx/nginx.conf` and the actual running stack before setting proxy targets. Browser requests use `credentials: 'include'`. Identity Web auth uses HttpOnly cookies, `GET /auth/csrf`, allowed `Origin`, and `X-CSRF-Token` on writes. Do not read tokens from cookies in JavaScript or store access/refresh tokens in local storage. Handle refresh rotation, `REFRESH_RACE`, expired/revoked sessions, and forced password change using the actual Identity contract.

Generate TypeScript types from the checked OpenAPI snapshots using a pinned, currently supported generator selected during implementation. Keep a small handwritten service adapter for headers, pagination, file uploads, and status transitions. Centralize `Idempotency-Key` generation/reuse for retryable commands, `expected_version` conflict handling, Vietnamese error-code mapping, and `202` operation polling. Never call internal service routes from the browser.

## 4. Screen and API slices

| Slice | Prototype screens | Primary contract/API family | Completion behavior |
|---|---|---|---|
| Shared session and shell | Citizen account; all five workspaces | Identity `/auth/*`, `/me`, grants; Response/Logistics authorization | Sign in/out, refresh, CSRF, workspace switch, scoped navigation, 401/403 and offline states |
| Citizen SOS | Help home, SOS form, acknowledgment, private tracking | Response `/requests`, `/requests/proxy`, `/requests/track`, `/requests/mine`, supplements, evidence | SELF guest/account, signed-in PROXY, household pin, accurate acknowledgment, status timeline, updates |
| Citizen public relief | Campaigns, drives, declaration, donation tracking | Response `/public/campaigns`; Logistics `/public/donation-drives*`, `/public/donations*` | Guest/account in-kind declaration, private code, declared/count/accepted differences, dispute flow |
| Volunteer | Overview, missions, progress, team, notices | Response `/missions/mine`, `/missions/{id}*`, `/teams*`, `/notices*` | Leader-only accept/decline/transition; authorized team details, position age, evidence |
| Coordinator | Queue, verify, triage, assign, map, notices, campaigns, reports | Response `/requests*`, `/missions*`, `/map/heatmap`, `/campaigns*`, `/reports/summary` | Scoped queue, manual verification and P1–P4, candidate comparison, explicit dispatch, operation polling |
| Operations | Overview, drives, intake, review, stock, assets, needs, distribution, handoff, reports | Logistics drives, receipts, stock, catalog/assets, needs/commitments, distributions/handoffs/reports; Response campaigns | Permission-specific actions, independent review, posted stock, partial fulfillment and custody history |
| Admin | Overview, users, organizations, grants, regions, audit | Identity `/users*`, `/organizations*`, `/grants*`, `/regions*`, `/audit-logs`; authorized Logistics audit | Scoped management, reason/version confirmations, no implicit victim/donor detail access |

The 38 prototype pages are screen families, not one-to-one API operations. Implement supporting list/detail dialogs and conditional states when the contract requires them. The prototype's numbers and examples must be replaced with real server data or honest empty states.

## 5. Build sequence and acceptance gates

### Phase A — foundation

1. Create `frontend/web/` without modifying backend ownership or adding a Compose file. Pin dependency versions only after checking current primary documentation and compatibility with the repository's Node baseline.
2. Implement tokens, SVG images, responsive shell, five workspaces, shared form fields, list/detail layout, loading/empty/error/offline/denied states, keyboard and screen-reader support.
3. Generate API types from snapshots; implement one browser client with same-origin proxy, cookie credentials, CSRF, idempotency, cursor pagination, and structured Vietnamese error mapping.
4. Integrate Identity `/auth/csrf`, register/login/refresh/logout, `/me`, and grant-aware navigation. Verify with real sessions and permission-denied accounts.

**Gate:** app builds and typechecks; a signed-out guest sees public routes; a signed-in user sees only eligible workspaces; session revocation and 401/403 states are accurate. Responsive shell works at representative phone, tablet, and desktop widths.

### Phase B — Citizen SOS

1. Implement SELF intake for guest and account owner. For guest, create the tracking capability as specified by the Response contract, keep it out of URLs and analytics, and present one-time save guidance. Never log it.
2. Implement PROXY only with a live signed-in session; keep reporter and household contact/location separate. The household pin is authoritative for region derivation; preserve coordinate order `[longitude, latitude]`, `source`, accuracy, and capture time.
3. Implement form review, idempotent submit, truthful acknowledgment, private tracking, reporter-visible timeline, permitted supplements, and evidence upload/download.
4. Use a stable incident-category list only after confirming an exposed catalog or a documented, versioned demo catalog. The current OpenAPI snapshot has no public category route; do not silently invent backend values.

**Gate:** guest SELF and signed-in PROXY pass against the main APIs without a database reset; missing/unknown fields remain unknown; replay does not create duplicate requests; errors and status labels are Vietnamese. Tracking secrets never appear in URL, logs, or persisted browser storage by default.

### Phase C — Citizen donation and public information

Implement campaign/drive browsing, guest and account declarations, capability tracking, discrepancies, private evidence, claim/recovery, and dispute actions that the current contract supports. Distinguish declared, counted, held, accepted, rejected, posted, and delivered quantities. Do not add cash/payment UI.

**Gate:** a declaration never appears as posted stock; the public view exposes no other donor's PII; private tracking and dispute flow use capability/owner checks.

### Phase D — Volunteer and Coordinator

Implement leader/member distinctions, mission offers and transitions, team profile/position and notices. Then implement coordinator queue/detail and all review lanes, contact/duplicate verification, manual triage, team candidates, assignment, map, mission monitoring, and response reports. Support `expected_version` conflicts and pending `202` resolution/cancellation operations where used.

**Gate:** leader-only actions are enforced by backend and correctly hidden in UI; coordinator queue order is not changed by AI; triage and dispatch require explicit human confirmation; stale team position is labeled; exact location/contacts appear only on authorized detail views.

### Phase E — Operations and Admin

Implement drives and campaigns, physical intake count, independent review and stock posting, scoped stock/assets, needs/commitments, distribution approval/dispatch, handoffs/reconciliation, then Identity administration and audit. Compose report panels from Response and Logistics separately, retain each `generated_at`, and show stale/unavailable panels honestly.

**Gate:** count author cannot review own receipt; distribution approver differs from preparer/dispatcher per contract; point receipt is distinct from household handout; ADMIN cannot open SOS or donor detail just because it is ADMIN. Audit reasons are privileged. Do not implement CSV export until a contract route exists; the current T19 inventory has none.

### Phase F — release checks

Run frontend typecheck/build and focused tests for business-critical flows. Verify Vietnamese success, validation, authentication, permission, conflict, notification, and any AI-output surfaces. Check keyboard focus, screen-reader labels, touch targets, color contrast, reduced motion, narrow-browser overflow, and no false acknowledgment under network failure. Use the main C48 services and primary databases for integration/smoke checks; do not add a test Compose/database or reset volumes without an explicit `--reset` request.

## 6. Explicitly deferred or conditional UI

- **Quick SOS message / LLM extraction:** no browser-callable extraction contract or approved PII handling exists. Do not send SOS text or precise location directly to an LLM provider. Once backend exposes a reviewed API, show extracted fields in an editable form, leave absent fields blank, preserve the original text, and require user review before submission.
- **Citizen severity suggestion:** there is no citizen scoring API. No numeric AI score or official P1–P4 before coordinator verification and decision.
- **CSV export:** no backend route in the current T19 inventory. Do not wire the prototype's visual export affordance as a real download.
- **Offline queue, push, payments, procurement, warehouse transfers, full stocktakes:** outside current committed Web/backend scope unless the project plan and contracts change.
- **Storage and operational evidence:** MinIO private evidence/restore, periodic scheduler, representative HTTP timing, report-scale/UI evidence, and some T18 runtime checks remain open backend acceptance gates. The Web must handle temporary unavailability rather than claim them complete.

## 7. Next session: first concrete task

Begin with Phase A. Re-read the required project documents and current Git status, verify the three OpenAPI snapshots against controller source (`npm run contracts:check` from `backend/`), inspect Nginx path/CSRF behavior, then create `frontend/web/`. Implement the responsive shared shell and Identity session/grant flow first. Use the prototype for visual reference, but write production components and API state explicitly; do not copy its mock data or no-op buttons into the product.

The design/prototype files under `frontend/` and `.superdesign/` are committed as implementation references. `frontend/web/` is the product code; the prototype remains illustrative and does not call backend APIs. Browser visual acceptance and live API checks must be recorded separately from this plan.
