> **Superseded condensed draft — retained for history only.** The user requested the full plan and diagrams be preserved. Read the [active full plan](../../c48-technology-and-delivery-plan.md) and [current backend entry point](../../backend/README.md). This draft does not govern implementation.

# C48 Active API Contracts

This is the active English API contract for Identity, Response and Logistics. Common architecture, scope evaluation, lock order, admission/seal protocols and target schema: [01-design.md](01-design.md). Tasks, traceability and planned verification: [03-implementation.md](03-implementation.md). This contract specifies target behavior; application code and target migrations are not yet implemented. Existing SQL is legacy input; apply target deltas in **T0-S** before application implementation.

## 1. Common contracts

| Topic | Binding contract |
|---|---|
| Paths | Prefix relative routes with `/api/v1/identity`, `/api/v1/response` or `/api/v1/logistics`. `/internal/` is service-network only; public proxy returns404. |
| DTO notation | `{field}` required; `field?` optional; `field?:T\|null` permits unknown/null. Unknown fields/query parameters fail VALIDATION_FAILED. UUID identifiers; ISO8601 UTC timestamps; finite coordinates `[longitude,latitude]` in range; nonblank bounded text. `V` below means body includes positive `expected_version`; `I` means Idempotency-Key required. |
| Responses | Explicit DTOs, never entities. GET/detail/action returns200 unless specified; creates201; deletes/logout/password204; operation-start202. Errors use `{code,message,field_errors?,details?,correlation_id}`. All human-readable copy is Vietnamese, independent of Accept-Language; codes/enums remain English. |
| Session (`S`) | Native: `Authorization: Bearer <access>`; Web: host-only HttpOnly Secure SameSite=Strict access cookie. Verify JWT signature/algorithm/issuer/audience/expiry then Identity introspection **every protected call**, no positive cache. Identity unavailable→503, never silently downgrade. Cookie writes require allowed Origin + X-CSRF-Token. |
| Capability (`T`/`D`) | Guest T: `Authorization: C48-Tracking <secret>`; D: `Authorization: C48-Donation <secret>`. Session+capability: native **Bearer plus X-Tracking-Secret/X-Donation-Secret**; Web cookies plus same X header. Never two Authorization values. Client-generated random32-byte base64url secrets, distinct purpose hashes. Identifiers are not credentials. |
| Permissions | Each named permission requires S and one matching grant for action **and** owner organization **and** region/campaign, or explicit SYSTEM action. Alternative grants OR; geographic overlap never crosses organizations. Owner/active-team rights are explicit relationships. No implicit ADMIN victim/donor access. Denied object existence→404; known action denial→403. |
| Versions | Material changes, including automated changes, increment aggregate version; no-op jobs do not. V commands compare expected_version under the aggregate lock, stale→VERSION_CONFLICT. Explicit append commands use their stated parent lock. Recognize replay before version rejection. |
| Idempotency | Every write I except login/refresh/logout, notice-read, position PUT, internal reads and internal intent/business-tuple commands. Claim key in business transaction; same actor/command/key + canonical payload/capability hash returns **original status/body** + Idempotent-Replay:true, never a mutable re-read. Different hash→IDEMPOTENCY_KEY_REUSED. Concurrent duplicate waits or LOCK_TIMEOUT. Validation/auth failures do not consume key. Recovery issuance alone has metadata-only replay (§3). |
| Collections (`P`) | Every collection GET uses `limit` default50, range1..100 and opaque `cursor`; response `{items,next_cursor,generated_at?}`. Cursor binds normalized filters/order/live scope hash. Scope-filter and deduplicate overlapping grants **before** LIMIT. `(sort,id)` keyset, no OFFSET/count. Default chronological `(created_at,id)` ascending; requests `(received_at,id)` ascending; drives/users/audit/notices descending. Catalog `(code,id)` or unique code; declared order never nullable. |
| Nested collections | Detail embeds capped `{items,more,next_cursor}` with named P sub-resource. Events50, contacts20, duplicates20, contributions20, disputes20, evidence5, other children50. Never unbounded detail arrays. Creation line arrays≤50, unique item/line ids; stored larger collections use P sub-resources. |
| Query budget | Default≤4 SQL statements independent of page size; batched children/aggregates, no eager/lazy ORM loading. Batch service lookups≤100 ids; no per-row service calls. Open queues use target partial indexes; history uses full keyset indexes. Scope branches merge/deduplicate before pagination. |
| Decimals | Quantity decimal strings validated **before casting** for numeric(18,3) range and unit.scale. Reject exponent, NaN, Infinity, overflow and excess scale. Positive quantities, except signed nonzero stock-adjustment delta; zero accepted/held/rejected counts allowed. Never sum different units. |
| Privacy | Auth/tracking/private donation responses no-store. No tokens, secret/code headers, phones, exact points or free-text PII in logs/maps/public reports/AI input. Correlation id propagates. Redact Authorization, cookies, all capability/recovery headers and passwords. |
| Internal (`C`) | Audience-restricted service JWT and per-route caller allowlist. User-authorized reads/commands additionally require Identity-signed short-lived on-behalf user context with live authority/scope; never a free actor/grant parameter. Outbound calls outside DB transactions, bounded timeout, specific503 on outage. |

### Role/action catalog

Citizen/guest own-object rights need no staff grant. Active APP leader owns team edits/mission actions; active members read assigned work. Staff permissions below always require matching scope; ADMIN only account/catalog administration explicitly listed.

| Role | Permissions |
|---|---|
| Every signed-in role | REQUEST_CREATE_PROXY; own requests/donations/notices/profile and permitted active-team relationships |
| ADMIN | USER_MANAGE, GRANT_MANAGE, ORG_MANAGE, AUDIT_READ; SYSTEM scope only |
| COORDINATOR | REQUEST_QUEUE_READ, REQUEST_DETAIL_READ, REQUEST_VERIFY, REQUEST_TRIAGE, REQUEST_CANCEL, REQUEST_REOPEN, REQUEST_RESOLVE, REQUEST_UNASSIGNED_QUEUE, TEAM_READ, TEAM_MANAGE_ANY, TEAM_POSITION_SET_ANY, MISSION_ASSIGN, MISSION_RECORD_ON_BEHALF, MISSION_OVERDUE_READ, CAMPAIGN_READ, CAMPAIGN_MANAGE, MAP_READ, NEED_MANAGE, REPORT_READ |
| CAMPAIGN_MANAGER | CAMPAIGN_READ, CAMPAIGN_MANAGE, DONATION_DRIVE_MANAGE, REPORT_READ |
| OPERATIONS_MANAGER | CAMPAIGN_READ, CAMPAIGN_MANAGE, MAP_READ, CATALOG_MANAGE, ASSET_MANAGE, DONATION_DRIVE_MANAGE, NEED_MANAGE, COMMITMENT_MANAGE, DISTRIBUTION_PREPARE, DISTRIBUTION_REVIEW, LOSS_APPROVE, ADJUSTMENT_REVIEW, REPORT_READ |
| INTAKE_STAFF | DONATION_INTAKE, DISTRIBUTION_PREPARE, DISTRIBUTION_DISPATCH, STOCK_ADJUST_REQUEST |
| REVIEWER | DONATION_REVIEW, DISTRIBUTION_REVIEW, LOSS_APPROVE, ADJUSTMENT_REVIEW |
| DISTRIBUTION_STAFF | DISTRIBUTION_PREPARE, DISTRIBUTION_DISPATCH, HANDOFF_RECORD, STOCK_ADJUST_REQUEST |

Extra review authority requires an explicit REVIEWER grant; manager/intake status alone never grants DONATION_REVIEW. Staff grants ORGANIZATION/REGION/CAMPAIGN with parent organization; CITIZEN/VOLUNTEER SYSTEM/ORGANIZATION. REQUEST_UNASSIGNED_QUEUE and region corrections require organization-wide scope. Grant and object relationships both apply to self-service exceptions.

## 2. Identity

Owns accounts, credentials, organizations, memberships, grants, region catalog and sessions; no operational phones/locations. Password Argon2id parameters pinned at setup; minimum10 characters, not username/common-list entry. Unknown/disabled login uses generic INVALID_CREDENTIALS and dummy hash work. JWT10min contains iss/aud/sub/sid/iat/exp/jti, no roles/PII. Refresh opaque32bytes hashed with pepper; one live token/family, absolute expiry never extended. Rotation locks user then refresh row; concurrent reuse<10s→REFRESH_RACE, older reuse revokes family→REFRESH_REUSED. Disable/reset/grant change increments authz_version and revokes families under user lock. Web tokens in cookies (access path `/api/v1`, refresh path `/api/v1/identity/auth`); native tokens in JSON, native login refuses cookies/browser Origin. Temporary-password accounts must change password before other protected business commands.

