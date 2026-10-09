> **Historical v3.3 source — not an implementation contract.** Read the [current backend pack](../../../backend/README.md) for v4.0 authority. Old section numbers, test claims and commands below describe their original revision.

# 03 — Response service: API contract

Schema: [schema/response.sql](../../../backend/schema/response.sql). Conventions: [00](00-setup.md). Permissions: [05](05-permissions.md). State rules: plan §8.1–8.2, §22, §23.2, §26. "Idem" = `Idempotency-Key` required. "Ver" = `expected_version` in body required. Authenticated = session + Identity introspection. Every command writes (same local transaction): state change, `request_event`/`mission_event`/`audit_log`, and notices.

## 1. Request intake and tracking

### `POST /requests` — create SOS (SELF, guest or signed-in) · Idem · public, throttled
Headers: `Idempotency-Key`; guest also `Authorization: C48-Tracking <secret>`; signed-in optional bearer/cookie (ownership link only — validated by **signature only**, no introspection).
```json
{ "incident_category_code": "FLOOD", "description": "…≤2000", "people_affected": 3,
  "reporter_name": "optional", "reporter_contact_phone": "0912345678",
  "reporter_declared_danger": false,
  "location": { "type": "Point", "coordinates": [106.70, 10.77], "source": "GPS", "accuracy_m": 12.0, "captured_at": "2026-10-07T08:30:00Z" } }
```
`201 { id, tracking_code, status: "SUBMITTED", received_at, review_lane }` (replay returns the same body + `Idempotent-Replay`). `location.source ∈ GPS|MANUAL_PIN`; GPS requires `accuracy_m`; manual pin must omit it. Phone: normalized to digits with an optional leading `+` (8–15 digits, DB-checked), required. Server: derives `region_code` by `ST_Covers(region_boundary)` (no match ⇒ null, request still stored), assigns demo intake organization, stores `tracking_secret_hash` (purpose-bound), creates request + subject + REPORTER-visible event "received" atomically; soft throttle breach (per-IP Nginx zone, per-phone `request_phone_idx` count, or the global `SOS_GLOBAL_PER_MIN` ceiling) ⇒ stored with `review_lane=RATE_LIMITED_REVIEW`; only the per-IP **hard** ceiling returns `429 SOS_RATE_CEILING`. `source_ip_hash` is stored. A cookie-authenticated call needs the CSRF token (00 §3.3). `tracking_code` is generated server-side from a CSPRNG (collision ⇒ `ON CONFLICT` retry, never inside an aborted transaction).
Errors: `VALIDATION_FAILED` (`COORDINATES_OUT_OF_RANGE`, `PEOPLE_AFFECTED_OUT_OF_RANGE`, `PHONE_INVALID`, `CATEGORY_UNKNOWN`, `ACCURACY_REQUIRED`), `TRACKING_SECRET_INVALID` 400, `TRACKING_SECRET_IN_USE` 409 (generic, reveals nothing), `IDEMPOTENCY_KEY_REUSED` 409, `RATE_LIMITED` 429 (with 113/114/115 text).

### `POST /requests/proxy` — report for a household · Idem · session required (**always introspected**)
Body as above plus `relationship` (required), `beneficiary_contact_phone?`, `alternate_contact { name, phone? }?`, `information_source`, `last_known_situation_at`, `contactability`. `location` is the **household's** pin (never the reporter's GPS). → `201` same shape. Beyond `PROXY_OPEN_CAP` open reports for the account ⇒ stored with `review_lane=PROXY_QUOTA_REVIEW` (never dropped). Identity outage ⇒ `503 IDENTITY_UNAVAILABLE` (client must not retry as SELF). Errors add `RELATIONSHIP_REQUIRED`.

