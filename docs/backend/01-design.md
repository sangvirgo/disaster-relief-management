# 01 — Authoritative backend design

## 1. Authority and scope

- This is the current English backend design for the C48 capstone.
- It consolidates the approved setup, permissions, schema reviews, plan Sections 22–27 and Appendix A.
- Latest explicit user decisions govern; this document records one current rule per topic.
- API contracts define transport shapes; this document defines ownership, invariants and target schema changes.
- Archived v3.3 SQL is a legacy baseline, not evidence that the target schema is implemented.
- Apply target deltas through reviewed migrations before implementing dependent APIs.
- Preserve existing UR/FR/NFR/UC/TC identifiers and traceability; never renumber historical evidence.
- Scope includes SOS, verification, teams, missions, campaigns, donations, basic stock and distribution.
- Include warehouses, vehicles, relief points, item/type/unit catalogs, notices and scoped reports.
- In-kind goods only; no cash, payments, checkout, procurement or warehouse ERP.
- Defer pledges, inter-warehouse transfers, source allocation, FEFO automation and full stocktakes.
- Keep point receipt and household handout distinct; no multi-leg forwarding workflow.
- AI, push and offline synchronization are optional extensions with separate acceptance gates.
- Human verification, independent receipt review, stock integrity and resolution fences are mandatory.
- This is a synthetic educational demo, not an approved operational rescue policy or HA system.

## 2. Architecture and implementation boundaries

- Use NestJS/TypeScript, TypeORM, PostgreSQL/PostGIS and REST/JSON.
- Identity, Response and Logistics are independently deployable services behind Nginx.
- Each service owns its database credentials, entities, migrations, environment and health routes.
- No cross-service SQL, shared entity models or cross-database foreign keys.
- Identity owns accounts, organizations, membership, grants, sessions and region codes.
- Response owns requests, verification, campaigns, teams, missions, boundaries and request evidence.
- Logistics owns donations, receipt review, catalog/assets, stock, fulfillment and distribution.
- Cross-service identifiers are opaque; validate them through authenticated owner APIs.
- Use Docker Compose on one demo host; no Python runtime, Kafka or Redis dependency.
- Keep business modules inside their owning app; controllers validate and map DTOs only.
- Services own state transitions, authorization, transactions and business guards.
- Share transport schemas and proven technical helpers only when actual reuse exists.
- Keep Vietnamese message catalogs in each app; no shared business service or generic repository.
- Use TypeScript strict mode, parameterized SQL and migrations; disable schema synchronization.
- Explicit DTO mapping is mandatory; never return ORM entities directly.
- Recheck primary sources before pinning dependencies, images, providers or license terms.
- Record compatible exact releases and image digests during the setup spike; never use `latest`.

## 3. API, language and command conventions

- Public bases: `/api/v1/identity`, `/api/v1/response`, `/api/v1/logistics`.
- Internal routes require audience-restricted service authentication and are not publicly routed.
- All human-readable backend responses, validation and notifications are Vietnamese.
- All Web/Mobile labels, accessibility text, statuses, reports and AI summaries are Vietnamese.
- Machine fields, codes, enum values, paths and technical documentation remain English.
- Preserve submitted names and free text; never silently translate user content.
- Clients branch on stable codes, never Vietnamese message strings.
- Sanitize framework, database and provider errors at the boundary; never leak raw exceptions.
- Error envelopes contain `code`, Vietnamese `message`, optional field codes and `correlation_id`.
- Generate/propagate correlation IDs without recording secrets or unnecessary PII.
- IDs are application-generated UUIDv7 where supported; catalog codes are natural immutable keys.
- Use UTC `timestamptz`; distinguish occurrence/capture times from server receipt times.
- Mutable aggregates have `version`; commands require `expected_version` and compare-and-update.
- Zero affected rows returns `VERSION_CONFLICT`; never use unguarded ORM `save()` for commands.
- No arbitrary status PATCH; expose named commands with transition guards.
- Every material aggregate mutation, including automated progress/recomputation, increments version; no-op retries and notice-only writes do not.
- Require UUID idempotency keys on mutations except explicitly documented session/read exceptions.
- Claim the key as the first statement of the business transaction using a unique insert.
- Scope keys by actor/service/command; guests additionally bind payload and capability hashes.
- Same canonical payload replays the recorded result; changed payload returns a conflict.
- Authenticate and validate before claiming a key; outbound validation precedes the transaction.
- Store resource/result metadata, not PII, bearer secrets or signed URLs in replay records.
- Recovery issuance is the explicit replay exception described in Section 5.
- Commit business state, appropriate append-only history and in-app notices atomically.
- Notice uniqueness includes source, source version, recipient and notice type.
- Use stable retryable errors for lock timeouts, deadlocks and dependency unavailability.
- Retry deadlocks/lock contention at most twice with jitter and the same business key.
- Never retry inside an aborted transaction without a savepoint or rollback.
- Authenticated and capability responses use `Cache-Control: no-store`.

## 4. Authentication, authorization and privacy