| Route | Authority | Request → response / guards |
|---|---|---|
| GET /auth/csrf | Public Web | 200 `{csrf_token}` bound to pre-session; rotated on login. |
| POST /auth/register I | Public; Web CSRF | `{username,password,display_name}`→201 `{user:{id,username,display_name}}`; CITIZEN only, role/scope fields rejected. |
| POST /auth/login | Public; Web CSRF | `{username,password,client_kind:WEB\|NATIVE}`→Web `{user,session:{expires_at},must_change_password}`+cookies; native `{user,access_token,refresh_token,expires_in,must_change_password}`. Login5/min IP+username,30/min IP; register3/h IP. |
| POST /auth/refresh | Refresh cookie+Web CSRF / native token | Native `{refresh_token}`; Web `{}`. Same session/token result as login without user; rotation rules above. |
| POST /auth/logout | S+Web CSRF | `{}`→204, revoke family, clear cookies. |
| POST /auth/change-password I | S | `{current_password,new_password}`→204; revoke other families, clear must_change_password. |
| GET /me | S | `{id,username,display_name,status,version,must_change_password,grants:{items,more,next_cursor}}`; full grants through GET /users/{id}/grants with self-read exception. |
| GET /regions P | S | `{code,name,status,version}` rows. |
| POST /users I | USER_MANAGE | `{username,display_name,temporary_password,organization_id?}`→201 user; must_change_password=true, optional validated membership. |
| GET /users P | USER_MANAGE | Filters query/status; username/display-name **prefix** only. `{id,username,display_name,status,version,created_at}`; no credentials. |
| GET /users/{id} | USER_MANAGE | User + capped memberships/grants; GET /users/{id}/memberships P and /grants P. |
| POST /users/{id}/disable I V; POST /users/{id}/enable I V | USER_MANAGE | `{expected_version,reason}`→user; disable revokes families; LAST_ADMIN guard. |
| POST /users/{id}/reset-password I V | USER_MANAGE | `{expected_version,temporary_password,reason}`→204; revoke families, require password change. |
| POST /users/{id}/grants I | GRANT_MANAGE | `{role_code,scope_type,organization_id?,region_code?,campaign_id?,reason}`→201 grant; validate shape/catalog/ownership, no self-grant, maximum100 live grants/user (reject new grant with VALIDATION_FAILED), duplicate→GRANT_EXISTS; revoke target sessions. Campaign grants validated by Response during grant use; no synchronous Identity→Response dependency. |
| POST /grants/{id}/revoke I V | GRANT_MANAGE | `{expected_version,reason}`→grant; soft revoke, LAST_ADMIN, revoke target sessions. |
| GET /users/{id}/grants P | GRANT_MANAGE or S self | Filter include_revoked; `{id,role_code,scope_type,organization_id,region_code,campaign_id,version,revoked_at}`. |
| GET /users/{id}/memberships P | USER_MANAGE or S self | `{organization_id,status,joined_at}`. |
| POST /organizations I | ORG_MANAGE | `{name,organization_kind}`→201 organization. |
| GET /organizations P | ORG_MANAGE | `{id,name,organization_kind,status,version}`. |
| POST /organizations/{id}/deactivate I V | ORG_MANAGE | `{expected_version,reason}`→organization; blocked by active memberships/grants. |
| POST /organizations/{id}/members I | ORG_MANAGE | `{user_id}`→201 membership. |
| POST /organizations/{id}/members/{user_id}/remove I | ORG_MANAGE | `{reason}`→204; preserve membership history. |
| POST /regions I | ORG_MANAGE SYSTEM | `{code,name}`→201 region. |
| POST /regions/{code}/deactivate I V | ORG_MANAGE SYSTEM | `{expected_version,reason}`→region; historical references preserved. |
| GET /audit-logs P | AUDIT_READ | Filters entity_type/entity_id; `{id,actor_id,action,entity_type,entity_id,occurred_at,reason,correlation_id}` and sanitized before/after. |
| POST /internal/token | Client credentials, Response/Logistics | `{client_id,client_secret,audience}`→`{access_token,expires_in}`; service JWT5min. |
| POST /internal/introspect | C Response/Logistics | `{sid,sub}`→`{active,user_id,display_name,status,authz_version,grants}`; grants bounded to100, reject excess at issuance rather than truncate authority. Inactive on revoked/expired/disabled/version mismatch. |
| POST /internal/users:lookup | C Response/Logistics | `{ids:uuid[1..100]}`→`{items:[{id,display_name}]}`; omit unknown; only ids already referenced by caller data. |
| GET /internal/organizations/{id} | C Response/Logistics | `{id,organization_kind,status,version}`. |

Admin writes audit actor/action/entity/sanitized before-after/reason/correlation id atomically. User/grant/session races, independent review and localization checks are planned in 03. Seed only synthetic accounts, including distinct counters/reviewers; bootstrap ADMIN password supplied privately.

## 3. Response intake, tracking, verification and attribution

`RequestIntake = {incident_category_code,location:{type:Point,coordinates:[lng,lat],source:GPS|MANUAL_PIN,accuracy_m?,captured_at},description?:string≤2000,people_affected?:integer1..10000|null,reporter_name?,reporter_contact_phone?:string|null,reporter_declared_danger?:boolean}`. GPS requires nonnegative accuracy; MANUAL_PIN omits accuracy. Phone omitted/null means unknown; supplied phone normalized optional+ and8..15digits. Description/media optional. **No citizen item/quantity selection**. Server assigns intake organization, derives region by seeded boundaries; unknown/ambiguous region=null and SOS remains accepted. Guest stores secret/key before sending; signed-in SELF ownership link may use signature-only intake validation to preserve SOS availability; all later owner-sensitive actions require live S. Soft IP/phone/global limits store review lane, hard IP ceiling429; no lost SOS on evidence/storage failure.

`ProxyIntake = RequestIntake + {relationship,household_reference_note?,beneficiary_contact_phone?:string|null,alternate_contact?:{name,phone?:string|null},information_source,last_known_situation_at,contactability}`. Location is affected household pin, not reporter GPS. PROXY requires live S and REQUEST_CREATE_PROXY; quota excess stores PROXY_QUOTA_REVIEW; Identity failure503, never fallback SELF.
`Sources = {contact_attempt_ids?:uuid[≤50],evidence_ids?:uuid[≤5],request_ids?:uuid[≤50]}`. Each reference must exist and be in scope: contacts/evidence on this request or explicitly referenced corroborating request; evidence READY and authorized. source_note records source/independence/limitations; no nonexistent external-record ids or same-account/phone proof, no IP-only verdict. Missing/unauthorized/mismatched references→SOURCE_REFERENCE_INVALID without disclosure.

| Route | Authority | DTO → response / guards |
|---|---|---|
| GET /request-categories P | Public | `{code,name,description?}` active categories; no victim data. |
| GET /skills P | S | `{code,name}` active skill catalog. |
| POST /requests I | Public T or signed-in SELF | RequestIntake→201 `{id,tracking_code,status:SUBMITTED,received_at,review_lane,version}`; secret purpose/hash uniqueness, safe lost-response replay. |
| POST /requests/proxy I | REQUEST_CREATE_PROXY | ProxyIntake→same201; reporter account and household subject separate. |
| GET /requests/track | T+X-Tracking-Code or S owner+X-Tracking-Code | `{id,tracking_code,status,version,received_at,can_supplement,followup_required,timeline,rejection_reason?,duplicate_of_code?,canonical_outcome?}`. Timeline cap50 with P events route. Wrong credential/code→same404;10/min,60/h IP. No priority rationale/staff notes. |
| GET /requests/mine P | S owner | Own `{id,tracking_code,status,received_at,version,followup_required}`. |
| POST /requests/claim I | S+T using dedicated secret header | `{tracking_code}`→200 `{id,tracking_code}`; bind reporter_user_id once, clear secret, audit; owned→ALREADY_CLAIMED. |
| POST /requests/{id}/tracking-secret/revoke I V | REQUEST_VERIFY | `{expected_version,reason}`→204; clear secret only, not ownership, audited. |
| POST /requests/{id}/recovery I V | REQUEST_VERIFY | `{expected_version,reason,verified_contact_basis:{contact_attempt_id,confirmation_basis,source_note}}`→201 `{issuance_id,recovery_code,expires_at}`; existing successful authorized contact record verifies reporter identity, name/phone alone insufficient. |
| POST /requests/recover I | S+X-Recovery-Code | `{tracking_code}`→200 `{id,tracking_code}`; bind once, revoke old secret, consume code atomically. No credential in URL. |
| POST /requests/{id}/supplements I V | T or S owner | `{expected_version,description?,household_reference_note?,people_affected?:integer1..10000\|null,location?,reporter_declared_danger?}`→201 `{event_id,version,followup_required}`; at least one fact, only SUBMITTED..IN_PROGRESS. Immutable history; post-verification handling below. |
| POST /requests/{id}/supplements/{event_id}/review I V | REQUEST_VERIFY | `{expected_version,decision:ACCEPT\|REJECT,reason,source_refs?:Sources,source_note?}`→200 `{version,verification_revision,followup_required}`; review exact material supplement, source-validation and snapshot rules below. |
| GET /requests P | REQUEST_QUEUE_READ | Filters status/region_code/priority/review_lane/category/from/to/bbox/declared_danger/overdue/followup_required; bbox≤0.5°each side. FIFO `(received_at,id)`. Row `{id,tracking_code,status,priority,review_lane,category,people_affected,region_code,received_at,declared_danger,overdue,followup_required,masked_phone,approx_location,version}`; location rounded3decimals, generated_at. Default NORMAL except overdue=true defaults all lanes. Budget3. |
| GET /requests/unassigned P | REQUEST_UNASSIGNED_QUEUE organization-wide | region=null only, same safe row projection. |
| GET /requests/{id} | REQUEST_DETAIL_READ | Request/subject/contact detail, verified snapshot and verification_revision, latest decision, followup_required, work_cycle/version, active mission page, capped events50/contacts20/duplicates20/evidence5; sensitive phones only scoped coordinator/reporter and assigned leader. |
| GET /requests/{id}/events P | REQUEST_DETAIL_READ or T/S owner | Staff full authorized timeline; reporter REPORTER visibility only, safe canonical outcome. |
| GET /requests/{id}/contact-attempts P | REQUEST_VERIFY | `{id,contact_target,outcome,note,occurred_at,actor_id}`. |
| GET /requests/{id}/duplicates P | REQUEST_DETAIL_READ | Safe linked request summaries, matching scope only. |
| GET /requests/{id}/missions P | REQUEST_DETAIL_READ | Current/historical scoped mission summaries; filter work_cycle. |
| GET /requests/{id}/evidence P | REQUEST_DETAIL_READ or T/S owner | Authorized evidence metadata only; reporter cannot see staff-only evidence. |
| POST /requests/{id}/start-verification I V | REQUEST_VERIFY | `{expected_version}`→request; SUBMITTED→VERIFYING, set verifying_since. |
| POST /requests/{id}/contact-attempts I | REQUEST_VERIFY | `{contact_target:REPORTER\|BENEFICIARY\|ALTERNATE,outcome,note?,occurred_at}`→201 contact attempt; lock parent, append, increment material version; NO_ANSWER never rejects. |
| POST /requests/{id}/concur I V | REQUEST_VERIFY | `{expected_version,note}`→201 `{event_id,reviewed_version,resulting_version}`; VERIFYING only, exact version protocol below. |
| POST /requests/{id}/verify I V | REQUEST_VERIFY | `{expected_version,basis,reason?,source_refs?:Sources,source_note?,concurrence_event_id?}`→request with verification_revision; VERIFYING→VERIFIED. Contact attempt or reason required. PROXY requires independent CORROBORATED/EVIDENCE_REVIEWED sources, or TWO_COORDINATOR_JUDGMENT with reason and valid distinct concurrence. |
| POST /requests/{id}/reject I V | REQUEST_VERIFY | `{expected_version,reason_kind:CLEARLY_INVALID\|UNREACHABLE\|OTHER,reason}`→request; VERIFYING→REJECTED; UNREACHABLE requires≥3 REPORTER/ALTERNATE attempts over≥30min, beneficiary-only failure insufficient. Inbound links preserved. |
| POST /requests/{id}/duplicate I V | REQUEST_VERIFY | `{expected_version,canonical_request_id,reason}`→request; VERIFYING→DUPLICATE; sorted row locks, authorized target, no self/chain/cycle, target not DUPLICATE/REJECTED/CANCELLED. Inbound links forbid source→DUPLICATE only. |
| GET /requests/{id}/duplicate-candidates P | REQUEST_VERIFY | Scoped same-category ±24h and≤1km suggestions, distance/id keyset; never automatic linking. |
| POST /requests/{id}/triage I V | REQUEST_TRIAGE | `{expected_version,priority:P1\|P2\|P3\|P4,priority_basis,reason}`→request; VERIFIED→TRIAGED or later priority update without rewind; lowering P1/P2 separately audited. |
| POST /requests/{id}/authority-referrals I | REQUEST_VERIFY | `{referred_body,note}`→201 referral event; audit only. |
| POST /requests/{id}/correct-region I V | REQUEST_UNASSIGNED_QUEUE organization-wide | `{expected_version,region_code,reason}`→request; ATTRIBUTION_LOCKED if admitted. |
| POST /requests/{id}/attach-campaign I V | CAMPAIGN_MANAGE | `{expected_version,campaign_id,reason}`→request; ACTIVE target/compatible org+region and request scope; ATTRIBUTION_LOCKED if admitted. |
| POST /requests/{id}/detach-campaign I V | CAMPAIGN_MANAGE | `{expected_version,reason}`→request; ATTRIBUTION_LOCKED if admitted. |

