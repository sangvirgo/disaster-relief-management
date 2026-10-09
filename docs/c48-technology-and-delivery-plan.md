# C48 Technology and Delivery Plan

**Version 4.0 · 2026-10-09 · design baseline, not implementation evidence.**

This concise plan replaces the cumulative v3.3 text. The user approved the logic-review corrections and requested a smaller agent-ready backend pack. Source scope is preserved in [project context](c48-project-context.md). Historical reasoning, requirement/test IDs and old diagrams remain in the [v3.3 archive](archive/v3.3/c48-technology-and-delivery-plan.md); archived statements do not override this baseline.

## 1. Authority and reading order

1. Root `AGENTS.md` and [project context](c48-project-context.md).
2. This plan and Appendix A.
3. [Backend entry point](backend/README.md), then its three numbered files in order.

The current plan defines product scope; [backend design](backend/01-design.md) defines business/data/authorization invariants; [API contract](backend/02-api-contracts.md) defines transport; [implementation plan](backend/03-implementation.md) defines tasks and evidence. A disagreement is a defect to correct before the affected task, not permission for an agent to guess. Existing `backend/schema/*.sql` is an **unrevised v3.3 input snapshot**, not the v4.0 target. T0-S reconciles it before application implementation.

## 2. Product and operating model

| Actor | Core responsibility |
|---|---|
| Citizen / reporter | Report a situation and affected location; optional note/media; private tracking and supplements. No required item selection, campaign or account for SELF SOS. |
| Signed-in proxy reporter | Report another household with relationship, source and last-known situation; beneficiary does not need an account/phone. |
| Coordinator | Receive, verify, prioritize, assign, follow up, record external-team reports, confirm outcomes and resolve/reopen with reasons. |
| APP team | Leader accepts/reports through the app; members read assigned work. |
| COORDINATOR team | External contact reports by phone/radio/in person; coordinator records it. No team account or app is required. |
| Campaign / operations manager | Publish campaigns/drives and manage basic allocation/assets; no automatic rescue authority. |
| Intake / reviewer / distribution staff | Count, independently approve, issue, record actual handoffs/returns/loss and reconcile quantities. |
| Administrator | Manage accounts/grants; administration does not imply access to victim/donor details. |

A team affiliation (volunteer/military/government/other) is metadata, never an authorization grant. Demo teams participate under one coordinating organization. Real cross-organization participation is outside the demo; do not bypass organization scope to simulate it.

### 2.1 SOS to assistance

Report situation/location → server ACK → coordinator intake and verification → manual triage → rescue mission, supply needs, both, or a reasoned decision that no mission is required → actual outcome/handoffs → guarded human resolution → administrative close.

- Notes/photos/video are optional. `people_affected` and reporter phone may be unknown; supplied values are validated. No fabricated phone, zero headcount or GPS accuracy.
- The coordinator defines item/unit/quantity **after assessment**. A request can have zero needs and zero missions; an absence alone is not proof that assistance is complete.
- Verification, priority, mission progress, supply fulfillment and physical custody are distinct. Unanswered calls do not automatically reject a report.
- Declared danger and waiting SUBMITTED reports are visible across all review lanes. Queue ownership and overdue follow-up must be explicit.
- Canceling active field work keeps the team unavailable until receipt of the stop/end instruction is confirmed. A database capacity slot is not proof of actual readiness.
- Completion may be evidenced by an attributable field report; media is supplementary. Failed assigned work cannot be waived using the no-mission branch.
- Once a mission is offered or Logistics admits a cycle, attribution is locked for that cycle. Reopen creates a new cycle; historical attribution never changes.

### 2.2 In-kind donation to final handoff

Manager publishes needed goods/intake site → donor declares actual goods → staff count independently → another person approves the exact revision → accepted quantity posts once → approved dispatch → actual point/household receipt → remaining custody/return/loss accounting.

| Concept | Meaning |
|---|---|
| Warehouse | Available stock and reservations; changes only through the ledger. |
| Relief point | One intermediate or designated destination; point-held quantities are separate from warehouse available stock. |
| Household/final recipient | Final assistance handoff, without mandatory account or phone. |
| Campaign | Operational grouping; an SOS and a drive may exist without one. |