- Registration grants CITIZEN only; staff and volunteer grants require authorized administration.
- Normalize unique usernames; hash passwords with a maintained Argon2id implementation.
- Unknown and disabled accounts follow a dummy-hash path with generic credential errors.
- Bound hashing concurrency and login/registration request rates.
- Web uses secure HttpOnly cookies, allowed Origin and CSRF checks on state changes.
- Native clients use bearer access tokens; mobile refresh secrets use secure platform storage.
- Validate JWT algorithm, issuer, audience, expiry and session ID.
- Introspect every protected request against live Identity account/session/grants.
- No positive authorization cache; coalesce only identical concurrent in-flight introspections.
- Identity failure closes protected access with Vietnamese 503, never stale authorization.
- Refresh sessions belong to a durable family with absolute expiry and one live token.
- Rotation locks the user FOR SHARE and checks the family's `authz_version`.
- Disable/reset/grant changes lock/update the user barrier before revoking families.
- A refresh rotated less than 10 seconds ago yields `REFRESH_RACE`; older reuse revokes its family.
- Evaluate permission AND owning organization AND scope AND object relationship.
- Alternative grants combine with OR; region/campaign grants carry their parent organization.
- ADMIN account control does not grant victim/donor detail access or implicit operational power.
- Team leadership is an active membership relationship, not an administrative role.
- Affiliation never grants permissions or crosses organization boundaries.
- Apply scope before pagination, aggregates, map generation, files, exports and notices.
- Unassigned-region access/correction requires organization-wide `REQUEST_UNASSIGNED_QUEUE`.
- Reporters see their own request and REPORTER timeline; staff-only history remains private.
- Assigned active members see task fields; only the active leader sees necessary contact phones.
- Exact household GPS is limited to authorized reporters/coordinators/assigned task views.
- Donors use ownership or a valid donation capability; receipt number/name/phone grants nothing.
- Return non-disclosing not-found responses where existence itself is sensitive.
- Mask list phones; keep names, contacts, exact GPS and free text out of public aggregates/AI/logs.
- Redact authorization, cookies, tracking codes, passwords, tokens and all secret/recovery fields.
- Technical logs use stable codes; audit payloads are bounded and omit credentials.

## 5. Guest capabilities, ownership and assisted recovery

- Guest SELF SOS and donations do not require Identity availability or account registration.
- Before submitting, clients persist a random 32-byte secret and separate idempotency UUID.
- Store only purpose-bound hashes: `sos-tracking` and `donation-capability` never interchange.
- Send secrets in capability headers, never URLs, query strings, Referer or logs.
- Tracking codes are public identifiers with at least 40 bits of entropy, not credentials.
- Validate secret hash first and compare tracking code without disclosing existence.
- Same key/body/secret replays creation after a lost ACK without duplicate submission.
- Authenticated claim with a valid capability binds the owner once and revokes that capability.
- Add nullable `recovery_code_hash` and `recovery_expires_at` to requests and donation deliveries.
- Require paired nullability and a unique non-null hash within the owning service.
- A scoped staff member verifies contact independently and records a nonblank recovery reason.
- Phone knowledge alone never authorizes lookup, tracking, claim or recovery issuance.
- Issue a cryptographically random purpose-bound recovery code expiring after 30 minutes.
- Bind its hash to the exact object and recovery purpose; issuance replaces any prior code.
- Persist issuer/time/reason audit metadata, never the plaintext code.
- Return plaintext exactly once on successful initial issuance over authenticated transport.
- An idempotent issuance replay returns metadata only, explicitly excluding plaintext.
- If the first response is lost, staff issues a replacement with a new key after verification.
- Authenticated redemption locks the object and verifies purpose, hash, expiry and unbound owner.
- Atomically set owner once, revoke the old tracking/donation secret and clear both recovery fields.
- Concurrent/repeated redemption cannot bind another owner; failed redemption reveals nothing.
- A code cannot transfer an already-owned object; account recovery remains an Identity workflow.
- Rate-limit issuance/redemption and audit success without storing the secret.

## 6. SOS intake and verification

- SOS requires incident category and affected-location snapshot; item selection is not required.
- `description` is optional bounded text; coordinators create item needs after assessment.
- Reporter/beneficiary/alternate phone fields may be null when unknown or unavailable.
- `request_subject.people_affected` is nullable; known values must be integers from 1 to 10000.
- Null means unknown; never invent zero, a phone number or a headcount to pass validation.
- Guest SELF is allowed; PROXY requires a current signed-in account and reporter relationship.
- Keep reporter identity/contact separate from affected household location/contact.
- PROXY preserves information source, last-known situation/time and contactability.
- Accept bounded `household_reference_note` in intake/supplement DTOs and scoped detail views.
- Validate coordinates before PostGIS conversion: GeoJSON `[longitude, latitude]`, SRID 4326.
- Preserve location source, capture time and accuracy; manual pin does not invent GPS accuracy.
- Derive region from validated seeded boundary polygons; ambiguous/uncovered location leaves null.
- Assign intake organization from configuration; citizen bodies cannot set staff attribution.
- No campaign is required for SOS; only authorized staff attach a compatible ACTIVE campaign.
- Store received time only after server acceptance; offline drafts remain explicitly pending.
- Soft abuse thresholds store reports in visible review lanes instead of silently dropping them.
- Use per-IP/global intake limits and nullable-phone-aware counting; no fake contact requirement.
- PROXY open cap defaults to 3 plus a daily soft threshold; excess enters quota review.
- Display counts/reasons for staff inspection; heuristics are not fraud findings.
- Verification records contact attempts, evidence limitations and a human decision.
- Unreachable or missing victim phone is not proof of falsity and does not force rejection. UNREACHABLE rejection requires at least3 logged attempts spanning30min and a reason; clearly-invalid reports use the separate reasoned invalidity basis. SUBMITTED/VERIFYING overdue default15min, danger immediate; these are synthetic-demo visibility defaults, never operational SLA or automated dispatch.
- PROXY verification requires independent corroboration/evidence or two distinct coordinators.
- Two-coordinator concurrence appends a STAFF request_event with positive integer reviewed_version and resulting_version=reviewed_version+1 in its validated payload; final verification_decision stores the concurrence_event_id uuid FK, checked for same request and a distinct scoped actor.
- Its local transaction checks reviewed version and advances the request to resulting version.
- Final verification requires `expected_version = resulting_version` with no intervening mutation.
- Both actors need current scope; the same actor cannot concur with their own decision.
- Verification appends an immutable `request_event` containing the exact verified snapshot payload.
- Add nullable `assistance_request.verification_revision uuid` FK to `request_event(id)`.
- Enforce that the pointed event belongs to that request and represents a verified snapshot.
- Store incident facts, subject/location/contact facts and relevant source revisions in the snapshot.
- Later supplements remain immutable events; they never silently overwrite verified facts. A newly declared danger=true immediately raises existing reporter_declared_danger as an unverified alert marker, including after verification; it does not approve new facts/priority. Only explicit scoped review may clear it. Open-request alerts include pending declared danger; do not wait for supplement acceptance to surface it.
- A supplement-review event references the supplement event ID and the accept/reject decision.
- Accepted factual changes require a new verified snapshot and update verification_revision atomically. Existing request_subject facts are the spatial/list projection: update them only on approved review after verification, in the same transaction; immutable snapshots preserve audit history, with no extra parallel verified_* columns.
- Mission/assessment views use the current verified snapshot and show pending supplements separately.
- Source/relationship/contact facts remain private even when a snapshot is retained.
- VERIFYING outcomes are exclusive: VERIFIED, REJECTED or DUPLICATE.
- Duplicate decisions preserve originals; no automatic household merge or chain reparenting.
- Lock source/target in sorted order; prohibit self/cycles and invalid canonical terminal targets.
- Canonical requests with inbound links cannot become DUPLICATE. They may become REJECTED from VERIFYING or safely CANCELLED with reason and usual guards; preserve all historical inbound links and never cascade outcomes.
- Priority P1–P4 is human-selected with basis/reason; lifecycle and declared danger stay separate.
- Scan SUBMITTED age and declared danger across every lane, including both abuse-review lanes.
- Also scan VERIFYING age from `verifying_since`; notices identify the lane and responsible staff.
- Default NORMAL queue filtering must never hide those cross-lane alerts.
- Reporter supplements are allowed only in documented nonterminal states, outside active intents.