### Immutable verification and follow-up

`assistance_request.verification_revision` is nullable UUID FK to immutable `request_event.id`, constrained to a verification snapshot event for that request. VERIFY creates event payload `{verified_snapshot:{incident_category_code,description,people_affected,location,reporter_declared_danger,subject:{household_reference_note,relationship,information_source,last_known_situation_at,contactability},contacts:{reporter_name,reporter_contact_phone,beneficiary_contact_phone,alternate_contact},source_revisions},basis,source_refs,source_note?,concurrence_event_id?}` and sets this pointer atomically. Snapshot retains unknown values as null. The event is the immutable approved revision; existing request_subject fields are the spatial/list projection, updated atomically only on approved review after verification. No additional verified_* fact columns. Mission.verification_revision is a required immutable same-request snapshot FK captured at offer; MissionView reads that destination even after subsequent request reviews.
`request_event.payload` on CONCURRENCE contains positive paired `reviewed_version` and `resulting_version`, with resulting_version=reviewed_version+1. `verification_decision.concurrence_event_id` is a nullable UUID FK to that event, required for TWO_COORDINATOR_JUDGMENT and checked for the same request and distinct authorized actor; no version columns are added to verification_decision. Concur locks request at version V, appends immutable CONCURRENCE `{reviewed_version:V,resulting_version:V+1,note}`, increments request to V+1, returns both versions. Verify must submit expected_version=V+1 and that event id; under lock require current version=resulting_version and reviewed_version=resulting_version−1. Actor must be distinct from verifier, still authorized/in scope; no intervening material mutation. Verify appends its snapshot and increments version again. A concurrence never verifies a report by itself.
Before verification, supplements append history and may update unverified reported fields. After verification, danger=true also immediately raises the existing unverified reporter_declared_danger alert marker (material version change); only scoped review can clear it, never a later citizen false alone. Other supplements append **reported** facts only; never overwrite verified snapshot or mission destination and never rewind status. Changes to description/situation, location, headcount or danger are material; any unreviewed material event gives `followup_required=true`. Review appends immutable SUPPLEMENT_REVIEW `{supplement_event_id,decision,reason,source_refs,source_note?,previous_verification_revision,verified_snapshot?}`. ACCEPT contains full new approved snapshot and becomes verification_revision; REJECT keeps pointer. Each supplement has at most one final review; stale/duplicate review conflicts. Pending flag derives from material supplements with no final review; no unrelated mutable flag.
Follow-up alone never automatically halts an already accepted mission or resolves/dispatches work. Staff must explicitly review current pending material facts before a new triage/mission offer/resolve. Existing mission destination remains the snapshot captured when offered; a changed destination requires cancelling/replacing that mission. ACCEPT cannot move a location outside locked region: new report or authorized new cycle required, old cycle remains historical.
Alerts scan **all lanes**: SUBMITTED age from received_at, VERIFYING age from verifying_since, or declared danger immediately; one notice per source/version/recipient. Routine NORMAL queue remains independently filterable. Alerts never select priority or dispatch. Canonical REJECTED/CANCELLED outcomes are allowed with usual guards and reason despite inbound duplicates; preserve links, no cascading state/delete/fulfillment closure. Reporter timeline shows safe canonical outcome only.

### Recovery, admission and exact target deltas

Request/donation recovery codes: random, purpose/object-bound hash,30min expiry, one live issuance/object; issuance replaces prior code. Initial201 exposes plaintext **once**. Same issuance-key replay returns original201 with `{issuance_id,expires_at}` and Idempotent-Replay:true, **without recovery_code**; this is the sole explicit original-body replay exception. Issuance response DTO makes recovery_code optional only on replay. Never retain plaintext in idempotency storage/logs/URLs. Redeem uses live S+X-Recovery-Code+identifier, binds unowned account exactly once, clears old secret and consumes code atomically; already-owned→ALREADY_CLAIMED. Wrong/expired/consumed code or identifier→same404. Redeem replay recognized through hashed original credential/key and returns original success without consuming again.
Target T0-S adds nullable `recovery_code_hash` and `recovery_expires_at` to requests and donation deliveries, paired nullability and unique non-null hash per service; purpose/object binding is in hashing, issuance_id and issuer/basis/time live in immutable audit/event metadata, consumption clears both recovery fields. Issuance/redeem replay stores safe metadata only. Add verification_revision FK above; immutable event snapshots/review references with same-request integrity and unique final review per supplement. No claim these exist in legacy SQL.
**Exact attribution delta:** `ALTER TABLE assistance_request ADD COLUMN attribution_locked_at timestamptz NULL;`. First mission offer OR authenticated Logistics admission sets stamp under request lock, incrementing version if newly set; only reopen clears it. attach/detach/correct-region cannot change admitted attribution. Stamp persists conservatively if Logistics fails.
`POST /internal/requests/{id}/cycles/{work_cycle}/admit` (C Logistics + signed live actor with NEED_MANAGE and request scope), body `{}`, business-tuple idempotency `(request_id,work_cycle)`→200 `{request_id,work_cycle,organization_id,region_code,campaign_id,version,attribution_locked_at}`. Require current cycle, status VERIFIED/TRIAGED/DISPATCHED/IN_PROGRESS, no pending material follow-up and eligible campaign. Repeated eligible current-cycle admission returns canonical attribution; old cycle→WORK_CYCLE_MISMATCH. Logistics calls before its transaction, then upserts/locks cycle with canonical attribution; local freeze/seal protects delayed writes. Admission is the meaningful marker, not a naive remote-check atomicity promise.

## 4. Teams, missions, campaigns and operational commands

`TeamCreate={name,organization_id,operating_region_code,team_kind,reporting_mode:APP|COORDINATOR,leader_user_id?,external_contact_note?,skill_codes:code[≤50]}`. APP requires active eligible leader account; COORDINATOR requires external_contact_note, may have zero accounts. Exact T0-S readiness delta: `ALTER TABLE rescue_team ADD COLUMN readiness_required boolean NOT NULL DEFAULT false;`. Active cancellation sets readiness_required=true and UNAVAILABLE atomically; ready clears it only with the required acknowledgment. Generic PATCH cannot clear it or set AVAILABLE while it is true. No fake account/automatic acceptance. Affiliation requires recorded verification before assignment; self-declared team_kind is not proof.
`MissionView={id,request_id,work_cycle,team_id,status,version,category,description,people_affected,location,declared_danger,offered_at,events,evidence}`. Assigned active team members see task snapshot/exact point and own mission evidence only; contact phones only assigned active APP leader, reporter or authorized scoped coordinator. No other teams' work or verification rationale. COORDINATOR teams get reports through authorized coordinator, not public access.