### Tracking (reporter side)
| Method & path | Auth | Behaviour |
|---|---|---|
| `GET /requests/track` | `Authorization: C48-Tracking <secret>` + `X-Tracking-Code: <code>` (never in the URL) **or** session owner + code | `200 { id, tracking_code, status, priority_visible?: false, received_at, timeline: [ { event_type, occurred_at, public_text_code } ], rejection_reason?, duplicate_of_code?, can_supplement }`. Lookup is by `tracking_secret_hash`, then the code is compared in constant time; wrong/missing secret or code ⇒ the same `404 NOT_FOUND` (no oracle, no timing difference). Limited to 10/min and 60/h per IP; `timeline` returns the last 50 entries with `more` + `GET /requests/{id}/events?cursor=` for the rest. Priority, staff notes, contact attempts, evidence of others are never returned. |
| `POST /requests/{id}/supplements` · Idem | same | `{ description?, people_affected?, location?, reporter_declared_danger? }` — allowed states SUBMITTED..IN_PROGRESS; appends a REPORTER event, increments `version`; terminal ⇒ `STATE_TRANSITION_INVALID`. Prior values stay in `request_event.payload`. |
| `POST /requests/{id}/evidence` · multipart · Idem | same | See §6 (evidence). |
| `GET /requests/mine?cursor=` | session | the account's own requests (list: id, code, status, received_at) |
| `POST /requests/claim` · Idem | session + `C48-Tracking` secret | `{ tracking_code }` → links `reporter_user_id` once, audited; secret stays valid until revoked by the reporter's choice (default: hash cleared after claim). `ALREADY_CLAIMED` 409 |

### Lost tracking secret (plan R-17)
Core: `POST /requests/{id}/tracking-secret/revoke` · Idem · `REQUEST_VERIFY` + scope — `{ reason }` clears `tracking_secret_hash`, writes an audited STAFF event; the old secret stops working; the coordinator tells the reporter the status by phone. The reporter's own path back is **claim after sign-in** (above). **Deferred (add only when scheduled):** re-binding a new secret needs a one-time recovery code (coordinator reads it to the reporter; valid 30 min; stored hashed) and therefore two extra columns `recovery_code_hash`, `recovery_expires_at` on `assistance_request`; they are intentionally absent from `response.sql` until then.

## 2. Coordinator queue, detail and verification