## 7. Teams, missions and campaign behavior

- Teams share one demo coordinating organization; record volunteer/military/government affiliation as metadata.
- Add `reporting_mode APP|COORDINATOR` to `rescue_team` with a CHECK constraint.
- Add nullable `external_contact_note`; require nonblank text when mode is COORDINATOR.
- APP requires an active leader to offer/accept/advance work; members cannot act as leader.
- COORDINATOR teams can operate without accounts or an app; scoped staff record their reports.
- Membership constraints retain one active leader per team and one active team per user.
- Transfer leadership under the team lock, demoting before promoting; audit membership changes.
- A named affiliation-verification action writes paired verifier/time fields with reason and audit.
- Affiliation verification changes metadata only, never permissions.
- Position snapshots preserve coordinates, source, capture time, accuracy and setter.
- Exclude stale positions from default candidates; allow reasoned manual inspection, not fabricated freshness.
- Required skills use `incident_category_skill(category_code, skill_code)`.
- Both columns are NOT NULL, composite PK, and FKs to `incident_category(code)` and `skill(code)`.
- Candidate eligibility requires every mapped skill, compatible scope, ACTIVE and AVAILABLE status.
- One mission serves one request/current cycle and exactly one team; multiple teams use separate missions. Add mission.verification_revision uuid NOT NULL FK request_event(id), same-request snapshot integrity checked; set once at offer and read its destination/task facts forever. Existing mission destinations therefore never follow later request projection changes.
- Capacity is one active mission, enforced by a partial unique index on team ID.
- Active statuses are OFFERED, ACCEPTED, EN_ROUTE and ON_SCENE.
- Under campaign/request/team locks, recheck skills, membership/mode, position, scope and capacity.
- First successful mission offer sets the attribution stamp in that same Response transaction.
- Suggest nearby eligible teams using distance bands and recent workload; coordinator chooses.
- Show distance, recent counts and active workload; record suggested team and override reason.
- Default radius 10 km and position freshness 30 minutes. Comparable band is nearest eligible distance + tolerance: P1=0 m, P2=500 m, P3/P4=2000 m. Within band order by distinct non-DECLINED/non-CANCELLED mission count over last24h, then distance, then team ID; remaining radius candidates order by distance/id. Show active older work separately. Example: A1km/5 missions, B1.5km/1 mission => B for P3/P4, A for P1; idle team9km never displaces A outside band. Stale/unknown positions appear separately and may be explicitly selected with warning/reason; manual offer rechecks eligibility but does not fabricate location freshness.
- No automatic dispatch, offer expiry or reassignment; overdue offers remain visible for manual action.
- APP active leader accepts/declines/advances; coordinator cancellation requires reason.
- Coordinator-recorded progress carries source, reported_by, reason and actual `occurred_at`.
- Completion requires `outcome_note`; radio/phone/in-person completion requires no mandatory media.
- Preserve server recording time separately from reported occurrence time.
- Completion evidence can be a structured sourced outcome; photos never become universal prerequisites.
- Failed work stays FAILED; never invent completion or use a no-mission waiver for failed work.
- Cancelling ACCEPTED/EN_ROUTE/ON_SCENE sets the team UNAVAILABLE in the same transaction.
- Add rescue_team.readiness_required boolean NOT NULL DEFAULT false. Active cancellation sets it true and availability UNAVAILABLE; generic availability PATCH cannot bypass it. Explicit scoped ready confirmation checks expected_version, no active mission, reporter/source/time and clears the marker atomically; stale confirmation cannot clear a newer decision.
- Cancelling OFFERED-only work releases capacity immediately without that readiness hold.
- Recompute request progress under its lock after every mission command.
- Accepted/travelling/on-scene work dominates offers; offers dominate fallback to TRIAGED.
- Mission completion never automatically resolves the request or its relief needs.
- Campaign PAUSED blocks new offers, acceptance, linked needs and commitments; existing work may finish.
- Already-issued delivery/return/loss settlement remains permitted after pause or closure.
- Close only after attached requests are terminal; RESOLVING is nonterminal.