| Route | Authority | DTO → response / guards |
|---|---|---|
| POST /teams I | TEAM_MANAGE_ANY | TeamCreate→201 team+optional APP leader membership. |
| GET /teams P | TEAM_READ or S own active membership | Filters region_code/availability/status; `{id,name,team_kind,reporting_mode,availability,skills,position:{age_s,accuracy_m,source},version}`; coordinates only scoped coordinator/own team. |
| GET /teams/{id} | TEAM_READ or S active member | Team detail, capped members/skills; GET /teams/{id}/members P same authority. External contact only scoped coordinator/leader. |
| PATCH /teams/{id} I V | TEAM_MANAGE_ANY or active APP leader | `{expected_version,name?,skill_codes?,availability?:AVAILABLE\|UNAVAILABLE,external_contact_note?}`; cannot bypass readiness-required latch; UNAVAILABLE with live mission refused, use mission cancellation. Mode/ownership not patchable. |
| POST /teams/{id}/members I V | TEAM_MANAGE_ANY or active APP leader | `{expected_version,user_id}`→201 membership; one active team/user, eligible account. |
| POST /teams/{id}/members/{user_id}/remove I V | Same as members | `{expected_version,reason}`→204; APP must retain active leader. |
| POST /teams/{id}/leader I V | TEAM_MANAGE_ANY | `{expected_version,user_id,reason}`→team; APP only, atomically transfer active membership leadership. |
| POST /teams/{id}/verify-affiliation I V | TEAM_MANAGE_ANY | `{expected_version,confirmation_basis,source_note}`→team; immutable verification event/basis. |
| POST /teams/{id}/ready I V | TEAM_MANAGE_ANY or active APP leader | `{expected_version,confirmation_basis,reported_by?,occurred_at}`→team; coordinator requires reported_by; no live mission; acknowledge latest unavailable decision, clear readiness latch and set AVAILABLE. |
| PUT /teams/{id}/position | Active APP leader / TEAM_POSITION_SET_ANY | `{location,accuracy_m?,captured_at,note?}`→204; leader GPS/MANUAL_PIN, coordinator COORDINATOR_REPORTED. ≤15s update or<25m movement no-op; changed stored position bumps version; bounded source audit. |
| GET /requests/{id}/team-candidates P | MISSION_ASSIGN | radius_m positive≤100000, default10000. Eligible affiliation/mode/skills/org/region/AVAILABLE/capacity teams; fresh position≤30min within radius. Nearest tolerance P1=0,P2=500m,others2000m; band orders recent24h count/distance/id, rest distance/id. Deterministic ranked cursor, scoped filter hash. Unknown-position P list via position=unknown, selectable with warning. `{team,distance_m,position_age_s,accuracy_m,recent_missions_24h,has_active_work,in_band,suggested}` plus parameters; exactly one suggestion across eligible ranked set, never dispatch. Budget3. |
| POST /requests/{id}/missions I V | MISSION_ASSIGN | `{expected_version,team_id,override_reason?}`→201 MissionView; only TRIAGED/DISPATCHED/IN_PROGRESS, current verified snapshot reviewed, campaign eligible; override required if not suggested. Atomic capacity-one OFFERED insert and attribution stamp, snapshot destination, notices. |
| GET /missions/mine P | S active member | MissionView for active own team; historical mission access rechecked by current relationship. |
| GET /missions/{id} | REQUEST_DETAIL_READ or assigned active member | MissionView and capped events/evidence; GET /missions/{id}/events P and /evidence P same authorization/projection. |
| POST /missions/{id}/accept I V | Active APP leader | `{expected_version}`→mission; OFFERED→ACCEPTED, campaign must be ACTIVE. |
| POST /missions/{id}/decline I V | Active APP leader | `{expected_version,reason}`→mission; OFFERED→DECLINED, free slot. |
| POST /missions/{id}/transition I V | Active APP leader | `{expected_version,to:EN_ROUTE\|ON_SCENE\|COMPLETED\|FAILED,note?,occurred_at,result?:{outcome_note}}`→mission; legal edges only, COMPLETED needs outcome_note; no media mandatory. |
| POST /missions/{id}/record-on-behalf I V | MISSION_RECORD_ON_BEHALF | `{expected_version,to:ACCEPTED\|DECLINED\|EN_ROUTE\|ON_SCENE\|COMPLETED\|FAILED,recorded_basis:RADIO\|PHONE\|IN_PERSON\|OTHER,reported_by,reason,occurred_at,note?,result?:{outcome_note}}`→mission; same legal edges, COMPLETED structured outcome valid without media; audit recorder/reporting source separately. |
| POST /missions/{id}/cancel I V; POST /missions/{id}/fail I V | MISSION_ASSIGN | `{expected_version,reason,occurred_at}`→mission; cancel OFFERED frees immediately; cancel active accepted/travel/scene sets team UNAVAILABLE and readiness-required atomically. Fail active mission needs recorded outcome; terminal rows immutable. |
| POST /missions/{id}/review-failure I V | REQUEST_RESOLVE | `{expected_version,disposition:REPLACED\|NO_FURTHER_ACTION\|REFERRED,reason,replacement_mission_id?}`→200 `{event_id,mission_version,request_version}`; FAILED only, lock request/mission, scope and current cycle; REPLACED requires completed replacement in same request/cycle. Append STAFF request_event MISSION_FAILURE_REVIEW payload with mission_id, resulting mission_version, disposition, reason and replacement id; increment both versions. Resolve requires review for every current-cycle FAILED mission. Other dispositions never waive the genuine completed-outcome requirement. |
| GET /missions/overdue-offers P | MISSION_OVERDUE_READ | OFFERED beyond configured age, scoped summaries; badge/notice only, no auto-reassignment. |
| POST /requests/{id}/cancel I V | REQUEST_CANCEL | `{expected_version,reason}`→202 `{operation_id,state}`; SUBMITTED..IN_PROGRESS only, durable CANCELLATION freeze intent; preserve inbound duplicate links. Freeze then cancel request/nonterminal missions with active-team safety, explicitly settle Logistics goods; never delete history. |
| POST /requests/{id}/resolve I V | REQUEST_RESOLVE | `{expected_version,resolution_reason,mission_not_required?:boolean}`→202 operation; TRIAGED/DISPATCHED/IN_PROGRESS only; no pending follow-up/live missions, every current-cycle FAILED mission explicitly reviewed, plus current-cycle structured completed outcome or zero-mission explicit mission_not_required=true. Current cycle with any failed/cancelled mission cannot use zero-mission branch. Obtain settled seal. |
| POST /requests/{id}/resolve/abort I V | REQUEST_RESOLVE | `{expected_version,reason}`→202 operation; RESOLUTION-only alias of operation abort below. |
| POST /requests/{id}/close I V | REQUEST_RESOLVE | `{expected_version,reason}`→request; RESOLVED→CLOSED. |
| POST /requests/{id}/reopen I V | REQUEST_REOPEN | `{expected_version,reason,campaign_id?:uuid\|null,region_code?}`→request; RESOLVED/CLOSED→TRIAGED in one Response transaction. Omit campaign retains only ACTIVE; null detaches; supplied ACTIVE compatible campaign requires CAMPAIGN_MANAGE target scope. Region change requires org-wide REQUEST_UNASSIGNED_QUEUE. Increment cycle, clear stamp/resolved_at/seal, retain historical snapshot and pending review history; old Logistics cycle untouched. Never separately mutate old sealed attribution. |
| GET /operations/{id} | Kind-specific REQUEST_RESOLVE or REQUEST_CANCEL | Live coordinator + request scope, including initiator; `{id,kind,state,request_id,version,previous_status,result?,failure_code?}`. Completed polling200; original command replay stays202. |
| POST /operations/{id}/adopt I V | Kind-specific permission above | `{expected_version,reason}`→operation; live coordinator takes responsibility atomically/audited; worker revalidates current actor authority. |
| POST /operations/{id}/abort I V | Kind-specific permission above | `{expected_version,reason}`→202 operation; RESOLUTION or CANCELLATION before irreversible commit; persist ABORTING, fence/unseal/unfreeze exact intent then restore saved SUBMITTED/VERIFYING/VERIFIED or recomputed later progress. Terminal/committed operation→OPERATION_NOT_ABORTABLE. |
| POST /campaigns I | CAMPAIGN_MANAGE | `{organization_id,name,objective,region_code,starts_at?,ends_at?}`→201 DRAFT campaign. |
| PATCH /campaigns/{id} I V | CAMPAIGN_MANAGE | `{expected_version,name?,objective?,region_code?,starts_at?,ends_at?}`→campaign; DRAFT only. |
| POST /campaigns/{id}/activate I V; POST /campaigns/{id}/pause I V; POST /campaigns/{id}/resume I V; POST /campaigns/{id}/close I V | CAMPAIGN_MANAGE | All four POST I V; `{expected_version,reason?}`; pause/close reason required. DRAFT→ACTIVE→PAUSED→ACTIVE; close from ACTIVE/PAUSED requires all linked requests CLOSED/REJECTED/DUPLICATE/CANCELLED. |
| GET /campaigns P; GET /campaigns/{id} | CAMPAIGN_READ | Scoped protected campaigns; manager grants explicitly include read. |
| GET /public/campaigns P | Public | ACTIVE/PAUSED allowlist `{id,title,objective,broad_region_name,starts_at,ends_at,status}`; no victim counts/coordinates. |
| GET /map/heatmap P | MAP_READ; unverified layer also REQUEST_QUEUE_READ | from/to≤31days, region_code or campaign_id, category?, status_layer=confirmed|unverified, cell_m∈250/500/1000/2000/5000. Scoped canonical counts, confirmed VERIFIED..RESOLVING; EPSG3405;≤5000 cells then error, cell/id keyset; `{cell,center,count}`, generated_at/filter echo. Cache30s scope hash. |
| GET /reports/summary | REPORT_READ | from/to≤366days + scoped campaign_id/region_code; bounded status/priority buckets, median receipt→verification→assignment, active missions/overdue, generated_at; cache60s. |
| GET /notices P; POST /notices/{id}/read | S recipient only | GET filters unread; Vietnamese notice rows. POST `{}`→204 naturally idempotent. |
| GET /internal/campaigns/{id} | C Identity/Logistics | `{id,status,organization_id,region_code,version}`; no PII. |
| GET /internal/requests/{id} | C Logistics + signed actor | NEED_MANAGE or REPORT_READ + request scope→`{id,status,work_cycle,organization_id,region_code,campaign_id,version,attribution_locked_at}`; prevalidation only. |
| POST /internal/requests:batch | C Logistics + signed actor | Same permissions; `{ids:uuid[1..100]}`→same scoped items; unknown/out-of-scope omitted identically, budget1. |
| GET /internal/operations/{intent_id} | C Logistics | `{id,kind,state,request_id,work_cycle,request_status,version}` for exact intent fences only. |

Mission edges: OFFERED→ACCEPTED/DECLINED/CANCELLED; ACCEPTED→EN_ROUTE→ON_SCENE→COMPLETED; ACCEPTED/EN_ROUTE/ON_SCENE→FAILED/CANCELLED. Terminal frees slot; active cancellation readiness is a separate team guard. Progress under request lock: accepted/travel/scene wins→IN_PROGRESS, else offers→DISPATCHED, else TRIAGED; never overwrite human terminal/RESOLVING. Completion alone never resolves. Campaign pause blocks new offers/acceptance, admitted new needs/commitments; accepted missions/physical settlements can finish. Resolution blockers use RESOLUTION_BLOCKED details reasons OPEN_NEED/UNSETTLED_ISSUE/ACTIVE_MISSION/NO_COMPLETED_MISSION_EVIDENCE/PENDING_FOLLOWUP; no-mission reasoned branch remains valid. Local terminal intent fences survive remote precheck races; no TTL/automatic unseal.

## 5. Logistics catalog, stock and donations

`Asset={organization_id,region_code,name,address_note?,location?}`; relief point location required. `Vehicle={organization_id,region_code,identifier,vehicle_type,capacity?,capacity_unit?}`; both capacity fields together, validated unit. Organization/region must match caller ASSET_MANAGE grant. PATCH never reassigns owner organization; region changes only if no operational references, otherwise new asset. Historical deactivated assets remain readable, cannot be selected for new work.
`L` read authority: S + owning catalog/asset scope with one of CATALOG_MANAGE/ASSET_MANAGE/DONATION_DRIVE_MANAGE/DONATION_INTAKE/DONATION_REVIEW/NEED_MANAGE/COMMITMENT_MANAGE/DISTRIBUTION_PREPARE/DISTRIBUTION_REVIEW/DISTRIBUTION_DISPATCH/HANDOFF_RECORD/REPORT_READ. Stock reads narrower: REPORT_READ/DONATION_INTAKE/COMMITMENT_MANAGE/DISTRIBUTION_PREPARE/DISTRIBUTION_DISPATCH + warehouse scope.

