# SOS, Authentication, and Rescue Coordination Implementation Plan

> **For agentic workers:** This plan is being executed inline in the current session because the user explicitly asked for implementation. The approved design reference is `docs/guides/c48-manual-change-guide-vi.pdf`.

**Goal:** Extend C48 registration, Google sign-in, SOS reporting and editing, Gemini extraction, coordinator visibility, team-history suggestions, and demo seed data without replacing existing service ownership or human dispatch controls.

**Architecture:** Identity owns email OTP, Google identity verification, and C48 sessions. Response owns SOS facts, human-reviewed AI advisory jobs, transparent risk indicators, team candidate ranking, mission history, and report updates. Web and Mobile consume these contracts; Gemini never writes SOS facts, sets official priority, or assigns a team.

**Tech Stack:** NestJS 12, TypeORM migrations, PostgreSQL/PostGIS, TypeScript, React/Vite, React Native/Expo, Gemini REST API (`gemini-3.1-flash-lite`), SMTP through Nodemailer, and Google ID-token verification through `google-auth-library`.

---

## File map

- Identity: `docs/backend/schema/identity.sql`; `backend/apps/identity/src/database/{data-source.ts,migrations/}`; `backend/apps/identity/src/auth/{auth.dto.ts,auth.controller.ts,auth.service.ts,auth.module.ts,auth-security.ts}`; new SMTP and Google verifier adapters; `backend/.env.example`; `backend/infra/compose.yaml`.
- Response: `docs/backend/schema/response.sql`; `backend/apps/response/src/database/{data-source.ts,migrations/}`; `backend/apps/response/src/requests/`; `backend/apps/response/src/tracking/`; `backend/apps/response/src/operations/`; `backend/apps/response/src/missions/`; `backend/apps/response/src/app.module.ts`.
- Clients and contracts: `frontend/web/src/auth/`, `frontend/web/src/features/citizen/`, `frontend/web/src/features/coordinator/`; `mobile/src/api/`, `mobile/src/store/`, `mobile/src/features/auth/`, `mobile/src/features/citizen/`; `contracts/openapi/`; `backend/scripts/contracts/openapi-details.mjs`.
- Fixtures and documentation: `docs/backend/seed/seed-response.sql`; `backend/scripts/db/check-migration-down`; `docs/backend/02-identity-api.md`; `docs/backend/03-response-api.md`; `docs/backend/07-error-catalog.md`.

## Task 1: Identity email OTP

1. Add nullable `app_user.email`, `email_verified_at`, nullable `password_hash`, and `PENDING_EMAIL` to the canonical Identity schema. Add case-insensitive email uniqueness, `email_verification_challenge`, least-privilege grants, and a data-preserving rollback guard.
2. Add and explicitly register `AddAuthEmailOtpGoogle1792953600000`. Make its `up` idempotent because the initial migration reads the canonical schema. Keep its `down` guarded against accounts, identity links, or challenges that would lose data.
3. Require a normalized email in `RegisterDto`; create a pending account and HMAC-only six-digit challenge; add verify/resend routes with row locking, five-minute expiry, five attempts, one-minute resend delay, and IP/account throttles. Grant `CITIZEN` and activate the user only after successful verification.
4. Add `EmailSender` backed by generic SMTP environment variables. Do not put OTPs or full email addresses in logs. Failed delivery leaves a resendable pending account and does not block anonymous SOS intake.
5. Update Identity API/OpenAPI and Vietnamese errors. Add Web and Mobile registration email fields, verification-code input, resend countdown, and pending-account feedback.

## Task 2: Google sign-in

1. Extend the Identity migration with `external_identity(provider, subject, user_id)` and `app_user_email_lower_uq`; Google-only users may have no password hash.
2. Verify Google ID tokens server-side against the configured web/iOS/Android client-ID allowlist, issuer, expiry, subject, and verified email. Use `sub` as the identity key; never auto-link an existing C48 account by matching email.
3. Add `POST /auth/google` and an authenticated recent-session `POST /auth/google/link`. New Google accounts receive a unique C48 username, verified email, `ACTIVE` status, and `CITIZEN` grant transactionally, then use the existing C48 session issuer.
4. Wire Google Identity Services in Web and Expo AuthSession in Mobile. Ship client IDs only; never place a Google client secret in either client.

## Task 3: SOS facts and owner update