## 8. Attribution admission and atomic reopen

- Add nullable `assistance_request.attribution_locked_at timestamptz`.
- First mission offer OR first Logistics admission sets it atomically under the request lock.
- Expose `POST /internal/requests/{id}/cycles/{work_cycle}/admit` to Logistics only.
- Require authenticated service identity plus signed actor context; never trust raw client actor headers.
- Idempotency uses the business tuple `(request_id, work_cycle)`; no expiring admission lease.
- Admit locks the request, checks current cycle, eligible lifecycle, actor scope and campaign eligibility.
- It sets the stamp if absent and returns canonical organization, region, campaign and version.
- Retry for the same eligible cycle returns canonical attribution without changing its meaning.
- Logistics calls admit before its transaction, then upserts/locks its unique fulfillment cycle.
- Cycle attribution comes only from the admission result and is immutable for that cycle.
- A seal/freeze racing a delayed local write is enforced by the Logistics cycle lock/state.
- Conservative admission stamp remains if Logistics fails; retry is safe and does not unlock attribution.
- Attach, detach and correct-region commands return `ATTRIBUTION_LOCKED` once stamped.
- First mission offer therefore prevents scope changes midmission as well as during fulfillment.
- Only reopen clears the stamp; no admin reset, timeout or failed-admission cleanup does so.
- Reopen is one Response transaction with reason and authorized terminal/current-cycle guards.
- Optional `campaign_id`: omit retains only an ACTIVE compatible authorized campaign.
- Explicit null detaches; supplied UUID must name an ACTIVE compatible authorized campaign.
- Optional `region_code` correction requires organization-wide `REQUEST_UNASSIGNED_QUEUE`.
- Validate the supplied region against the controlled boundary catalog; null follows explicit unassigned policy.
- In that transaction increment work_cycle, clear stamp/seal/resolved time and set TRIAGED.
- Apply attribution changes inside reopen, never by editing the old sealed cycle first.
- Old Logistics attribution, needs, settlements, seals and mission history remain immutable.
- A delayed old admission cannot write new demand into a sealed/frozen old cycle.

## 9. Resolution, cancellation and durable local fences

- Human resolution requires current-cycle mission outcome review and terminal fulfillment targets.
- If missions exist, require a genuine completed outcome and no active or unreviewed failed work.
- A failed mission requires POST /missions/{id}/review-failure with REQUEST_RESOLVE and scope. Lock request/mission; record STAFF request_event MISSION_FAILURE_REVIEW payload {mission_id,mission_version,disposition,reason,replacement_mission_id?}, increment mission and request versions atomically. REPLACED requires completed same-request/current-cycle replacement. Resolution checks every FAILED current-cycle mission has a review matching its resulting version; NO_FURTHER_ACTION/REFERRED still cannot waive genuine completed outcome. No extra review column/table is required.
- If no mission was assigned, require `mission_not_required=true` and nonblank `resolution_reason`.
- Persist these facts with the durable resolution intent/history, not an ephemeral request body.
- Response creates resolution_intent with exact request/cycle/kind, actor and prior state. expected_request_version stores the resulting post-barrier request version, not the caller pre-mutation version; finalizer checks that version. Add resolution_intent.version integer NOT NULL DEFAULT1 CHECK(version>0), reason text NOT NULL/nonblank and mission_not_required boolean NOT NULL DEFAULTfalse (CANCELLATION requires false). Create stores resolution_reason/cancellation reason; recovery and finalization read these columns, adopt/abort version them.
- Intent states are PENDING, ABORTING, COMPLETED and ABORTED; only one open intent per request.
- RESOLVING/active cancellation intent blocks competing mutations, supplements and mission changes.
- Outbound seal/freeze calls happen after the Response transaction commits.
- Logistics maintains unique `fulfillment_cycle(request_id, work_cycle)` with OPEN/FROZEN/SEALED.
- Add `cycle_intent(intent_id uuid PRIMARY KEY, cycle_id uuid NOT NULL FK, kind, state, created_at)`.
- Kind CHECK: RESOLUTION or CANCELLATION; state CHECK: SEALED, FROZEN or ABORTED.
- Intent IDs bind permanently to one exact cycle and kind; mismatched replays conflict.
- Retain `cycle_intent` rows and ABORTED tombstones without TTL or automatic deletion.
- Seal/freeze authenticates Response and confirms the exact durable intent is PENDING.
- Then upsert/lock the cycle and inspect the local intent fence before any state change.
- A matching completed local operation replays its result; ABORTED rejects late duplicates.
- Every need/commitment/issue mutation locks this cycle before child rows.
- Seal requires terminal needs, no reservations and no unsettled commitment target quantities.
- Create and seal empty cycles explicitly; absence is never treated as a protected empty result.
- Seal writes a stable seal ID and SEALED local intent in the same local transaction.
- SEALED prevents demand, target and commitment changes; post-target physical custody may continue.
- Response finalization first conditionally consumes the PENDING intent under its local lock.
- Recheck authorization/cycle/mission guards and record RESOLVED plus seal ID/version atomically.
- Pending recovery returns 202 with operation ID; never claim completion before final commit.
- Recovery retries the same intent and queries outcomes; timeout is not evidence of failure.
- Revoked initiator rights require authorized adoption/abort; service identity cannot bypass actor scope.
- Abort first commits Response ABORTING, preventing a competing finalizer from resolving.
- Unseal verifies exact ABORTING intent and request neither RESOLVED nor CLOSED before its transaction.
- Under the cycle lock, matching unseal writes ABORTED and releases only that intent's seal.
- If seal never arrived, unseal still creates the cycle and ABORTED fence after verified ABORTING.
- A delayed seal either commits before abort and is released, or sees ABORTED and fails.
- Restore saved previous_status for SUBMITTED/VERIFYING/VERIFIED, otherwise recompute mission progress, only after confirmed exact-intent unseal/unfreeze; never unseal by timeout. Generic adopt/abort supports both intent kinds with kind-specific live permission and scope.
- Cancellation uses distinct kind CANCELLATION and freezes even a previously missing cycle.
- FROZEN blocks new demand/commitments/issues but permits release and physical settlement.
- After confirmed freeze, cancel missions/request atomically, applying the team readiness rule.
- Cancellation cycles remain FROZEN; do not convert them to resolution seals or revive demand.
- Old-cycle physical work can finish without changing the human cancellation outcome.