| Route | Authority | DTO → response / guards |
|---|---|---|
| GET /item-types P; GET /units P; GET /items P | L | type/status/query prefix filters; `{id?,code?,name,status,version,unit_code?,scale?}`; Vietnamese catalog names. |
| POST /item-types I | CATALOG_MANAGE | `{code,name}`→201 type. |
| POST /units I | CATALOG_MANAGE | `{code,name,scale:integer0..3}`→201 unit; code/scale immutable after use. |
| POST /items I | CATALOG_MANAGE | `{item_type_code,unit_code,name}`→201 item; unique name/unit. |
| POST /items/{id}/deactivate I V | CATALOG_MANAGE | `{expected_version,reason}`→item; history retained. |
| POST /warehouses I; POST /relief-points I | ASSET_MANAGE | Asset→201 asset; warehouse accepts location_public?:boolean; public location opt-in only. |
| PATCH /warehouses/{id} I V; PATCH /relief-points/{id} I V | ASSET_MANAGE | `{expected_version,name?,region_code?,address_note?,location?,location_public?}`; location_public warehouse only, point location cannot become null. |
| GET /warehouses P; GET /warehouses/{id}; GET /relief-points P; GET /relief-points/{id} | L | Scoped asset DTOs, no unrelated contacts. |
| POST /warehouses/{id}/deactivate I V; POST /relief-points/{id}/deactivate I V | ASSET_MANAGE | `{expected_version,reason}`→asset; preserve open-work settlement access. |
| POST /vehicles I | ASSET_MANAGE | Vehicle→201 vehicle; vehicle identifier unique. |
| PATCH /vehicles/{id} I V | ASSET_MANAGE | `{expected_version,region_code?,identifier?,vehicle_type?,capacity?,capacity_unit?}`→vehicle; scope/ownership guards above. |
| GET /vehicles P; GET /vehicles/{id} | L | Scoped Vehicle + status/version. |
| POST /vehicles/{id}/deactivate I V | ASSET_MANAGE | `{expected_version,reason}`→vehicle. |
| POST /stock/opening I | ASSET_MANAGE with OPERATIONS_MANAGER grant | `{warehouse_id,lines:[{item_id,quantity}],note}`→201 movements; one opening business key per warehouse/item, no fabricated donation. |
| GET /stock P | Stock-read authority | warehouse_id required, item_id?; `{balance_id,item_id,unit,on_hand,reserved,available}`. |
| GET /stock/{balance_id}/movements P | Stock-read authority | Append-only `{id,type,quantity,delta_on_hand,delta_reserved,operation_ref,occurred_at}` authorized via warehouse. |
| POST /stock/adjustments I | STOCK_ADJUST_REQUEST | `{balance_id,delta_on_hand,compensates_movement_id?,reason}`→201 PENDING adjustment. With compensation, source must be OPENING/ADJUSTMENT on same balance, delta_reserved=0 and no receipt/commitment/handoff link; server derives exact opposite on_hand, validates supplied delta_on_hand equals inverse and unique once-only link; ordinary adjustments have delta_reserved=0. Reviewer approves exact derived delta; reserved floor remains enforced. Other movement corrections use owning release/return/review workflows, preserving commitment/receipt counters. |
| POST /stock/adjustments/{id}/review I V | ADJUSTMENT_REVIEW | `{expected_version,decision:APPROVE\|REJECT,note}`→adjustment; distinct requester, PENDING lock, approve inserts exactly one movement, reserved floor enforced. |
| GET /public/donation-drives P; GET /public/donation-drives/{id} | Public | OPEN drives only; `{id,title,description,items,accepted_totals,dates,intake_location,campaign_status,campaign_status_at,accepting_handovers,generated_at}`. Items capped50, GET /public/donation-drives/{id}/items P. No per-drive distributed totals. Inactive campaign disables handovers; cache timestamp explicit. Budget3/cache60s. |
| GET /public/donation-drives/{id}/items P | Public | `{item_id,name,type,unit,target_quantity,acceptance_note}`; OPEN drive only. |
| POST /donation-drives I | DONATION_DRIVE_MANAGE | `{title,description,intake_warehouse_id,campaign_id?,opens_at?,closes_at?,items:[{item_id,target_quantity,acceptance_note?}]}`→201 DRAFT; warehouse/campaign compatible+authorized, Response validation before tx. |
| PATCH /donation-drives/{id} I V | DONATION_DRIVE_MANAGE | `{expected_version,title?,description?,opens_at?,closes_at?,items?}`→drive; DRAFT only, items set replacement. |
| POST /donation-drives/{id}/open I V; POST /donation-drives/{id}/pause I V; POST /donation-drives/{id}/resume I V; POST /donation-drives/{id}/close I V | DONATION_DRIVE_MANAGE | All four POST I V `{expected_version,reason?}`; pause/close reason required; open/resume validate ACTIVE campaign. Close never blocks receipt/dispute/return. |
| GET /donation-drives P; GET /donation-drives/{id} | DONATION_DRIVE_MANAGE/DONATION_INTAKE/DONATION_REVIEW | Scoped staff DRAFT/all lifecycle details; filters status/campaign_id/warehouse_id. |
| POST /public/donation-drives/{id}/deliveries I | D or S donor | `{donor_name,donor_phone,lines:[{item_id,declared_quantity}]}`→201 `{id,public_code,status:DECLARED,declaration_revision:1,version}`; OPEN+eligible drive; item on drive; no stock credit. |
| GET /public/donations/{id} | D or S owner | `{public_code,status,version,declaration,receipt?,disputes,progress}`; capped declaration/count lines50 and disputes20, no staff names/other donors. Public path is private capability view. |
| POST /public/donations/{id}/declarations I V | D or S owner | `{expected_version,lines:[{item_id,declared_quantity}]}`→201 immutable revision; DECLARED only. |
| POST /public/donations/{id}/disputes I | D or S owner | `{reason}`→201 dispute; no destructive count changes. |
| GET /public/donations/{id}/disputes P | D or S owner | Own disputes `{id,status,reason,resolution_note?,created_at}`. |
| POST /public/donations/{id}/claim I | S+D dedicated header | `{}`→200 `{id,public_code}`; bind once, clear capability, audit. |
| POST /donation-deliveries/{id}/assisted-declaration I V | DONATION_INTAKE | `{expected_version,lines:[{item_id,declared_quantity}],reason}`→201 staff-assisted revision; visibly unconfirmed by donor. Staff create walk-in through same declaration intake with separate DONATION_INTAKE authorization and donor DTO, no forged donor session. |
| POST /donation-deliveries/{id}/capability/revoke I V | DONATION_INTAKE | `{expected_version,reason}`→204; clear hash, not ownership. |
| POST /donation-deliveries/{id}/recovery I V | DONATION_INTAKE | `{expected_version,reason,verified_contact_basis:{confirmation_basis,source_note}}`→201 `{issuance_id,recovery_code,expires_at}`; independently verified contact recorded/audited; metadata-only replay as §3. |
| POST /public/donations/recover I | S+X-Recovery-Code | `{public_code}`→200 `{id,public_code}`; bind once/revoke old secret/consume code, same purpose/privacy/replay rules as request recovery. |
| GET /donation-deliveries P; GET /donation-deliveries/{id} | DONATION_INTAKE/DONATION_REVIEW | Intake-site scope; filters drive_id/status; work FIFO created_at/id; list phone masked, full phone authorized detail only. |
| POST /donation-receipts I | DONATION_INTAKE | `{delivery_id,warehouse_id}`→201 receipt; unique delivery, same drive organization, intake warehouse unless scoped reasoned override in `{override_reason?}`. Sets COUNTING. |
| POST /donation-receipts/{id}/counts I V | DONATION_INTAKE | `{expected_version,lines:[{item_id,counted_quantity,accepted_quantity,held_quantity,rejected_quantity,condition_note?,expiry_date?}],note?}`→201 `{count_revision,version,review_state:PENDING_REVIEW}`; immutable full revision, counted=accepted+held+rejected; unexpected items allowed; invalidate current-revision approval. |
| POST /donation-receipts/{id}/review I V | DONATION_REVIEW | `{expected_version,count_revision,declaration_revision,decision:APPROVE\|REJECT\|REQUEST_RECOUNT,reason?}`→review; exact current revisions; reviewer distinct from **every** count author, in both directions. Differences recorded/notified, reasoned approval may coexist with dispute. |
| POST /donation-receipts/{id}/post I V | DONATION_REVIEW | `{expected_version,count_revision,declaration_revision}`→200 posting; exact current approved revisions, first posting only, cumulative accepted credit once; POSTED lifecycle. Same business post/new key→ALREADY_POSTED, original key→original response. |
| POST /donation-receipts/{id}/release-held I V | DONATION_REVIEW | `{expected_version,count_revision,declaration_revision,reason}`→200 posting; after POSTED only, exact current approved later revision; post positive accepted-minus-cumulative-posted delta; **no new revision here**. |
| GET /donation-disputes P | DONATION_REVIEW | Intake-site scope, status filter, donor masked. |
| POST /donation-disputes/{id}/resolve I V | DONATION_REVIEW | `{expected_version,resolution_note}`→dispute; donor notice, never delete. |

Held-release sequence: intake creates conserved new count revision moving held→accepted; independent existing review approves; release-held posts delta only. After first post, delivery remains **POSTED**, even with pending/rejected later revision. Response current_review_state is derived from receipt_review matching the exact current count and declaration revisions; absent matching review means PENDING_REVIEW. No extra review-status columns are stored. Response current_count_revision and approved_count_revision identify the relevant immutable revisions; posted totals and public accepted totals derive from actual RECEIPT/RECEIPT_HELD_RELEASE ledger movements. A pending or approved-but-unposted revision never increases public accepted totals. Posted quantities cannot be erased through later counts; accepted in a new proposed revision cannot fall below cumulative posted. Lock receipt, verify exact current approval, same item/warehouse and cumulative posted≤approved accepted; unique revision/item movement business key defeats a second credit under another key. Future T0-S must implement exact-revision review references and posting constraints, not extra review-status columns or a claim that legacy SQL already supports them.
Stock changes only through append-only stock_movement; trigger updates balance and enforces0≤reserved≤on_hand. Application cannot update balance or mutate/truncate ledger. Business-key unique movement refs; sorted balance locking after sorted missing-row preinsert; movement/counters/audit/notice commit locally. No outbound call/upload while locked.

## 6. Needs, commitments, distribution and custody