A point receipt satisfies only a need explicitly targeting that point. It does not prove household delivery. After a point-targeted need is settled, later handouts/returns/loss update custody without settling the commitment again; permitted post-target custody survives a fulfillment seal. Release of held goods requires a new intake revision, independent review and posting of the approved additional quantity only.

Accepted totals are attributable to a donation drive. Final-distributed totals are attributable only to their recorded campaign/warehouse scope; pooled stock has no per-drive source allocation in this version. No money, payments, pledges, procurement or commerce.

## 3. Technology decisions and comparisons

| Area | Selected baseline | Comparison / reason |
|---|---|---|
| Backend | NestJS / TypeScript | Shared language with clients; guards, validation and OpenAPI. Spring Boot is capable but adds Java; Django/DRF offers mature CRUD but adds Python; FastAPI offers concise typed APIs but fewer integrated application conventions; Flask requires more assembly. No Python runtime is introduced. |
| Persistence | TypeORM + PostgreSQL/PostGIS | Transactions, constraints, locking and spatial queries match rescue/stock workflows. PostgreSQL is preferred over document-first storage for quantity integrity; PostGIS avoids a separate spatial data engine. Use parameterized SQL where ORM support is insufficient. |
| Boundaries | Identity, Response, Logistics | Separate ownership/migrations/credentials, REST integration. A monolith would reduce integration cost; three services remain the approved capstone baseline. |
| Web / mobile | React/Vite / React Native/Expo, TypeScript | Operational Web screens and foreground device GPS/media. No background location tracking. |
| Storage | MinIO AIStor Free, single node | Selected educational lab object store, private S3 API through AWS SDK v3. Operators obtain the artifact/license under current terms; do not redistribute. Verify license limits, private access and restore before use. Do not rely on HA, encryption at rest or SLA from the selected Free tier. |
| Deployment | Compose + Nginx on one host | Demonstrates separate services, not infrastructure high availability. Separate service databases on PostgreSQL. |
| Async / AI | Local durable jobs; AI off by default | No broker, Redis, autonomous verification/priority/dispatch, or new AI service. Revisit only with a measured requirement. |

Node 24 LTS and PostgreSQL 17/PostGIS 3.5 are setup candidates from earlier research, **not freshly verified compatibility claims**. T0-S verifies/pins the database/PostGIS image before SQL execution; T0 verifies/pins Node/Nest/TypeORM and proves migration, spatial, locking and OpenAPI compatibility.

## 4. Ownership and invariant boundaries

- **Identity:** users, organizations, region catalog, memberships, scoped grants and session families.
- **Response:** SOS/subjects, verification/source references, teams/positions, missions, campaigns, request history and resolution/cancellation intents.
- **Logistics:** item/unit catalogs, assets, drives/declarations/receipts/reviews, stock ledger, needs/commitments, distributions, handoffs and local cycle fences.
- No cross-service SQL, credentials, FKs or transactions. Each owner writes state/history/notices atomically. Network calls and uploads occur outside transactions.
- Request-cycle admission locks attribution in Response before Logistics creates needs. Logistics cycle locks/fences protect delayed commands and terminal-intent tombstones reject late seal retries.
- Current scope is checked before pagination and actions. Multiple matching grants never duplicate a row. Cross-service board reads are batched and carry authenticated user scope.
- Quantity units remain separate. Reservations are part of on-hand, not additional stock. Returned/lost goods do not count as delivered to an unmet target.
- Logs/audits exclude secrets and unnecessary PII; user-entered text is rendered inert. Exact location/contact access is object-scoped.

## 5. Storage, language and optional scope

Uploads reserve bounded quota, stream outside transactions to immutable private keys, then mark READY. Failure preserves the SOS. JPEG/PNG ≤10 MiB, MP4 ≤50 MiB, ≤5 READY/PENDING files and ≤100 MiB per owner; validate actual content, bounded parser execution and codecs. Downloads authorize current access before a 60-second signed link. Restore database metadata and object bytes together with a checksum manifest.

All product copy and backend human-readable responses are Vietnamese, including validation/framework/provider errors, notifications and AI explanations. Paths, codes, enum values, JSON fields and technical documentation remain English. Preserve submitted names/text; never translate user data silently.