## 10. Quantities, needs and stock integrity

- API quantities are decimal strings; database quantities are `numeric(18,3)`.
- Validate the original lexical string BEFORE any numeric(18,3) cast or persistence.
- Reject NaN, Infinity, exponents, negative/zero command quantities and excess unit scale.
- Unit scale is 0–3; enforce at most 15 integral digits and the numeric(18,3) range.
- Do not use floating-point arithmetic; use exact decimal/string arithmetic for quantities.
- PostgreSQL rounds excess fractional digits during numeric typmod conversion before ordinary CHECKs.
- A CHECK on the already-cast value cannot prove original input scale; do not claim otherwise.
- Trusted SQL entry points accept text/unconstrained numeric and validate before typmod assignment.
- Add explicit finite-value constraints to balances, counters, lines and movements; reject NaN explicitly.
- Units are canonical; no implicit box/piece conversion.
- One need is one item per cycle; one commitment is one immutable warehouse contribution.
- Keep `original_quantity` as the immutable initial quantity, not a maximum.
- Remove legacy `CHECK (requested_quantity <= original_quantity)`.
- Expose explicit increase-need command with expected_version, new quantity and reason.
- Increasing above the initial original_quantity is allowed on OPEN eligible cycles and audited.
- Reduce only to `delivered + reserved_remaining + unsettled_issued` or above.
- `reserved_remaining = quantity - released_quantity - issued_quantity`.
- `unsettled_issued = issued_quantity - delivered_quantity - returned_quantity - lost_quantity`.
- All counters stay nonnegative; protected totals cannot exceed current requested quantity.
- Cancel need only after unsettled target goods are settled; release reservations atomically.
- Preserve requested/history and record `cancelled_remaining = requested - delivered`.
- CANCELLED outstanding is zero; report cancelled remainder separately from active demand.
- FULFILLED requires delivered equals effective requested plus human confirmation.
- Point-target needs require nonblank `target_reason`; target is immutable after any commitment.
- Final-recipient target is represented by null designated_point_id; point target uses exact point ID.
- Commitment states are derived from quantities, never arbitrary status edits.
- Only append-only `stock_movement` insertion changes stock counters.
- Enforce on_hand >= 0, reserved >= 0 and reserved <= on_hand.
- Precreate missing balance pairs in sorted order, then lock by warehouse/item before movement insert.
- Harden the balance writer as SECURITY DEFINER owned by a dedicated NOLOGIN non-superuser role.
- Fix search_path to trusted schemas with pg_temp last and qualify all referenced relations/functions.
- Revoke PUBLIC execution and CREATE on trusted schemas; app roles cannot own/replace the writer.
- Revoke direct app INSERT/UPDATE/DELETE/TRUNCATE of balance counters and ledger mutation/deletion.
- Provide only controlled zero-balance creation and validated movement insertion privileges.
- Movement type/source shape, operation_ref uniqueness and constraints guard every write path.
- ISSUE decreases on_hand/reserved once; delivery never decrements warehouse stock again.
- Adjustment requires independent review, exact balance/deltas and one movement per adjustment.
- Add optional `stock_adjustment.compensates_movement_id` FK to stock_movement.
- Carry it through adjustment DTO/review/post into the correcting movement.
- Compensation is limited to OPENING or ADJUSTMENT source movements with delta_reserved=0 and no receipt/commitment/handoff source. Use the same balance and full opposite on_hand delta, once only, preserving reserved floor. Receipt, reserve, issue and return corrections use their owning review/release/return workflows so ledger reversal cannot leave business counters inconsistent.
- Preserve unique non-null movement compensation reference; partial reversal uses no false full-compensation link.
- Never edit an original ledger row; ordinary reviewed adjustments retain their own reason/audit.

## 11. Donation intake, revisions and posting