| Method & path | Perm | Behaviour |
|---|---|---|
| `GET /requests?status=&region_code=&priority=&review_lane=&category=&from=&to=&bbox=&declared_danger=&overdue=&cursor=&limit=` | `REQUEST_QUEUE_READ` | Scope is compiled to `organization_id = ANY($) AND (region_code = ANY($) OR campaign_id = ANY($) …)` **before** pagination and must be `EXPLAIN`-checked on 100k rows. Order is fixed `received_at ASC, id ASC` (never by AI/priority); cursor per 00 §3. **`review_lane` defaults to `NORMAL`**; `RATE_LIMITED_REVIEW` / `PROXY_QUOTA_REVIEW` are separate views so spam cannot bury real reports. `bbox` must be ≤ 0.5° × 0.5°. `overdue=true` means `status='VERIFYING'` and (`verifying_since` older than `VERIFY_OVERDUE_MINUTES` or declared danger) — served by `request_verifying_idx`. **Index choice (01 §7 R1):** when `status` is absent or a subset of the open set, the open-status partial indexes serve the queue; history (closed/terminal) uses the full `(organization_id[, region_code], received_at, id)` indexes. A mixed REGION+CAMPAIGN grant list runs one query per grant kind and merges by `(received_at, id)` (00 §3.4 item 5). **Query budget 3:** page, batched latest-decision/overdue flags, one phone-mask/lookup-free pass (no per-row queries). `priority`/`category`/`declared_danger` filter the ordered walk. Row: id, tracking_code, status, priority, review_lane, category, `people_affected`, region, received_at, declared_danger, overdue, **masked phone, no exact point** (`approx_location` rounded to 3 decimals ≈ 100 m). `generated_at`. |
| `GET /requests/unassigned?cursor=` | `REQUEST_UNASSIGNED_QUEUE` (org/system scope) | `region_code IS NULL` queue, keyset, served by `request_unassigned_idx` |
| `GET /requests/{id}` | `REQUEST_DETAIL_READ` | Full detail incl. subject, exact location, contacts, last 50 timeline entries, last 20 contact attempts, the latest verification decision, active missions, up to 5 evidence items, `canonical` and the first 20 `duplicates` — each nested list carries `more: true` and has its own paged sub-resource (`GET /requests/{id}/events`, `/contact-attempts`, `/duplicates`, `/missions`, `/evidence`), plus `version`, `work_cycle`. The verification basis is read from the latest `verification_decision` (no copy on the request row). Audit-read event for exact contact reveal is **not** required (demo) but contact fields appear only here. |
| `POST /requests/{id}/start-verification` · Idem · Ver | `REQUEST_VERIFY` | SUBMITTED→VERIFYING |
| `POST /requests/{id}/contact-attempts` · Idem | `REQUEST_VERIFY` | `{ contact_target, outcome, note? }` → `201`. `NO_ANSWER` never changes status |
| `POST /requests/{id}/verify` · Idem · Ver | `REQUEST_VERIFY` | `{ basis, reason? }`; VERIFYING→VERIFIED. Rules: PROXY needs `CORROBORATED`/`EVIDENCE_REVIEWED` with an independent source (not the same account/phone/IP) or `TWO_COORDINATOR_JUDGMENT`, which requires `reason` and a prior `CONCURRENCE` event (below) by a distinct in-scope coordinator; the server fills `concurring_user_id` from that event (the client never supplies it); a contact attempt or stated reason must exist (`NO_CONTACT_ATTEMPT` 409) |
| `POST /requests/{id}/concur` · Idem | `REQUEST_VERIFY` | `{ note }` — records a `CONCURRENCE` STAFF event by a second coordinator whose payload stores the `request.version` it saw; `verify` (under the request-row lock) accepts it only if that version equals the current one — a later supplement invalidates it. (Never compare `occurred_at`: `now()` is the transaction start time.) No separate table |
| `POST /requests/{id}/reject` · Idem · Ver | `REQUEST_VERIFY` | `{ reason }`; for unreachable reasons requires ≥ 3 REPORTER/ALTERNATE attempts over ≥ 30 min unless `reason_kind = CLEARLY_INVALID` (`REJECT_THRESHOLD_NOT_MET` 409). Beneficiary-only failed calls do not count |
| `POST /requests/{id}/duplicate` · Idem · Ver | `REQUEST_VERIFY` | `{ canonical_request_id, reason }`; locks both rows in sorted id order; canonical must be in scope, not DUPLICATE/REJECTED/CANCELLED, not self; request with inbound links cannot become DUPLICATE (`CANONICAL_HAS_DUPLICATES` 409) |
| `GET /requests/{id}/duplicate-candidates` | `REQUEST_VERIFY` | suggestions only: same category ±24 h within 1 km (`ST_DWithin`), scoped; never auto-links |
| `POST /requests/{id}/triage` · Idem · Ver | `REQUEST_TRIAGE` | `{ priority, priority_basis, reason }`; VERIFIED→TRIAGED or priority change in later states without rewinding; lowering P1/P2 requires reason and writes a distinct event |
| `POST /requests/{id}/authority-referrals` · Idem | `REQUEST_VERIFY` | `{ referred_body, note }` audit only, no state change |
| `POST /requests/{id}/correct-region` · Idem · Ver | `REQUEST_UNASSIGNED_QUEUE` | `{ region_code, reason }` audited |
| `POST /requests/{id}/attach-campaign` / `detach-campaign` · Idem · Ver | `CAMPAIGN_MANAGE` | target campaign ACTIVE and org/region compatible |
| `POST /requests/{id}/cancel` · Idem · Ver | `REQUEST_CANCEL` | via resolution intent (CANCELLATION): freeze Logistics cycle → commit CANCELLED, cancel non-terminal missions, release capacity. **always `202 { operation_id, state }`** (poll `GET /operations/{id}`; a replay of a completed command returns `200` with `Idempotent-Replay: true`). Not allowed from RESOLVING/RESOLVED |
| `POST /requests/{id}/resolve` · Idem · Ver | `REQUEST_RESOLVE` | Seal protocol of plan §23.2, fenced as in 00 §3.1 rule 6; always `202 { operation_id, state }`. `409 RESOLUTION_BLOCKED { reasons: [OPEN_NEED, UNSETTLED_ISSUE, ACTIVE_MISSION, NO_COMPLETED_MISSION_EVIDENCE] }` |
| `POST /requests/{id}/resolve/abort` · Idem | `REQUEST_RESOLVE` | ABORTING → unseal → restore recomputed progress |
| `POST /requests/{id}/close` · Idem · Ver | `REQUEST_RESOLVE` | RESOLVED→CLOSED |
| `POST /requests/{id}/reopen` · Idem · Ver | `REQUEST_REOPEN` | `{ reason }`; RESOLVED/CLOSED→TRIAGED, `work_cycle+1`; campaign closed ⇒ attach/detach first |
| `GET /operations/{operation_id}` | scope | intent state for 202 polling |

Recovery task (in-process scheduler, every 30 s): re-drive PENDING/ABORTING intents with the same intent id; overdue scans: `VERIFYING` older than `VERIFY_OVERDUE_MINUTES` or declared-danger flagged ⇒ overdue badge + one notice per scoped coordinator (unique per source/version/recipient).