1. Extend `assistance_request` with `needs_rescue DEFAULT true`, `needs_relief_supplies DEFAULT false`, and an at-least-one-need check. Extend `request_subject` with nullable child and elderly counts.
2. Add `mission_kind` (`RESCUE`, `DELIVERY`, `COMBINED`), optional opaque `distribution_id`, and request mission-history index. Keep the current one-active-mission-per-team index.
3. Add and register `AddSosFactsAndMissionKind1792953600000`; use idempotent DDL and refuse rollback when non-default facts or non-RESCUE missions exist.
4. Extend SELF and PROXY intake validation, canonical idempotency hashes, inserts, tracking projections, approved facts, and coordinator detail. Unknown counts remain `null`; child plus elderly counts cannot exceed a known total.
5. Add `PUT /requests/:id/report` as an allowlisted, versioned reporter command using `ReporterAccessService`, `Idempotency-Key`, optimistic locking, immutable events, and the existing supplement-review path after verification or attribution lock. Do not allow lifecycle, priority, region, team, or Logistics fields.

## Task 4: Gemini extraction and rule-based risk advisory

1. Add a Response `ai_advisory` table and a daily usage bucket, with provider/model/prompt/schema versions, request/version/input hash, extraction status, structured JSON, and separate human review fields. Register `AddAiAdvisory1792953600001`.
2. Enqueue extraction in the SOS transaction and process it from the existing Response process using a bounded `SKIP LOCKED` poller. Submit only minimized description text; do not submit names, phones, tracking secrets, exact coordinates, or media. Store no raw provider prompt.
3. Call Gemini's stable `gemini-3.1-flash-lite` endpoint with JSON Schema output, output-token cap, timeout, one-attempt behavior, server-side validation, and Vietnamese fallback errors. Limit all application calls to 500 per America/Los_Angeles calendar day; provider errors must never fail SOS intake.
4. Add staff-only advisory reads and accept/adjust/reject review commands. Write a staff event for each review; do not expose AI advisory in public tracking or apply its facts automatically.
5. Add deterministic risk score/reason codes from declared danger, flood/trapped signals, vulnerable counts, and injury cues. Show them as review guidance only; official P1–P4 remains coordinator-owned.

## Task 5: Candidate history and coordinator/citizen views

1. Preserve the current nearest-distance tolerance algorithm: P1 0 m, P2 500 m, P3/P4 2 km; inside the band, lower 24-hour mission load wins, then distance and team ID.
2. Return candidate workload/history summaries and add a bounded keyset page for all mission outcomes per team/request, including timestamps, terminal status, override reason, and coordinator-recorded provenance.
3. Expand the coordinator detail projection and Web UI with reporter/contact provenance, location accuracy/time, counts, declared danger, requested aid kinds, verified facts, AI advisory/review, candidates/workload, mission history, and reporter-visible timeline.
4. Keep citizen tracking limited to reporter-visible events and existing tracking capability checks. Render every new status and reason in Vietnamese.

## Task 6: Web and Mobile SOS forms

1. Add rescue (default on), relief-supplies (optional), life-threat question, total/child/elderly counts, and quick description fields in both clients. Validate client inputs for usability while retaining backend validation as authority.
2. Submit the SOS immediately without waiting for OTP or Gemini. Send the normal request payload and display its tracking code/guest secret behavior unchanged.
3. Add an explicit Vietnamese notice that the description is sent to Gemini for extraction, and tell reporters not to enter names, phone numbers, identity numbers, or exact addresses in that description.
4. Update citizen tracking to show the new public progress event while keeping staff-only facts hidden.

## Task 7: Seeder, contracts, environment, and documentation

1. Update Identity and Response demo rows with verified/pending-email examples, varied rescue/supply requests, flood/children/elderly/danger combinations, team workloads and mission history. Keep fixture times relative to seed time and add future mission/event examples without replacing existing primary data.
2. Update `backend/scripts/db/check-migration-down` migration counts and rollback expectations for Identity (2) and Response (5).
3. Update `.env.example`, Compose allowlists, environment validation, Identity/Response API docs, Vietnamese error catalog, and OpenAPI snapshots/export metadata.
4. Build Identity, Response, Logistics, Web, and Mobile TypeScript targets. Do not reset or migrate a running database in this implementation session.

## Explicit boundaries

- AI and risk indicators never verify a request, change official priority, choose a team, or dispatch a mission.
- One `rescue_team` may receive RESCUE, DELIVERY, or COMBINED work; its current active-work capacity remains one.
- Logistics remains the owner of stock, approval, dispatch, and handoff. Response stores only the opaque distribution ID.
- A missing external secret disables only its integration path. Required variables are listed for the user after source changes are ready; no real secret is committed.