- Drives specify scope, intake warehouse, item/unit needs, acceptance notes and open dates.
- Only OPEN drives accept new handovers; closing does not erase ongoing review/dispute work.
- Donor declaration records actual goods handed over; it does not credit stock.
- Name/phone and item quantities support guest donations; no account/address/national ID requirement.
- Staff-created walk-ins preserve missing donor confirmation honestly.
- Declaration/count revisions are immutable and name exact item quantities.
- Counted = accepted + held + rejected; preserve differences and condition/disposition reasons.
- Reviewer differs from every count author, even when staff hold several roles.
- Reviews reference exact declaration and count revisions; changing either requires fresh review.
- Posting locks receipt, validates latest approved revision and serializes item caps.
- Posted RECEIPT plus RECEIPT_HELD_RELEASE totals cannot exceed approved accepted quantity per item.
- Receipt warehouse/item must match the balance and approved count line.
- Initial receipt posting is unique per receipt/balance independently of idempotency key.
- Release-held creates a NEW cumulative count revision, then independent review, then incremental post.
- Accepted cumulative quantities cannot decrease below already-posted totals; corrections use adjustments.
- Post only `approved_accepted - already_posted`, never the full cumulative accepted total again.
- Use a stable receipt/revision/item operation reference for held increments.
- A delivery remains POSTED while additional revisions are pending or disputed.
- Derive review_status from receipt.current_count_rev, delivery.current_declaration_rev and the receipt_review matching both revisions (PENDING when absent); derive postable increment from approved accepted minus ledger posted per item. No redundant review-status column is needed. Queue includes POSTED deliveries with unreviewed revisions; public approved totals come from ledger, never this pending revision.
- Public accepted totals use actual posted movements or the approved posted basis, not pending counts.
- Never sum every count revision; pending latest revision must not replace the posted approved basis.
- Private receipts show declared/count/accepted/held/rejected, discrepancies and dispute history.
- Expiry_date is informational receipt-line metadata; no batch, FEFO or donor-source allocation claim.
- Warehouses expose permitted collection location only when `location_public` allows it.
- Include `warehouse.location_public` in authorized versioned warehouse PATCH and public projection.
- No per-drive distributed totals: pooled stock cannot attribute downstream goods to a donor drive.
- Campaign/warehouse distribution reports remain separate, with item/unit and generated_at.

## 12. Distribution target settlement and physical custody

- Distribution transitions DRAFT → APPROVED → DISPATCHED → RECONCILED; cancel before dispatch only.
- Approval covers exact version/lines; edits invalidate approval and require review again.
- Two-person control: preparer may dispatch; approver differs from both preparer and dispatch actor.
- Do not require preparer and dispatcher to differ; seed at least two appropriately scoped staff.
- Field handoff recorder must differ from dispatch actor; enforce through distribution lookup.
- For receipt/handout/RETURN, an external receiver needs no account; receiver_label and confirmation_basis are nonblank when receiver_user_id is absent. LOSS has no receiver and forbids receiver fields; source/basis and independent review explain the loss.
- If receiver_user_id exists it differs from recorder. LOSS uses two steps: HANDOFF_RECORD creates immutable pending facts/lines; LOSS_APPROVE reviewer distinct from recorder approves/rejects through review-loss. Add handoff_record.state RECORDED|PENDING_LOSS|REJECTED NOT NULL DEFAULT RECORDED, version positive integer DEFAULT1 and review_reason nullable/nonblank. Non-LOSS must be RECORDED; pending/rejected LOSS has no approved_by, approved LOSS is RECORDED with authenticated approved_by_user_id distinct recorder and nonblank review_reason. Change legacy LOSS-approval CHECK accordingly. Pending/rejected LOSS never changes custody/counters/settlement; approval locks distribution then handoff and rechecks balances before once-only accounting. No client-supplied approver.
- Dispatch locks distribution, cycle, needs, commitments and balances in deterministic order.
- Request-aid lines reference commitments with matching item and warehouse via composite FKs.
- Direct campaign issue reserves/issues atomically; never invent request commitments for it.
- Maintain separate target accounting and physical custody counters for each line.
- Final-recipient target settles DELIVERED only at DIRECT_HOUSEHOLD or HOUSEHOLD_HANDOUT.
- Point target settles DELIVERED only at POINT_RECEIPT at the exact designated point.
- Point receipt for a final-recipient need moves custody only; it does not satisfy the need.
- A point-target receipt settles its commitment once while goods may remain physically at the point.
- Later household handout/return/loss changes custody without settling that commitment again.
- Post-target custody commands remain allowed after SEALED, with scope and arithmetic checks.
- Post-target return credits warehouse on actual receipt but does not reverse delivered target counters.
- Post-target loss records physical loss without rewriting historical target fulfillment.
- Add UNIQUE `issued_line_settlement(handoff_line_id)`; replace redundant nonunique handoff index.
- Settlement quantity must equal that handoff_line quantity, with matching commitment, RECORDED handoff state and valid kind; pending/rejected loss cannot gain settlements or counter effects.
- Every handoff kind validates route/source-stage and locks distribution before counter checks.
- In transit: issued = direct delivery + point receipt + verified transit return + transit loss + remaining.
- At point: received = household handout + verified point return + approved point loss + still held.
- Point stock is not warehouse available stock; no negative or double-consumed custody quantities.
- RECONCILED requires physical transit/point balances zero and no PENDING_LOSS, independently of target seal eligibility.
- Partial deliveries remain visible; issued, target-delivered and final household distributed are distinct totals.

## 13. Schema inventory and field-purpose coverage