Request error codes (messages in [07-error-catalog.md](07-error-catalog.md)): `STATE_TRANSITION_INVALID`; `VERIFICATION_BASIS_REQUIRED` 400, `REASON_REQUIRED` 400, `SECOND_COORDINATOR_REQUIRED` 409, `NO_CONTACT_ATTEMPT` 409, `REJECT_THRESHOLD_NOT_MET` 409, `CANONICAL_INVALID` 409, `CANONICAL_HAS_DUPLICATES` 409, `ALREADY_CLAIMED` 409, `REQUEST_NOT_VERIFIED` 409, `RESOLUTION_BLOCKED` 409, `LOGISTICS_UNAVAILABLE` 503, `CAMPAIGN_NOT_ACTIVE` 409.

## 3. Teams, positions and candidate selection

| Method & path | Perm | Behaviour |
|---|---|---|
| `POST /teams` · Idem | `TEAM_MANAGE_ANY` | `{ name, organization_id, operating_region_code, team_kind, leader_user_id, skill_codes[] }` → creates team + leader membership (leader must hold VOLUNTEER or staff account, validated via Identity lookup) |
| `GET /teams?region_code=&availability=&status=&cursor=` | `TEAM_READ` (coordinator scope) / own team | Row: id, name, kind, availability, skills, `position { age_s, accuracy_m, source }` (no coordinates for non-coordinators) |
| `GET /teams/{id}` · `PATCH /teams/{id}` · Ver | leader (own) / `TEAM_MANAGE_ANY` | name, skills, availability (`UNAVAILABLE` with active mission ⇒ `TEAM_HAS_ACTIVE_MISSION` 409 unless coordinator confirms) |
| `POST /teams/{id}/members` / `…/members/{user_id}/remove` · Idem | leader / coordinator | one ACTIVE team per user (`USER_IN_OTHER_TEAM` 409); cannot remove the only leader (`LEADER_REQUIRED`) |
| `POST /teams/{id}/leader` · Idem · Ver | coordinator | transfer leadership atomically (old→MEMBER, new→LEADER) |
| `PUT /teams/{id}/position` | leader (own) → source GPS/MANUAL_PIN; `TEAM_POSITION_SET_ANY` → `COORDINATOR_REPORTED` | `{ location, accuracy_m?, captured_at, note? }`; upsert (naturally idempotent — no Idempotency-Key). Hot row: an update within 15 s of the last one or moving < 25 m returns `204` **without writing**; audit only when the source changes or a coordinator sets it. No GiST index (hundreds of rows) |
| `GET /requests/{id}/team-candidates?radius_m=` | `MISSION_ASSIGN` | Algorithm (plan §26.3): filter (active member+leader, skills ⊇ required, org/region compatible, AVAILABLE, no active mission) → fresh-position (≤ 30 min) within radius via `ST_DWithin`; `nearest = min(distance)`; tolerance by request priority (P1 0 m, P2 500 m, else 2 km); band = distance ≤ nearest + tolerance; order band by `recent_count` asc, distance asc, team id asc; others by distance; separate list `unknown_position` (selectable with warning). Row: team, `distance_m`, `position_age_s`, `accuracy_m`, `recent_missions_24h`, `has_active_work`, `in_band`, `suggested` (exactly one). Response includes the parameters used. **Read-only.** | **Query budget 3:** eligible teams + positions (`ST_DWithin`), one `GROUP BY team_id` for `recent_missions_24h` and one for `has_active_work` over the candidate ids (`mission_team_recent_idx`, `mission_team_one_active_uq`) — never per team.

## 4. Missions