| Route | Authority | DTO → response / guards |
|---|---|---|
| POST /needs I | NEED_MANAGE | `{request_id,work_cycle,item_id,quantity,designated_point_id?,target_reason?}`→201 need; call Response admit before tx, lock/upsert canonical cycle, OPEN only. No point→FINAL_RECIPIENT; point→RELIEF_POINT with reason, active same-organization point+scope. One live item/cycle; original_quantity immutable. |
| POST /needs/{id}/increase I V | NEED_MANAGE | `{expected_version,quantity,reason}`→need; new requested total>current, may exceed initial original; OPEN cycle/campaign eligible, history retained. |
| POST /needs/{id}/reduce I V | NEED_MANAGE | `{expected_version,quantity,reason}`→need; lower total≥delivered+reserved_remaining+unsettled_issued, original unchanged. |
| POST /needs/{id}/cancel I V | NEED_MANAGE | `{expected_version,reason}`→need; release unissued atomically, reject unsettled issued; cancelled_remaining=requested−delivered, outstanding0. |
| POST /needs/{id}/confirm-fulfilled I V | NEED_MANAGE | `{expected_version}`→need; delivered=requested, mark FULFILLED, never from partial receipt. |
| POST /needs/{id}/commitments I V | COMMITMENT_MANAGE | `{expected_version,warehouse_id,quantity}`→201 commitment; expected_version is need version; warehouse active **same org as cycle**+scope; delivered+reserved+unsettled+new≤requested, available≥new; reserve movement. |
| POST /commitments/{id}/release I V | COMMITMENT_MANAGE | `{expected_version,quantity,reason}`→commitment; unissued only, RELEASE movement. |
| GET /needs P | NEED_MANAGE/REPORT_READ | request_id/work_cycle required; scoped `{id,item,unit,original,requested,reserved,issued_unsettled,delivered,returned,lost,cancelled_remaining,outstanding,status,version}`. |
| GET /needs/{id}/contributions P | NEED_MANAGE/REPORT_READ | Commitment/warehouse quantity summaries scoped by cycle, no donor-source allocation. |
| GET /requests/{request_id}/fulfillment | NEED_MANAGE/REPORT_READ | work_cycle required; `{needs:{items,more,next_cursor},cycle_state,generated_at}`, need page via GET /needs; each contribution cap20+P route. Budget4. |
| POST /distributions I | DISTRIBUTION_PREPARE | `{warehouse_id,relief_point_id?,vehicle_id?,purpose:REQUEST_AID\|CAMPAIGN_DISTRIBUTION\|POINT_REPLENISHMENT,campaign_id?,lines:[{item_id,quantity,commitment_id?}]}`→201 DRAFT; scope/all assets same org, active vehicle/point. REQUEST_AID needs matching commitment item/warehouse and reserved balance; point matches route/need target; campaign direct requires active authorized campaign; point replenishment requires point. |
| PUT /distributions/{id}/lines I V | DISTRIBUTION_PREPARE + preparer | `{expected_version,lines:[{item_id,quantity,commitment_id?}]}`→distribution; DRAFT/APPROVED only, void approval and return DRAFT. |
| POST /distributions/{id}/approve I V | DISTRIBUTION_REVIEW | `{expected_version}`→distribution; approver≠preparer, save approved_version. |
| POST /distributions/{id}/dispatch I V | DISTRIBUTION_DISPATCH | `{expected_version}`→distribution; dispatcher≠approver (preparer **may** dispatch), approved_version=current. REQUEST_AID ISSUE reserved commitment; direct RESERVE+ISSUE atomically; once only. |
| POST /distributions/{id}/cancel I V | DISTRIBUTION_PREPARE+preparer or DISTRIBUTION_REVIEW+approver | `{expected_version,reason}`→distribution; before dispatch only. |
| POST /distributions/{id}/handoffs I | HANDOFF_RECORD; RETURN exception below | `{handoff_kind:DIRECT_HOUSEHOLD\|POINT_RECEIPT\|HOUSEHOLD_HANDOUT\|RETURN\|LOSS,source_stage?:IN_TRANSIT\|AT_POINT,receiver_user_id?,receiver_label?,confirmation_basis,occurred_at,lines:[{distribution_line_id,quantity}]}`→201 handoff. Lock distribution, exact arithmetic below. Field recorder≠dispatch actor and account receiver; receipt/handout/RETURN without account→label+basis mandatory. LOSS forbids receiver fields, requires basis/source-stage and review. LOSS creates PENDING_LOSS handoff only, no custody/settlement counters yet; separate review below. Client cannot supply approved_by. |
| POST /distributions/{id}/handoffs/{handoff_id}/review-loss I V | LOSS_APPROVE | `{expected_version,decision:APPROVE\|REJECT,reason}`→handoff; expected_version is handoff version. Lock distribution then pending LOSS; approver distinct recorder, current scope. APPROVE rechecks physical balances, posts custody/eligible settlement once and sets RECORDED; REJECT sets REJECTED without accounting. approved_by_user_id comes from authenticated approver, never body. |
| POST /distributions/{id}/reconcile I V | DISTRIBUTION_REVIEW | `{expected_version}`→distribution; each line in_transit=at_point=0 and no PENDING_LOSS handoff, mark RECONCILED. |
| GET /distributions P; GET /distributions/{id} | DISTRIBUTION_PREPARE/DISTRIBUTION_REVIEW/DISTRIBUTION_DISPATCH/HANDOFF_RECORD | scoped filters status/warehouse_id/campaign_id. `{id,status,version,purpose,lines:{items,more,next_cursor}}`; line dispatched/received/handed_out/returned/lost/in_transit/at_point. |
| GET /distributions/{id}/lines P; GET /distributions/{id}/handoffs P | Same distribution-read authority | Scoped line quantities or handoff metadata, receiver label private; authorized evidence metadata only. |
| GET /internal/requests/{id}/fulfillment | C Response+signed actor | REQUEST_DETAIL_READ or NEED_MANAGE/REPORT_READ+cycle scope; work_cycle required; same bounded fulfillment DTO. |
| POST /internal/fulfillment:summary | C Response+signed actor | Same scope; `{request_ids:uuid[1..100],work_cycle?}`→`{items:[{request_id,work_cycle,item_id,unit,requested,committed,issued,delivered,outstanding,cancelled_remaining,cycle_state}]}` at most50 item lines/request; each request result also includes more and next_cursor for the authorized GET /needs continuation, never silent truncation. Unknown/out-of-scope ids omitted; budget2. |
| POST /internal/requests/{id}/cycles/{cycle}/freeze | C Response only, exact authorized cancellation intent | `{intent_id}`→200 `{cycle_state:FROZEN,intent_id}`; create missing cycle/tombstone, block needs/increases/commitments/issues; allow release/cancel/physical settlement. |
| POST /internal/requests/{id}/cycles/{cycle}/seal | C Response only, exact authorized resolution intent | `{intent_id}`→200 `{cycle_state:SEALED,seal_id,intent_id}`; no open/partial need, remaining reserve or unsettled issue; create empty cycle when absent. |
| POST /internal/requests/{id}/cycles/{cycle}/unseal | C Response only, exact aborting intent | `{intent_id}`→200 cycle state; covers unseal/unfreeze, exact current intent only. Persist ABORTED fence even if no prior cycle/seal. Request not RESOLVED/CLOSED; delayed seal/freeze must fail local terminal fence even after old remote PENDING precheck. |

Need target immutable once any commitment exists. Commitment warehouse/target point org mismatch→WAREHOUSE_ORG_MISMATCH/POINT_ORG_MISMATCH. Local cycle lock is mandatory for **all** request-linked commands, including delayed prevalidated commands. FROZEN permits release/cancel and physical settlement, SEALED forbids new fulfillment writes; explicitly permits **after-target custody** below. No auto-unseal/TTL. Operation adoption/abort retains intent fencing, not a new unfenced seal id.
Per distribution line `in_transit=dispatched−POINT_RECEIPT−DIRECT_HOUSEHOLD−RETURN/LOSS(IN_TRANSIT)`; `at_point=POINT_RECEIPT−HOUSEHOLD_HANDOUT−RETURN/LOSS(AT_POINT)`, both≥0. Direct requires no relief point; point receipt/handout requires point; return/loss source_stage mandatory. Recorder locks distribution and validates remaining physical quantities, even without V.
FINAL_RECIPIENT need: point receipt is intermediate custody only; direct/household handout settles DELIVERED. RELIEF_POINT need: receipt at exact designated point settles DELIVERED; subsequent handout/return/loss is **after-target custody only**, no second commitment settlement. A handoff line eligible for fulfillment yields exactly one unique quantity-matched settlement linked to its actual commitment; intermediate/after-target lines yield none. Before-target RETURN/LOSS settles RETURNED/LOST at most issued. Returned aid reopens outstanding via quantity-derived need state, never credits delivered. No delivered+returned double settlement of point-target goods.
RETURN authorization: warehouse staff with **DONATION_INTAKE or DISTRIBUTION_DISPATCH** + receiving warehouse scope, physical receipt confirmed in confirmation_basis; HANDOFF_RECORD not additionally required for this warehouse-specific action. Credit same source warehouse via unique RETURN movement/handoff-line, never before physical receipt. Other field handoffs require HANDOFF_RECORD and recorder≠dispatcher; RETURN requires independent receipt recorder≠dispatcher as well. Post-target return after SEALED credits custody/stock only, leaves fulfilled commitment unchanged. LOSS requires independent review-loss before its counters or settlement count; pending/rejected handoffs are excluded from physical arithmetic and reports. Stock already issued is never decremented again.

## 7. Evidence, reports and bounded background work