| Owner / group | Tables and purpose |
|---|---|
| Identity catalogs | region, organization: controlled scope and organization status |
| Identity accounts | app_user, membership, role_grant: identity, affiliation and live scoped permissions |
| Identity sessions | session_family, refresh_session: revocation barrier, rotation and reuse history |
| Response catalogs | incident_category, skill, incident_category_skill, region_boundary: categories, capabilities and geography |
| Response campaigns | campaign: organized response scope, dates and lifecycle |
| Response intake | assistance_request, request_subject: lifecycle/ownership and affected household facts |
| Response verification | contact_attempt, verification_decision, request_event, authority_referral: evidence, decisions and audience-specific history |
| Response coordination | rescue_team, team_member, team_skill, team_position: mode, membership, skills and fresh position |
| Response missions | mission, mission_event: one-team current-cycle work and sourced outcomes |
| Response recovery/files | resolution_intent, evidence_metadata: durable operations and private media state |
| Logistics catalog/assets | item_type, unit, item, warehouse, relief_point, vehicle: canonical goods and operational assets |
| Logistics appeals | donation_drive, drive_item: intake opportunities and acceptance criteria |
| Logistics declarations | donation_delivery, donation_declaration, donation_line: private donor access and immutable declared revisions |
| Logistics intake | donation_receipt, receipt_count, receipt_count_line, receipt_review, donation_dispute: independent counting and approval |
| Logistics stock | stock_balance, stock_movement, stock_adjustment: guarded materialized balances and immutable correction ledger |
| Logistics fulfillment | fulfillment_cycle, cycle_intent, relief_need, commitment: immutable attribution, fences and target quantities |
| Logistics distribution | distribution, distribution_line, handoff_record, handoff_line, issued_line_settlement: dispatch, custody and once-only target settlement |
| Logistics files | logistics_attachment: private donation/dispute/handoff evidence metadata |
| Each applicable service | audit_log, idempotency_record; Response/Logistics notice: history, replay and recipient updates |

- Every persisted field must name a command/DTO consumer, query/report use or integrity/audit purpose.
- New migrations include that mapping; remove unused proposals instead of leaving orphan fields.
- Ownership/attribution fields are server-set; grants and cross-service context are never mass-assigned.
- Paired nullable fields require explicit shape CHECKs; SQL NULL must not bypass nonblank requirements.
- Preserve composite UNIQUE targets required by FKs even when their leading PK looks redundant.
- Preserve receipt/declaration revision FKs, same-organization asset FKs and distribution/handoff route FKs.
- Append-only history rejects UPDATE/DELETE/TRUNCATE through privileges and triggers.
- No hard deletion of referenced business history; deactivate catalogs/assets instead.
- `verification_decision.concurrence_event_id` links the validated version-paired concurrence event; `request_event.payload` stores concurrence versions and verified/supplement snapshots.
- Add mission_event.outcome_note text nullable/nonblank, recorded_at timestamptz NOT NULL DEFAULTnow(); COMPLETED requires outcome_note, sourced reports retain occurred_at and recorded_at separately. Both direct and recorded DTOs write these fields; task timeline/outcome review reads them.
- Request recovery fields, attribution stamp and verification_revision are explicit target schema additions.
- Team mode/contact/readiness_required, category-skill map, cycle_intent and adjustment compensation are target additions. Add vehicle.region_code NOT NULL, validated through Identity catalog; expose it in create/detail and apply REGION asset scopes to it. No index until an actual vehicle collection query needs one.
- Delivery/receipt organization_id are NOT NULL with drive/delivery/warehouse composite ownership FKs.
- Relief need target_reason and settlement uniqueness/quantity checks are target additions.
- Apply finite/scale writer validation, stock privilege hardening and index changes before claiming readiness.

## 14. Index and query contract

- Each collection has a declared fixed SQL budget, normally at most four statements for 50 rows.
- Page size must not increase SQL or cross-service call counts; no eager/lazy ORM child loading.
- Keyset paginate parent rows first, then batch children by IDs and aggregate with GROUP BY.
- Lists use non-null sort keys and ID tie-breakers; no OFFSET or one-to-many join pagination.
- Default limit 50, maximum 100; cursors bind filters and authorization context.
- Apply mixed grant branches separately and deduplicate by parent ID BEFORE final ORDER BY/LIMIT.
- Use UNION with deduplication or equivalent distinct parent selection, never limit overlapping grants first.
- Equality keys precede ordered timestamp/ID keys; partial predicates match the actual query.
- Open requests explicitly predicate status IN (SUBMITTED, VERIFYING, VERIFIED, TRIAGED, DISPATCHED, IN_PROGRESS, RESOLVING).
- `request_open_org_fifo_idx`: (organization_id, received_at, id), partial open predicate.
- `request_open_org_region_fifo_idx`: (organization_id, region_code, received_at, id), same predicate.
- Keep full request_org_fifo_idx and request_org_region_fifo_idx in that order for history.
- `request_campaign_idx`: (campaign_id, received_at, id), WHERE campaign_id IS NOT NULL.
- `request_unassigned_idx`: (organization_id, received_at, id), WHERE region_code IS NULL AND status NOT IN (REJECTED,DUPLICATE,CANCELLED,CLOSED).
- `request_review_lane_idx`: (organization_id, received_at, id), WHERE review_lane <> NORMAL AND status IN (SUBMITTED,VERIFYING).
- `request_verifying_idx`: (organization_id, verifying_since), WHERE status = VERIFYING.
- Add `request_submitted_alert_idx`: (organization_id, received_at, id), WHERE status = SUBMITTED; no lane exclusion.
- Keep declared danger as a filter on that bounded alert scan; do not hide quota lanes.
- `distribution_scope_idx`: (organization_id, created_at, id), replacing status-first ordering.
- `distribution_open_idx`: same keys, WHERE status IN (DRAFT,APPROVED,DISPATCHED).
- `drive_scope_idx`: (organization_id, created_at DESC, id DESC), replacing status-first ordering.
- `drive_public_idx`: (created_at DESC, id DESC), WHERE status = OPEN.
- `delivery_work_idx`: (organization_id, created_at, id), WHERE status IN (DECLARED,COUNTING,PENDING_REVIEW,APPROVED).
- POSTED receipts with pending revisions need a separate receipt-based queue using current revision/review predicates.
- That queue must include POSTED deliveries explicitly; do not overload initial delivery status semantics.
- `need_cycle_idx`: (cycle_id), covering cancelled history as well as live needs.
- `movement_balance_idx`: (balance_id, created_at, id) INCLUDE (delta_on_hand,delta_reserved).
- `notice_recipient_idx`: (recipient_user_id, created_at DESC, id DESC); unread version WHERE read_at IS NULL.
- Audit entity browse: (entity_type, entity_id, created_at DESC, id DESC); Identity type browse omits entity_id.
- Drop vehicle_unit_idx, item_unit_idx and audit_log_actor_idx absent an actual defined query.
- Retain unique FK targets; do not confuse constraint indexes with optional read indexes.
- GiST remains on request_subject.location and region_boundary.geom; scan the small team-position set.
- No speculative status-only, free-text/trigram or JSON indexes.
- Rare priority/category/danger filtering is an explicit measured-limit case, not an index per filter.
- Every large-table endpoint identifies its index and exact partial predicate in its contract.
- Batch Identity users:lookup, Response requests:batch and Logistics fulfillment:summary, at most 100 IDs.
- Batch endpoints enforce scope per ID and omit inaccessible objects without disclosure.
- Public drive totals use one grouped query over posted accepted goods, never per-row service calls.
- Reports are item/unit scoped with generated_at and windows at most 366 days; heatmap at most 31 days.
- Heatmap counts canonical verified requests only, never duplicate originals or unverified review-lane reports.
- Use EPSG:3405 demo grid, verify cell error for seeded regions; suppress exact household PII.
- Bound map viewport/cell count and cache sanitized scoped aggregates briefly; no global atomic snapshot claim.