| Method & path | Perm | Behaviour |
|---|---|---|
| `POST /requests/{id}/missions` · Idem · Ver(request) | `MISSION_ASSIGN` | `{ team_id, override_reason? }` (`override_reason` required when team ≠ suggested; `suggested_team_id` is stored on the mission). Lock order: campaign `FOR SHARE` → request `FOR UPDATE` → team `FOR SHARE` → insert. In one transaction rechecks membership, skills, org/region, AVAILABLE, campaign not PAUSED, request VERIFIED+; inserts OFFERED mission (capacity-one unique index is the final guard ⇒ `TEAM_BUSY` 409), recomputes request progress (DISPATCHED unless accepted work exists), notice to leader. |
| `GET /missions/mine?cursor=` | active member | missions of the member's team (keyset on `(created_at, id)`); fields per "Mission view" below |
| `GET /missions/{id}` | member / `REQUEST_DETAIL_READ` scope | |
| `POST /missions/{id}/accept` · `/decline` · Idem · Ver | active leader | OFFERED→ACCEPTED / DECLINED(+reason); request becomes IN_PROGRESS on first accept |
| `POST /missions/{id}/transition` · Idem · Ver | active leader | `{ to: EN_ROUTE\|ON_SCENE\|COMPLETED\|FAILED, note?, result?: { outcome_note } }`; legal edges only; COMPLETED/FAILED releases the slot; completing never resolves the request |
| `POST /missions/{id}/record-on-behalf` · Idem · Ver | `MISSION_RECORD_ON_BEHALF` | `{ to, recorded_basis: RADIO\|PHONE\|IN_PERSON\|OTHER, reported_by, reason, note? }` — same edges/effects, event shows "Điều phối viên ghi thay" |
| `POST /missions/{id}/cancel` · `/fail` · Idem · Ver | `MISSION_ASSIGN` | reason required; releases capacity; request progress recomputed under the request-row lock |
| `POST /missions/{id}/evidence` · multipart | active leader / coordinator | §6 |
| `GET /missions/overdue-offers?cursor=` | `MISSION_OVERDUE_READ` (coordinator) | OFFERED older than `OFFER_OVERDUE_MINUTES` (flag only; never auto-reassign) |

**Contract notes from the review:** `reject` takes `reason_kind` (`CLEARLY_INVALID`/`UNREACHABLE`/`OTHER`, stored on the decision); every list above is keyset-paginated; internal routes accept end-user context only through a short-lived signed on-behalf-of token issued by Identity (never a free `actor` parameter), and each internal route has an allow-list of caller client ids.

**Mission view** for members: category, description, `people_affected`, exact location (leader and members of the **assigned** team), reporter contact phone (**leader only**), beneficiary/alternate contact (leader only), declared-danger flag, own mission timeline, evidence of this mission. Never: other requests, priority rationale, other teams, verification notes.

Errors: `TEAM_BUSY`, `TEAM_NOT_ELIGIBLE` (details: reason codes `INACTIVE|UNAVAILABLE|SKILL_MISSING|SCOPE_MISMATCH`), `TEAM_HAS_ACTIVE_MISSION`, `MISSION_NOT_LEADER`, `OVERRIDE_REASON_REQUIRED`, `CAMPAIGN_PAUSED`, `RECORDED_BASIS_REQUIRED`, `USER_IN_OTHER_TEAM`, `LEADER_REQUIRED`.

## 5. Campaigns, map, reports, notices

| Method & path | Perm | Behaviour |
|---|---|---|
| `POST /campaigns` · `PATCH /campaigns/{id}` · Ver | `CAMPAIGN_MANAGE` | DRAFT edits only for name/objective/region/dates |
| `POST /campaigns/{id}/activate` · `/pause` · `/resume` · `/close` · Idem · Ver | `CAMPAIGN_MANAGE` | pause/close need `reason`; close ⇒ `CAMPAIGN_HAS_OPEN_REQUESTS` 409 while linked requests non-terminal |
| `GET /campaigns?cursor=` · `GET /campaigns/{id}` | `CAMPAIGN_READ` in scope | protected detail |
| `GET /public/campaigns` | public | **allowlisted projection** only: id, title, objective, broad region name, dates, status ACTIVE/PAUSED. No counts of people, no coordinates |
| `GET /internal/campaigns/{id}` | service token | `{ id, status, organization_id, region_code, version }` for Identity grants and Logistics checks |
| `GET /internal/requests/{id}` | service token + on-behalf-of token (Logistics) | `{ id, status, work_cycle, organization_id, region_code, campaign_id, version }` + whether the **calling user's** scope covers it (computed from the grants in the on-behalf-of token, never from a free parameter). Logistics may cache the status for 5 s for pre-validation and always re-checks under the cycle lock |
| `POST /internal/requests:batch` | service token + on-behalf-of token | **Batch read (plan §27.3, TC-BE-33).** `{ ids: [uuid ≤ 100] }` → `{ items: [ { id, status, work_cycle, organization_id, region_code, campaign_id, version, in_caller_scope } ] }`; ids that do not exist **or** are outside the caller's scope are omitted identically (no disclosure); 101 ids ⇒ `400 VALIDATION_FAILED`. Logistics uses it for any list/board that needs more than one request; it never calls the single-id route in a loop. Query budget 1. |
| `GET /internal/operations/{intent_id}` | service token (Logistics) | `{ kind, state, request_status }` so Logistics can confirm an ABORTING intent before unsealing |
| `GET /map/heatmap?from=&to=&status_layer=confirmed\|unverified&region_code=&category=&cell_m=1000` | `MAP_READ` | Scope filter first; verified open canonical requests (`status IN VERIFIED..RESOLVING`, `canonical_request_id IS NULL`); grid by `ST_SnapToGrid(ST_Transform(location::geometry, <projection>), cell_m)`; row `{ cell: GeoJSON polygon, center, count }`, `generated_at`, filters echoed; cells with count < 1 omitted; no PII; `unverified` layer only for `REQUEST_QUEUE_READ` and clearly separate. Projection EPSG from config (default 32648). **Limits:** `cell_m ∈ {250, 500, 1000, 2000, 5000}`; window ≤ 31 days; `region_code` or `campaign_id` required; ≤ 5,000 cells (`TOO_MANY_CELLS`); `statement_timeout` 5 s; identical queries cached 30 s keyed by the scope hash. Measured at 200k requests: 94 ms (7 days) – 212 ms (30 days); if profiling later exceeds 500 ms add a generated cell column or a materialised cell table (01 §6). |
| `GET /reports/summary?from=&to=&campaign_id=&region_code=` | `REPORT_READ` | window ≤ 366 days and a scope filter required; counts by status/priority, median time receipt→verification→assignment (assignment time = one `min(created_at) … GROUP BY request_id` join, not a per-request LATERAL), active missions, overdue, `generated_at`; cached 60 s |
| `GET /notices?unread=&cursor=` · `POST /notices/{id}/read` | recipient (naturally idempotent) | in-app notices (Vietnamese rendered from codes) |