| Scope | Treatment |
|---|---|
| Core | SOS/proxy, verification/triage, APP and COORDINATOR teams, missions, campaigns/heatmap, guest in-kind donations, independent review, basic stock/partial delivery, points/custody, reports, privacy and recovery. |
| Conditional | Push, full offline retry queue, CSV and AI; implement only after core acceptance. Pending/not-sent UI remains required even if offline queue is omitted. |
| Deferred | Inter-warehouse transfers, batch/source allocation, stocktakes, automated FEFO, multi-leg forwarding and multi-request dispatch. Existing reserved IDs are retained, not implementation obligations. |
| Real-use gates | Operational priority/SLA validation, multi-agency participation, personal-data retention and external-provider approval. Synthetic demo behavior does not constitute official rescue policy. |

## 6. Requirements and stable identifiers


For FR priorities, **M** means required for the core demo, **S** means should have if time permits, and **O** means optional extension. These are proposed priorities, not classifications in the original brief.

### 6.1 User Requirements (UR)

| ID | Actor | Need |
|---|---|---|
| UR-01 | Citizen / signed-in proxy reporter | Submit an SOS for self or an affected household with its location and report provenance; distinguish reporter contact from beneficiary contact; receive server confirmation. |
| UR-02 | Citizen | Track progress, add information, and understand rejection, duplicate, or closure reasons. |
| UR-03 | Coordinator | Verify reports, review duplicates, inspect the heatmap and assign capable nearby teams while considering recent workload. |
| UR-04 | Volunteer/team | Access assigned missions only; accept/decline, update progress, and submit outcome evidence. |
| UR-05 | Campaign / operations manager | Manage campaigns, collection appeals, relief points and basic supply allocations/deliveries; advanced warehouse operations are deferred. |
| UR-06 | Admin/manager | Manage accounts/scoped permissions and view operational dashboards/reports. |
| UR-07 | Operations team | See work queues, partially fulfilled needs, service health, dashboard timestamps, and recovery guidance. |
| UR-08 | Signed-in or guest donor | Find donation drives, declare supplies handed over, inspect verified receipt and distribution progress, and dispute differences. |
| UR-09 | Intake staff / independent operations reviewer | Receive and count supplies, independently approve receipts, preserve discrepancies and post accepted stock once; campaign managers publish drives. |
| UR-10 | Distribution staff / receiving party | Authorize dispatch, record custody changes and beneficiary handouts, and reconcile shortages, returns and losses. |

### 6.2 Functional Requirements (FR)