| Route | Authority | Contract |
|---|---|---|
| POST /requests/{id}/evidence I | T/S owner or REQUEST_VERIFY | multipart `{file,visibility?:REPORTER\|STAFF}`; owner cannot choose STAFF, staff decides visibility.201 `{id,state:PENDING\|READY}`. |
| POST /missions/{id}/evidence I | Active APP leader or MISSION_RECORD_ON_BEHALF | multipart `{file}`→201 evidence; no mandatory completion media. |
| GET /evidence/{id}/download (Response) | Current parent request/mission read relationship | 200 `{url,expires_in:60}`, reauthorize exact object, never URL in logs. |
| POST /public/donations/{id}/evidence I | D or S owner | multipart `{file,dispute_id?}`→201; dispute must belong to donation. |
| POST /donation-disputes/{id}/evidence I | DONATION_REVIEW | multipart `{file}`→201, matching intake-site scope. |
| POST /distributions/{id}/handoffs/{handoff_id}/evidence I | HANDOFF_RECORD or authorized RETURN warehouse recorder | multipart `{file}`→201; parent handoff/distribution match, current scope. |
| GET /public/donations/{id}/evidence P | D or S owner | Own evidence metadata; staff-private attachments excluded. |
| GET /evidence/{id}/download (Logistics) | Current donor-owner/capability or authorized parent staff reader | Same signed-url DTO, exact owning donation/dispute/handoff permission. |
| GET /public/donation-reports/summary P | Public | Exactly one attribution view: drive_id→accepted by drive/item/unit; campaign_id or warehouse_id→actual final-distributed by recorded campaign/warehouse/item/unit. from/to≤366days, generated_at, scope/metric echoed. No per-drive distributed_total after pooling, no PII/exact location/evidence. Cache60s; actual posted receipt/held-release ledger quantities for POSTED donations only. |
| GET /reports/stock-summary P | REPORT_READ | warehouse_id required; on_hand/reserved/available per item/unit, held/in_transit separate, generated_at. |
| GET /reports/fulfillment P | REPORT_READ | campaign_id or region_code and from/to≤366days; original/increased/reduced/cancelled/active_requested/delivered/active_outstanding separate; cycle scope, generated_at. |
| GET /reconciliation P | REPORT_READ or DISTRIBUTION_REVIEW | warehouse_id required,item_id?; intake accepted/posted/reserved/in_transit/at_point/final-distributed/returned/lost; flags balance-vs-ledger or counter-vs-settlement mismatch; no pooled donor-source claims. |
| GET /notices P; POST /notices/{id}/read (Logistics) | S recipient only | GET unread filter; POST `{}`→204, no Idempotency-Key. |

Evidence requires Content-Length; max5 PENDING/READY files and100MiB/owner including reserved pending bytes. Lock parent/reserve quota, stream outside transaction to generated immutable private key, sniff real type, cap bytes, then finalize READY/checksum in short tx. JPEG/PNG≤10MiB, MP4 H.264/AAC≤50MiB with bounded validation; reject SVG/HTML/other formats. Failure leaves request/donation intact, metadata FAILED; retry new upload. Pending>15min reconciler wins conditional state transition before deleting object. Guest concurrency2/IP,200MiB/h/IP, global20 uploads/replica, appropriate429; no unchecked provider error text. Downloads expire60s and never make buckets public.
Jobs claim bounded batches with advisory lock/SKIP LOCKED and jitter; recovery30s, drive/campaign refresh5min. Re-drive same intent; live authorization required or operation awaits adoption. Material state changes bump version; no-op scans do not. Campaign closure updates drive cached status/acceptance, preserves history/settlement. Notice uniqueness source/version/recipient/type, atomic with local business event. Background work never automatically verifies, dispatches, closes requests or silently accepts a team offer.

## 8. Implementation boundary

T0-S must apply the attribution timestamp, immutable verification snapshot FK/review references, recovery issuance hashes/expiry/consumption, APP/COORDINATOR team shape/affiliation/readiness markers, nullable unknown intake, exact-revision receipt review references and ledger-derived accepted totals, same-organization asset/need constraints, quantity-matched unique settlements and local terminal intent fences. Existing SQL and historical tests do not establish these target guarantees. Exact field/index inventories and real restricted-role, concurrency, scale and Vietnamese-response checks are governed by [03-implementation.md](03-implementation.md); this document makes no executed-test claim. No payments, AI dispatch, source allocation after pooling, or extra runtime is part of this contract.

## 9. Vietnamese error catalog

Every error the API can return has one row here. The implementation loads this table into each service's message catalog; **a CI test fails if a thrown `code` is missing from the catalog, or a catalog `message` is empty/English** (see [implementation checks](03-implementation.md)). `field_errors` codes (e.g. `PHONE_INVALID`) are listed with HTTP `400` and appear under `VALIDATION_FAILED`. Messages never contain PII, identifiers or internal terms. Owner = the service that raises the code (shared codes exist in all three).