## 6. Evidence upload (requests and missions)

`POST …/evidence` multipart, one file per call, Idem. Requires `Content-Length` (`411`), a streaming byte counter and the guest limits of 00 §3.3. Steps: authorize owner object → in a short transaction lock the owner row, check count ≤ 5 READY/PENDING and aggregate ≤ 100 MiB (including `declared_bytes` of PENDING), insert `PENDING` row with `declared_bytes` (from `Content-Length`; reject over limit) → stream to a generated immutable key (`req/{id}/{uuid}` or `mission/{id}/{uuid}`) outside any transaction with a byte cap → detect real type (JPEG/PNG ≤ 10 MiB; MP4 H.264/AAC ≤ 50 MiB; reject SVG/HTML/others) → second short transaction sets READY with size, mime, checksum. Failure leaves the SOS intact and the row `FAILED` (retryable by a new upload). The scheduler (advisory-locked, 00 §3.2) reconciles `PENDING` older than 15 min with `UPDATE … WHERE state='PENDING' RETURNING` and deletes the object only if it won the race. `GET /evidence/{id}/download` → authorizes on the owning object then returns `{ url, expires_in: 60 }`. Errors: `EVIDENCE_LIMIT_REACHED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `STORAGE_UNAVAILABLE` 503.

## 7. State and invariants to enforce in code

Request transitions exactly as plan §8.1 diagram; mission as §8.2; DISPATCHED/IN_PROGRESS recomputed from missions (accepted/en-route/on-scene ⇒ IN_PROGRESS; else any OFFERED ⇒ DISPATCHED; else TRIAGED unless human terminal outcome); lock order and modes per 00 §3.1 (campaign `FOR SHARE`/`FOR UPDATE` → request `FOR UPDATE` → team → team_member → mission). Progress recompute updates `status`/`updated_at` but **not** `version`. Reopen increments `work_cycle`, tags new missions, and **clears** `resolved_at` and `resolution_seal_id` (DB CHECKs require both for RESOLVED/CLOSED and forbid one without the other). Entering VERIFYING sets `verifying_since`. While RESOLVING reject offers, progress, supplements, cancel, competing resolve. Priority never affects queue order or dispatch. **Not implemented here:** AI tables/endpoints (plan §12, optional), push notifications, CSV export.

## 8. Tests (planned, link to plan IDs)

TC-01..14, TC-20, TC-21, TC-30, TC-BE-02/03/04/08/11/12/13/16/17/18/22/24/25/27/28, TC-REV-01..08/10..14. Required race tests: two coordinators offer one team; two verifications; duplicate A→B vs B→C; concurrent supplement vs resolve; refresh-free guest retry after lost response.