| ID | Priority | Proposed functional requirement | Verification criterion |
|---|---:|---|---|
| FR-IAM-01 | M | Citizen registration, login, refresh/logout, account disabling, and credential changes | Invalid/expired tokens or disabled accounts receive 401; logout invalidates the refresh session |
| FR-IAM-02 | M | Organization/region/campaign-scoped roles; action and object checks | Citizens cannot access another citizen's request; volunteers see their team's missions only |
| FR-IAM-03 | M | Admin account, organization, and role management with least privilege | Permission changes record actor/time and before/after values |
| FR-REQ-01 | M | Create requests with category, optional note, nullable headcount when unknown, optional reporter contact phone (validate when provided), location/manual pin, time/source, optional reporter-declared 'immediate danger' flag (unverified; see FR-REQ-10) | Validate input incl. phone format; return an identifier and server receive time; contact phone is visible only to the reporter, scoped coordinators and assigned team leaders, and excluded from maps, reports and AI input |
| FR-REQ-02 | M | Anyone may submit an SOS without an account (guest SOS); an optional signed-in citizen's request is linked to the account. Guests track and supplement through a high-entropy tracking secret generated by the client before submission (backend API contract); the server returns only a non-credential request ID and tracking code. A guest can later claim the request after signing in | Unauthenticated creation succeeds with rate limiting; the server stores only a purpose-bound hash of the secret and never returns or logs it; a lost creation response is recoverable by retrying with the same key/body/secret; without the secret (or ownership) tracking/supplement is denied; registration still grants CITIZEN only; SOS creation and secret-based tracking never call Identity |
| FR-REQ-03 | M | Idempotent SOS creation retries | Same key/payload/secret creates no second row and returns the original request ID and tracking code; same key with a different payload or secret is rejected (409) |
| FR-REQ-04 | M | Verify, reject, and duplicate-link; rejection/duplicate decisions require reasons | Preserve duplicate requests and link them to a canonical request |
| FR-REQ-05 | M | Manual P1–P4 priority with actor/time/reason and override history | Priority is separate from status; AI cannot change it automatically |
| FR-REQ-06 | M | Scoped list/map filtering by bbox/region, status, priority, and time | Apply authorization filters before pagination |
| FR-REQ-07 | M | Citizens view timelines and supplement their own requests in permitted states | Owner-only access; supplements record actor/time |
| FR-MSN-01 | M | Manage teams, skills and availability; APP teams have account members, COORDINATOR teams have an external contact without mandatory accounts | Reject inactive/unavailable teams or missing mandatory skills |
| FR-MSN-02 | M | Create missions, offer/assign, accept/decline, transition, and record results | Only valid transitions; record actor/time/reason |
| FR-MSN-03 | M | One request may have multiple missions; one mission belongs to one request and one team in the MVP | One completed mission does not close a request with remaining needs |
| FR-MSN-04 | M | Request/mission evidence uploads and coordinator outcome confirmation | Metadata and download access follow object scope |
| FR-CAM-01 | M | Response manages campaigns, incident categories on requests, operating regions, time, and status | Scoped creation/editing; Logistics stores campaign references |
| FR-LOG-01 | M | Manage warehouses, items, vehicles, relief points, and campaign references where needed | Active/inactive entities; preserve existing history |
| FR-LOG-02 | M | Basic receipt, reserve/release, issue, verified return and independently reviewed correction; inter-warehouse transfers are deferred (S) | Ledger records actor/time/quantity/reason; balances never negative |
| FR-LOG-03 | M | Link Logistics needs and commitments to a request by opaque ID; record commit/release/issue/delivery locally | Multiple contributions are supported; no cross-service transaction or direct table access |
| FR-LOG-04 | M | Distribution by campaign, point, item, quantity, and actor | Retries never duplicate a distribution |
| FR-LOG-05 | M | Show requested, committed/reserved, issued, delivered, and outstanding quantities; allow partial fulfillment | Delivered + active committed/reserved + issued-but-not-delivered never exceeds requested; one partial contribution does not close the need |
| FR-DON-01 | M | Campaign/operations managers publish drives with optional campaign link, intake location, items/types/units and acceptance criteria | Staff without drive-management grant cannot publish; drive and campaign remain distinct |
| FR-DON-02 | M | Signed-in or guest donors leave name/phone and declare supplies handed over without mandatory registration; future pledges are deferred (S) | Guest capability is donation-scoped; retries do not duplicate records; declarations never credit stock |
| FR-DON-03 | M | Preserve donor declarations, independent physical counts, condition and accepted/rejected/held quantities | Immutable submitted revisions and explicit missing confirmation; compare matching canonical units |
| FR-DON-04 | M | Independent review and exactly-once posting of accepted receipts | Reviewer differs from intake actor; pending/held goods cannot be allocated; posting and ledger/audit are atomic |
| FR-DON-05 | M | Private donor receipt, discrepancy notification and dispute history | Receipt number alone grants no access; silence never becomes donor agreement; no deletion of disagreements |
| FR-DON-06 | S | Trace receipt-source allocations through reserve, issue, transfer, return and settlement | Per-source balances reconcile with aggregate stock; mixed goods are described as accounting allocations |
| FR-REC-01 | M | Basic per-item campaign/intake/stock/delivery totals with separate held and outstanding quantities | No summing unlike units; trace receipt and distribution records; source-level pooled allocation is deferred |
| FR-REC-02 | S | Versioned stocktakes and independently approved corrective movements | No overwrite of posted counts; stale stocktake conflicts; adjustment cannot violate reserved/nonnegative constraints |
| FR-LOG-06 | M | Independently approve distribution plans and record dispatch/receipt evidence | No self-approval or duplicate ISSUE; relief-point receipt is distinct from beneficiary handout |
| FR-LOG-07 | M | Record direct household delivery or one point receipt followed by partial handouts, with verified return/loss; multi-leg forwarding is deferred | A unit is counted at its actual handoff stage; delivery never decrements warehouse stock again |
| FR-AI-07 | O | Human-reviewed donation-document extraction only after a measured benefit gate | No automatic approval, stock mutation, allocation or accusation; deterministic reconciliation works with AI disabled |
| FR-REQ-08 | S | Suggest possible duplicate reports using time/category/location filters | Suggestions are visibly non-authoritative; only a coordinator may link/reject |
| FR-REQ-09 | M | Human resolution with a durable current-cycle Logistics seal and recoverable intent | Concurrent fulfillment changes cannot invalidate a committed resolution; timeout recovery preserves one outcome |
| FR-REQ-10 | M | Minimum verification evidence and unreachable-reporter handling: contact-attempt log, verification basis, overdue escalation, authority-referral record, reporter-declared danger flag kept separate from status and priority | NO_ANSWER alone never verifies or rejects; rejection for unreachability needs the demo minimum attempts and a reason; TWO_COORDINATOR_JUDGMENT needs a distinct second coordinator; overdue and declared-danger requests are visible to other scoped coordinators; no automatic ranking, triage or dispatch |
| FR-REQ-11 | M | Authenticated PROXY reports for an affected household, with relationship, last-known information and optional alternate contact | Subject pin is not reporter GPS; current login checked for PROXY; neither login nor relationship verifies the report; private access remains reporter/scoped staff/assigned team only |
| FR-MSN-05 | M | Candidate teams from volunteer, military and government organizations, filtered by capability, scope, availability and capacity, then nearby distance and recent workload | The backend design specifies comparison factors and stale-position exclusion; a slightly farther, less-burdened eligible team can be suggested; coordinator decides and offer transaction rechecks capacity |
| FR-MSN-06 | M | Audited coordinator-recorded mission progress on behalf of a team that cannot use the app (radio/phone), with basis and reporter | Same transition table; recording actor and external reporter stored; active cancellation keeps the team unavailable until field confirmation; no inferred progress |
| FR-TEAM-01 | M | Team leader or scoped coordinator creates/maintains a team profile (members, skills, affiliation, availability) and confirms or sets the team position (foreground/manual, with source, accuracy, time and audit) | Position freshness drives the documented candidate query; coordinator-set position is labelled and audited; no background tracking; inactive/unavailable teams cannot be offered missions |
| FR-MAP-01 | M | Scoped operational heatmap with explicit time/status filters and canonical-report counts | Verified canonical requests only by default; unverified queue separate; duplicate reports never inflate confirmed totals; no PII or exact households in aggregate response; no automatic dispatch |
| FR-NOT-01 | M | In-app notices in the service that owns the changed request, mission, or stock task; push/email are extensions | Notice write is local to the business transaction; recipient scope is enforced |
| FR-NOT-02 | S | Push alert for new mission offers and request status changes to registered devices (Expo push), sent from the owning service after commit via a small outbox row; guests rely on the secret-based tracking page | Push failure never rolls back or blocks the business change; payload carries only a Vietnamese generic text and notice ID, no exact location or contact data; retry is idempotent per notice and device |
| FR-RPT-01 | M | Scoped dashboards for request states/timings and stock/fulfillment gaps | Totals match a fixed dataset; each API response includes generated_at |
| FR-RPT-02 | S | Scoped CSV export with role-based PII masking | No unauthorized fields; audit sensitive exports |
| FR-AUD-01 | M | State, decision, adjustment, distribution, and role-change history | No passwords/tokens in audit; restricted readers |
| FR-EVT-01 | O | Broker-based event streaming and replay are deferred exploration | Excluded from core acceptance unless measured fan-out/replay/independent-consumer criteria are demonstrated |
| FR-FILE-01 | M | Private uploads, size/type validation, metadata, controlled downloads | Reject forged MIME/oversize files; expired links cannot download |
| FR-OFF-01 | S | Offline SOS drafts and mission-progress actions retry with the same idempotency key | Distinguish QUEUED_ON_DEVICE from SUBMITTED; a mission action that could not be sent is never shown as done |
| FR-AI-01 | O | AI/rule suggestions with factors/version and coordinator acceptance/override; optional detailed requirements FR-AI-02..06 in the archived optional-AI specification | No automatic dispatch/priority overwrite; core works with AI disabled |