| code | HTTP | Owner | Vietnamese message |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | shared | Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại các trường được đánh dấu. |
| `CURSOR_INVALID` | 400 | shared | Dữ liệu phân trang không còn hợp lệ. Vui lòng tải lại danh sách. |
| `IDEMPOTENCY_KEY_INVALID` | 400 | shared | Mã yêu cầu không hợp lệ. |
| `TOO_MANY_LINES` | 400 | shared | Số dòng vượt quá giới hạn cho phép trong một thao tác (tối đa 50). |
| `UNAUTHENTICATED` | 401 | shared | Bạn cần đăng nhập để thực hiện thao tác này. |
| `SESSION_EXPIRED` | 401 | shared | Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại. |
| `FORBIDDEN` | 403 | shared | Bạn không có quyền thực hiện thao tác này. |
| `CSRF_INVALID` | 403 | shared | Yêu cầu không hợp lệ hoặc đã hết hạn. Vui lòng tải lại trang. |
| `NOT_FOUND` | 404 | shared | Không tìm thấy dữ liệu yêu cầu. |
| `VERSION_CONFLICT` | 409 | shared | Dữ liệu đã được cập nhật. Vui lòng tải lại trước khi tiếp tục. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | shared | Mã yêu cầu đã được dùng cho nội dung khác. |
| `STATE_TRANSITION_INVALID` | 409 | shared | Trạng thái hiện tại không cho phép thao tác này. |
| `PAYLOAD_TOO_LARGE` | 413 | shared | Tệp hoặc nội dung vượt quá giới hạn cho phép. |
| `LENGTH_REQUIRED` | 411 | shared | Yêu cầu tải tệp thiếu thông tin kích thước. |
| `UNSUPPORTED_MEDIA` | 415 | shared | Định dạng tệp không được hỗ trợ. |
| `RATE_LIMITED` | 429 | shared | Bạn thao tác quá nhanh. Vui lòng thử lại sau. |
| `SOS_RATE_CEILING` | 429 | Response | Hệ thống đang quá tải yêu cầu từ địa chỉ của bạn. Nếu đang nguy hiểm, hãy gọi 113/114/115 rồi thử lại sau. |
| `INTERNAL_ERROR` | 500 | shared | Hệ thống gặp lỗi. Vui lòng thử lại sau. |
| `IDENTITY_UNAVAILABLE` | 503 | shared | Dịch vụ tài khoản tạm thời không khả dụng. Vui lòng thử lại. |
| `RESPONSE_UNAVAILABLE` | 503 | shared | Dịch vụ tiếp nhận và điều phối tạm thời không khả dụng. Vui lòng thử lại. |
| `LOGISTICS_UNAVAILABLE` | 503 | shared | Dịch vụ vật tư tạm thời không khả dụng. Vui lòng thử lại. |
| `STORAGE_UNAVAILABLE` | 503 | shared | Kho lưu trữ tệp tạm thời không khả dụng. Yêu cầu của bạn vẫn được giữ. |
| `LOCK_TIMEOUT` | 503 | shared | Hệ thống đang bận xử lý dữ liệu này. Vui lòng thử lại. |
| **Identity** | | | |
| `INVALID_CREDENTIALS` | 401 | Identity | Tên đăng nhập hoặc mật khẩu không đúng. |
| `REFRESH_REUSED` | 401 | Identity | Phiên đăng nhập không còn an toàn. Vui lòng đăng nhập lại. |
| `REFRESH_RACE` | 409 | Identity | Phiên đang được làm mới ở nơi khác. Vui lòng thử lại. |
| `PASSWORD_WEAK` | 400 | Identity | Mật khẩu chưa đủ mạnh (tối thiểu 10 ký tự, không phổ biến). |
| `SCOPE_INVALID` | 400 | Identity | Phạm vi quyền không hợp lệ. |
| `USERNAME_TAKEN` | 409 | Identity | Tên đăng nhập đã được sử dụng. |
| `LAST_ADMIN` | 409 | Identity | Không thể thực hiện vì đây là quản trị viên cuối cùng. |
| `GRANT_EXISTS` | 409 | Identity | Quyền này đã được cấp cho người dùng. |
| `ORGANIZATION_NAME_TAKEN` | 409 | Identity | Tên tổ chức đã tồn tại. |
| `ORGANIZATION_IN_USE` | 409 | Identity | Tổ chức đang được sử dụng nên chưa thể ngừng hoạt động. |
| **Response — intake / tracking** | | | |
| `COORDINATES_OUT_OF_RANGE` | 400 | Response | Tọa độ không hợp lệ. |
| `ACCURACY_REQUIRED` | 400 | Response | Vị trí GPS cần có độ chính xác. |
| `PEOPLE_AFFECTED_OUT_OF_RANGE` | 400 | Response | Số người cần hỗ trợ không hợp lệ. |
| `PHONE_INVALID` | 400 | Response | Số điện thoại không hợp lệ. |
| `CATEGORY_UNKNOWN` | 400 | Response | Loại sự cố không hợp lệ. |
| `RELATIONSHIP_REQUIRED` | 400 | Response | Vui lòng cho biết mối quan hệ với người cần hỗ trợ. |
| `TRACKING_SECRET_INVALID` | 400 | Response | Mã bảo mật theo dõi không hợp lệ. |
| `TRACKING_SECRET_IN_USE` | 409 | Response | Không thể sử dụng mã bảo mật này. Vui lòng tạo mã khác. |
| `ALREADY_CLAIMED` | 409 | Response | Yêu cầu này đã được gắn với một tài khoản. |
| `EVIDENCE_LIMIT_REACHED` | 409 | Response | Đã đạt giới hạn số lượng hoặc dung lượng tệp đính kèm. |
| **Response — verification / priority** | | | |
| `REASON_REQUIRED` | 400 | Response | Vui lòng nhập lý do. |
| `VERIFICATION_BASIS_REQUIRED` | 400 | Response | Vui lòng chọn cơ sở xác minh. |
| `NO_CONTACT_ATTEMPT` | 409 | Response | Cần ghi nhận ít nhất một lần liên hệ hoặc nêu lý do không thể liên hệ. |
| `SECOND_COORDINATOR_REQUIRED` | 409 | Response | Cần một điều phối viên khác xác nhận đồng thuận. |
| `REJECT_THRESHOLD_NOT_MET` | 409 | Response | Chưa đủ số lần liên hệ để từ chối vì không liên lạc được. |
| `REQUEST_NOT_VERIFIED` | 409 | Response | Yêu cầu chưa được xác minh. |
| `CANONICAL_INVALID` | 409 | Response | Yêu cầu gốc được chọn không hợp lệ. |
| `CANONICAL_HAS_DUPLICATES` | 409 | Response | Yêu cầu này đang là yêu cầu gốc của các yêu cầu trùng khác. |
| `RESOLUTION_BLOCKED` | 409 | Response | Chưa thể xác nhận hoàn tất. Vui lòng xử lý các mục còn tồn đọng. |
| **Response — teams / missions / campaigns** | | | |
| `TEAM_BUSY` | 409 | Response | Đội đang có nhiệm vụ khác. |
| `TEAM_NOT_ELIGIBLE` | 409 | Response | Đội không đủ điều kiện nhận nhiệm vụ này. |
| `TEAM_HAS_ACTIVE_MISSION` | 409 | Response | Đội đang thực hiện nhiệm vụ nên chưa thể chuyển sang không sẵn sàng. |
| `USER_IN_OTHER_TEAM` | 409 | Response | Người này đang thuộc một đội khác. |
| `LEADER_REQUIRED` | 409 | Response | Đội phải có một trưởng đội đang hoạt động. |
| `MISSION_NOT_LEADER` | 403 | Response | Chỉ trưởng đội đang hoạt động mới thực hiện được thao tác này. |
| `OVERRIDE_REASON_REQUIRED` | 400 | Response | Vui lòng nhập lý do khi chọn đội khác với gợi ý. |
| `RECORDED_BASIS_REQUIRED` | 400 | Response | Vui lòng ghi rõ nguồn thông tin khi ghi thay cho đội. |
| `CAMPAIGN_NOT_ACTIVE` | 409 | Response / Logistics | Chiến dịch hiện không hoạt động. |
| `CAMPAIGN_PAUSED` | 409 | Response / Logistics | Chiến dịch đang tạm dừng. |
| `CAMPAIGN_HAS_OPEN_REQUESTS` | 409 | Response | Còn yêu cầu chưa kết thúc thuộc chiến dịch này. |
| `TOO_MANY_CELLS` | 400 | Response | Khu vực hoặc khoảng thời gian quá lớn. Vui lòng thu hẹp bộ lọc. |
| **Logistics — catalog / stock** | | | |
| `ITEM_NAME_TAKEN` | 409 | Logistics | Tên mặt hàng đã tồn tại. |
| `VEHICLE_IDENTIFIER_TAKEN` | 409 | Logistics | Biển số hoặc mã phương tiện đã tồn tại. |
| `POINT_INACTIVE` | 409 | Logistics | Điểm cứu trợ đã ngừng hoạt động. |
| `VEHICLE_INACTIVE` | 409 | Logistics | Phương tiện đã ngừng hoạt động. |
| `QUANTITY_SCALE_INVALID` | 400 | Logistics | Số lượng có quá nhiều chữ số thập phân so với đơn vị tính. |
| `INSUFFICIENT_STOCK` | 409 | Logistics | Không đủ hàng tồn kho khả dụng. |
| `ADJUSTMENT_VIOLATES_RESERVED` | 409 | Logistics | Điều chỉnh làm tồn kho thấp hơn lượng đã giữ chỗ. |
| **Logistics — donations** | | | |
| `DRIVE_NOT_OPEN` | 409 | Logistics | Đợt quyên góp hiện không nhận hàng. |
| `ITEM_NOT_ON_DRIVE` | 400 | Logistics | Mặt hàng không nằm trong danh sách của đợt quyên góp. |
| `DONATION_SECRET_INVALID` | 400 | Logistics | Mã bảo mật quyên góp không hợp lệ. |
| `DONATION_SECRET_IN_USE` | 409 | Logistics | Không thể sử dụng mã bảo mật này. Vui lòng tạo mã khác. |
| `DECLARATION_LOCKED` | 409 | Logistics | Phiếu khai báo đã được tiếp nhận kiểm đếm nên không thể sửa. |
| `COUNT_SPLIT_MISMATCH` | 400 | Logistics | Số đã đếm phải bằng tổng số nhận, giữ lại và từ chối. |
| `STALE_REVISION` | 409 | Logistics | Phiên bản khai báo hoặc kiểm đếm đã thay đổi. Vui lòng tải lại. |
| `SELF_REVIEW_FORBIDDEN` | 403 | Logistics | Người kiểm đếm không được tự duyệt phiếu của mình. |
| `RECEIPT_NOT_APPROVED` | 409 | Logistics | Phiếu nhận chưa được duyệt độc lập. |
| `ALREADY_POSTED` | 409 | Logistics | Phiếu nhận đã được ghi vào kho. |
| **Logistics — needs / fulfillment** | | | |
| `NEED_EXISTS` | 409 | Logistics | Nhu cầu cho mặt hàng này đã tồn tại. |
| `NEED_OVER_COMMITTED` | 409 | Logistics | Tổng số lượng cam kết vượt quá nhu cầu. |
| `BELOW_PROTECTED_QUANTITY` | 409 | Logistics | Không thể giảm nhu cầu xuống thấp hơn lượng đã giữ chỗ hoặc đã giao. |
| `UNSETTLED_ISSUED_GOODS` | 409 | Logistics | Còn hàng đã xuất chưa được xác nhận giao, trả hoặc ghi mất. |
| `CYCLE_FROZEN` | 409 | Logistics | Yêu cầu đang bị khóa để hủy. Chỉ được hoàn tất các bước đã bắt đầu. |
| `CYCLE_SEALED` | 409 | Logistics | Chu kỳ xử lý đã được niêm phong. |
| `CYCLE_NOT_SETTLED` | 409 | Logistics | Còn nhu cầu hoặc hàng chưa hoàn tất nên chưa thể niêm phong. |
| **Logistics — distribution** | | | |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Logistics | Người lập phiếu không được tự duyệt. |
| `APPROVAL_STALE` | 409 | Logistics | Phiếu đã thay đổi sau khi duyệt. Cần duyệt lại. |
| `NEED_TARGET_LOCKED` | 409 | Logistics | Không thể đổi điểm nhận khi nhu cầu đã có cam kết. |
| `TARGET_REASON_REQUIRED` | 400 | Logistics | Cần nêu lý do khi chọn điểm cứu trợ làm nơi nhận. |
| `SETTLEMENT_TARGET_MISMATCH` | 409 | Logistics | Nơi giao không khớp với nơi nhận đã chọn cho nhu cầu này. |
| `POST_EXCEEDS_APPROVED` | 409 | Logistics | Số lượng nhập kho vượt quá số lượng đã được duyệt. |
| `WAREHOUSE_ORG_MISMATCH` | 409 | Logistics | Kho nhận không thuộc tổ chức của đợt quyên góp. |
| `ALREADY_DISPATCHED` | 409 | Logistics | Phiếu đã xuất kho. |
| `LINE_ITEM_MISMATCH` | 400 | Logistics | Mặt hàng không khớp với cam kết. |
| `HANDOFF_KIND_INVALID` | 409 | Logistics | Hình thức bàn giao không phù hợp với phiếu phân phối. |
| `HANDOFF_EXCEEDS_BALANCE` | 409 | Logistics | Số lượng bàn giao vượt quá số lượng đang có ở giai đoạn này. |
| `SETTLEMENT_EXCEEDS_ISSUED` | 409 | Logistics | Số lượng xác nhận vượt quá số lượng đã xuất. |

A revoked or expired session is SESSION_EXPIRED; a missing session credential is UNAUTHENTICATED. State conflicts use STATE_TRANSITION_INVALID; concurrent duplicate commands wait or return LOCK_TIMEOUT.


### Additional active codes

| code | HTTP | Owner | Vietnamese message |
|---|---|---|---|
| `ATTRIBUTION_LOCKED` | 409 | Response | Phạm vi xử lý đã được cố định cho chu kỳ này. |
| `WORK_CYCLE_MISMATCH` | 409 | Response / Logistics | Chu kỳ xử lý đã thay đổi. Vui lòng tải lại. |
| `POINT_ORG_MISMATCH` | 409 | Logistics | Điểm cứu trợ không thuộc tổ chức xử lý yêu cầu. |
| `SOURCE_REFERENCE_INVALID` | 400 | Response | Nguồn xác minh không hợp lệ hoặc không được phép truy cập. |
| `SUPPLEMENT_REVIEW_REQUIRED` | 409 | Response | Thông tin bổ sung cần được điều phối viên xem xét. |
| `VERIFICATION_REVISION_CONFLICT` | 409 | Response | Thông tin xác minh đã thay đổi. Vui lòng tải lại. |
| `TEAM_REPORTING_MODE_INVALID` | 400 | Response | Hình thức báo cáo của đội không hợp lệ. |
| `EXTERNAL_CONTACT_REQUIRED` | 400 | Response | Cần ghi thông tin liên hệ bên ngoài của đội. |
| `TEAM_READY_REQUIRED` | 409 | Response | Cần xác nhận đội đã sẵn sàng trước khi giao nhiệm vụ mới. |
| `AFFILIATION_BASIS_REQUIRED` | 400 | Response | Cần ghi cơ sở xác minh đơn vị của đội. |
| `MISSION_OUTCOME_REQUIRED` | 400 | Response | Cần ghi kết quả và thời điểm thực hiện nhiệm vụ. |
| `MISSION_NOT_REQUIRED_INVALID` | 409 | Response | Chu kỳ đã có nhiệm vụ nên không thể xác nhận là không cần nhiệm vụ. |
| `OPERATION_NOT_ADOPTABLE` | 409 | Response | Thao tác này hiện không thể được tiếp nhận. |
| `OPERATION_NOT_ABORTABLE` | 409 | Response | Thao tác này đã vượt qua bước có thể hủy. |
| `RECOVERY_BASIS_REQUIRED` | 400 | Response / Logistics | Cần ghi cơ sở liên hệ đã được xác minh để khôi phục. |
| `HANDOFF_ACTOR_CONFLICT` | 403 | Logistics | Người ghi bàn giao không được trùng với người xuất hàng hoặc người nhận. |
| `RECEIVER_CONFIRMATION_REQUIRED` | 400 | Logistics | Cần ghi người nhận và cơ sở xác nhận bàn giao. |
| `RETURN_RECEIPT_REQUIRED` | 409 | Logistics | Cần xác nhận kho đã thực nhận hàng trả lại. |
| `NEED_INCREASE_INVALID` | 400 | Logistics | Số lượng mới phải lớn hơn nhu cầu hiện tại. |
| `QUANTITY_INVALID` | 400 | Logistics | Số lượng không hợp lệ. |
| `INTENT_TERMINAL` | 409 | Logistics | Thao tác đã kết thúc nên không thể thực hiện lại bước này. |