## 15. Transactions, files and operations

- Response lock order: campaign, request, rescue_team, team_member, mission; sort IDs within each level.
- Campaign admission takes FOR SHARE; pause/close takes FOR UPDATE.
- Every mission command locks the request, preserving the resolving/intent barrier.
- Logistics lock order: distribution when applicable, cycle, need, commitment, sorted balances.
- Receipt commands lock receipt first; adjustment review locks adjustment first, then required balances.
- Seal/unseal use the same cycle lock; no network call occurs while any local transaction is open.
- Cross-service calls use 2-second timeout, keep-alive and per-callee bounded circuit breakers.
- Service dependency outages return explicit unavailable states; dashboards show source timestamps separately.
- Default lock timeout 3 s, statement timeout 8 s, idle transaction timeout 10 s.
- Pools start at Identity 20, Response 30, Logistics 20 with at least 20 connections of headroom.
- Introspection has its own bounded small pool; reports may use explicit longer local statement limits.
- Jobs claim bounded batches with advisory locks and SKIP LOCKED; run one scheduler in the demo.
- Jobs are idempotent; recovery does not re-drive ABORTED intents; no automatic fence expiry.
- MinIO AIStor Free is the selected private single-node synthetic lab store through AWS SDK v3.
- Recheck release/license/edition limits before setup; do not redistribute binaries or licenses.
- Do not assume HA, replication, at-rest encryption, lifecycle transitions or SLA in the free tier.
- Separate least-privilege Response and Logistics buckets/credentials; Identity has no object access.
- Upload protocol: authorize/reserve PENDING metadata, stream outside transaction, then commit READY.
- Failures preserve the SOS and retryable file state; reconcile orphan uploads with conditional state claims.
- Require Content-Length, bounded streaming counters, actual MIME checks and immutable generated keys.
- Limit media count, bytes, guest concurrency and aggregate upload rates; never trust client filename/type.
- Use current owner authorization before download; signed URL TTL is 60 seconds and is a bearer window.
- Store metadata only, never object bytes or signed URLs in SQL, logs or reports.
- Back up metadata and bytes with key/size/checksum manifest outside the demo host; verify restore later.
- Health/live and health/ready expose no dependency details and are not public Nginx routes.

## 16. Acceptance and handoff

- This document changes design only; it does not establish migration correctness or product test results.
- No runtime tests are authorized or executed for this documentation task.
- Before implementation, reconcile target migrations and API DTOs against every delta above.
- Retain T0-S schema alignment before T0 compatibility spike, then implement one integrated slice at a time.
- Future checks include real PostgreSQL races for capacity, review/post, compensation, settlement and fences.
- Include pre-cast scale/NaN, recovery one-use/replay and concurrent owner-claim rejection cases.
- Include attribution admission versus offer/reopen and delayed old-cycle write cases.
- Include concurrence intervening mutation and immutable snapshot/supplement-review linkage cases.
- Include active cancellation readiness, offered release and coordinator completion without media cases.
- Include held increment review/post with POSTED visibility and post-seal physical custody cases.
- Include Vietnamese success, validation, auth, permission, conflict, notices and optional AI output checks.
- Preserve TC-BE-30 fixed query budgets, TC-BE-31 target checks, TC-BE-32 posting caps and TC-BE-33 batch scope.
- TC-PERF-02 uses 1 M requests with at most 1% open and 300k distributions/deliveries.
- Measure EXPLAIN ANALYZE BUFFERS: lists at most 5 ms, filtered rows at most 20× page size.
- Heatmap limit is 500 ms; document rare-filter exceptions and actual environment instead of extrapolating.
- Prior legacy SQL assertions/measurements do not certify these new schema deltas.
- Scope cuts require explicit FR/TC/API/demo changes; never silently remove integrity controls.
- Operational priority definitions, real-data retention and production provider policies need domain approval.
- Main/API handoff: encode admit and atomic reopen exactly as Section 8, not separate attribution edits.
- Encode recovery issuance metadata-only replay, concurrence versions and snapshot event FK exactly as Sections 5–6.
- Encode increase, held-release review, ready confirmation and custody commands with the guards above.
- Next concrete task after the documentation ledger is accepted is T0-S target-schema migration work.