### 6.3 Non-functional Requirements (NFR)

The brief specifies no numeric thresholds. implementation task T18 adopts the numeric synthetic-demo targets under the user's delegated design authority; these do not establish an operational SLA.

| ID | Quality | Proposed requirement/criterion |
|---|---|---|
| NFR-SEC-01 | Security | Require authentication by default. The only public unauthenticated routes are registration/login/refresh and CSRF bootstrap; sanitized request-category listing; guest SOS creation, evidence upload and secret-based tracking; and the backend public donation routes: sanitized read-only donation-drive listing/detail and campaign summaries and capability-based guest actual-donation declaration creation (pledges deferred), tracking, dispute and evidence upload. Guest routes are throttled per IP and per contact phone under the backend SOS soft-threshold rules, validate input strictly, and never expose other reports. A guest report is untrusted until a coordinator verifies it and cannot reach triage or dispatch before then. Services enforce scope and never trust client-supplied roles. |
| NFR-SEC-02 | Security | Filter list querysets by authorization; enforce detail/action object permissions, input/file validation, and suitable rate limits. route-level guards do not automatically scope returned rows; test object and list authorization separately. [NestJS guards](https://docs.nestjs.com/guards), [NestJS validation](https://docs.nestjs.com/techniques/validation) |
| NFR-SEC-03 | Security | Do not log tokens, passwords, signed URLs, or unnecessary exact locations; HTTPS outside local development. |
| NFR-SEC-04 | Security | Web hardening per the backend security rules: strict CSP, nosniff, no-referrer, no-store on sensitive responses, escaped rendering of all user-entered text, secrets only in approved credential headers, dependency audit recorded before the demo. Tested by TC-BE-27. |
| NFR-PRV-01 | Privacy | Exact locations are accessible only to the subject, scoped coordinators, and assigned teams; reports aggregate by default. Retention needs confirmation. |
| NFR-REL-01 | Reliability | Nonnegative inventory, valid states, idempotent API retries, visible cross-service errors, and backup restoration checks.  Bounded database lock/statement timeouts and connection pools per service (the backend transaction rules); a timeout surfaces as a retryable Vietnamese error, never a hang or partial write. |
| NFR-PERF-01 | Performance | Adopted synthetic-demo target: 10,000 stored assistance requests; 20 concurrent k6 virtual users; common read API p95 ≤ 2 seconds and SOS creation p95 ≤ 3 seconds excluding upload; unexpected HTTP failure rate < 1% during a 10-minute measured steady interval after a 2-minute warm-up. Include Identity introspection. Record hardware and workload mix as implementation task T18 specifies. Task T18 adds a scale gate (TC-PERF-02: 1 M stored requests, ≤ 1 % open) because a 10,000-row dataset hides history-dependent query degradation. |
| NFR-PERF-02 | Performance | Spatial indexes/bbox/result limits for maps; each dashboard panel shows its source timestamp instead of an unqualified real-time claim. |
| NFR-UX-01 | Usability | Few SOS steps, usable controls, clear submission status, manual pin, understandable GPS errors. |
| NFR-OFF-01 | Weak connectivity | If an offline queue is implemented, retries are idempotent; no continuous background location synchronization. |
| NFR-OBS-01 | Operations | Health/readiness, correlation IDs, API latency/errors, database/storage health, and optional AI-job age/failure metrics. |
| NFR-OPS-01 | Recovery | Document DB/object metadata backup and perform a demo restore; define RPO/RTO when real requirements exist. |
| NFR-COMP-01 | Compatibility | Versioned API/OpenAPI, controlled migrations, UTC backend, configurable UI timezone. |
| NFR-TEST-01 | Testing | State, object-permission, inventory-race, retry/idempotency, partial-fulfillment, API-outage, and end-to-end tests; coverage threshold remains open. |
| NFR-L10N-01 | Language — confirmed | All Web/Mobile user-facing content and backend human-readable messages are Vietnamese, including errors, notifications, and displayed AI explanations. Stable machine codes/fields remain English. Technical documents remain English. |

## 7. Delivery and acceptance

Use the ordered tasks in [03-implementation.md](backend/03-implementation.md). T0-S reconciles the legacy SQL; T0 proves pinned compatibility; T1–T10 deliver the rescue workflow; T11–T17 deliver accountable supplies and guarded completion; T18 hardens/measures; T19 hands off contracts and evidence. Prototype the T16 seal/fence path during T0 instead of discovering its failure at the end.

Every accepted slice includes current OpenAPI/migrations, state/scope/quantity cases, Vietnamese responses, a working Web/Mobile contract and actual command evidence. Planned tests are not passing tests. Scope cuts remove conditional/deferred features first; never weaken independent review, once-only posting, nonnegative stock, human verification, privacy, terminal fences or truthful ACK.

Backend T19 is not whole-product acceptance. The three-member team also delivers these integration milestones:

| Milestone | Client/integration responsibility | Dependency / acceptance |
|---|---|---|
| C1 | Web/Mobile SELF report, private track and signed-in proxy; Vietnamese GPS/manual-pin/pending states | T4–T7 contracts; real-device denied GPS, lost response and retry; TC-LOGIC-01/04/11 |
| C2 | Coordinator Web verification/map/APP-or-external-team assignment; Mobile assigned-team workflow | T7–T10; external team completes without app; scope denials and safe cancellation demonstrated |
| C3 | Public drive/donor receipt; staff count/review and partial handoff screens | T11–T15; donor declaration versus count discrepancy, held-release review and point/final-recipient distinction |
| C4 | Resolve/reopen, service-outage displays, reports and complete journeys | T16–T18; seal recovery, post-target custody, real-device/network tests and Vietnamese accessibility checks |
| C5 | Final SRS/SDD, test results, install/restore guide, user guide and demo recording | T19 + C1–C4; documents match current contracts/screens, each claim linked to actual evidence |

Required capstone outputs: SRS, SDD, test cases/results, installation and restore instructions, user guide, and demonstration evidence. Keep UR/FR/NFR/UC/TC traceability. Existing diagrams are historical illustrations until checked against v4.0; they are not a schema/API contract.

Demo performance: fixed 10,000-request seed, 20 k6 VUs, 2-minute warm-up plus 10-minute measurement, 80% scoped reads/20% SOS, no upload in SOS timings, read p95 ≤2s, SOS p95 ≤3s, unexpected failures <1%. Include Nginx and introspection; record hardware/build/dataset growth. Query scale acceptance additionally uses 1M requests (≤1% open) and 300k deliveries/distributions, representative filters and keyset page two. These are recorded demo targets, not nationwide capacity claims.

## 8. References and historical evidence

- [NestJS](https://docs.nestjs.com/), [TypeORM PostgreSQL](https://typeorm.io/docs/drivers/postgres/), [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html), [partial indexes](https://www.postgresql.org/docs/17/indexes-partial.html), [PostGIS](https://postgis.net/docs/ST_DWithin.html).
- [MinIO AIStor Free agreement](https://www.min.io/legal/aistor-free-agreement), [license limits](https://docs.min.io/aistor/operations/licenses/), [S3 signed URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [OWASP file uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
- [Platform research](research/disaster-response-platform-patterns.md), [donation research](research/in-kind-donation-reconciliation-patterns.md), [capstone lessons](research/ptit-hcm-capstone-design-lessons.md). Dates/claims remain historical unless rechecked for an actual implementation decision.
- [Archived detailed plan](archive/v3.3/c48-technology-and-delivery-plan.md) retains prior comparisons, IDs, use cases and optional-AI research. The Vietnamese v2.8 plan and old drawings do not govern v4.0.

## Appendix A. Agent handoff

### A.1 Start and authority

Read AGENTS, context, this plan and the three backend files. Begin with T0-S, then T0. An agent can start the documented schema/setup tasks after the documentation review; application slices require their preceding evidence gates. Do not assume legacy SQL has already received v4.0 changes.

### A.2 Non-negotiable invariants

Own service database/credentials/migrations; stable IDs; scoped reads/actions/files; human verification/priority/dispatch; current work-cycle guards; terminal intent fences; local atomic history/notices; once-only movements and independent approval; physically bounded handoffs; immutable historical attribution; Vietnamese copy; no false received/completed UI; no secret/PII leaks.

### A.3 Research and implementation limits

Verify time-sensitive versions, provider terms and licenses against primary sources before pinning. Record dates, URLs, exact artifacts and evidence; dated research does not prove current support. AI remains disabled without a separate reviewed contract/evaluation/privacy basis. Map provider and real-data retention are separate gates, not reasons to block schema/setup with synthetic data.

### A.4 Session handoff

Record objective, authorized scope, files/commit, completed and remaining tasks, decisions, exact checks/results, environment versions without secrets, limitations, and the next concrete task. Update the review/evidence status in the implementation plan; never mark an unexecuted TC as passed.
