# C48 Technology and Delivery Plan

| Attribute | Value |
|---|---|
| Project | Emergency Response and Disaster Relief Management System |
| Project code | C48 |
| Version | 2.8 — defense-review corrections: client-generated SOS tracking secret, verification and unreachable-reporter rules, P1–P4 criteria, seal-protected scope, integrated schedule, cancelled-need accounting; builds on 2.7 donation extension |
| Initial research / plan revision | 2026-09-29 / 2026-10-04 |
| Team context | Three members in the project brief; backend owned by one member |
| Document role | Single technical plan for implementation and further research |

This document provides the proposed technical baseline for the SRS, SDD, database/API design, test cases, and user guide. The three-service architecture and adapted workflows below are C48 design proposals, not requirements imposed by the department or approved rescue policy.

**For implementation and further research:** this is the single technical plan. Appendix A adds execution guidance and remaining slice-specific contract gates. Sections 22 and 23 define the backend structure, business invariants, and resolved architecture-review decisions; Section 25 extends the baseline with in-kind donations, independent receipt verification, source accounting and relief handouts. Section 12 specifies the optional AI decision-support extension; Section 6.3 records the object-storage choice. This plan does not claim implementation benchmarks or executed product tests.

## 1. Reading guide and confidence levels

| Label | Meaning |
|---|---|
| **Project brief** | Requirements consolidated in [c48-project-context.md](c48-project-context.md). |
| **Proposal** | Technical choice or business rule proposed as the capstone baseline. |
| **Needs confirmation** | A question for the supervisor or someone with relevant operational experience. |

OCHA/IFRC materials inform humanitarian workflow design; they do not replace rules issued by competent authorities in Vietnam. OCHA describes a cycle covering analysis, planning, resource mobilization, implementation, monitoring/evaluation, and reporting. [OCHA — Humanitarian Programme Cycle](https://knowledge.base.unocha.org/wiki/spaces/hpc/overview)

## 2. Recommendation summary

| Area | Proposed baseline | Rationale |
|---|---|---|
| Backend | NestJS + TypeScript on a supported Node.js LTS release | Fits the TypeScript client stack and supports modular APIs, validation, and OpenAPI. Pin compatible versions at setup. |
| Database | PostgreSQL + PostGIS, accessed through TypeORM and parameterized SQL for spatial operations | Relational workflows, inventory transactions, and indexed location queries; TypeORM documents PostgreSQL geometry/geography support. [TypeORM PostgreSQL spatial columns](https://typeorm.io/docs/drivers/postgres/) |
| Backend services | Three independently deployable services: Identity, Response, Logistics | Shows meaningful ownership boundaries while keeping the capstone deployable and testable by one backend owner. |
| Service communication | REST/JSON for user-facing and cross-service commands; local database transactions | Workflows are human-paced and need immediate responses. Broker-based messaging is deferred until a measured use case needs fan-out, replay, or independent consumers. |
| Web | React + TypeScript + Vite | Suitable for operational dashboards; authenticated screens do not require SSR/SEO. [Vite guide](https://vite.dev/guide/) |
| Mobile | React Native + Expo + TypeScript | Shares TypeScript skills and supports GPS, photos, and notifications. Request location permission when needed; no default background tracking. [React Native TypeScript](https://reactnative.dev/docs/typescript), [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/) |
| Files | MinIO AIStor Free, single-node lab deployment, through the AWS SDK for JavaScript S3 client | Final capstone choice for synthetic demo data. Obtain/use it under current license terms; do not redistribute software. Free tier has no HA/SLA and excludes at-rest encryption; retain private access and tested backup. |
| Deployment | Docker Compose on one demo host; Nginx reverse proxy | Multiple containers do not require multiple physical machines. [Docker Compose production](https://docs.docker.com/compose/how-tos/production/) |
| AI | Advisor with explanations; coordinator makes the decision | An optional research direction, with no automatic priority changes or rescue dispatch. |

**Demo scale:** three application services, PostgreSQL/PostGIS with separate database credentials, object storage, and optional lightweight metrics on one demo host. k6 can generate HTTP virtual-user traffic against the APIs without Kafka. [Grafana k6 virtual users](https://grafana.com/docs/k6/latest/get-started/running-k6/)

## 3. Problem analysis and business workflow

### 3.1 Risks to address

The project context involves information passing through multiple channels and teams. Validate these risk hypotheses through interviews or surveys:

- Requests may lack location, affected-person count, or observation time.
- Duplicate reports may remain unlinked, distorting statistics or causing repeated dispatch.
- Coordinators may lack visibility into pending verification, accepted missions, and available resources.
- Inventory and aid deliveries may diverge across receipts, transfers, commitments, issues, and distributions without a traceable history.
- Weak connectivity may leave a citizen unsure whether the server received an SOS.
- Dashboards can mislead if their source, filter scope, or latest-data time is unclear.
- Broad access permissions may expose sensitive location/contact information.

These are problem hypotheses, not findings about a particular locality or authority.

### 3.2 Target workflow

1. **Intake:** a citizen submits a request with coordinates, accuracy, capture time, and location source. Offline submissions remain pending; only a server acknowledgement (ACK) means received.
2. **Screening:** validate input, use an idempotency key to prevent duplicate submission, and add the request to the operational queue.
3. **Verification:** a coordinator contacts the reporter or adds information. Rejection and duplicate linking require a reason and history.
4. **Prioritization:** a coordinator applies agreed criteria. AI output, if enabled, is supplementary.
5. **Dispatch:** offer a mission to a suitable team. The team accepts/declines and records travel, arrival, and results.
6. **Resource allocation:** a coordinator records structured needs in Logistics; one or more warehouses commit contributions. Commitments, physical issue, and confirmed delivery remain separate stages.
7. **Outcome confirmation:** the team provides results/evidence; a coordinator confirms whether needs are met. Completing one mission does not automatically close a request with remaining needs.
8. **Monitoring:** each owning service exposes its operational status and reports the time at which its current dashboard data was read.

### 3.3 Patterns adapted for C48

The recommendations below reuse workflow ideas documented in [the disaster-response platform research](research/disaster-response-platform-patterns.md). They extend the project brief as proposals; they are not official requirements.

| Inspiration | C48 adaptation | Why it fits |
|---|---|---|
| Ushahidi's review queue, moderation, and saved searches | Coordinator views for awaiting verification, verified-but-unassigned, active missions, and partially fulfilled requests; exact location/contact data stays scoped | Makes the handoff and backlog visible without automating human decisions |
| Sahana ShaRe's partial commitments and separate logistics records | A fulfillment board shows requested, committed, issued, delivered, and outstanding quantities; more than one warehouse/organization can contribute | A request can remain open while some aid has been delivered, and one contribution does not hide the remaining need |
| Peer capstones described in the CNTT catalogue: dispatch/logistics visibility, high-concurrency ticketing, and comparative traffic-simulation metrics | Add measurable workflow timings and a filtered outstanding-aid view by authorized request/region/item; use k6 for a modest API load scenario | Gives the demo a clear operational outcome and evidence without copying unrelated brokers, trading, or simulation domains |

The workbook is a catalogue of project descriptions, not evidence that every listed technology or workload was implemented. C48's distinction is the traceable workflow from report verification through mission progress and partial aid fulfillment, supported by auditable quantities and response-time measurements.

The workflow references the OCHA cycle conceptually. Validate terminology and responsibilities for this project. [OCHA HPC](https://knowledge.base.unocha.org/wiki/spaces/hpc/overview)

## 4. Technology comparisons

### 4.1 Database and NestJS persistence

| Criterion | PostgreSQL + PostGIS | MySQL 8.4 + InnoDB | MongoDB |
|---|---|---|---|
| Relationships and constraints | Strong fit for users, missions, inventory transactions, and audit | Strong; InnoDB supports transactions and foreign keys | Relationships and cross-entity reporting need more application design |
| GPS/maps | PostGIS spatial operators and GiST indexes; TypeORM maps PostgreSQL geometry/geography to GeoJSON | MySQL has spatial features, but the selected ORM/query path needs more verification | 2dsphere indexes; a document model does not simplify stock-ledger constraints |
| Concurrent inventory updates | Transactions, check/unique constraints, and row locks prevent over-issue | InnoDB supports transactions and locking | Multi-document transactions exist; inventory consistency still needs deliberate rules |
| NestJS integration | PostgreSQL driver and `@nestjs/typeorm`; TypeORM supports spatial column types | TypeORM supported; GIS is not the reason to select it | Nest provides Mongoose integration; not the chosen fit for the relational ledger |
| Decision | **Selected** | Not selected | Not selected as the primary database |

TypeORM is selected because Nest documents a maintained `@nestjs/typeorm` integration and TypeORM's PostgreSQL driver documents geometry/geography columns with GeoJSON exchange. Use migrations, not runtime schema synchronization. Use TypeORM transactions and row locks for inventory; use parameterized SQL/QueryBuilder for spatial predicates such as `ST_DWithin` where repository methods do not express the required operation. Keep SRID, index/operator choice, and geography-versus-geometry explicit. [NestJS database integrations](https://docs.nestjs.com/techniques/database), [TypeORM PostgreSQL spatial columns](https://typeorm.io/docs/drivers/postgres/), [PostGIS spatial indexes](https://postgis.net/documentation/faq/spatial-indexes/)

Prisma is a credible TypeScript alternative with generated types, but PostGIS access uses unsupported/custom-type and raw-query paths. Drizzle is also viable if the team prefers SQL-first queries and verifies migration/spatial needs. Use one ORM across services. The selection is **TypeORM**, subject to an early compatibility spike covering geometry migration, spatial query, and transaction/row-lock behavior on the selected PostgreSQL/PostGIS image. [Prisma unsupported database features](https://www.prisma.io/docs/orm/prisma-schema/data-model/unsupported-database-features), [Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)

Store points as GeoJSON with longitude, latitude order and SRID 4326; validate ranges before persistence. Consider `geography(Point,4326)` for meter-based radius behavior and geometry for boundaries; validate units/indexes with representative queries. [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946), [PostGIS spatial indexes](https://postgis.net/documentation/faq/spatial-indexes/)

Inventory writes use short PostgreSQL transactions, deterministic row-lock order, and constraints such as `on_hand >= 0`, `reserved >= 0`, and `reserved <= on_hand`. Do not call another service or object storage while holding database locks. Test concurrency against PostgreSQL/PostGIS, not SQLite. [PostgreSQL explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)


### 4.2 Backend framework evaluation and selection

**Evaluation method:** qualitative comparison against C48's three-service, TypeScript, PostgreSQL/PostGIS, GIS, and solo-backend needs, using official documentation reviewed on 2026-09-30. This is not a performance benchmark. NestJS/TypeScript is the selected backend; no Python framework is part of the implementation stack.

| Framework | Strengths relevant to C48 | Integration work and tradeoffs | Assessment |
|---|---|---|---|
| **NestJS (TypeScript/Node.js)** | Modules/providers/guards, TypeScript, OpenAPI and validation integrations; one language family across backend and clients | ORM/migrations, PostGIS queries, domain authorization, and operations UI still need explicit implementation | **Selected** for the three service boundaries and TypeScript development |
| **Spring Boot (Java/Kotlin)** | Mature application/security/operations ecosystem | Separate JVM language/tooling from clients; strong alternative if the team already has more Spring experience | Technically capable; larger language/tooling switch for this project |
| **Django + DRF (Python)** | Integrated ORM, admin/auth and mature API conventions | Different backend language; cross-service API contracts and domain rules still need explicit work | Capable alternative, not used in this plan |
| **FastAPI (Python)** | Type-oriented validation, generated OpenAPI, async API support | Assemble ORM/migrations, admin, auth, permissions, and GIS components | Capable for focused APIs, but adds a language/tooling split |
| **Flask (Python)** | Small core and flexible component selection | More foundational database, schema, authentication, and administration decisions across services | Flexible but adds assembly work and a language/tooling split |

**Evidence:** Nest documents modules/providers, guards, validation, OpenAPI, and database integrations. Spring Boot, Django/DRF, FastAPI, and Flask remain capable alternatives with different integration tradeoffs. [NestJS database integrations](https://docs.nestjs.com/techniques/database), [NestJS validation](https://docs.nestjs.com/techniques/validation), [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [Spring Boot](https://docs.spring.io/spring-boot/index.html), [Django overview](https://docs.djangoproject.com/en/5.2/intro/overview/), [FastAPI features](https://fastapi.tiangolo.com/features/), [Flask design](https://flask.palletsprojects.com/en/stable/design/)

**Selection rationale — project-specific:** NestJS matches a TypeScript client/backend workflow and documents patterns for modules, guards, OpenAPI, and validation. TypeORM's PostgreSQL spatial types support the GIS baseline. This reduces language/tooling changes while keeping database, authorization, and local transactions explicit. It does not imply Nest is universally superior or faster.

**Selected implementation choices:** three NestJS REST services on the default Express adapter; TypeScript; TypeORM + PostgreSQL/PostGIS; Nest `ValidationPipe` with DTO validation; `@nestjs/swagger` for OpenAPI; Passport/JWT for authentication; AWS SDK for JavaScript v3 S3 client for MinIO. Pin compatible Node/Nest/dependency versions after the compatibility spike; avoid floating `latest` tags.

Use one repository/workspace for three Nest applications, each with its own bootstrap, environment, image, migration set, database credentials, and deployment. Keep domain models and persistence code inside their owning service. Share API DTOs only where a concrete contract requires it; do not share domain entities or database modules across services.


### 4.3 Web, mobile, and API

| Channel | Proposal | Scope |
|---|---|---|
| Web | React + TypeScript + Vite; React Router; TanStack Query for server state | Dashboard, map/queue, verification/triage, missions, inventory, reports, admin |
| Mobile | React Native + Expo + TypeScript | Citizen SOS/status tracking; volunteer missions/progress; foreground GPS and bounded photo/video evidence |
| API | REST/JSON /api/v1; per-service OpenAPI through `@nestjs/swagger` | Web/mobile contracts, mocks, and API checks |
| Maps | Separate map UI from business logic; PostGIS queries; select tile/geocoding provider after license, quota, and privacy review | Do not send incident descriptions or personally identifiable information (PII) to map providers |

Emergency screens should minimize steps, provide accessible controls, clearly show submission status, and allow a manual pin when GPS is denied or inaccurate. Do not enable background tracking by default. Expo permissions depend on platform and access type. [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), [Expo permissions](https://docs.expo.dev/guides/permissions/)

### 4.4 Service communication and asynchronous work

| Need | C48 baseline | Add a broker only when… |
|---|---|---|
| Login, request intake, verification, mission updates, stock/fulfillment commands | REST/JSON with bounded timeouts, stable error codes, idempotency on retryable commands | A user-facing operation must fan out to many independently deployed consumers and synchronous APIs no longer fit |
| Dashboards and notifications | Read each service's authoritative API; store an in-app notice with the business change in its owning service | Independent consumers need durable event replay or measured traffic makes the current approach insufficient |
| Optional AI analysis | Response-owned job row plus a worker that claims pending jobs; intake does not wait for analysis | Job volume, independent scaling, or operational requirements justify a separate queue |

Kafka is not required for k6 virtual users: k6 sends scripted HTTP/API requests and defines virtual-user counts and thresholds in the test configuration. [Grafana k6 HTTP requests](https://grafana.com/docs/k6/latest/using-k6/http-requests/), [k6 virtual users](https://grafana.com/docs/k6/latest/get-started/running-k6/)

Reconsider Kafka only if C48 gains several independent consumers, needs durable event replay/reprocessing, or measured asynchronous backlog/fan-out cannot be handled by a small database-backed worker. Kafka provides durable event-stream storage and processing, but adds broker operation, schemas, retries, deduplication, monitoring, and recovery work. Those capabilities are not needed merely because the design has multiple services or load tests. [Apache Kafka documentation](https://kafka.apache.org/documentation/)

### 4.5 Service decomposition

| Model | Benefits | Cost/risk | Assessment |
|---|---|---|---|
| One modular monolith | Simplest deployment and cross-domain transactions | Does not provide independently deployable ownership | Evaluated alternative; the user confirmed the three-service baseline and sufficient delivery time on 2026-10-01 |
| Three services: Identity, Response, Logistics | Clear account, emergency workflow, and supply ownership; manageable API boundaries | Requires documented REST contracts and cross-service failure handling | **Selected** |
| Five or more services | More independently deployable components | Extra databases, contracts, and operations without a demonstrated workload need | Deferred |

Each selected service has its own application boundary and database credentials; the demo may run all three on one host and PostgreSQL server. No service reads another service's tables. Use synchronous REST for the few cross-service checks; keep each database transaction within its owner.

## 5. Proposed architecture

### 5.1 Diagram

```mermaid
flowchart LR
  Clients[Web and mobile clients]
  Proxy[Nginx reverse proxy]
  Identity[Identity API]
  Response[Response API + optional job worker]
  Logistics[Logistics API]
  DB[(PostgreSQL + PostGIS<br/>separate database/user per service)]
  S3[(Private S3-compatible object storage)]
  Load[k6 HTTP virtual users]

  Clients --> Proxy
  Proxy --> Identity
  Proxy --> Response
  Proxy --> Logistics
  Identity --> DB
  Response --> DB
  Logistics --> DB
  Response --> S3
  Logistics --> S3
  Response <-->|REST contract| Identity
  Logistics <-->|REST contract when needed| Response
  Load --> Proxy
```

All three services can run as containers on one demo host. A shared PostgreSQL server is acceptable for the demo, while each service uses its own database and credentials. No service can query another service's tables. k6 generates HTTP requests to the API; it is not part of the runtime architecture.

### 5.2 Boundaries and data ownership

| Service | Owns | Example API surface |
|---|---|---|
| **Identity** | Accounts, credentials, organizations, memberships, scoped role grants, refresh sessions | Registration/login/session, user/role administration |
| **Response** | Campaigns, assistance requests and their incident categories, verification and priority history, teams, missions/progress, request evidence, request timeline | Intake, verification, duplicate review, triage, assignment, mission actions, scoped map/queue |
| **Logistics** | Item catalog, warehouses, stock balances/ledger, relief needs and commitments linked by opaque request ID, transfers, vehicles, relief points, distribution records | Receipts/issues/transfers, partial commitments and fulfillment, stock and outstanding-need views |

Boundary rules:

- Each service owns its schema, migrations, credentials, and local transaction. IDs crossing boundaries are opaque UUID references; no cross-service foreign keys or table queries.
- Response remains authoritative for request and mission status. Logistics remains authoritative for stock, commitments, issued/delivered quantities, and fulfillment status.
- The coordinator board composes scoped Response and Logistics API results. If one API is unavailable, show which panel is stale/unavailable; never imply that the other service completed its work.
- In-app request/mission notices live in Response; stock/task notices live in Logistics. Each service exposes its own scoped reports and timestamps; there is no standalone Notification or Reporting service.
- Cross-service REST calls happen outside database transactions. Commands that may be retried use an idempotency key. Do not imply cross-service atomicity.

### 5.3 Request-to-fulfillment board

This is the main workflow adaptation from Sahana ShaRe's partial commitments and Ushahidi's human-reviewed queue. [Research details and sources](research/disaster-response-platform-patterns.md)

1. Response receives a request and keeps it in an internal verification queue. A coordinator records VERIFIED, REJECTED with reason, or DUPLICATE with a canonical request and reason. A possible duplicate search may suggest nearby reports by time, category, and location, but a person makes the decision.
2. After verification, an authorized coordinator records structured assistance needs in Logistics. Logistics links each need to an opaque `request_id` and request work-cycle identifier; the request and need can be read together through the board without sharing tables.
3. A need records requested quantity and item/unit. One or more warehouse/organization contributions can be committed. Under a transaction that locks the need row, delivered + committed/reserved + issued-but-not-delivered cannot exceed requested quantity. A cancellation releases an unissued commitment; an issued quantity must be delivered, returned, or recorded as loss.
4. Track quantities separately: requested, committed/reserved, issued, delivered, and outstanding. For a need that is not CANCELLED, `outstanding = requested - delivered`, where `requested` is the current effective quantity after any authorized reduction (original and every change stay in history); partial delivery never makes the need complete. A CANCELLED need contributes 0 to outstanding/backlog; its undelivered remainder is reported separately as `cancelled_remaining = requested_at_cancellation - delivered`. A coordinator can explicitly reduce/cancel a need with a reason, preserving its history.
5. The request status, mission status, and fulfillment status remain separate. A mission completion does not close a request; a delivery does not mark a rescue mission complete. The coordinator confirms overall resolution after reviewing current mission and fulfillment evidence.

**Demo scenario:** a verified request needs 20 relief kits and rescue assistance. One warehouse commits and delivers 12 kits; the board shows PARTIALLY_FULFILLED with 8 outstanding, and the request remains open. A second contribution delivers the remaining 8; the board records both actors/times, and the coordinator explicitly confirms resolution. The demo also shows a suspected duplicate that a coordinator reviews and links manually.

### 5.4 REST and background-job behavior

- REST handles immediate user actions and the small number of cross-service lookups. Use bounded timeouts, Vietnamese user-facing errors, stable machine error codes, and idempotency for retries.
- Report aggregation is performed by each owning service or by the client composing two scoped API results. Include `generated_at` per response; do not call it globally real-time.
- If optional AI analysis is enabled, write a durable job to the Response database in the same transaction as its request intent. A worker claims pending jobs with a lease, calls inference outside the transaction, and stores one versioned result. A failed worker leaves retryable work in the database; no message broker is required.
- Do not add Kafka, Redis, a service mesh, schema registry, workflow engine, or a separate notification/reporting service to the baseline. Revisit only against the criteria in Section 4.4.

## 6. Data model and integrity

### 6.1 Logical ERD by service

```mermaid
erDiagram
  IDENTITY_USER ||--o{ IDENTITY_ROLE_GRANT : receives
  IDENTITY_ORGANIZATION ||--o{ IDENTITY_MEMBERSHIP : has
  IDENTITY_USER ||--o{ IDENTITY_MEMBERSHIP : joins
  RESPONSE_CAMPAIGN |o--o{ RESPONSE_REQUEST : groups
  RESPONSE_REQUEST ||--o{ RESPONSE_REQUEST_EVENT : records
  LOGISTICS_FULFILLMENT_CYCLE ||--o{ LOGISTICS_RELIEF_NEED : guards
  RESPONSE_REQUEST ||--o{ RESPONSE_MISSION : dispatches
  RESPONSE_TEAM ||--o{ RESPONSE_TEAM_MEMBER : has
  RESPONSE_TEAM ||--o{ RESPONSE_MISSION : receives
  RESPONSE_REQUEST ||--o{ RESPONSE_EVIDENCE : includes
  LOGISTICS_WAREHOUSE ||--o{ LOGISTICS_STOCK_BALANCE : stores
  LOGISTICS_ITEM ||--o{ LOGISTICS_STOCK_BALANCE : counts
  LOGISTICS_STOCK_BALANCE ||--o{ LOGISTICS_STOCK_MOVEMENT : changes
  LOGISTICS_RELIEF_NEED ||--o{ LOGISTICS_COMMITMENT : fulfilled_by
  LOGISTICS_WAREHOUSE ||--o{ LOGISTICS_COMMITMENT : supplies
  LOGISTICS_TRANSFER ||--o{ LOGISTICS_TRANSFER_LINE : moves
  LOGISTICS_DISTRIBUTION ||--o{ LOGISTICS_DISTRIBUTION_LINE : issues
  RESPONSE_REQUEST ||--o{ RESPONSE_RESOLUTION_INTENT : guards
  LOGISTICS_COMMITMENT ||--o{ LOGISTICS_ISSUED_LINE_SETTLEMENT : settles
  LOGISTICS_TRANSFER_LINE ||--o{ LOGISTICS_TRANSFER_TRANSIT_LINE : tracks

  IDENTITY_USER {
    uuid id PK
    string username UK
    string status
  }
  IDENTITY_ROLE_GRANT {
    uuid id PK
    uuid user_id
    string role
    string scope_type
    uuid scope_id
  }
  RESPONSE_REQUEST {
    uuid id PK
    uuid organization_id
    string region_code
    int work_cycle
    int version
    uuid campaign_id
    uuid reporter_user_id
    string tracking_secret_hash
    string status
    string priority
    string priority_basis
    boolean reporter_declared_danger
    string verification_basis
    geography location
    datetime location_captured_at
    float location_accuracy_m
    string location_source
    int people_affected
    string contact_phone
    datetime created_at
  }
  RESPONSE_MISSION {
    uuid id PK
    uuid request_id
    int work_cycle
    string status
    uuid coordinator_user_id
    uuid team_id
    datetime created_at
  }
  LOGISTICS_STOCK_BALANCE {
    uuid id PK
    uuid warehouse_id
    uuid item_id
    decimal on_hand
    decimal reserved
  }
  LOGISTICS_STOCK_MOVEMENT {
    uuid id PK
    uuid balance_id
    string movement_type
    decimal quantity
    uuid actor_user_id
    datetime occurred_at
  }
  LOGISTICS_FULFILLMENT_CYCLE {
    uuid id PK
    uuid request_id
    int work_cycle
    string state
    int version
    uuid seal_id
    uuid intent_id
  }
  LOGISTICS_RELIEF_NEED {
    uuid id PK
    uuid request_id
    uuid campaign_id
    uuid organization_id
    string region_code
    int work_cycle
    uuid item_id
    decimal requested_quantity
    string unit
    string status
  }
  LOGISTICS_COMMITMENT {
    uuid id PK
    uuid relief_need_id
    uuid warehouse_id
    decimal quantity
    decimal released_quantity
    decimal issued_quantity
    decimal delivered_quantity
    decimal returned_quantity
    decimal lost_quantity
    string status
    datetime created_at
  }
  RESPONSE_RESOLUTION_INTENT {
    uuid id PK
    uuid request_id
    int work_cycle
    string kind
    string state
    uuid actor_user_id
    int expected_request_version
    string previous_state
  }
  LOGISTICS_ISSUED_LINE_SETTLEMENT {
    uuid id PK
    uuid commitment_id
    string settlement_type
    decimal quantity
    uuid actor_user_id
    datetime occurred_at
  }
  LOGISTICS_TRANSFER_TRANSIT_LINE {
    uuid id PK
    uuid transfer_line_id
    decimal dispatched
    decimal received
    decimal returned
    decimal lost
  }
```

Each mission has exactly one team; additional teams receive separate missions under the same request. A request may have no campaign until a scoped coordinator attaches it to an ACTIVE campaign. The Logistics `request_id` is an opaque cross-service reference, not an ERD relationship or foreign key. Other diagram relationships are local to a service. Implementation still requires complete timestamps, audit fields, indexes, unique constraints, migrations, and retention policies.

### 6.2 Core entities

| Database | Minimum tables/entities |
|---|---|
| Identity | User, Organization, controlled Region catalog, Membership, RoleGrant, account status, RefreshSession with rotation/revocation, AuditRecord |
| Response | Campaign, ResolutionIntent, RegionBoundary referencing the controlled region code, AssistanceRequest with organization_id and nullable region/campaign, RequestEvent, ContactAttempt, AuthorityReferral, RescueTeam, TeamMember with opaque user ID, VolunteerProfile, Mission with one team_id, EvidenceMetadata, scoped in-app Notification; optional AnalysisSnapshot, AnalysisJob, TriageRecommendation, RecommendationReview (Section 12) |
| Logistics | Warehouse, Item, StockBalance, StockMovement, ReliefNeed/request reference, Commitment (one need/item per contribution), FulfillmentCycle, Transfer/lines, Distribution/lines, IssuedLineSettlement, TransferTransitLine, Vehicle, ReliefPoint, scoped in-app Notification |

Define the Identity user entity and migration before other services rely on its contract; external services store opaque user UUIDs rather than duplicating credentials.

### 6.3 GPS and evidence files

- Coordinates use WGS84/SRID 4326; GeoJSON order is longitude, latitude. Validate longitude within -180..180, latitude within -90..90, and nonnegative accuracy. [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946)
- Store capture time, accuracy in meters, source (GPS, manual pin, geocoded), and server receive time separately. Device-reported accuracy is not a guarantee of field accuracy.
- Store a location snapshot with the SOS. Add location history only for an explicit requirement; continuous background tracking is outside the MVP.
- Scope map queries by authorization, region/time/status/bounding box. Do not expose all PII through map responses.
- Store files in object storage. The database holds object key, owner type/ID, validated MIME, size, checksum, uploader, time, and visibility. Keep buckets private; use short-lived signed URLs if direct access is used.
- Validate actual MIME, extension, and size; do not trust client-provided names/MIME. Uploads require authorization on the owning business object.
- Demo data must be synthetic; do not use real victims' images or personal information.
- Use the AWS SDK for JavaScript v3 S3 client from the owning NestJS service. Configure separate service credentials and private buckets for Response and Logistics. Unit tests may mock S3; provider integration and restore checks must use the selected MinIO AIStor Free lab instance.

#### Selected object storage: MinIO AIStor Free

**Final choice for this capstone: MinIO AIStor Free, single-node lab deployment, using synthetic data.** MinIO Community is not selected: its repository is archived and marked unmaintained. AIStor Free is a separate proprietary product; its agreement allows standalone educational/research use, and its operations documentation sets edition-specific limits. This is a lab choice, not a production recommendation. No MinIO artifact/license, application integration, or restore test has been installed or verified as part of this plan. [Community repository](https://github.com/minio/minio), [AIStor Free agreement](https://www.min.io/legal/aistor-free-agreement), [AIStor license operations](https://docs.min.io/aistor/operations/licenses/)

| Decision | C48 baseline |
|---|---|
| Product/edition | MinIO AIStor Free; do not substitute a Community image or third-party rebuild |
| Topology/data | One node for the lab; synthetic demo data only; no HA or production availability claim |
| License/package | Operators must obtain and use the product under the current agreement and active license. Do not modify or redistribute the AIStor binary/image or license in the repository/submission unless the applicable terms expressly allow it. Record the exact release and license validity before the demo. |
| Free-tier limits | Do not rely on distributed deployment, replication, lifecycle transitions, version-specific deletion, encryption at rest, or an SLA/SLO. The current docs state AIStor Free support begins with `minio.RELEASE.2025-12-20T04-58-37Z`; recheck the requirement against the release chosen for setup. |
| Application integration | Private S3 API; AWS SDK for JavaScript v3; separate least-privilege Response and Logistics credentials/buckets; no blanket access for other services |

Use backend-mediated uploads through the owning NestJS service for the first implementation. Authorize the business object, persist attachment state as PENDING in a short database transaction, validate and stream bounded content to a generated immutable key outside the transaction, then record READY in a second short transaction. On failure, preserve the SOS and expose a retryable FAILED/PENDING attachment; reconcile crashes between object upload and metadata commit. Enforce extension/type/size rules using detected content, not client MIME or filename. Do not hold database locks during S3 calls or claim a cross-database/object-store atomic transaction. [AWS SDK for JavaScript S3 client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/), [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Keep buckets private and store only object metadata (owner, generated key, detected MIME, size, checksum, uploader, timestamps, visibility/state) in PostgreSQL. Do not persist object bytes or signed URLs in PostgreSQL, logs, analytics, or reports. Authorize each download against the current business object before creating a short-lived signed URL; use a hostname reachable from the backend, browser, and physical mobile device. A signed URL remains a bearer capability until it expires, so document that revocation window or proxy downloads when immediate revocation is required. Direct client uploads are outside the initial scope: presigned upload URLs can be reused and can replace an existing key until expiry. [S3 presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

Back up owning-service database metadata and object bytes together, with a manifest of keys, sizes, and checksums. Keep a backup outside the demo host; test restoration in an isolated environment and verify scoped download/denied access after restore. A PostgreSQL dump or a volume beside the original objects alone is not a verified backup. No backup/restore test has been executed yet.

Section 23.5 adopts the demo media allowlist, size/count/aggregate limits and 60-second download TTL.

### 6.4 Inventory and audit

- StockMovement is append-only: RECEIPT, RESERVE, RELEASE, ISSUE, TRANSFER_OUT, TRANSFER_IN, RETURN, ADJUSTMENT.
- StockBalance is the current balance/projection, updated in the same transaction as its movement; available = on_hand - reserved.
- Constraints: on_hand ≥ 0, reserved ≥ 0, reserved ≤ on_hand; quantities are positive and units match the item. Adjustments require actor, reason, and permission.
- Enforce a unique warehouse/item pair for StockBalance. Lock multiple item balances in a stable ID order to prevent duplicate updates and reduce deadlocks.
- Destination receipt is a separate transfer step. Creating a transfer alone does not increase destination stock.
- Distribution records item, quantity, warehouse/relief point, campaign, time, and actor. Do not require beneficiary names/identity documents without an approved need.
- Use unique/idempotency keys for receipt/issue/distribution retries and row locks to prevent concurrent over-issue.

## 7. System requirements

For FR priorities, **M** means required for the core demo, **S** means should have if time permits, and **O** means optional extension. These are proposed priorities, not classifications in the original brief.

### 7.1 User Requirements (UR)

| ID | Actor | Need |
|---|---|---|
| UR-01 | Citizen | Submit an SOS/request with location, affected-person count, and incident information; receive confirmation of server receipt. |
| UR-02 | Citizen | Track progress, add information, and understand rejection, duplicate, or closure reasons. |
| UR-03 | Coordinator | Verify, link duplicates, prioritize, view maps, and assign suitable teams. |
| UR-04 | Volunteer/team | Access assigned missions only; accept/decline, update progress, and submit outcome evidence. |
| UR-05 | Operations manager | Manage campaigns, warehouses, vehicles, relief points, commitments, transfers, issues, and distributions with traceability. |
| UR-06 | Admin/manager | Manage accounts/scoped permissions and view operational dashboards/reports. |
| UR-07 | Operations team | See work queues, partially fulfilled needs, service health, dashboard timestamps, and recovery guidance. |
| UR-08 | Signed-in or guest donor | Find donation drives, declare supplies handed over, inspect verified receipt and distribution progress, and dispute differences. |
| UR-09 | Warehouse manager / intake staff / independent reviewer | Open drives, count receipts independently, approve intake and reconcile stock without overwriting donor statements. |
| UR-10 | Distribution staff / receiving party | Authorize dispatch, record custody changes and beneficiary handouts, and reconcile shortages, returns and losses. |

### 7.2 Functional Requirements (FR)

| ID | Priority | Proposed functional requirement | Verification criterion |
|---|---:|---|---|
| FR-IAM-01 | M | Citizen registration, login, refresh/logout, account disabling, and credential changes | Invalid/expired tokens or disabled accounts receive 401; logout invalidates the refresh session |
| FR-IAM-02 | M | Organization/region/campaign-scoped roles; action and object checks | Citizens cannot access another citizen's request; volunteers see their team's missions only |
| FR-IAM-03 | M | Admin account, organization, and role management with least privilege | Permission changes record actor/time and before/after values |
| FR-REQ-01 | M | Create requests with category, short description, headcount, reporter contact phone (required; verification needs a way to reach the reporter), location/manual pin, time/source, optional reporter-declared 'immediate danger' flag (unverified; see FR-REQ-10) | Validate input incl. phone format; return an identifier and server receive time; contact phone is visible only to the reporter, scoped coordinators and assigned team leaders, and excluded from maps, reports and AI input |
| FR-REQ-02 | M | Anyone may submit an SOS without an account (guest SOS); an optional signed-in citizen's request is linked to the account. Guests track and supplement through a high-entropy tracking secret generated by the client before submission (Section 22.2); the server returns only a non-credential request ID and tracking code. A guest can later claim the request after signing in | Unauthenticated creation succeeds with rate limiting; the server stores only a purpose-bound hash of the secret and never returns or logs it; a lost creation response is recoverable by retrying with the same key/body/secret; without the secret (or ownership) tracking/supplement is denied; registration still grants CITIZEN only; SOS creation and secret-based tracking never call Identity |
| FR-REQ-03 | M | Idempotent SOS creation retries | Same key/payload/secret creates no second row and returns the original request ID and tracking code; same key with a different payload or secret is rejected (409) |
| FR-REQ-04 | M | Verify, reject, and duplicate-link; rejection/duplicate decisions require reasons | Preserve duplicate requests and link them to a canonical request |
| FR-REQ-05 | M | Manual P1–P4 priority with actor/time/reason and override history | Priority is separate from status; AI cannot change it automatically |
| FR-REQ-06 | M | Scoped list/map filtering by bbox/region, status, priority, and time | Apply authorization filters before pagination |
| FR-REQ-07 | M | Citizens view timelines and supplement their own requests in permitted states | Owner-only access; supplements record actor/time |
| FR-MSN-01 | M | Manage teams, skills, availability, and members through opaque user IDs | Reject inactive/unavailable teams or missing mandatory skills |
| FR-MSN-02 | M | Create missions, offer/assign, accept/decline, transition, and record results | Only valid transitions; record actor/time/reason |
| FR-MSN-03 | M | One request may have multiple missions; one mission belongs to one request and one team in the MVP | One completed mission does not close a request with remaining needs |
| FR-MSN-04 | M | Request/mission evidence uploads and coordinator outcome confirmation | Metadata and download access follow object scope |
| FR-CAM-01 | M | Response manages campaigns, incident categories on requests, operating regions, time, and status | Scoped creation/editing; Logistics stores campaign references |
| FR-LOG-01 | M | Manage warehouses, items, vehicles, relief points, and campaign references where needed | Active/inactive entities; preserve existing history |
| FR-LOG-02 | M | Receipts, transfers, receipt confirmation, reserve/release, issue, return, adjustment | Ledger records actor/time/quantity/reason; balances never negative |
| FR-LOG-03 | M | Link Logistics needs and commitments to a request by opaque ID; record commit/release/issue/delivery locally | Multiple contributions are supported; no cross-service transaction or direct table access |
| FR-LOG-04 | M | Distribution by campaign, point, item, quantity, and actor | Retries never duplicate a distribution |
| FR-LOG-05 | M | Show requested, committed/reserved, issued, delivered, and outstanding quantities; allow partial fulfillment | Delivered + active committed/reserved + issued-but-not-delivered never exceeds requested; one partial contribution does not close the need |
| FR-DON-01 | M | Warehouse-scoped managers publish donation drives with needed items, units, intake periods and acceptance criteria | Only authorized managers open/pause/close; donation drives are distinct from Response campaigns |
| FR-DON-02 | M | Signed-in and guest citizens pledge and separately declare actual handed-over quantities | Guest capability is donation-scoped; retries do not duplicate records; declarations never credit stock |
| FR-DON-03 | M | Preserve donor declarations, independent physical counts, condition and accepted/rejected/held quantities | Immutable submitted revisions and explicit missing confirmation; compare matching canonical units |
| FR-DON-04 | M | Independent review and exactly-once posting of accepted receipts | Reviewer differs from intake actor; pending/held goods cannot be allocated; posting and ledger/audit are atomic |
| FR-DON-05 | M | Private donor receipt, discrepancy notification and dispute history | Receipt number alone grants no access; silence never becomes donor agreement; no deletion of disagreements |
| FR-DON-06 | M | Trace receipt-source allocations through reserve, issue, transfer, return and settlement | Per-source balances reconcile with aggregate stock; mixed goods are described as accounting allocations |
| FR-REC-01 | M | Reconcile declarations, custody, stock and relief handoffs | Unit-normalized equations, separate cumulative/current totals, explicit unmatched and overdue custody |
| FR-REC-02 | M | Versioned stocktakes and independently approved corrective movements | No overwrite of posted counts; stale stocktake conflicts; adjustment cannot violate reserved/nonnegative constraints |
| FR-LOG-06 | M | Independently approve distribution plans and record dispatch/receipt evidence | No self-approval or duplicate ISSUE; relief-point receipt is distinct from beneficiary handout |
| FR-LOG-07 | M | Record partial beneficiary handouts and point-held stock with returns/loss settlement | A unit is counted at its actual handoff stage; delivery never decrements warehouse stock again |
| FR-AI-07 | O | Human-reviewed donation-document extraction only after a measured benefit gate | No automatic approval, stock mutation, allocation or accusation; deterministic reconciliation works with AI disabled |
| FR-REQ-08 | S | Suggest possible duplicate reports using time/category/location filters | Suggestions are visibly non-authoritative; only a coordinator may link/reject |
| FR-REQ-09 | M | Human resolution with a durable current-cycle Logistics seal and recoverable intent | Concurrent fulfillment changes cannot invalidate a committed resolution; timeout recovery preserves one outcome |
| FR-REQ-10 | M | Minimum verification evidence and unreachable-reporter handling: contact-attempt log, verification basis, overdue escalation, authority-referral record, reporter-declared danger flag kept separate from status and priority | NO_ANSWER alone never verifies or rejects; rejection for unreachability needs the demo minimum attempts and a reason; TWO_COORDINATOR_JUDGMENT needs a distinct second coordinator; overdue and declared-danger requests are visible to other scoped coordinators; no automatic ranking, triage or dispatch |
| FR-NOT-01 | M | In-app notices in the service that owns the changed request, mission, or stock task; push/email are extensions | Notice write is local to the business transaction; recipient scope is enforced |
| FR-NOT-02 | S | Push alert for new mission offers and request status changes to registered devices (Expo push), sent from the owning service after commit via a small outbox row; guests rely on the secret-based tracking page | Push failure never rolls back or blocks the business change; payload carries only a Vietnamese generic text and notice ID, no exact location or contact data; retry is idempotent per notice and device |
| FR-RPT-01 | M | Scoped dashboards for request states/timings and stock/fulfillment gaps | Totals match a fixed dataset; each API response includes generated_at |
| FR-RPT-02 | S | Scoped CSV export with role-based PII masking | No unauthorized fields; audit sensitive exports |
| FR-AUD-01 | M | State, decision, adjustment, distribution, and role-change history | No passwords/tokens in audit; restricted readers |
| FR-EVT-01 | O | Broker-based event streaming and replay are deferred exploration | Excluded from core acceptance unless Section 4.4 revisit criteria are demonstrated |
| FR-FILE-01 | M | Private uploads, size/type validation, metadata, controlled downloads | Reject forged MIME/oversize files; expired links cannot download |
| FR-OFF-01 | S | Offline SOS drafts and mission-progress actions retry with the same idempotency key | Distinguish QUEUED_ON_DEVICE from SUBMITTED; a mission action that could not be sent is never shown as done |
| FR-AI-01 | O | AI/rule suggestions with factors/version and coordinator acceptance/override; optional detailed requirements FR-AI-02..06 in Section 12.8 | No automatic dispatch/priority overwrite; core works with AI disabled |

### 7.3 Non-functional Requirements (NFR)

The brief specifies no numeric thresholds. Section 23.6 adopts the numeric synthetic-demo targets under the user's delegated design authority; these do not establish an operational SLA.

| ID | Quality | Proposed requirement/criterion |
|---|---|---|
| NFR-SEC-01 | Security | Require authentication by default. The only public unauthenticated routes are registration/login/refresh; guest SOS creation, evidence upload and secret-based tracking; and the Section 25 donation routes: sanitized read-only donation-drive listing/detail and capability-based guest donation pledge/delivery creation, tracking, dispute and evidence upload. Guest routes are throttled per IP and per contact phone under the never-drop rule of Section 14, validate input strictly, and never expose other reports. A guest report is untrusted until a coordinator verifies it and cannot reach triage or dispatch before then. Services enforce scope and never trust client-supplied roles. |
| NFR-SEC-02 | Security | Filter list querysets by authorization; enforce detail/action object permissions, input/file validation, and suitable rate limits. route-level guards do not automatically scope returned rows; test object and list authorization separately. [NestJS guards](https://docs.nestjs.com/guards), [NestJS validation](https://docs.nestjs.com/techniques/validation) |
| NFR-SEC-03 | Security | Do not log tokens, passwords, signed URLs, or unnecessary exact locations; HTTPS outside local development. |
| NFR-SEC-04 | Security | Web hardening per Section 14: strict CSP, nosniff, no-referrer, no-store on sensitive responses, escaped rendering of all user-entered text, secrets only in authorization headers, dependency audit recorded before the demo. Tested by TC-BE-27. |
| NFR-PRV-01 | Privacy | Exact locations are accessible only to the subject, scoped coordinators, and assigned teams; reports aggregate by default. Retention needs confirmation. |
| NFR-REL-01 | Reliability | Nonnegative inventory, valid states, idempotent API retries, visible cross-service errors, and backup restoration checks.  Bounded database lock/statement timeouts and connection pools per service (Section 22.4); a timeout surfaces as a retryable Vietnamese error, never a hang or partial write. |
| NFR-PERF-01 | Performance | Adopted synthetic-demo target: 10,000 stored assistance requests; 20 concurrent k6 virtual users; common read API p95 ≤ 2 seconds and SOS creation p95 ≤ 3 seconds excluding upload; unexpected HTTP failure rate < 1% during a 10-minute measured steady interval after a 2-minute warm-up. Include Identity introspection. Record hardware and workload mix as Section 23.6 specifies. |
| NFR-PERF-02 | Performance | Spatial indexes/bbox/result limits for maps; each dashboard panel shows its source timestamp instead of an unqualified real-time claim. |
| NFR-UX-01 | Usability | Few SOS steps, usable controls, clear submission status, manual pin, understandable GPS errors. |
| NFR-OFF-01 | Weak connectivity | If an offline queue is implemented, retries are idempotent; no continuous background location synchronization. |
| NFR-OBS-01 | Operations | Health/readiness, correlation IDs, API latency/errors, database/storage health, and optional AI-job age/failure metrics. |
| NFR-OPS-01 | Recovery | Document DB/object metadata backup and perform a demo restore; define RPO/RTO when real requirements exist. |
| NFR-COMP-01 | Compatibility | Versioned API/OpenAPI, controlled migrations, UTC backend, configurable UI timezone. |
| NFR-TEST-01 | Testing | State, object-permission, inventory-race, retry/idempotency, partial-fulfillment, API-outage, and end-to-end tests; coverage threshold remains open. |
| NFR-L10N-01 | Language — confirmed | All Web/Mobile user-facing content and backend human-readable messages are Vietnamese, including errors, notifications, and displayed AI explanations. Stable machine codes/fields remain English. Technical documents remain English. |

## 8. Business rules and state machines

### 8.1 Assistance Request

```mermaid
stateDiagram-v2
  [*] --> SUBMITTED
  SUBMITTED --> VERIFYING
  VERIFYING --> VERIFIED
  VERIFYING --> REJECTED
  VERIFYING --> DUPLICATE
  VERIFIED --> TRIAGED
  TRIAGED --> DISPATCHED
  DISPATCHED --> TRIAGED: all offers ended or mission failed
  DISPATCHED --> IN_PROGRESS
  IN_PROGRESS --> TRIAGED: no active work, awaiting reassignment or confirmation
  IN_PROGRESS --> DISPATCHED: only unaccepted offers remain
  DISPATCHED --> CANCELLED
  IN_PROGRESS --> RESOLVING: human confirmation and mission guards
  TRIAGED --> RESOLVING: human confirmation and mission guards
  RESOLVING --> RESOLVED: Logistics cycle sealed
  RESOLVING --> TRIAGED: audited abort after seal release
  RESOLVED --> CLOSED
  CLOSED --> TRIAGED: reopen with reason
  SUBMITTED --> CANCELLED
  VERIFYING --> CANCELLED
  TRIAGED --> CANCELLED
  VERIFIED --> CANCELLED
  IN_PROGRESS --> CANCELLED
```

- Priority is separate from status and is a human decision recorded after verification. The criteria below are **C48 simulation rules proposed by the team, not rescue-authority policy** (R-07); they need domain review before any real use and imply no guaranteed SLA.

| Level | Draft criterion | Illustrative demo case |
|---|---|---|
| P1 | Verified immediate or ongoing threat to life | Household trapped by rising water with a child or injured person; medical emergency with no access |
| P2 | Serious risk within hours without help | Stranded without drinking water for over a day with elderly people; hazard approaching a known location |
| P3 | Help needed, no immediate risk to life | Damaged shelter or supply shortage in a stable situation |
| P4 | Informational, follow-up or non-urgent | Status question, update to an earlier report, offer of information |

  The coordinator records the factors behind the choice: threat to life, vulnerable people (children, elderly, disabled, pregnant, injured), headcount, time-criticality, hazard trend, isolation/access. If information is still incomplete after verification, choose by the worst credible case, set `priority_basis = INCOMPLETE_INFO` and review it when new information arrives. Any scoped coordinator with the triage grant may change priority with a reason; every change keeps actor/time/before/after; lowering P1/P2 requires a reason and shows as a distinct audit event. These labels never rank the queue or dispatch automatically.
- Keep three things apart: the **reporter-declared danger flag** (an unverified checkbox "immediate danger to life" captured at intake), the **verification status**, and the **coordinator priority**. The declared flag is shown to scoped coordinators as a visible badge and filter so unverified urgent reports are noticed early; it never changes status, order or priority automatically, and the default queue order stays by server receive time.
- Verification is required before triage/dispatch under this baseline. **Minimum verification:** record at least one contact attempt or a stated reason none was possible, and choose exactly one outcome with a recorded `verification_basis`: `CONTACT_CONFIRMED` (reached the reporter or a named contact), `CORROBORATED` (an independent report or linked duplicate describes the same incident), `EVIDENCE_REVIEWED` (attached photo/video/location is consistent with the report), or `TWO_COORDINATOR_JUDGMENT` (verified without contact or corroboration; requires a reason and a second, distinct scoped coordinator's concurring record).
- **Unreachable reporter:** each attempt is logged as a `ContactAttempt` (time, actor, outcome `REACHED`, `NO_ANSWER`, `WRONG_NUMBER` or `OTHER`, note). `NO_ANSWER` alone never verifies and never rejects: the request stays VERIFYING and visible. REJECTED for unreachability requires a reason and, as a demo default, at least three logged attempts over at least 30 minutes unless the report is clearly invalid; a rejected report can be superseded by a new report. A VERIFYING request that carries the declared danger flag, or is older than a configurable demo threshold (default 15 minutes), shows an overdue badge and an in-app notice to other scoped coordinators and the organization manager; this is visibility, not automatic dispatch. A coordinator may record an `AuthorityReferral` event (time, actor, referred body, free-text note) when handing the case to a competent authority outside the system; it is audit evidence and does not change state. The demo cannot call emergency services, and these thresholds are team defaults pending domain review.
- REJECTED requires a reason; DUPLICATE requires a canonical request ID and reason. Preserve both records.
- A partially fulfilled Logistics need does not change mission state; it never demotes progress from another active mission. Offering new work gives DISPATCHED only when no accepted work remains.
- DISPATCHED means a mission offer has been sent; IN_PROGRESS starts when the first team accepts.
- Recompute dispatch progress in the same Response transaction as a mission transition: any ACCEPTED/EN_ROUTE/ON_SCENE mission preserves IN_PROGRESS; otherwise any OFFERED mission gives DISPATCHED; otherwise the request returns to TRIAGED unless a coordinator has confirmed RESOLVED/CLOSED/CANCELLED. Completed missions remain evidence for human resolution, never an automatic closure. Section 22 specifies cancellation and reopen guards.
- A coordinator confirms RESOLVED when current-cycle needs are met; CLOSED is administrative completion. If missions were assigned, require completed evidence and no active mission; if no rescue mission was needed, record that human decision. Mission completion never closes a request automatically.
- Only scoped coordinators may reopen/cancel, with reason/audit and explicit handling of active missions.
- Cancellation is available only from SUBMITTED, VERIFYING, VERIFIED, TRIAGED, DISPATCHED and IN_PROGRESS. It is rejected from RESOLVING and RESOLVED because the Logistics cycle is then being sealed or is already sealed and cannot be frozen. A RESOLVED request moves to CLOSED, or is reopened with a reason; an abandoned finalization uses the audited abort path in Section 23.2.
- Canonical requests with inbound duplicate links cannot become DUPLICATE, REJECTED or CANCELLED; lock and recheck links as defined in UC-02 and Section 22.2.

### 8.2 Mission

```mermaid
stateDiagram-v2
  [*] --> OFFERED
  OFFERED --> ACCEPTED
  OFFERED --> DECLINED
  ACCEPTED --> EN_ROUTE
  EN_ROUTE --> ON_SCENE
  ON_SCENE --> COMPLETED
  ACCEPTED --> FAILED
  EN_ROUTE --> FAILED
  ON_SCENE --> FAILED
  OFFERED --> CANCELLED
  ACCEPTED --> CANCELLED
  EN_ROUTE --> CANCELLED
  ON_SCENE --> CANCELLED
```

- DECLINED, FAILED, CANCELLED, and COMPLETED terminate a mission; reassignment creates a new mission/assignment.
- Mission state is independent of stock commitment and delivery state. A team can accept/progress a mission while a separate Logistics contribution is being fulfilled; the coordinator sees both on the request board.
- Team members view assigned missions; only the active leader accepts/declines, advances and submits results/evidence. Scoped coordinators oversee missions and may cancel/fail with reason.
- Store transition actor/time, reason, note, and evidence references. Location updates are optional, without background tracking.
- Multiple missions can serve one request; a coordinator confirms the overall outcome before resolution.
- An OFFERED mission past the overdue threshold (Section 22.3) is flagged for human follow-up; the system never reassigns automatically.

### 8.3 Inventory and transfers

For each Logistics need, show requested, committed/reserved, issued, delivered, and outstanding quantities. Count a delivery only after receipt is confirmed at the designated relief point or recipient. The board labels a need OPEN before any delivery, PARTIALLY_FULFILLED when some but not all requested quantity is delivered, FULFILLED after the requested quantity is delivered and coordinator-reviewed, or CANCELLED after an authorized reasoned cancellation. These are fulfillment labels, separate from request and mission states.

```text
Commitment summary: PROPOSED -> COMMITTED -> ISSUED -> DELIVERED or SETTLED
PROPOSED/COMMITTED -> CANCELLED only when no quantity was issued.
Partial issue/delivery and mixed return/loss are quantity-derived summaries
as defined in Section 23.4; they are not arbitrary status PATCHes.

Transfer: DRAFT -> RESERVED -> IN_TRANSIT -> RECEIVED
             |         |          |-> RECONCILED (received + returned + lost)
             +---------+-> CANCELLED (before dispatch only)
```

- Commands check state and permission; clients cannot arbitrarily PATCH status.
- on_hand represents stock held; reserved represents stock allocated; available = on_hand - reserved. A committed stock contribution reserves locally in Logistics; it does not change Response or mission status.
- ISSUE reduces on_hand and reserved exactly once. Cancelling an unissued commitment releases reserved quantity without increasing on_hand. Issued goods require delivery, verified return, or audited loss settlement.
- Dispatch decreases source on_hand and reserved once and creates in-transit quantities. Receipt credits only physically received quantities at the destination. After dispatch, cancellation is prohibited; verified return credits the source, and authorized loss reconciliation removes transit quantity with reason/audit. Each line satisfies dispatched = received + returned + lost + remaining_in_transit. Both warehouses belong to Logistics; short local transactions lock affected balances in stable order.
- Adjustments require reason, actor, and audit; never edit/delete old ledger entries to force a balance to match.
- Two stock-out paths exist and must not be confused. (a) **Request-linked aid:** commitment → ISSUE → delivery/return/loss settlement against a ReliefNeed. (b) **Campaign/relief-point distribution:** a Distribution not tied to a request need reserves and issues atomically in one local transaction. Each unit leaves stock through exactly one ISSUE movement; a Distribution line for request-linked aid references the issued commitment and never creates a second ISSUE. TC-16 exercises path (b); TC-BE-05/06 exercise path (a).

### 8.4 General rules

- Server UTC is the audit timestamp; keep client capture time separately.
- Commands use idempotency; expected state/version checks prevent stale updates.
- Do not hard-delete requests, missions, or stock movements with activity; use state/archive according to policy.
- Priority/AI overrides, rejection, mission cancellation, stock adjustments, and role changes require actor/time/reason.
- Response owns campaigns. Lifecycle: DRAFT → ACTIVE; ACTIVE → PAUSED; PAUSED → ACTIVE; DRAFT/ACTIVE/PAUSED → CLOSED. Scoped coordinators/managers execute commands with version checks and reasons for pause/close. Only ACTIVE campaigns accept new attachments. SOS creation never requires an existing campaign. Campaign closure is blocked while linked requests are nonterminal; Logistics returns/settlements remain allowed.

## 9. Main use cases

### UC-01 — Submit an SOS/assistance request

**Actor:** Citizen, with or without an account (guest).

**Preconditions:** GPS available or user supplies a manual pin. Signing in is optional; the guest client generates and persists the tracking secret and idempotency key before submitting, and the server returns a request ID and tracking code on acknowledgement.

**Main flow:** Select assistance category → enter headcount/information and a contact phone (prefilled from the last request when available; stored on the request, not in Identity) → confirm location/accuracy → optionally attach photos/video within Section 23.5 limits → submit with idempotency key and (guest) client-generated tracking secret → Response validates and stores the request, audit, and timeline in one local transaction → returns request ID and SUBMITTED → citizen views the server-confirmed status and supplements information when state permits.

**Exceptions:** Offline submissions stay QUEUED_ON_DEVICE and are not server-received; denied GPS permits manual pin; validation errors preserve the form; the same key, payload and secret return the same request on retry, including when the first response was lost. The submission screen always shows a Vietnamese notice that the system is not a substitute for emergency lines and that a person in immediate danger should call 113/114/115 (copy subject to review); it states that a request is received only after the server acknowledgement.

**Postconditions:** Exactly one request record with server receive time; retries return the same request.

### UC-02 — Verify and triage

**Actor:** Scoped coordinator.

**Preconditions:** Request exists and is not terminal.

**Main flow:** Open scoped queue/map → start VERIFYING → supplement/contact, logging every ContactAttempt → choose exactly one outcome: VERIFIED with a verification basis (Section 8.1), REJECTED with reason, or DUPLICATE with canonical reference/reason. If the reporter cannot be reached, follow the unreachable-reporter rules in Section 8.1 (request stays VERIFYING, overdue escalation, optional authority-referral record). Only VERIFIED proceeds to human triage with priority/reason. Each command writes state/history/audit atomically.

**Duplicate guard:** Canonical target must be a different authorized, non-DUPLICATE/non-REJECTED/non-CANCELLED request. A request already referenced as canonical cannot itself become DUPLICATE, REJECTED or CANCELLED; linkers and those transitions lock the affected request rows in sorted ID order and recheck inbound links. Do not create chains or cycles. Preserve the original report and its history; the demo does not reparent duplicate links.

**Exceptions:** Reject out-of-scope actions; return conflict if state changed; duplicates require a canonical link.

**Postconditions:** Priority remains separate from status; the scoped board reads the authoritative Response state.

### UC-03 — Assign and accept a mission

**Actors:** Coordinator and active team leader; other volunteers have read access to their team's assignments.

**Preconditions:** Request verified/triaged; team active; coordinator authorized for the scope.

**Main flow:** Select a team by skills/scope/availability → offer assignment → active team leader accepts → EN_ROUTE → ON_SCENE → results/evidence → coordinator confirms mission outcome. The team assignment proceeds independently of Logistics fulfillment; both statuses appear on the request board.

**Exceptions:** Select another team if declined/unavailable. Concurrent assignments use version/transaction checks and conflicting commands reload. PAUSED campaigns block offers/acceptance; already accepted missions may continue under the campaign rules.

**Postconditions:** Consistent mission/request history; only a coordinator confirms resolution.

### UC-04 — Commit and partially fulfill a relief need

**Actors:** Scoped coordinator and warehouse/operations manager.

**Preconditions:** Warehouse/item active; stock may be available.

**Main flow:** Open a verified request on the board → define requested items/quantities in Logistics → one or more authorized warehouses commit partial quantities → confirm physical issue and later delivery → inspect remaining outstanding quantity → repeat or explicitly cancel/reduce the need with reason.

**Exceptions:** Insufficient stock cannot be committed; retries do not duplicate; cancellation before issue releases reserved quantity; issued goods require delivery, return, or loss settlement. A partial delivery keeps the need open.

**Postconditions:** Balance matches the ledger; each need shows requested/committed/issued/delivered/outstanding values and actor/time history.

### UC-05 — Dashboard/reports

**Actors:** Scoped coordinator/manager/admin.

**Main flow:** Select time/region/campaign → scoped APIs in Response and Logistics return authoritative aggregates with generated_at → UI composes the result and shows each source timestamp → export if authorized.

**Exceptions:** API outage marks only that source panel unavailable/stale; unauthorized export is denied/audited; no-data results follow an agreed convention.

**Postconditions:** No unauthorized PII exposure; dashboards do not modify authoritative business data.

### UC-06 — Manage accounts and permissions

**Actors:** Admin; citizen registering an account; invited staff/volunteer.

**Main flow:** A citizen registers with a unique normalized username and password and receives CITIZEN only. Admin creates staff/volunteer accounts, disables accounts, or grants role/scope → Identity records audit → services apply policy → UI exposes permitted functions. Registration never accepts privileged roles or scopes from the client. Email/SMS verification and self-service password recovery are outside the initial demo; admin-assisted reset revokes sessions and requires a password change.

**Exceptions:** Cannot remove the last administrator; disabled accounts cannot refresh tokens; existing access tokens are rejected through the current-session check described in Section 22.

**Postconditions:** All APIs enforce backend authorization; hidden UI controls are not a security boundary.

### UC-07 — AI-assisted priority suggestion (extension)

**Actor:** Coordinator.

**Main flow:** Response persists an immutable minimized snapshot and durable job → a Response-owned worker returns a versioned suggestion or abstention → coordinator inspects facts/reasons → authorized review checks freshness, request version, and verified/eligible state → human accepts or overrides with reason → atomic priority/audit write. See Section 12 for job, API, and failure contracts.

**Exceptions:** Timeout/failure leaves manual triage available; insufficient or unsupported data yields abstention; stale input, competing review, wrong scope, or ineligible state rejects acceptance. AI cannot change priority itself.

**Postconditions:** Official priority changes only through coordinator action.

### UC-08 — Create and manage a relief campaign

**Actors:** Coordinator or operations manager with campaign scope.

**Preconditions:** Authenticated user with region/organization management permission.

**Main flow:** Create campaign name/objective/region/time → persist in Response → activate → attach requests → Logistics records an opaque campaign reference on related needs/commitments/distributions → manager pauses/closes when permitted.

**Exceptions:** Closed campaigns cannot accept new requests; returns/settlements remain possible; reject invalid campaign IDs; closure preserves ledger/request history.

**Postconditions:** Response is authoritative for campaign status; Logistics may store an opaque campaign reference where useful.

### UC-09 — Manage vehicles and relief points

**Actor:** Scoped operations manager.

**Main flow:** Create/edit an asset with its organization/region and validated type/capacity or location/operating fields → list/view only authorized assets → select an active relief point as a distribution destination → inactivate an unused or retired asset with audit.

**Exceptions:** Reject cross-scope access, invalid values and selection of an inactive point for new distribution. Inactivation never deletes previous distribution references; asset management does not fabricate stock or imply routing/maintenance workflows.

**Postconditions:** Asset catalog and operational history remain consistent. FR-LOG-01/04 and TC-BE-21 define acceptance.

## 10. API and authentication

Donation use cases UC-10..14, donation APIs, UI details and their acceptance cases are specified in Section 25. They extend the existing logistics slice and do not create another service.

### 10.1 API conventions

- Base path /api/v1; REST/JSON; UUID identifiers; ISO-8601 UTC timestamps; bounded pagination/filters; consistent errors with code, message, field errors, and correlation ID.
- Separate OpenAPI schemas for the three APIs with shared terminology, pagination, error envelope, and authorization notes.
- Explicit business command endpoints for transitions, rather than unrestricted status PATCH.
- Significant side-effecting POST commands accept Idempotency-Key; state updates check expected state/version inside the transaction.
- Generate per-service OpenAPI with `@nestjs/swagger` and review/version the published contract. [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)

### 10.1.1 Vietnamese user-facing responses

**Confirmed product requirement:** human-readable API messages are Vietnamese, including validation, authentication/permission failures, business conflicts, upload failures, and notifications. JSON field names, error codes, enum values, and URLs remain stable machine identifiers. Clients use codes for logic and Vietnamese labels for display; do not parse message text.

Example error envelope:

```json
{
  "code": "REQUEST_VERSION_CONFLICT",
  "message": "Yêu cầu đã được cập nhật. Vui lòng tải lại trước khi tiếp tục.",
  "field_errors": {},
  "correlation_id": "uuid"
}
```

Implement a centralized NestJS exception filter and `ValidationPipe` exception factory that map stable validation/auth/business error codes to reviewed Vietnamese messages. Do not return class-validator or provider error strings directly. Set the API locale to Vietnamese regardless of `Accept-Language`; workers use the same Vietnamese message catalog outside HTTP request context. [NestJS validation](https://docs.nestjs.com/techniques/validation), [NestJS exception filters](https://docs.nestjs.com/exception-filters)

Backend responses may contain user-entered text unchanged. Do not translate names, original reports, opaque IDs, or machine codes. Map internal AI reason codes to Vietnamese explanations; optional LLM summaries must satisfy the same language requirement before display, otherwise show a reviewed Vietnamese fallback.

### 10.2 Endpoint sketches

| Service | Example endpoints | Authorization/notes |
|---|---|---|
| Identity | POST /identity/auth/register, /login, /refresh, /logout; GET /identity/me; POST /identity/users/{id}/roles | Admin-only role grants; no PII/location in tokens |
| Response | POST /response/requests; GET /response/requests; POST /response/requests/{id}/verify, /triage, /duplicate, /resolve; POST /response/requests/{id}/missions | Public rate-limited intake (guest or signed-in); `GET /response/requests/track` with the tracking secret in an authorization header for guests; scoped staff list/detail; resolution obtains a current-cycle Logistics resolution seal |
| Response | POST /response/campaigns; GET /response/campaigns; POST /response/campaigns/{id}/close | Response owns campaigns and request incident categories; managers need appropriate scope |
| Response | POST /response/missions/{id}/accept, /decline, /transition, /evidence | Active team leader accepts/declines, advances and uploads evidence; scoped coordinator may cancel/fail |
| Logistics | POST /logistics/needs; POST /logistics/needs/{id}/commitments; POST /logistics/commitments/{id}/issue, /deliver, /cancel | Need/commitment row locks; partial quantities; actor/reason audit |
| Logistics | POST /logistics/receipts, /transfers, /transfers/{id}/receive, /distributions, /adjustments; GET /logistics/stock?warehouse_id=...; /vehicles; /relief-points | Idempotency, audit, unit validation, row locks, scoped report fields |
| Logistics (internal) | GET /logistics/requests/{request_id}/fulfillment?work_cycle=...; POST /logistics/requests/{request_id}/cycles/{cycle}/seal, /unseal, /freeze | Authenticated service read and idempotent resolution seal; returns scoped totals or an immutable seal after all current-cycle needs and issued quantities are settled |
| Response / Logistics | GET /{service}/notifications; POST /{service}/notifications/{id}/read | Each service returns only notices it owns and scopes by recipient |
| Response / Logistics | GET /{service}/reports/... | Reports read the owning service's data and include generated_at |

These are SDD sketches, not final contracts. Finalize complete paths through OpenAPI and UI-flow review. Internal APIs must not blindly trust client headers.

**Internal API exposure and service credentials:** Identity introspection and the Logistics fulfillment/seal/unseal/freeze endpoints are internal. Nginx exposes only the public routes and returns 404 for internal paths (e.g. `/api/v1/identity/internal/*`, `/api/v1/logistics/internal/*`); internal calls use the Compose private network. Service-to-service calls authenticate with short-lived, audience-restricted service JWTs that Identity issues through a client-credentials grant to each service (per-service secret from the environment, never committed). The receiving service verifies issuer, audience and the allowed caller. Actor/scope context travels in signed token claims or in a body validated against the actor's own session, never in free client headers. Test that a public caller cannot reach internal paths (add to TC-BE-07 and TC-BE-20).

### 10.3 Authorization matrix

| Actor | Proposed core permissions |
|---|---|
| Guest (no account) | Create an SOS; with the SOS tracking secret, view its status/timeline and supplement it. View sanitized open donation drives; create a pledge or delivery declaration and, with the donation-scoped capability secret, track, dispute and attach evidence to that donation only (Section 25.4). SOS and donation secrets are not interchangeable. No access to anything else. |
| Citizen | Create, view, and supplement own requests (including claimed guest requests); view own notifications. |
| Volunteer | View assigned team missions and maintain own profile/availability. Only the active team leader accepts/declines, advances missions and submits results/evidence. |
| Coordinator | Scoped queue/map; verify, duplicate-link, triage, assign, cancel/reopen, confirm outcomes. |
| Operations Manager | Scoped warehouse/point/vehicle/distribution management; transfers/adjustments according to policy; operational reports. |
| Admin | Accounts/roles/configuration; case-detail access is not automatically granted without need. |

**Proposed authentication:** Identity issues asymmetric JWTs containing issuer, audience, subject, expiry, and minimum role/scope data. Services validate signatures locally. Access tokens expire after 10 minutes for the demo; refresh sessions have a 7-day absolute expiry with rotation and reuse detection; rotation does not extend that expiry. These are capstone configuration defaults. Each protected HTTP request validates the JWT locally and obtains current account/session/grants from an authenticated Identity introspection API without a positive cache. Logout revokes that session; disabling, credential reset, or role changes revoke all affected sessions. Identity unavailability returns Vietnamese 503 and fails closed for authenticated routes. Guest SOS creation, guest evidence upload and secret-based tracking are deliberately independent of Identity: if a bearer token is present on SOS creation, Response validates its signature locally only (ownership link) and never calls introspection, so an Identity outage cannot block an emergency report. A request already authorized may finish; this is request-boundary revocation, not cancellation of in-flight transactions. Section 22 defines the availability tradeoff.

Section 23.1 fixes the browser/native transport, cookie/CSRF controls and client storage for these sessions.

Do not encode all policy in JWTs: Response checks its own team/region/request relationships and Logistics checks warehouses/commitments. Service queries must still filter rows by scope after Nest guards authorize the action. [NestJS guards](https://docs.nestjs.com/guards)

## 11. User-interface architecture

**Language:** all user-facing Web/Mobile copy is Vietnamese, including controls, labels, placeholders, status descriptions, accessibility labels, empty/loading/error states, dialogs, notifications, and report/export headings. Render stable backend enums through Vietnamese labels; preserve original user-entered content. This requirement is independent of English technical documentation or the language used in developer conversations.

### Web

- **Coordinator:** saved views for awaiting verification, verified-but-unassigned, active missions, and partially fulfilled needs; map and scoped filters; request details, team availability, mission board, and audit timeline.
- **Operations manager:** campaigns, warehouses/items, stock ledger, commitments/transfers, vehicles, relief points, and distributions.
- **Admin:** accounts, organizations, role grants, service health; PII only with a relevant operational role.
- **Operational metrics:** cases by region/status/priority; time from receipt to verification/assignment/delivery; unfinished missions; requested/committed/issued/delivered/outstanding quantities per authorized request; source timestamps.

### Mobile

- **Citizen:** SOS submission, manual pin, optional photos/video, confirmation with request ID, timeline, supplementary information.
- **Volunteer:** assigned missions, necessary details, accept/decline, state actions, outcome photos/video.
- Offline drafts/queues clearly indicate pending synchronization and reuse the same idempotency key. Minimize local PII; decide cache deletion and platform protection before implementing persistent caches.
- Internal chat, background live tracking, turn-by-turn navigation, and a custom geocoding service are outside the MVP unless explicitly approved.

## 12. Backend AI integration — researched design

### 12.1 Purpose, scope, and evidence

**Original research: 2026-09-29; blueprint adaptation reviewed: 2026-09-30. Status: optional capstone integration design, not a validated emergency-triage system.** The goal is to help coordinators inspect incomplete reports and consider a priority suggestion, while preserving manual verification, assignment, and final decisions. Section 12.10 adapts relevant ideas from the supplied AI blueprint; the [review note](c48-ai-blueprint-review.md) records the source analysis and limitations. The architecture below is a C48 design decision; the cited sources establish technical mechanisms and evaluation practices, not the accuracy of this proposed application.

NIST AI RMF organizes risk management around Govern, Map, Measure, and Manage, including human responsibilities and ongoing evaluation. C48 applies these ideas through recorded ownership, a bounded purpose, evaluation before activation, human review, and a disable/rollback path. This is not a claim of certification or operational readiness. [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)

| Candidate capability | Input/output | Value and limitations | C48 recommendation |
|---|---|---|---|
| Priority suggestion | Structured incident facts → proposed P1–P4, reasons, missing facts | Helps review consistency; depends on agreed definitions and representative labels | Primary AI research experiment, always human-reviewed |
| Missing-information detection | Required fields and contradictions → clarification checklist | Useful without a trained model; unknown facts must stay unknown | Implement as deterministic validation/rules first |
| Report summarization/category extraction | Redacted narrative → short summary and proposed category | Can reduce reading effort; may omit or invent details | Optional LLM experiment after the structured flow works |
| Duplicate candidates | Time window + PostGIS proximity + category/text similarity → possible related reports | Distinct households can share location and hazard | Optional suggestions only; never automatically merge or discard |
| Team/resource matching | Skills, scope, availability, distance → candidate list | Hard constraints and query logic already cover baseline needs | Use ordinary filters/queries first; no AI required |
| Image/video severity inference, demand forecasting, autonomous dispatch | Media/history → inferred severity/resource decision | Needs specialized data, evaluation, compute, and stronger governance | Outside this capstone AI slice |

A versioned rule engine is a decision-support baseline, not evidence of machine learning. If the capstone claims an ML contribution, include a separately trained/evaluated model and compare it with the rules. If suitable labeled data is unavailable, report that limitation and retain an integration/rules demonstration.

### 12.2 Technology options and selection

| Option | Implementation | Strength | Limitation | Decision |
|---|---|---|---|---|
| Versioned rules | TypeScript functions plus a reviewed rule table | Reproducible explanations; no training data dependency | Rule quality depends on domain review; no learned generalization | Baseline advisor mode |
| Weighted scoring | Small versioned TypeScript evaluator on explicit known factors | Explainable comparator for the blueprint experiment | Averages can dilute critical signals; weights/thresholds are unvalidated | Optional research comparator; not a directly actionable recommendation |
| Supervised model | Defer to a separate research spike using a Node-compatible inference runtime and versioned artifact | Could add learned ranking after rules baseline | Requires labels, leakage controls, class-imbalance analysis, runtime compatibility, and calibration | Not in the core delivery stack |
| Hosted LLM | Server-side provider call with a strict output schema | Useful experiment for summarization/extraction of Vietnamese narratives | Provider cost/availability, privacy, injection, hallucinations, version changes | Optional; provider remains unselected |
| Local language model | Separate inference process called by the worker | Keeps inference within the chosen environment | Hardware/memory, deployment, license, and quality still need validation | Only after hardware and evaluation justify it |

A text vectorizer does not by itself understand urgency. No ML framework or training runtime is selected for the baseline. Any later model experiment must use a Node.js-compatible runtime, version its feature transformations, and be evaluated on held-out, grouped data before it is considered for integration.

**Optional future experiment:** if suitable labeled data and a Node.js-compatible model tool are available, compare reviewed rules with a small structured-feature model, then assess whether approved text features improve held-out results. Evaluate Vietnamese text with diacritics, missing diacritics, negation, abbreviations, and contradictory statements. Do not assume that an English pretrained model works for Vietnamese emergency reports. No model/provider has been selected or benchmarked by this document.

No vector database, RAG framework, agent framework, GPU, or additional message broker is needed for the baseline. Implement rules in a small TypeScript module. Add a provider adapter only when a hosted model is actually integrated.

### 12.3 Placement within the three-service architecture

**Start with an advisor component owned by Response.** Run it as a worker process using the Response codebase and Response-owned AI tables. This is a worker for durable background work, not an independently owned service. It does not access Identity or Logistics databases directly. A future independently owned AI service would require a demonstrated scaling or governance need; do not create that boundary just to make an API call.

```mermaid
sequenceDiagram
  participant C as Citizen / Coordinator
  participant R as Response API
  participant D as Response DB
  participant W as Response advisor worker
  participant M as Rules / Model / Optional provider
  C->>R: Submit or supplement request
  R->>D: Transaction: request + audit + analysis job
  R-->>C: Server ACK without waiting for AI
  W->>D: Claim pending job with bounded lease
  W->>M: Analyze minimized immutable snapshot
  Note over W,M: No DB lock held during inference
  M-->>W: Validated suggestion or abstention
  W->>D: Transaction: result + job status
  C->>R: Read suggestion and source facts
  C->>R: Review with expected request version
  R->>D: Authorize + freshness check + human decision + audit
  R-->>C: Confirm committed review result
```

The job row stores a request ID, input revision/hash, policy version, state, attempt count, and lease. The worker claims one pending job in a short transaction, then reads the immutable snapshot from Response-owned tables. It uses a unique job/recommendation constraint and claim token so retries cannot commit competing results. No raw description, contact detail, file, or precise coordinate needs to pass through a broker.

Use short database transactions for job claims and result writes. Provider calls occur outside TypeORM transactions/row locks. If the worker is down, jobs remain pending for a later retry; the normal human workflow remains available. [TypeORM transactions](https://typeorm.io/docs/advanced-topics/transactions/)

### 12.4 Data model and input/output contract

All following tables belong to Response. These are proposed additions, not existing migrations.

| Entity | Minimum fields and constraints |
|---|---|
| AnalysisSnapshot | UUID, request ID, work_cycle, input revision, feature schema version, normalized/minimized feature JSON with fact provenance, input/context hash, capture/evaluation time and optional hazard source/version/validity; immutable content; protected like the request |
| AnalysisJob | UUID, snapshot ID, advisor/policy version, state, attempt count, available_at, lease_until, claim token, error code, timestamps; unique snapshot/advisor/policy tuple |
| TriageRecommendation | UUID, job ID unique, suggested priority nullable, outcome, reason codes, missing/conflicting fields, extracted claims/source references, separate data-quality/verification signals, calibrated score nullable, score semantics, model/rule/prompt version, artifact hash, evaluated_at, generated_at, expires_at; immutable result |
| RecommendationReview | UUID, recommendation ID unique for the authoritative review, decision, chosen priority nullable, reason, reviewer ID, reviewed request version, timestamp; conflict on a competing final review |

Separate the job lifecycle from the recommendation review lifecycle:

- Job: PENDING → RUNNING → SUCCEEDED or ABSTAINED; retryable failure → RETRY_WAIT → RUNNING; exhausted/permanent failure → FAILED. Disabling cancels unclaimed jobs; in-flight output is ignored or retained as disabled history, never applied.
- Recommendation: PENDING_REVIEW → ACCEPTED, OVERRIDDEN, or DISMISSED. Input changes invalidate unreviewed recommendations as STALE. Expiration is an additional freshness guard, with its duration still to be agreed. Reviewed historical results remain historical and are not relabeled as current.

Use a dedicated input revision for incident facts affecting analysis; do not invalidate a suggestion merely because a notification was marked read. Any relevant fact update creates a new snapshot/revision and makes old unreviewed results ineligible for acceptance. The review command also checks the current request version to catch competing human updates.

Keep citizen-reported facts, coordinator-verified facts and model-extracted suggestions distinct, with source/input revision and reported/inferred provenance. Extracted claims never overwrite verified facts or the request's authoritative headcount/location. Missing totals remain null in the extraction result; this does not relax the required validated headcount on SOS creation. Vulnerable groups may overlap, so their counts cannot be summed to invent total occupants. Negation, contradictions and unsupported inference produce missing/conflict indicators and, where critical facts are insufficient, abstention. Correcting facts creates a new revision/snapshot; historical output remains immutable.

Freshness also depends on time and external context. If waiting time is used, record its origin as the current work cycle's server start time (initial receipt or audited reopen), evaluated_at and expiry at the next relevant policy boundary or the configured maximum result age, whichever is earlier. An initial receipt timestamp must not age a reopened cycle. If hazard features are used, derive them locally in Response from authorized synthetic/manual geometry with source, version and validity; give providers minimized categories rather than exact GPS. Missing/stale hazard data remains unknown. Review checks work_cycle, expiry and current hazard/context version even when input_revision has not changed. Re-evaluation creates a new immutable context snapshot/job; unchanged equivalent context still deduplicates using the policy time bucket and hazard/context versions, not a different clock instant for each retry. Record actual expiry/re-evaluation configuration before enabling the affected policy.

Input uses known structured facts and explicit null/unknown values: category, reported needs, headcount, incident/capture time, and confirmed operational flags from the agreed taxonomy. Exact GPS, reporter identity, phone number, tracking secrets/tokens, signed URLs, images, ContactAttempt and AuthorityReferral notes are excluded by default. The reporter-declared danger flag (Section 8.1) may enter only as a reported, unverified fact with provenance; it never counts as verified and never changes verification status, queue order or priority by itself. If coarse location is justified, document why it is needed and assess regional bias. Unknown is not false or zero; headcount alone is not an urgency policy.

Illustrative result envelope, **not a clinical rule or executable triage policy**:

```json
{
  "recommendation_id": "uuid",
  "request_id": "uuid",
  "input_revision": 3,
  "feature_schema_version": 1,
  "advisor_kind": "rules",
  "advisor_version": "rules-v1",
  "policy_version": "draft-policy-v1",
  "outcome": "SUGGESTION",
  "suggested_priority": "P2",
  "reason_codes": ["REVIEWED_RULE_MATCH"],
  "missing_fields": [],
  "confidence": null,
  "confidence_kind": "NOT_APPLICABLE",
  "generated_at": "2026-09-29T10:30:00Z"
}
```

Validate priority/outcome enums, lengths, bounded arrays, source references, and version fields. A schema-valid response can still be factually wrong. For insufficient, contradictory, unsupported, or out-of-distribution input, use ABSTAIN with `suggested_priority = null`; route to the normal human queue. Rule match strength and an LLM's self-reported certainty are not calibrated probabilities.

Data quality and verification need are separate from urgency: improved GPS accuracy or extra evidence alone must not increase/decrease a danger level. Do not import the blueprint's `0.05 * confidence` term into the operational advisor. A pure weighted comparator may expose its versioned score only in the research view; it is ineligible for the authoritative review command. In the PDF formula, severity=100 with every other component=10 yields 37/MEDIUM, demonstrating dilution rather than a validated priority rule. The reviewed rule table for `draft-policy-v1` must cite the draft P1–P4 criteria and factors of Section 8.1 and change only together with them. Domain-reviewed critical rules take precedence over soft assistance-only rules in the advisor; until sufficient facts and a reviewed policy are available, abstain and flag human verification instead of guessing low urgency. The verification flag does not automatically change official priority, queue order or dispatch.

### 12.5 API, authorization, and human review

| Proposed endpoint under /api/v1 | Behavior and permission |
|---|---|
| POST /response/requests/{id}/analysis-jobs | Scoped coordinator requests/retries analysis; idempotency required; return job ID and 202, or existing equivalent job |
| GET /response/requests/{id}/recommendations | Scoped coordinator reads results with age, input revision, reasons, missing facts, and eligibility; no public/guest access |
| POST /response/recommendations/{id}/review | Scoped coordinator supplies ACCEPT/OVERRIDE/DISMISS, reason, chosen priority when overriding, expected request version, and idempotency key |

Automatic job creation after intake is allowed only when the AI feature is enabled; submission remains successful if AI is disabled or unavailable. An early suggestion may be displayed as unverified information. **Accept/override can affect priority only after request verification and only in a state permitting human priority changes.** Use the same domain command as manual triage; do not add a backdoor around normal guards. For VERIFIED requests it may perform the normal human-authorized transition to TRIAGED; for later eligible states it changes priority without rewinding progress. Reject terminal/ineligible states and stale input with a conflict.

In one review transaction, check role/scope, request version, current input revision/work cycle, recommendation/context freshness, advisor review eligibility, and permitted state; then write review, human-authorized priority change where applicable, and audit. Research-only weighted outputs cannot be accepted or overridden through this command; a coordinator may always use eligible manual triage separately. DISMISS records feedback without changing priority. An override requires the selected priority and a reason. A repeated identical idempotent command returns the original result; a conflicting second review fails.

The worker has no credentials for priority/mission mutation APIs. Where practical, give its database connection privileges limited to required snapshot/job/result operations; do not assume a shared application image itself enforces least privilege. Web/mobile call Response only and never receive provider API keys. The citizen/volunteer UI displays authoritative human decisions, not unreviewed model scores.

Coordinator UI must render explanations and summaries in Vietnamese, mapping stable reason codes to reviewed copy. It must show source facts beside the suggestion, mark it as advisory, distinguish missing data from low urgency, and leave manual triage available. Do not silently reorder or hide the operational queue based on AI scores. Any future AI-ranked view must be an explicitly labeled optional view with a normal queue available.

### 12.6 Reliability, privacy, and deployment

- **Retry budget:** propose at most three attempts with bounded backoff and a provider deadline; choose actual timeouts after measurement. Permanent validation/schema errors do not retry indefinitely. Rate limits respect provider guidance and a project cost budget.
- **Lease recovery:** assign a fresh claim token per attempt. After a lease expires, another worker may retry; only the current token may commit a result. This prevents a late worker overwriting a newer attempt. Maintain one committed recommendation per job.
- **External calls:** a crash after a provider response may incur a second call/cost. Use provider idempotency if supported, otherwise document this residual behavior; database deduplication cannot guarantee one billable call.
- **Failure isolation:** worker/model/provider outage leaves jobs pending/failed. Human intake, verification, priority changes, dispatch, and stock operations continue.
- **Resource limits:** begin with one worker and CPU inference; cap concurrency and memory so analysis cannot starve Response. Benchmark before adding local LLM/GPU infrastructure. A separate model server is a runtime dependency, not automatically a new domain service.
- **Data minimization:** use structured fields first; redact approved text before any external call. Redaction may be incomplete, so real sensitive-data egress still needs a provider/retention decision. Do not log full prompts, outputs, exact locations, credentials, or signed URLs by default.
- **Untrusted text:** treat citizen narratives, OCR, and retrieved content as data. Give an LLM no tools, database mutation permissions, network actions, or storage credentials. Instructions embedded in a report must not change workflow or output policy. Prompt instructions and JSON validation alone do not eliminate injection risk. [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- **Model artifacts:** store trusted, versioned artifacts with checksums and training/environment metadata; load only approved artifacts. Do not accept uploaded model files from users.
- **Storage relationship:** MinIO may hold private authorized research datasets or trusted model artifacts; inference runs in the NestJS worker or an approved provider endpoint. No vector database is required to store photos, JSON, or model files. Keep research/model buckets separate from evidence and restrict access.
- **Disable/rollback:** feature flag off stops new analyses and disables review acceptance of pending suggestions; manual triage remains available. Pin the previous known version for rollback. A rollback must never undo past human decisions.
- **Observability:** job age, completion/failure/abstention rates, attempt counts, stale-result count, inference latency, review latency, override rate, and optional provider cost. Logs use job/request/correlation IDs; dashboard metrics are aggregated, access-controlled, and not claims of model accuracy.

### 12.7 Evaluation design and research validity

**Dataset first:** define the unit of analysis, allowed inputs, label taxonomy, label timestamp, and data-use basis before training. Use domain-reviewed labels with a documented disagreement/adjudication process. Do not automatically treat coordinator acceptance as ground truth: exposure to suggestions can bias decisions. Record which facts were available at prediction time; later rescue outcomes and final priority must not leak into training features.

Split by incident/campaign and, where feasible, by time so near-duplicate reports do not appear in both training and evaluation. Keep the test set untouched until the experiment is fixed. Group-aware splitting can prevent group overlap, but cannot guarantee class balance for every dataset; report rare/missing classes and limitations. Fit every learned preprocessing step on training folds only.

| Evaluation area | Report | Why it matters |
|---|---|---|
| Priority classification | Per-class precision/recall/F1, macro-F1, confusion matrix, class sample counts | Overall accuracy can conceal poor performance on rare urgent cases |
| Under-prioritization | P1/P2 cases suggested less urgent, separated by degree of error | A one-level error and an urgent-to-nonurgent error should not be hidden in one score |
| Abstention | Coverage, abstention rate, class-specific abstention, errors among answered cases | A model cannot look successful merely by avoiding difficult inputs |
| Probability output | Reliability/calibration analysis and a suitable scoring metric if probabilities are exposed | A raw score is not necessarily a meaningful probability |
| Text extraction/summary | Field correctness, unsupported claims, critical omissions, contradiction handling | Fluent language is not evidence of correct incident information |
| Robustness | Negation, missing fields, duplicates, long text, dialect/diacritics, injection, unseen categories | Checks likely input variations and unsupported cases |
| Operations | End-to-end analysis age, inference p95, CPU/RAM, failure recovery, cost | Determines whether the optional worker fits the demo environment |
| Human workflow | Review completion/time and override reasons; usability observations | Checks usefulness without assuming acceptance means correctness |

Classification metrics and calibration concepts in the C48 evaluation plan are proposals; select compatible tooling only if a model is added.

Compare manual/rule baseline and ML on the same held-out dataset. Report dataset size, provenance, class distribution, split method, preprocessing, seed, model/version, parameters, threshold selection, and uncertainty/sample limitations. Keep synthetic fixtures for workflow testing, but do not present agreement with labels generated by the same rules/LLM as independent validation. Do not invent a required accuracy or critical-case recall threshold before domain review.

For the PDF's scoring versus rule+LLM experiment, distinguish two comparisons: end-to-end evaluation on identical original snapshots, including extraction failures/missing facts; and policy-only evaluation on identical independently curated structured facts. Do not attribute gains from additional narrative information to the priority policy alone. Freeze weights, rule precedence, thresholds and prompt/model versions before the held-out evaluation. If LOW/MEDIUM/HIGH/CRITICAL research labels are used, map them explicitly to P4/P3/P2/P1 and keep existing API enums stable. The proposed 150–300 synthetic cases are an initial experiment size, not evidence of sufficient real-world accuracy; labels must be independent of the tested rules/model, with related incidents/paraphrases grouped across splits. Report extraction correctness and unsupported claims alongside urgency metrics, abstention, processing time and provider cost. [NIST AI RMF evaluation guidance](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf), [NIST Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

**Demo acceptance:** reproducible inference, truthful abstention, documented evaluation, no automatic decisions, validated failure recovery, and passing integration tests. **Real-world use:** requires separate operational validation and data/privacy decisions; a capstone benchmark is insufficient evidence.

### 12.8 Additional optional requirements and planned tests

These extend FR-AI-01 and UC-07 without making AI mandatory. Existing TC-26/TC-27 remain in the core matrix.

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| FR-AI-02 | O | Durable, idempotent asynchronous analysis jobs | Retries/redelivery cannot commit multiple results for one job; intake never waits for inference |
| FR-AI-03 | O | Versioned inputs/results and stale-result protection | Relevant fact edits prevent acceptance of older suggestions |
| FR-AI-04 | O | Authorized human review and audit | Only scoped coordinators can accept/override; expected version and normal state guards apply |
| FR-AI-05 | O | Abstention, timeout, disable/rollback, and operational metrics | Manual workflows continue under outage; UI never maps failure/unknown to low urgency |
| FR-AI-06 | O | Reproducible evaluation and artifact provenance | Record labels/splits/versions/metrics; no fabricated accuracy or untrusted artifacts |

All tests below are **planned, not executed**. Expand them into executable cases using the test-record fields in Section 13.2.

| Test ID | Requirement / use case | Preconditions and action | Expected result |
|---|---|---|---|
| TC-AI-01 | FR-AI-02 / UC-07 | Enable advisor; submit valid SOS while inference is blocked | SOS ACK succeeds; durable job remains pending; request priority unchanged |
| TC-AI-02 | FR-AI-02 / UC-07 | Retry the same analysis-job command and run two workers against pending jobs | One logical job and at most one committed result; claim lease prevents competing commits |
| TC-AI-03 | FR-AI-03 / UC-07 | Generate result at input revision 3; edit relevant facts to revision 4; accept old result | Conflict; no priority/state change; stale result remains historical |
| TC-AI-04 | FR-AI-04 / UC-07 | Two scoped coordinators review the same suggestion/request version concurrently | One final review succeeds; second conflicts; one authoritative decision |
| TC-AI-05 | FR-AI-04 / UC-07 | Citizen, unrelated coordinator, or worker attempts review | Denied without leaking the request or changing priority |
| TC-AI-06 | FR-AI-01, FR-AI-05 / UC-07 | Missing/contradictory inputs or unsupported category | ABSTAIN/null suggestion with reasons; manual queue retained, no default P4 |
| TC-AI-07 | FR-AI-05 / UC-07 | Provider times out/rate-limits across retry budget | Bounded retries then visible failure; intake/dispatch remain operational |
| TC-AI-08 | FR-AI-01, FR-AI-04 / UC-07 | Model proposes lower urgency than current human P1 | No automatic downgrade; only an explicit eligible human command can change it |
| TC-AI-09 | FR-AI-04 / UC-07 | Request unverified or terminal; attempt ACCEPT | State guard rejects; no bypass of verification or reopening |
| TC-AI-10 | FR-AI-02 / UC-07 | Crash after job claim; lease expires; new attempt completes; old attempt returns | Recovery works; old claim token cannot overwrite new result |
| TC-AI-11 | FR-AI-01, FR-AI-05 / UC-07 | Narrative contains instructions to ignore policy or call tools; output contains invalid priority | Text treated as data; no tool execution; invalid output rejected; no authoritative mutation |
| TC-AI-12 | FR-AI-05 / UC-07 | Disable advisor with queued/running jobs and pending suggestions | Manual workflow remains available; pending AI acceptance blocked; completed human history unchanged |
| TC-AI-13 | FR-AI-06 / UC-07 | Prepare train/test sets with related reports; inspect split and fitted preprocessing | No incident-group overlap; no test-fitted transforms; evaluation manifest records checks |
| TC-AI-14 | FR-AI-06 / UC-07 | Artifact hash/version mismatch or unapproved model file | Refuse load and expose failure; no fallback to an arbitrary artifact |
| TC-AI-15 | FR-AI-04 / UC-07 | Verified request/current suggestion; authorized ACCEPT or OVERRIDE with reason | One atomic human review/priority/audit change; retry returns original result |
| TC-AI-16 | FR-AI-05 / UC-07 | Inspect provider request/logs with seeded phone/token/location markers | Disallowed fields absent; no provider secret appears in web/mobile responses |
| TC-AI-17 | FR-AI-03/04 / UC-07 | Narrative omits total occupants, includes overlapping vulnerable groups or negated symptoms; extracted claim conflicts with verified headcount | Unsupported totals remain null; no invented sum or symptom; provenance/conflicts retained; verified request facts unchanged |
| TC-AI-18 | FR-AI-01/05 / UC-07 | Hold danger facts constant; vary GPS accuracy/evidence confidence | Data-quality/verification signals may change; urgency does not change solely because confidence changed; unknown is not default P4 |
| TC-AI-19 | FR-AI-01/04/06 / UC-07 | Evaluate the weighted dilution counterexample; try accepting its research-only result; evaluate conflicting critical and food-only rules under a reviewed fixture policy | Comparator records 37/MEDIUM and known limitation; acceptance denied; critical fixture rule takes precedence or insufficient critical facts abstain; no automatic official priority change |
| TC-AI-20 | FR-AI-03/05 / UC-07 | Waiting-time boundary passes, hazard validity/version changes, or request reopens without a relevant new narrative | Old result cannot be accepted; refreshed context creates a new deduplicated job; reopened cycle uses its own start time; absent hazard remains unknown |
| TC-AI-21 | FR-AI-04/05, NFR-L10N-01 / UC-07 | Optional provider returns English copy, malformed JSON or a late result after human correction | Reviewed Vietnamese fallback or visible abstention/failure; schema-invalid content rejected; old result cannot overwrite verified facts, official priority or mission progress |
| TC-AI-22 | FR-AI-06 / UC-07 | Compare methods with different available facts, labels generated by the tested engine, or incident paraphrases split across sets | Evaluation checks reject the invalid comparison; separate end-to-end and policy-only reports use aligned inputs, independent labels and grouped held-out cases |

### 12.9 Delivery sequence and research artifacts

1. **Contracts and fixtures:** agree advisor purpose, draft taxonomy, input schema, abstention, permissions, versions, and synthetic edge cases. Do this while Response contracts are designed.
2. **Rules integration:** build the optional Response worker, durable jobs, result/read/review APIs, coordinator panel, and failure tests after manual triage works.
3. **Optional ML experiment:** only if suitable data, evaluation support, and a Node.js-compatible runtime are available; create a reproducible dataset manifest and compare against the rules baseline. Otherwise keep the documented rules-only advisor.
4. **Optional text assistance and blueprint comparison:** add extraction/summarization only after privacy/cost/output validation decisions; measure unsupported facts and critical omissions. Run the weighted comparator and rule+LLM experiment under Section 12.7; comparator results remain research-only. Hybrid is deferred until evaluation demonstrates a benefit. Do not expand to tool-using agents.
5. **Demo/report:** show stale-result rejection, outage fallback, human override, and a reproducible evaluation. Feature-freeze with AI disabled if the integration/evaluation is incomplete.

Deliver a short advisor design note, data/label manifest, experiment report, model/rule card with intended use/limits, API schema, and the planned test execution record. Their content can live within the existing SDD/test report; a separate platform or registry is unnecessary.

### 12.10 C48-aligned integration of the supplied AI blueprint

**Adaptation decision: 2026-09-30.** The supplied blueprint, as analyzed in the [review note](c48-ai-blueprint-review.md), contributes an extraction/rules experiment and human-review workflow. C48's assigned scope, state machines, permissions, data ownership, and delivery priorities govern integration. AI remains optional; the blueprint does not replace the selected architecture or add mandatory research features.

```mermaid
flowchart TD
  Intake[SOS and appended reported facts] --> Snapshot[Response immutable versioned snapshot]
  Snapshot --> Worker[Existing Response TypeScript advisor worker]
  Worker --> Extract[Optional minimized LLM extraction with provenance]
  Extract --> Validate[Validate supported facts, unknowns and conflicts]
  Worker --> Structured[Known structured facts without an LLM]
  Structured --> Validate
  Validate --> Rules[Versioned rules: suggestion or abstention]
  Validate --> Comparator[Optional weighted research comparator]
  Comparator --> Experiment[Evaluation report only]
  Rules --> Review[Scoped coordinator views Vietnamese reasons and source facts]
  Review --> Command[Existing manual triage command with state and freshness guards]
  Command --> Commit[Human priority decision and audit]
```

- **Reuse the baseline:** existing Response snapshots/jobs/recommendations/reviews and TypeScript rules. LLM calls run outside DB transactions and have no operational tools or mutation permissions. Two small evaluation functions suffice for a comparison; introduce abstractions only for actual reuse.
- **Keep decisions human-owned:** extraction proposes facts; rules propose priority or verification need. Neither changes verified facts, official P1–P4, mission state or assignment. Manual processing remains available with AI disabled or unavailable.
- **Use only supported context:** preserve unknown totals, overlapping groups, negation and contradictory updates as Section 12.4 specifies. Compute optional hazard features locally; version and expire time/hazard-dependent results. The PDF's unsupported `peopleCount=4` and uncalibrated `semanticUrgency=0.95` are counterexamples, not contract defaults.
- **Separate operational advisor and experiment:** rules are the baseline advisor; optional rule+LLM supports extraction and summarization. Weighted scoring is a research comparator with documented dilution limits, separate confidence and independently reviewed labels. A future hybrid requires evaluation and an explicit policy revision before it becomes review-eligible.
- **Keep adjacent extensions deferred:** live/background tracking, route replay, forecast feeds, ETA/hazard-aware routing, Redis/WebSocket and additional service boundaries are not adopted by this AI integration. Team scope, mandatory skills and availability remain hard constraints in ordinary Response queries. The selected stack remains three NestJS services with TypeORM, PostgreSQL/PostGIS, and MinIO AIStor Free; no Python runtime or broker is introduced.

Before enabling this extension, finalize extraction provenance schemas, rule taxonomy/precedence, bounded fields, expiry/context version checks, Vietnamese reason mappings, provider/data-egress decisions when applicable and the tests in Section 12.8. The PDF's example weights and urgency rules are unvalidated research proposals, not rescue-authority policy. Core delivery proceeds independently of this optional integration.

## 13. Testing and test cases

### 13.1 Strategy

| Layer | Coverage | Suggested tools |
|---|---|---|
| Domain/unit | State transitions, priority, inventory arithmetic, permission predicates, DTO mapping | NestJS TestingModule/Jest and Supertest; use real PostgreSQL/PostGIS for locking and GIS. [NestJS testing](https://docs.nestjs.com/fundamentals/testing) |
| Database integration | PostGIS, rollback, locks/races, constraints/migrations | Real PostgreSQL/PostGIS in a Compose test profile; SQLite does not provide equivalent GIS/locking behavior |
| API/security | 401/403/404, registration/revocation, object scope/list filters, validation, rate limits, uploads | Supertest and role × endpoint × scope matrix |
| Cross-service integration | JWT/scope checks, REST timeouts/errors, idempotent retries, partial results when one API is unavailable | Supertest against the three APIs in a Compose test profile |
| Frontend | Forms, state labels, authorized navigation, stale dashboards, offline pending | Unit/component tests and smoke use cases |
| E2E/demo | Citizen submission → coordinator verification → team progress + partial Logistics fulfillment → human resolution | Playwright or manual checklist/video evidence; use synthetic data |
| NFR | API latency/error thresholds, restore, upload limits, database contention, log redaction | k6 HTTP load script, recovery scenarios, security checklist; record measurement hardware |
| Real-device mobile | GPS denied/low accuracy, network lost mid-send, retry after lost response, secret storage, guest tracking, mission action not sent | Physical Android/iOS device(s) with Expo build; record device, OS and result per case |
| Usability and accessibility | SOS steps and completion time, errors, understanding of received/not-received state, accessibility labels and contrast on emergency screens | Task-based check with a stated number of testers; report sample size and limits, not general claims |

### 13.2 Core test cases

These are **planned test cases, not execution results**. Test records must include ID, linked FR/UR, preconditions, data, steps, expected result, actual result, status, and tested build/commit.

#### Detailed specifications for high-risk tests

| ID / FR | Preconditions and data | Steps | Expected result |
|---|---|---|---|
| TC-01 / FR-REQ-01, 03 | Guest or demo citizen; synthetic coordinates, accuracy 12 m, 3 people; unused key; for a guest, a client-generated tracking secret | POST valid request; repeat same key/payload/secret, including after the first response is discarded | One request, one ID and one tracking code; same retry result; separate capture/receive times |
| TC-06 / FR-IAM-02, FR-REQ-07 | Citizens A/B; request owned by B | A reads B's request, attempts update, then lists requests | Cannot read/update B's request; list contains only A's cases; no description/location disclosure |
| TC-16 / FR-LOG-02 | on_hand = 5, reserved = 0; two authorized operators; each requests direct issue-and-distribution of 4 of the same SKU/warehouse | Concurrent commands with different keys; each atomically reserves/issues its own available goods and records distribution | One succeeds; one conflicts/reports insufficient stock; available = 1; one ISSUE movement |
| TC-21 / FR-NOT-01 | Request transition and one recipient; retryable command has a fixed idempotency key | Submit the same state-change command twice | One state transition and one in-app notice for that transition/recipient |
| TC-25 / FR-OFF-01, FR-REQ-03 | Mobile SOS draft with idempotency key; network toggle available | Disable network and send; inspect UI; reconnect and retry twice | Pending before ACK, submitted afterward; exactly one server request |
| TC-30 / FR-CAM-01 | ACTIVE campaign; scoped coordinator; existing history | Attach request; attempt close while request nonterminal; complete/resolve/close request; close campaign; attempt another attachment; read history | Premature close conflicts; close after terminal request succeeds; new attachment denied; scoped history remains accessible |
| TC-31 / FR-LOG-03, FR-LOG-05, FR-MSN-02 | Verified request needs 20 kits; warehouse A can provide 12 and warehouse B can provide 8 | Create need; commit/deliver 12; inspect board; commit/deliver 8; coordinator resolves request | First contribution shows 12 delivered and 8 outstanding; second completes 20; separate mission/request/fulfillment statuses and both contribution audits remain visible |

| ID | Scenario | Expected result |
|---|---|---|
| TC-01 | Valid GPS SOS | Store location, accuracy, source, capture/receive time; return one ID and SUBMITTED |
| TC-02 | Out-of-range coordinates, negative headcount, or missing field | 400; no request or audit record |
| TC-03 | GPS denied; manual pin provided | MANUAL_PIN source; UI does not claim precise GPS |
| TC-04 | Retry same Idempotency-Key after timeout | Same request ID; no second row |
| TC-05 | Same key with different payload or different tracking secret | Conflict; existing request unchanged |
| TC-06 | Citizen A reads/updates Citizen B's request | Access denied without sensitive disclosure |
| TC-07 | Volunteer lists missions | Only missions assigned to the team/member |
| TC-08 | Region A coordinator accesses region B case | Denied; map/list do not disclose the object |
| TC-09 | Reject without reason | Validation error; state/history unchanged |
| TC-10 | Duplicate designation without canonical request | Do not persist DUPLICATE |
| TC-11 | SUBMITTED directly to CLOSED | Conflict/validation error; state/audit unchanged |
| TC-12 | Assign inactive/unavailable team | Rejected; request not dispatched |
| TC-13 | Two coordinators assign the same request/version | One succeeds; the other conflicts and reloads |
| TC-14 | One of two missions completes | Mission completes; request does not automatically resolve/close |
| TC-15 | Issue more than available | Rollback; no movement; unchanged on_hand/reserved |
| TC-16 | Concurrent issues against the same available stock | Locks/constraints prevent total issue exceeding stock |
| TC-17 | Retry transfer receipt with same key | Destination stock credited once |
| TC-18 | Cancel an unissued commitment | Reserved quantity is released; on_hand is unchanged; need remains outstanding |
| TC-19 | Cancel a commitment after ISSUE | Reject direct cancellation; require delivery, verified return, or audited loss |
| TC-20 | Response transaction rolls back after request creation | No request or partial audit/timeline rows |
| TC-21 | Retry the same notification-triggering command | One transition and one notice per recipient for that transition |
| TC-22 | Identity or Logistics API is temporarily unavailable | Caller gets a Vietnamese retryable error; no false success or duplicate side effect after retry |
| TC-23 | One dashboard source API lags/fails | UI shows its generated_at or marks that panel stale/unavailable; other source data remains labeled correctly |
| TC-24 | Forged MIME, prohibited type, oversized upload | Reject; clean orphaned object; no download link |
| TC-25 | Repeated offline SOS retries after reconnect | Pending becomes submitted only after ACK; exactly one request |
| TC-26 | AI suggests lower urgency for coordinator-assigned P1 | No automatic downgrade/deletion; separate suggestion and audited override |
| TC-27 | AI timeout | Manual triage works; no SOS/verification/dispatch blocking |
| TC-28 | Refresh after role revocation | Refresh denied; existing access is rejected on the next protected request via Identity introspection |
| TC-29 | Restore demo backup | Requests, ledger, file metadata consistent; runbook identifies object files to restore |
| TC-30 | Attach request after campaign closure | Response rejects new attachment; scoped historical request/ledger access remains |
| TC-31 | Partially fulfill a request from multiple warehouses | Need remains partially fulfilled until delivered quantity meets the current requested quantity; each contribution reconciles to stock ledger |

### 13.3 Traceability: UR → FR → UC → Test

| UR | Main FR | Use case | Test case |
|---|---|---|---|
| UR-01 | FR-REQ-01..03, FR-FILE-01, FR-OFF-01 | UC-01 | TC-01..05, TC-24..25, TC-BE-24, TC-BE-27 |
| UR-02 | FR-REQ-04, FR-REQ-07, FR-NOT-01 | UC-01, UC-02 | TC-06, TC-09..11, TC-22 |
| UR-03 | FR-REQ-04..06, FR-REQ-09, FR-REQ-10, FR-MSN-01..03, FR-LOG-03 | UC-02, UC-03, UC-04 | TC-06, TC-08..14, TC-31, TC-BE-17..18, TC-BE-25 |
| UR-04 | FR-MSN-01..04 | UC-03 | TC-07, TC-14, TC-24, TC-BE-04, TC-BE-10 |
| UR-05 | FR-CAM-01, FR-LOG-01..05 | UC-04, UC-08, UC-09 | TC-15..19, TC-30..31, TC-BE-19/21/23 |
| UR-06 | FR-IAM-01..03, FR-RPT-01..02, FR-AUD-01 | UC-05, UC-06 | TC-06..08, TC-23, TC-28, TC-BE-01, TC-BE-20, TC-BE-29 |
| UR-07 | FR-LOG-05, NFR-OBS-01, NFR-OPS-01 | UC-01..05 | TC-20..23, TC-29, TC-31 |
| UR-08 | FR-DON-01..06, FR-REC-01 | UC-10, UC-11, UC-12 | TC-DON-01..08, TC-REC-01 |
| UR-09 | FR-DON-01/03/04/06, FR-REC-01..02 | UC-10, UC-12, UC-14 | TC-DON-03..09, TC-REC-01..03 |
| UR-10 | FR-LOG-06..07, FR-DON-06, FR-REC-01 | UC-13 | TC-DIST-01..04, TC-REC-01 |

Supplementary traceability for quality and optional requirements:

| Requirement | Test case |
|---|---|
| NFR-SEC-01 | TC-BE-24, TC-BE-20, TC-DON-02/07 |
| NFR-SEC-02 | TC-06, TC-08, TC-BE-12 |
| NFR-SEC-03, NFR-SEC-04 | TC-BE-27, TC-BE-29 |
| NFR-PRV-01 | TC-08, TC-BE-12 |
| NFR-REL-01 | TC-BE-17/18, TC-BE-28 |
| NFR-PERF-01/02 | TC-PERF-01 |
| NFR-OBS-01, NFR-OPS-01 | TC-BE-14, TC-29 |
| NFR-UX-01, NFR-OFF-01 | Usability check (Section 13.1), TC-25 |
| NFR-L10N-01 | TC-L10N-01..03 and the Vietnamese checks of Section 25.11 |
| NFR-TEST-01 | Section 13.1 strategy and the TC-BE series |
| FR-REQ-08 | TC-BE-16 |
| FR-AI-01..06 | TC-26, TC-27, TC-AI-01..22 |
| FR-AI-07 | TC-AI-DON-01..03 |

### 13.4 Additional language and storage checks

The storage checks in Section 6.3 extend FR-FILE-01, TC-24, and TC-29, including private-policy enforcement, reachable signed links, storage-outage handling, and object-byte restoration. They are planned checks, not completed tests.

| Test ID | Requirement | Scenario | Expected result |
|---|---|---|---|
| TC-L10N-01 | NFR-L10N-01 | Exercise success, validation, login failure, denied scope, stale update, throttling, and upload failure, including English Accept-Language | Human-readable API text remains Vietnamese; stable codes and status semantics remain intact; no raw provider errors |
| TC-L10N-02 | NFR-L10N-01 | Walk through Web/Mobile forms, states, accessibility labels, notifications, and report/export headings | Vietnamese copy with proper Unicode; machine enums displayed as Vietnamese labels; original user content preserved |
| TC-L10N-03 | NFR-L10N-01, FR-AI-01 | Display rule explanation, optional model summary, abstention, and background notification | Vietnamese text or a reviewed Vietnamese fallback; no untranslated template/code exposed as user copy |

## 14. Security, privacy, and operations

- Default deny. Public routes are limited to those listed in NFR-SEC-01: registration/login/refresh, guest SOS creation/evidence/tracking, and the Section 25 sanitized drive listing plus capability-based guest donation routes. Guest SOS abuse controls: Nginx and application throttling per IP and per contact phone, strict DTO/size limits, idempotency key required, the tracking secret is a client-generated random value of at least 128 bits (the plan uses 32 bytes), stored only as a purpose-bound hash, never returned or logged and compared in constant time, and guest uploads use the same media limits with a lower per-IP quota. Spam is contained by the verification gate: nothing unverified is triaged, dispatched or counted in operational reports. Add a captcha only if abuse is observed.
- **Never-drop throttling for SOS:** disaster conditions put many legitimate reporters behind one carrier-grade NAT or shelter Wi-Fi IP, and an attacker could submit with a victim's phone number to lock that number out. Therefore a per-IP or per-phone *soft* threshold never rejects a plausible SOS: the report is stored, tagged `RATE_LIMITED_REVIEW` and shown in a separate coordinator review lane (so spam cannot bury real reports, and declared-danger badges still show). Only a high *hard* ceiling (demo default ten times the soft threshold, per IP only) returns a Vietnamese 429 that tells the person to call 113/114/115 and retry. A phone number is never used as a lock-out key. Guest uploads and donation routes may reject at their quota because they are not the life-safety path.
- **Web hardening (NFR-SEC-04):** serve a strict Content-Security-Policy (`default-src 'self'`, no inline script, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on authenticated and tracking responses. Render all user-entered text (descriptions, names, notes, donor declarations) as escaped text; never use raw-HTML rendering for it. Tracking and donation secrets travel only in an authorization header, never in a URL or Referer. Run a dependency vulnerability audit before the demo and record the result.
- Authorization combines role, scope, and object relationship across details, lists, exports, file downloads, and push-device registration.
- Hidden frontend menus do not provide security. OWASP identifies Broken Object Level Authorization as a major API risk. [OWASP API Security Top 10 — BOLA](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)
- Audit enough to trace actions without copying unnecessary PII; restrict readers and clarify retention.
- Decide location visibility, location/photo/audit retention, deletion requests, backups, and provider data exposure. IASC/ICRC guidance is reference material; use synthetic demo data. [IASC guidance](https://emergency.unhcr.org/sites/default/files/2023-11/IASC%20Operational%20Guidance%20on%20Data%20Responsibility%20in%20Humanitarian%20Action%2C%202023.pdf), [ICRC handbook](https://www.icrc.org/en/publication/430501-handbook-data-protection-humanitarian-action-second-edition)
- Single-host Compose is not high availability. Provide healthchecks, restart policies, volumes, example environment configuration, migration/seed commands, backup/restore runbook, and log rotation.
- Optional Prometheus/Grafana: API latency/errors, database connections/disk, object storage, and (only if AI worker is enabled) job age/failures. Always provide health endpoints, structured logs, and correlation IDs.

## 15. Deployment baseline

### Baseline: Docker Compose

```text
Browser / Mobile
    -> Nginx (one demo host)
    -> Identity, Response, Logistics (3 application services)
    -> PostgreSQL/PostGIS (separate database/user per service)
    -> MinIO AIStor Free S3 API (single-node lab)
    -> Prometheus/Grafana (optional profile)
```

- Provide development/test Compose configuration, healthchecks, volumes, .env.example, migrations, demo seed commands, and backup/restore procedures.
- Do not commit .env files/secrets; create demo accounts/passwords through local seeding.
- Nginx handles baseline routing/rate limits; services still authenticate and authorize.
- Disable optional metrics dashboards if RAM is constrained. Keep the Response job worker in the same application/service boundary; run a second worker process only if the optional job queue is enabled.

## 16. Backend implementation sequence

The backend owner's stated target is two to three weeks of focused backend work. The user confirmed on 2026-10-01 that the available time is sufficient for Slices 1–5 of the original scope and authorized resolving the architecture-review decisions. **That confirmation predates the Section 25 donation extension (2026-10-04) and must be re-confirmed:** two to three weeks does not cover Slices 5–6 as Must scope, so the integrated schedule below spreads backend work over project weeks 3–7 and the owner re-estimates after the R-04 spike. Keep three independently deployable services; each slice needs its tests and acceptance evidence. Keep optional features out until the core workflow is stable.

| Order | Complete slice | Exit evidence |
|---|---|---|
| 1 | Workspace, Compose, three service boundaries, migrations, Vietnamese errors, Identity registration/session/scope | Repeatable setup; auth and object-scope checks; each service starts and migrates independently |
| 2 | SOS intake, PostGIS, idempotency, request timeline, scoped verification queue | Retry creates one request; unknown/ambiguous region remains visible to designated intake staff |
| 3 | Verification outcomes, manual priority, duplicate review, team assignment and mission progress | State/permission tests; duplicates require human decision; team workflow completes without a broker |
| 4 | Logistics catalog, warehouses, stock ledger, commitments, partial issue/delivery, transfers and relief points | Inventory constraints and concurrency tests; 12-of-20 demo stays open with 8 outstanding |
| 5 | Section 25 donation core: drives, pledges/declarations with client secret, independent count/review, exactly-once posting, source roots | TC-DON-01..07/09; no double credit; self-review denied; guest lost-response retry creates one record |
| 6 | Section 25 distribution and reconciliation: approved dispatch, custody legs, handouts, source allocations on every stock mutation, reconciliation views, stocktakes | TC-DIST-01..04, TC-DON-08, TC-REC-01..03; 55/50/5/35/15 scenario reconciles |
| 7 | Compose board integration, dashboards/timings, storage, recovery, k6 smoke/load check, documentation and demo | Three API contracts verified together; partial outage labels are truthful; restore and end-to-end evidence recorded |

Implement one end-to-end slice at a time. The project brief describes a three-member team; the user confirmed one person owns backend work, so coordinate interfaces with the other workstreams without splitting backend ownership. No separate Notification, Reporting, AI, or broker service is part of the baseline.

### Integrated weekly schedule (three members)

Weeks refer to the ten-week outline in the project context. B = backend owner, W = Web owner, M = Mobile owner. Each week ends with an integrated demo of that week's slice against the real APIs, not mocks.

| Week | Backend (B) | Web (W) | Mobile (M) | End-of-week output |
|---|---|---|---|---|
| 1–2 | R-04 spike, MinIO terms check, OpenAPI for Slices 1–4, ERD | Wireframes, Vietnamese copy list | SOS flow wireframes, secret/idempotency design | SRS draft, survey/interview evidence started, contracts reviewed |
| 3 | Slice 1 (Identity/sessions/grants) and start Slice 2 | Login, session, scoped shell | SOS form: GPS/manual pin, client secret + key persisted, queue-on-device state | Guest SOS submits end to end; retry returns one request |
| 4 | Finish Slice 2; Slice 3 (verification, contact attempts, duplicates, priority, missions) | Verification queue, map, duplicate review, priority | Tracking by secret; team mission screens | Verify → triage → assign → accept demo |
| 5 | Slice 4 (stock, commitments, board) and seal protocol TC-BE-17/18 | Fulfillment board, warehouse/point screens | Mission progress and evidence upload | 12-of-20 partial fulfillment demo; seal tests run |
| 6 | Slice 5 (donation core) | Drive management, intake count/review screens | Citizen/guest donation declaration and tracking | 100/60/58/55 donation scenario with denied self-review |
| 7 | Slice 6 (distribution, custody, reconciliation, stocktakes); integration fixes | Distribution/receiving/handout and reconciliation views, dashboards | Real-device pass: denied GPS, network loss mid-send, retry, guest tracking | System test run; 55/50/5/35/15 scenario; TC results recorded |
| 8 | Slice 7: k6, backup/restore, documentation | User guide screenshots, report | User guide, device evidence | SDD/test report/installation guide, demo rehearsal |
| 9 | Defense | Defense | Defense | Defense with recorded evidence |
| 10 | Contingency | Contingency | Contingency | Buffer only |

### Scope reduction if the backend estimate slips

Never cut: authentication/scope, SOS with truthful server acknowledgement and idempotency, verification/duplicate decisions, the resolution seal, independent receipt review with exactly-once posting, the append-only stock ledger, and core Vietnamese messages. Cut in this order, and with each cut update the requirement priority, traceability, test cases, demo script and defense claims together so nothing is claimed that was dropped:

1. Real push/email, offline retry queue, CSV export, advanced routing, non-required infrastructure.
2. Optional AI (Section 12 and FR-AI-07).
3. Stocktakes (FR-REC-02, TC-REC-02/03): downgrade to Should and keep reconciliation reports.
4. Pledges (keep direct handover declarations) and earliest-expiry source selection (keep receipt-root source tracing).
5. If the seal still cannot be finished, apply the R-03 feature cut, not a check-then-write substitute.

## 17. Defense demonstration

1. A citizen submits an SOS with GPS/accuracy or manual pin; retry the same key and show one request.
2. A coordinator opens the verification queue, checks a suspected duplicate, records a human decision and reason, sets priority, and assigns a team.
3. A volunteer accepts, progresses EN_ROUTE → ON_SCENE, uploads evidence, and reports completion; mission completion alone does not resolve the request.
4. Logistics records a 20-kit need. Warehouse A delivers 12, leaving the request open with 8 outstanding; warehouse B delivers the remaining 8; the coordinator confirms overall resolution.
5. Show the audit trail, quantities by fulfillment stage, time-to-verify/assign/deliver, and timestamped dashboard panels.
6. Run a small k6 HTTP scenario and report the virtual-user count, duration, p95 latency, error rate, and test hardware.
7. Guest SOS retry after a simulated lost response returns the same request and tracking code; an unreachable reporter stays VERIFYING with logged attempts and an overdue badge until a coordinator decides.
8. Section 25 scenarios: pledge 100, handover 60, count 58, accepted 55/rejected 3 with denied self-review; dispatch 55, point receipt 50, approved loss 5, handout 35, 15 still held; reconciled totals.
9. Optional: coordinator reviews an AI suggestion; the manual workflow still succeeds with the worker disabled.

The demo proves the workflow, authorization, GIS, inventory integrity, and measured API behavior. It does not claim nationwide capacity or automatic dispatch.

## 18. Deliverable documentation

| Document | Minimum contents |
|---|---|
| SRS | Scope, actors, glossary, assumptions, identified UR/FR/NFR with acceptance criteria, use cases, business rules, states, traceability, open decisions |
| SDD | Context/container/component views, three-service ownership, ERD, auth/RBAC, API/OpenAPI, fulfillment workflow, sequence/deployment, security/privacy, tradeoffs |
| Test plan/cases | IDs, requirement links, preconditions, data, steps, expected results; unit/API/integration/security/E2E/NFR; actual results and defects |
| Installation guide | Prerequisites, environment, Compose profiles, migrations/seeds, demo accounts, backup/restore, troubleshooting, shutdown |
| User guide | Citizen, volunteer, coordinator, manager/admin flows; GPS/offline states; screenshots/video |
| Demo/report | Synthetic data, script, diagrams, technical decisions, limitations, k6 measurements, and test evidence; optional AI extension |

**Evidence to collect before the defense** (record what was actually done; do not describe planned items as done):

- Requirement traceability matrix: project brief requirement → UR/FR → screen/API → test case → demo evidence.
- Business validation: who was surveyed or interviewed (role, number, date), the questions, the results and the design decisions that followed; if no domain contact was reachable, state that limitation explicitly (R-07).
- Real-device mobile tests: denied GPS, network lost mid-send, retry after lost response, guest tracking by secret.
- Authorization, concurrent update, service-failure (Identity and Logistics stopped) and backup/restore results with commit and date.
- SOS usability check: number of steps, completion time, user errors and whether testers understood the received/not-received state, with sample size.
- k6 report with hardware, build and workload; the 20-VU run is a demo workload and is not a user-capacity claim.
- AI/rules research note: problem, options, data, evaluation method and the reason the advisor is integrated or not; if only fixed rules are used, call it a rule-based decision-support set and claim no real-world accuracy.

## 19. Risks and open decisions

| Decision | Proposed default | Decision deadline |
|---|---|---|
| Mandatory login or guest SOS? | Guest SOS enabled (decided 2026-10-01): no account needed in an emergency; client-generated tracking secret for guests; optional account for history and claiming; rate limits and the verification gate control abuse | Settled for demo |
| Priority, SLA, who verifies/closes/reopens? | Draft P1–P4; coordinator with reasons; no implicit SLA | Before policy is represented as approved |
| Coordinator scope/team availability? | Current grants + object relationships; one-team missions, capacity one, leader actions in Section 22 | Settled for demo |
| Map/tile/geocoding provider, license, quota? | MapLibre-style client map behind a thin adapter; tile source whose terms permit demo and load-test use (public OpenStreetMap tile servers are not used for k6 or heavy testing); no geocoding in the MVP beyond manual pin; no incident PII sent to providers | Before Web/Mobile map integration (must be settled before the coordinator map slice) |
| Push/email? | In-app notices are the authoritative record (core). Expo push for mission offers and status changes is a Should (FR-NOT-02) via a local outbox; a mock sender runs without credentials; email/SMS stay out of scope | Before client integration |
| Offline depth? | Honest pending/draft behavior; retry queue is Should | Before client contract freeze |
| File types/sizes/retention? | Section 23.5 fixes demo media limits and signed-link TTL; real-data retention remains separate | Limits settled for demo; retention before pilot |
| Location/photo/audit/backup retention? | No invented official policy; confirm before a pilot | Before real deployment |
| Load targets/demo hardware? | Section 23.6 adopts the workload and numeric demo thresholds; record actual host details and measured results | Hardware at setup; results before performance acceptance |
| Storage edition/provider and license? | MinIO AIStor Free single-node lab selected; team members obtain it under current terms; validate private access and restore before demo | Before storage integration |
| Labeled AI data? | Do not assume availability; explainable rules suffice for PoC; AI disabled by default | Before optional evaluation |
| Partial-fulfillment policy | Demo uses coordinator-created needs and confirmed delivery; validate real workflow with domain reviewer | Before claiming operational policy |
| Kafka/event broker? | Not in baseline; revisit only if the criteria in Section 4.4 are demonstrated | Only after measured need |

## 20. Design conclusion

The proposed baseline is **NestJS/TypeScript + TypeORM + PostgreSQL/PostGIS + React/Vite + React Native/Expo**, with three services: Identity, Response, and Logistics. REST handles immediate operations; each service owns its database and reports; Logistics links partial aid commitments to opaque request IDs. Compose runs the demo on one host. Kafka, standalone Notification/Reporting services, and distributed stock-reservation sagas are deferred. MinIO AIStor Free is the selected single-node lab object store. AI is optional and provides coordinator-reviewed suggestions only.

This baseline and Section 22 support incremental backend implementation. The workflow additions are proposals inspired by humanitarian platforms and peer-project patterns; they are not official emergency-response policy. Each slice still requires reviewed API/data contracts and executed acceptance evidence before it is called complete.

## 21. References

### Business context and data

- [OCHA — Humanitarian Programme Cycle](https://knowledge.base.unocha.org/wiki/spaces/hpc/overview)
- [IFRC — Emergency Response Framework](https://www.ifrc.org/document/ifrc-emergency-response-framework)
- [IASC — Data Responsibility in Humanitarian Action](https://emergency.unhcr.org/sites/default/files/2023-11/IASC%20Operational%20Guidance%20on%20Data%20Responsibility%20in%20Humanitarian%20Action%2C%202023.pdf)
- [ICRC — Handbook on Data Protection in Humanitarian Action](https://www.icrc.org/en/publication/430501-handbook-data-protection-humanitarian-action-second-edition)

### Backend, database, API, security

- [Spring Boot documentation](https://docs.spring.io/spring-boot/index.html)
- [NestJS documentation](https://docs.nestjs.com/)
- [NestJS database integrations](https://docs.nestjs.com/techniques/database)
- [NestJS validation](https://docs.nestjs.com/techniques/validation)
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [NestJS authentication](https://docs.nestjs.com/techniques/authentication)
- [NestJS file upload](https://docs.nestjs.com/techniques/file-upload)
- [NestJS testing](https://docs.nestjs.com/fundamentals/testing)
- [TypeORM PostgreSQL driver and spatial columns](https://typeorm.io/docs/drivers/postgres/)
- [TypeORM transactions](https://typeorm.io/docs/advanced-topics/transactions/)
- [Django overview (framework comparison only)](https://docs.djangoproject.com/en/5.2/intro/overview/)
- [FastAPI features](https://fastapi.tiangolo.com/features/)
- [Flask design decisions](https://flask.palletsprojects.com/en/stable/design/)
- [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)
- [PostgreSQL transactions](https://www.postgresql.org/docs/18/tutorial-transactions.html)
- [PostGIS spatial indexes](https://postgis.net/documentation/faq/spatial-indexes/)
- [RFC 7946 — GeoJSON](https://datatracker.ietf.org/doc/html/rfc7946)
- [OWASP API Security Top 10 — BOLA](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)
- [MongoDB geospatial indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/geospatial/2dsphere/)
- [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [MySQL InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-introduction.html)

### Messaging, storage, frontend, deployment

- [Apache Kafka event-streaming documentation](https://kafka.apache.org/documentation/)
- [Grafana k6 HTTP requests](https://grafana.com/docs/k6/latest/using-k6/http-requests/)
- [Grafana k6 virtual users and test execution](https://grafana.com/docs/k6/latest/get-started/running-k6/)
- [Sahana ShaRe request and partial-commitment use cases](https://eden-legacy.sahanafoundation.org/wiki/BluePrint/ShaRe/UseCases)
- [Sahana logistics modules](https://eden-legacy.sahanafoundation.org/wiki/DeveloperGuidelines/Logistics)
- [Ushahidi incoming-data review and moderation](https://docs.ushahidi.com/platform-user-manual/6.-managing-data-in-your-deployment)
- [Ushahidi saved searches](https://docs.ushahidi.com/platform-user-manual/7.-analysing-data-on-your-deployment/7.1-saved-searches)
- [MinIO Community repository status](https://github.com/minio/minio)
- [MinIO AIStor Free agreement](https://www.min.io/legal/aistor-free-agreement)
- [MinIO AIStor license operations and feature limits](https://docs.min.io/aistor/operations/licenses/)
- [AWS SDK for JavaScript v3 S3 client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/)
- [Amazon S3 presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [React — build an app from scratch](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite guide](https://vite.dev/guide/)
- [React Native TypeScript](https://reactnative.dev/docs/typescript)
- [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)
- [Docker Compose production](https://docs.docker.com/compose/how-tos/production/)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
- [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### Research notes

- Initial research was conducted on 2026-09-29; the NestJS framework comparison and MinIO AIStor Free decision were checked against linked primary sources on 2026-09-30. Versions, support schedules, APIs, license terms, and project status can change. Recheck release compatibility and current AIStor terms before implementation.
- NestJS/TypeScript was selected after a qualitative comparison with Spring Boot, Django/DRF, FastAPI, and Flask. This was not a performance benchmark; team familiarity should be confirmed during setup.
- MinIO AIStor Free single-node is the one selected capstone storage option. MinIO Community is not selected. Current terms, artifact/license validity, S3 compatibility, private policy behavior, and restoration still need to be checked during setup; none have been tested by this research.
- The workflow adaptation report reviews Ushahidi, Sahana Eden, and KoboToolbox; the separate CNTT workbook scan is summarized in that note and should be read as project descriptions, not implementation verification.
- Section 22 records the current three-service and partial-fulfillment decisions, including guest-capable SOS intake. Quantitative NFRs, official priority rules, retention, external providers, and operational AI use still need the relevant confirmation.

## 22. Solo backend implementation baseline

**Decision date: 2026-09-30. Authority: the backend owner authorized correction of the plan.** These are implementation decisions for the synthetic capstone demo, not policies approved by a rescue authority. Preserve the assigned functional scope and use three core services. This revision supersedes earlier five-service, Kafka, and reservation-saga proposals throughout this document.

### 22.1 Repository structure and clean-code rules

```text
backend/
  apps/
    identity/src/
    response/src/
    logistics/src/
  packages/
    contracts/src/          # only if a contract is shared by two services
    technical/src/          # proven technical helpers only, e.g. purpose-bound secret hashing, error envelope, idempotency utilities; no business rules or messages
  infra/                   # Compose, Nginx, database initialization
  scripts/                 # migration, seed, backup/restore commands
  test/                    # cross-service integration and k6 scripts (per-app unit tests stay beside their app)
```

Each app owns `main.ts`, `app.module.ts`, `config/`, `database/data-source.ts`, `database/migrations/`, and `modules/<business-module>/`. A business module uses `<name>.module.ts`, `<name>.controller.ts` when it has HTTP routes, `<name>.service.ts`, `dto/`, and `entities/` as needed. Keep modules small and named for business capabilities so no single module becomes a catch-all: for example Response `requests`, `verification`, `missions`, `campaigns`, `advisor`; Logistics `stock`, `needs`, `commitments`, `transfers`, `distributions`, `donations`, `receipts`, `reconciliation`, `stocktakes`; Identity `auth`, `sessions`, `grants`. Per-service Vietnamese message catalogs live in the owning app; the shared technical helpers take a purpose string (for example `sos-tracking`, `donation-capability`) so one service's secrets can never validate in another. The optional AI job worker stays inside Response. Each service has its own environment validation, image, migration command, database credentials, and health/readiness routes. Create only directories used by the current slice. Use one package manager/workspace and pin versions after a primary-source compatibility check; this document selects no exact runtime releases.

- Controllers parse validated DTOs, invoke use cases, and map responses; they contain no SQL or business state transitions. Services own business guards, transaction boundaries, and authorization of actions/objects. List/map queries apply scope before pagination or aggregation.
- Use TypeORM repositories/QueryBuilder and the transaction's EntityManager directly. Add a dedicated query/persistence component only when real complexity warrants it; no generic base repository, one-implementation interface, or pass-through layer.
- Never return entities directly as public response contracts. Explicit DTO mapping avoids credentials/internal fields leaking and keeps OpenAPI stable.
- Keep entities/migrations/domain rules in their owner app. Share transport schemas and proven technical code only; no shared business services or database connection module. Do not build a platform package ahead of actual reuse.
- Enable TypeScript strict checks, ESLint and formatting. Avoid untyped `any`, swallowed errors, magic status strings, circular module dependencies, and runtime schema synchronization. Use named enums/types, bounded DTO validation, parameterized SQL, DB constraints, and reviewed migrations.
- Centralize Vietnamese exception/validation copy and stable error codes, including 404, 413, 429, auth, provider, and worker paths. Log technical codes/correlation IDs without passwords, tokens, signed links, or unnecessary PII.
- Every nontrivial slice includes meaningful automated checks for its invariants. PostgreSQL/PostGIS and API integration checks cover actual concurrency and service-boundary behavior; mocks do not establish those guarantees. Run the relevant checks before recording completion.

### 22.2 Identity, scope, and request decisions

| Area | Capstone implementation decision |
|---|---|
| Citizen onboarding | Public rate-limited registration grants CITIZEN only. Unique normalized username; passwords are hashed with an appropriate maintained implementation selected at setup. Account/password errors do not disclose credential existence. Staff/volunteer roles are admin-granted. Registration is optional for SOS (guest SOS enabled; see NFR-SEC-01 and Section 14). Idempotency for guest SOS is scoped by the client-generated key (random UUID) plus payload hash; a guest can claim a request by presenting its tracking secret while signed in, which sets reporter_user_id once and audits it. **SOS tracking secret protocol:** before the first submission the guest client generates a cryptographically random 32-byte secret and a separate idempotency key and stores both (Web session storage/memory with an explicit private-code download; Mobile SecureStore) before sending. Response validates format/length, stores only a purpose-bound hash (distinct from the donation-secret purpose), and scopes idempotent replay to key + payload hash + secret hash. The same triple returns the original request ID and tracking code, so a lost response never loses access or duplicates a request; the same key with a different payload or secret returns 409; a secret hash already bound to another request returns a generic 409 without revealing it. The tracking code is an identifier, not a credential. If the secret is lost, a scoped coordinator who reached the reporter on the request's contact phone may revoke and re-bind a new secret with audit; phone number alone never grants tracking access, and failed recovery reveals nothing. |
| Scope | Each grant binds a role/action set to one scope: organization, region, campaign or explicitly granted system scope. Alternative matching grants are OR; inside an organization/region/campaign match, the action, owning organization and selected scope must all match (AND). System scope is an explicit cross-organization exception for its named actions only, never implicit in ADMIN. Region/campaign grants carry their parent organization; geographic overlap alone never crosses organization boundaries. Owner/team relationships are separate explicit permissions, not inferred staff grants. Admin account management does not imply access to victim details. Exact GPS is limited to the reporter, authorized coordinators and assigned teams. |
| Revocation | JWT checks include approved algorithm, issuer, audience, expiry and session ID. Identity introspection is authenticated as a service and checks active account/session/current grants. No positive auth cache in demo. Identity outage fails closed with Vietnamese 503. This trades availability for simple request-boundary revocation. |
| Request intake | campaign_id is nullable. Backend configuration assigns the synthetic demo intake organization; citizens cannot set organization or staff scope. Identity owns controlled region codes; Response owns seeded region boundary geometry and derives region from the location. Unknown/ambiguous boundary results keep region null and enter an explicit unassigned queue. Only coordinators with organization-wide intake permission or explicit system intake grants can view/correct that queue; campaign-only grants cannot. No match must not reject SOS or silently hide it from all intake operators. Region correction is versioned/audited. Only authorized coordinators attach/reassign requests to ACTIVE campaigns with compatible organization/operating region. |
| Priority | P1–P4 labels remain the draft taxonomy in Section 8.1. Human coordinator selects priority/reason after verification. No SLA is implied and no automatic queue ranking/dispatch is derived from these labels. |
| Supplements | Reporter may add information in SUBMITTED/VERIFYING/VERIFIED/TRIAGED/DISPATCHED/IN_PROGRESS. Preserve earlier facts as history. Terminal requests reject supplements; coordinate reopen separately. |
| Cancellation/resolution | Scoped coordinator may cancel a request in SUBMITTED through IN_PROGRESS (not RESOLVING or RESOLVED, see Section 8.1) with reason, subject to the canonical-reference guard below. First freeze the Logistics cycle through the durable cancellation intent in Section 23.2. In a Response transaction, commit cancellation, cancel nonterminal missions and release team capacity; keep completed evidence. Then explicitly settle linked Logistics needs: cancel unissued commitments, and preserve issued goods for delivery/return/loss accounting. Before RESOLVED, Response obtains an idempotent Logistics resolution seal for the current work cycle under the protocol in Section 23.2. An unavailable API, open/partial need, or unsettled issued quantity blocks sealing and resolution. Record the immutable seal ID/version with the human confirmation. The seal prevents concurrent or later need changes in that cycle; reopening creates a new cycle. CLOSED follows RESOLVED. CLOSED reopens to TRIAGED with reason; old terminal missions remain historical. |
| Duplicate/rejection | Outcomes branch only from VERIFYING. Duplicate target must be authorized and cannot be self, DUPLICATE, REJECTED or CANCELLED. Lock source/target request rows in sorted ID order before checking state and inbound links. A canonical request with inbound duplicate links cannot become DUPLICATE, REJECTED or CANCELLED; every linker/rejection/cancellation uses the same locks and recheck. No duplicate chains/cycles or automatic link reparenting. Terminal REJECTED/DUPLICATE/CANCELLED records are historical; a new report is created for renewed need. |
| Campaign pause/close | PAUSED blocks new attachments, mission creation/offers and acceptance of existing offers. Coordinators may cancel offered missions; accepted missions may finish. New campaign-linked needs/commitments are blocked while paused; already-issued goods can still be delivered, returned, or settled. Resume is PAUSED → ACTIVE. Close requires all attached requests terminal (CLOSED/REJECTED/DUPLICATE/CANCELLED). Preserve all fulfillment and stock history after closure. |

Use a request work-cycle counter incremented on reopen; tag each new mission and Logistics need with that cycle. Historical missions/needs cannot resolve a reopened request. For request dispatch progress, recompute under a Response request-row lock after each mission transition. Accepted/travelling/on-scene work takes precedence over offers; offers take precedence over returning to TRIAGED. No mission transition changes a human terminal outcome or automatically marks RESOLVED. A request stays TRIAGED/IN_PROGRESS until a coordinator begins the guarded RESOLVING workflow. If the cycle has missions, resolution requires at least one completed mission with current-cycle evidence and no active missions; if no rescue mission was assigned, the coordinator records that it was not required. In both cases, obtain the current-cycle Logistics resolution seal before resolution as defined in Section 23.2.

For commands touching campaigns and requests in Response, acquire campaign rows first in sorted ID order, then request rows, team rows, and mission rows in stable order. Reopening a request attached to a CLOSED campaign requires authorized attachment to an ACTIVE compatible campaign or audited detachment first. Duplicate decisions lock affected request rows in sorted order; do not add unrelated Logistics rows to the same transaction.

### 22.3 Team, fulfillment, and stock decisions

- One mission belongs to one request/work cycle and exactly one team. Only an active team leader accepts/declines, advances, and submits results; scoped coordinators can assign or cancel with reason. Team members can view their team's work; solo volunteers use a one-member team.
- Demo teams have capacity one active mission. OFFERED, ACCEPTED, EN_ROUTE, and ON_SCENE reserve capacity; terminal transitions release it. Recheck membership, required skills, organization/operating-region compatibility, and availability in the same Response transaction as the offer. No automatic offer expiry or auto-reassignment; expose offer age, and show an overdue badge plus an in-app notice to the offering coordinator and organization manager when an OFFERED mission is older than a configurable demo threshold (default 10 minutes) so an unanswered offer cannot silently stall a request in DISPATCHED. The coordinator cancels it and creates a new mission manually.
- Logistics owns ReliefNeed, Commitment, stock, transfer, and distribution records. A need references `request_id` and `work_cycle` without a cross-database foreign key. Validate request/scope through the Response API before creating a linked need; make the API call before opening a Logistics transaction.
- A need has item, unit, requested quantity, state, and version. A commitment has an immutable need/warehouse/quantity reference and quantity-derived summaries PROPOSED/COMMITTED/ISSUED/DELIVERED/SETTLED/CANCELLED, with partial quantities and guards defined in Section 23.4. Lock the need row before creating or changing commitments; `delivered + committed/reserved + issued-but-not-delivered` cannot exceed the requested quantity. Keep each organization's/warehouse's contribution separately attributable.
- Derive committed/reserved, issued, delivered, and outstanding totals from single-item commitments, settlement records, and stock movements. For a non-CANCELLED need `outstanding = requested_effective - delivered`; a CANCELLED need has outstanding 0 and reports `cancelled_remaining` instead, so backlog, dashboards and request-resolution checks never count cancelled demand as still owed. A partial delivery never marks the need complete. Reports show original requested, reduction/cancelled quantity, active requested, delivered and active outstanding as separate columns and never add `cancelled_remaining` to active outstanding. An authorized coordinator may reduce or cancel a need with a reason under the protected-quantity and physical-settlement guards in Section 23.4. Do not delete prior commitments or stock movements.
- ISSUE reduces on_hand and reserved exactly once. Distribution/delivery references issued commitment quantities and never decrements warehouse stock again. Delivered + returned + recorded loss cannot exceed issued quantity. Transfers separately reconcile dispatched = received + returned + lost + remaining_in_transit; a dispatched transfer cannot be cancelled as if stock were still at the source.
- Stock quantities use fixed-precision database decimals with item unit/scale validation and decimal strings in API contracts. Reject negative/zero command quantities and incompatible units. Lock multiple item balances in stable ID order; enforce `on_hand >= 0`, `reserved >= 0`, and `reserved <= on_hand`.
- No cross-service atomicity is claimed. If Response is unavailable, Logistics cannot create a new request-linked need; if Logistics is unavailable, the SOS/mission remains in Response and the board reports Logistics unavailable. A retry uses the same idempotency key. Cancelling first freezes its Logistics cycle; closing/resolving requires its resolution seal. Explicit Logistics settlement handles linked cancelled needs; issued items retain their physical ledger history.
- For campaign-linked commands, validate current campaign eligibility through an authenticated Response API before the local Logistics transaction. Do not hold stock locks during that call. A pause/close racing the check may be observed on the next command; the board must show the authoritative status and coordinators must settle already issued goods. This is a documented demo boundary, not a claim of distributed atomicity.

### 22.4 API and reliability contracts

Before coding each slice, review its OpenAPI contract: exact `/api/v1` paths, DTOs, success/status codes, error codes and Vietnamese messages, filters/limits, actor/scope matrix, expected_version, and idempotency examples. Include only CRUD/actions used by the clients for accounts, campaigns, request incident categories, teams/profiles, requests/missions, warehouses/items, vehicles/relief points, stock, commitments, notifications, and reports. Endpoint sketches in Section 10 are not substitutes for these artifacts.

- Persist idempotency records under a unique actor/service/command/key scope in the business transaction. Store the canonical validated-payload hash and original response; an identical retry returns the original result and a changed payload returns 409. Use database uniqueness/version checks for concurrent retries, not in-memory maps.
- Set `lock_timeout` and `statement_timeout` on each service's database role (demo defaults 3 s and 8 s, tuned in the setup spike) and size each service's connection pool so the sum across three services plus migrations stays below PostgreSQL `max_connections` with headroom. A lock or statement timeout rolls the transaction back and returns a stable retryable code with a Vietnamese message; commands are safe to retry under their idempotency key. Never open a transaction before an outbound call or an upload.
- Cross-service REST calls use service credentials, bounded timeouts, stable error codes, and no open database transaction. Retry only idempotent commands with the same key. A service outage is reported as unavailable; do not fabricate success or silently duplicate a command.
- Write in-app notices with the owning business change in the same local transaction. Uniqueness includes source record, source version, recipient, and notice type so a command retry cannot create duplicate notices. Push/email stay optional and require provider-specific retry/idempotency decisions.
- Reporting reads each service's own data and includes `generated_at`. A composed dashboard shows source timestamps and partial unavailability; it does not treat a cross-service view as a globally atomic snapshot.
- Optional AI jobs are durable Response rows claimed with a bounded lease and claim token. Unique job/result constraints prevent two workers from committing competing results; provider calls run outside database transactions.

### 22.5 Solo backend sequence and acceptance gates

| Order | Complete slice | Exit evidence |
|---|---|---|
| 1 | Workspace, Compose, three apps, migrations, errors, Identity registration/sessions/grants | Repeatable setup; auth/scope/revocation and Vietnamese-message checks |
| 2 | SOS, controlled regions, PostGIS, idempotency, own timeline, verification queue | TC-01..14, TC-BE-01..04/11/12/24/25; scoped map/list; human-reviewed duplicate and priority decisions |
| 3 | Logistics catalog/stock/commitments, request board, partial delivery, campaign/relief-point links | TC-15..19/31, TC-BE-05/06/09/10/13/15; no over-issue; partial fulfillment and API error behavior |
| 4 | Section 25 donation core, distribution/custody and reconciliation (see Section 16 slices 5–6 and its cut order) | TC-DON-01..09, TC-DIST-01..04, TC-REC-01..03; independent review, single posting, conservation equations |
| 5 | UI/API integration, dashboards, file storage, recovery, k6 run, documentation/demo | TC-20..30, TC-BE-07/08/14/16, TC-L10N; truthful source timestamps, private files, backup restore, end-to-end evidence |

File metadata/contracts start with SOS/missions; do not claim evidence-upload requirements complete before storage acceptance. Each slice updates traceability, API examples, migrations, seed data, and actual command/results. The partial-fulfillment demo and authorization/inventory invariants are core; AI, CSV export, push/email, and full offline queue remain optional. Do not add another runtime, broker, or service without evidence.

### 22.6 Additional acceptance cases for corrected decisions

These planned cases extend existing IDs without renumbering them. They are not executed tests.

| ID | Linked requirements | Required assertions |
|---|---|---|
| TC-BE-01 | FR-IAM-01..03 | Registration cannot grant staff privileges; refresh reuse revokes the session family; logout/disable/reset/role change rejects the next protected call; Identity outage gives Vietnamese 503 |
| TC-BE-02 | FR-REQ-01, FR-CAM-01 | SOS succeeds without campaign; out-of-scope/inactive attachment fails; pause/resume/close guards and historical settlements are consistent |
| TC-BE-03 | FR-REQ-04, FR-MSN-03 | Verification outcomes are exclusive; self/chain/cycle duplicate links fail; accepted work survives sibling decline; offered-only fallback and human resolution behave correctly |
| TC-BE-04 | FR-MSN-01..03 | Two offers to a capacity-one team yield one winner; an offer older than the demo threshold shows the overdue badge and notice without auto-reassignment; unauthorized member cannot accept; terminal transition releases capacity; reopened cycle excludes old outcome evidence |
| TC-BE-05 | FR-LOG-02..05 | Concurrent commitments to one need cannot exceed requested quantity; partial delivery leaves the correct outstanding amount; repeated commands do not double reserve or issue |
| TC-BE-06 | FR-LOG-02..04 | Transfer receipt/return/loss reconciles transit; in-transit cancellation fails; distribution of issued goods does not decrement stock again; over-settlement and repeated commands fail safely |
| TC-BE-07 | FR-LOG-03, FR-RPT-01 | Response or Logistics API outage is visible; resolution fails closed if Logistics cannot confirm no open need; retrying a command with the same key creates no duplicate side effect |
| TC-BE-08 | FR-NOT-01, NFR-L10N-01 | Notice is visible only to its recipient and created once per source version; HTTP and worker-facing messages shown to users remain Vietnamese |
| TC-BE-09 | FR-LOG-03, FR-LOG-05 | Cancelling an unissued commitment releases stock but preserves requested quantity; issued goods require delivery/return/loss settlement |
| TC-BE-10 | FR-MSN-02, FR-LOG-05 | Mission status changes do not fabricate stock delivery; request cannot be resolved from mission completion alone |
| TC-BE-11 | FR-REQ-04 | B links to A; attempting A → C duplicate, rejection or cancellation conflicts. Concurrent B → A and A → C cannot create a chain/cycle or an invalid canonical target |
| TC-BE-12 | FR-IAM-02, FR-REQ-01/06 | Grants match action AND organization AND selected scope, with OR across matching grants; no cross-organization access. Unknown/ambiguous region SOS succeeds and is visible to designated intake coordinator only; campaign-only coordinator cannot read it; scoped correction is audited |
| TC-BE-13 | FR-CAM-01, FR-MSN-02, FR-LOG-03 | Pause blocks new attachments, missions, and campaign-linked commitments; accepted work and already-issued goods remain visible; resume restores permitted commands; CLOSED request cannot reopen in CLOSED campaign |
| TC-BE-14 | FR-RPT-01, NFR-OBS-01 | Dashboard composes a fixed Response/Logistics dataset with correct scope, totals, separate source timestamps, and a clear unavailable state when one API is stopped |
| TC-BE-15 | FR-LOG-03..05, FR-REQ-09 | One request need is fulfilled by 12 of 20 units, then another 8; delivered/outstanding totals, stock ledger, partial state, audit actors, and human resolution all reconcile |
| TC-BE-16 | FR-REQ-06, FR-REQ-08 | Duplicate-candidate filter returns nearby/time/category matches only as suggestions; coordinator can ignore or link with a reason; unauthorized regions remain hidden |

### 22.7 Remaining decisions and current repository status

The repository currently has documentation only. No NestJS workspace, migrations, OpenAPI artifacts, running services, or executed product tests are established by this plan edit. Section 22 fixes design inconsistencies and defines the implementation path; it is not evidence of a working backend.

Before setup, verify primary-source runtime/image/client compatibility and current AIStor package/license. Section 23 adopts authentication transport, resolution sealing, quantity rules, asset/media scope, file limits and numeric performance targets. Before integration, turn these decisions into versioned OpenAPI and migrations; before acceptance, record actual hardware and executed results. External map/push/email/LLM providers remain unselected. Official priority/SLA, retention, real-data privacy and disaster-authority policies need separate confirmation before real deployment. These limitations do not block independent synthetic-demo slices.

## 23. Architecture review decisions — 2026-10-01

**Authority and scope:** the user authorized resolving the review findings using best practice and confirmed sufficient delivery time. Retain Identity, Response and Logistics as independently deployable NestJS services. These are synthetic-demo design decisions; they do not establish official rescue policy. This section supersedes earlier wording where the resolution lookup, commitment model, media limits or acceptance thresholds differ. It adds documentation and planned acceptance cases, not application code or executed product tests.

### 23.1 Web and Mobile session transport

- Identity remains the issuer and owner of sessions. Web is served through the same HTTPS Nginx origin as the three APIs. Browser access and refresh tokens are issued only through `HttpOnly; Secure; SameSite=Strict` host-only cookies with no `Domain` attribute. Access-cookie path is `/api/v1`; refresh-cookie path is `/api/v1/identity/auth`. Cookie expiry cannot exceed the existing 10-minute access/7-day absolute refresh lifetimes. Login/refresh responses for Web contain session metadata, never token JSON. No browser *authentication* token goes into localStorage, sessionStorage, URLs or client-state persistence. SOS tracking and donation capability secrets are not authentication sessions: Web keeps them in memory with a sessionStorage copy so a refresh does not lose them, and offers an explicit private save/copy of the tracking code plus secret on the confirmation screen because closing the browser would otherwise lose access (coordinator-assisted recovery is the fallback, R-17). They are protected by the NFR-SEC-04 CSP/XSS controls, and Mobile keeps them in SecureStore.
- All browser state-changing routes, including login, registration, refresh and logout, require an allowed `Origin` and a session/pre-session-bound CSRF token in a custom header. Identity supplies a pre-session CSRF token for public auth forms and rotates it on login/session rotation. CSRF tokens are distinct from authentication credentials. Missing/invalid tokens fail with Vietnamese errors. CORS allows only configured development origins; production is same-origin. Nginx strips caller-provided internal identity headers.
- Mobile uses `Authorization: Bearer` for access tokens kept in memory and Expo SecureStore for the rotating refresh token. Native login/refresh has an explicit transport contract and returns tokens only to that flow; it must not also issue browser cookies. Browser routes cannot bypass CSRF by selecting a native transport. Native endpoints reject browser cookie authentication and browser Origin requests. Passwords are never persisted; logout/reset/revocation clears SecureStore, in-memory tokens and sensitive query caches. Sensitive API responses use `Cache-Control: no-store`.
- Both clients serialize refresh attempts per session. Identity rotates under a session-row lock; an old refresh token is single-use. Reuse revokes the family as already specified. A lost refresh response may require login again; do not weaken reuse detection to silently recover it. Web tabs coordinate refresh through native browser locking where available; otherwise a conflict prompts login. Immediate request-boundary introspection/revocation remains the chosen tradeoff; load and outage tests include it.

Sources: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [React Native Security](https://reactnative.dev/docs/security). Cookie/CSRF configuration above is the C48 design, not a claim that cookie flags alone prevent every attack.

### 23.2 Resolution seal and cross-service recovery

A read followed by a Response write cannot prevent a concurrent Logistics need creation. Use a small durable REST workflow with an authoritative Logistics write barrier:

1. Response authorizes the coordinator and checks request version, work cycle, current mission evidence and lifecycle. In a short local transaction it records a unique resolution intent and marks the request `RESOLVING`, retaining its previous state for a possible abort. While RESOLVING, reject mission offers/progress, need-change authorizations, supplements, cancellation and competing resolution; allow scoped reads. No cross-service call holds a Response transaction open.
2. Response calls the authenticated, idempotent Logistics seal command with intent ID, request ID and work cycle. Logistics owns `FulfillmentCycle`, unique on `(request_id, work_cycle)`, with OPEN/FROZEN/SEALED, version, seal ID and intent ID. Every need creation/edit/cancellation, commitment/issue/delivery/return/loss command locks this cycle row first, then need/commitment rows and sorted stock balances. Creating a missing cycle uses the unique constraint and then locks the winner. This also applies to delayed commands that validated Response before RESOLVING.
3. Under that same cycle lock, Logistics refuses sealing if any need is OPEN/PARTIALLY_FULFILLED, any stock remains reserved, or any issued quantity remains unsettled. Otherwise it writes an immutable seal and blocks all later fulfillment mutations for that cycle. An empty cycle is explicitly created and sealed; it is not treated as an unprotected absence. A concurrent mutation either commits before the seal and participates in its checks, or sees SEALED and fails.
4. Response verifies the seal belongs to its intent/current cycle. In a local transaction it rechecks version, authorization and mission guards, then records RESOLVED, seal ID/version, audit and notice and completes the intent. CLOSED remains the subsequent administrative command. Reopen increments work_cycle and uses a new Logistics cycle; old seals/history remain immutable.
5. Timeout/crash leaves the intent durable. A small Response recovery task queries/retries the same seal/intent; it never assumes timeout means failure. A sealed cycle remains sealed even if Response is temporarily unavailable. If the coordinator cancels finalization, Response first durably marks the intent ABORTING so no finalizer can commit RESOLVED. Logistics may unseal only after an authenticated Response check confirms that exact intent is ABORTING and the request is neither RESOLVED nor CLOSED. It then idempotently releases the seal; Response restores recomputed prior progress (TRIAGED when no active work remains) with audit. No TTL or automatic unseal is allowed. If a seal cannot be released, keep a visible recoverable RESOLVING state.

Request enum/state diagram includes `RESOLVING`, displayed as “Đang xác nhận hoàn tất”; it is nonterminal and prevents campaign closure. ResolutionIntent records operation kind (RESOLUTION/CANCELLATION), actor, expected request version, previous state, cycle, idempotency scope, PENDING/ABORTING/COMPLETED/ABORTED state and timestamps. Recovery uses trusted service credentials and current actor grants; if authorization has been revoked, keep the intent visible for an authorized coordinator to adopt or abort. Resolution APIs return 202 plus operation ID while recovery is pending and 200 when committed; the request cannot claim resolution before completion. Service credentials must be audience-restricted; actor/scope context comes from authenticated service contracts, never arbitrary client headers. This protocol guarantees a sealed cycle has no open fulfillment work, without claiming a distributed database transaction. Campaign pause eligibility retains the documented command-boundary behavior in Section 22.3; physical stock settlement remains permitted after pause/cancellation.

Cancellation uses the same write-barrier principle: record a cancellation intent in Response, block new Response actions, and idempotently freeze the Logistics cycle before committing CANCELLED and cancelling missions/releasing team capacity. FROZEN rejects new needs, demand increases, commitments and issues, including previously authorized delayed commands; it permits only release, need cancellation and physical delivery/return/loss settlement. A crash retries the same freeze/intent. Completion seals the cycle once all needs and goods are settled. Campaign closure may preserve cancelled-request settlements but cannot revive its cycle. The cancellation intent is a distinct operation kind in the same durable intent table; a failed freeze leaves cancellation pending rather than reporting false completion.

### 23.3 Domain and schema decisions

- No independent `Incident` aggregate is needed for the current scope. An AssistanceRequest carries a controlled incident category and reported incident facts; Campaign groups the organized response. Use these meanings consistently in SRS, ERD, DTOs and UI. A future shared hazard event requires a demonstrated requirement before adding an entity.
- One ReliefNeed represents one item/unit for one request/work cycle. One Commitment represents one warehouse contribution to that need, with immutable original quantity and cumulative released/issued/delivered/returned/lost quantities. Remove CommitmentLine; multiple requested items use separate needs/commitments. Transfer and Distribution keep line tables because they genuinely contain multiple items. Delivery/distribution lines reference the issued commitment and settlement operation; no second stock decrement.
- Logistics stores nullable opaque `campaign_id` plus organization/region attribution on linked needs, copied from authenticated Response context for scoped reporting. These are historical attribution, not current campaign authority. A request with existing needs cannot silently change campaign, organization or region attribution: block reassignment until old-cycle needs are cancelled/settled, then explicitly establish new attribution with audit. Current campaign eligibility still comes from Response. Do not rewrite past distributions when a campaign changes.
- **Region data:** Identity owns the controlled region code catalog; Response owns boundary geometry seeded from simplified polygons derived from an openly licensed administrative-boundary dataset (record dataset, version and license in the seed README) or hand-drawn synthetic regions for the demo. Seed at least one region with boundaries covering the demo coordinates, plus a deliberately uncovered coordinate for the unassigned-queue test (TC-BE-12). Without seeded boundaries every SOS would land in the unassigned queue.
- Final migrations include work_cycle/version/audit fields, unique cycle and stock pairs, immutable operation references, quantity constraints and the spatial indexes already specified. The logical ERD is a view of these decisions, not a full physical schema.

### 23.4 Quantity changes and partial commitment summaries

For a contribution, `reserved_remaining = quantity - released - issued`, and `unsettled_issued = issued - delivered - returned - lost`; both must stay nonnegative. ISSUE decreases stock and reserved_remaining once. Returns credit stock only on confirmed physical warehouse receipt. Returned/lost quantities free unmet demand for a replacement contribution; they never count as delivered. All settlement records are immutable and independently idempotent.

A need remains constrained by `delivered_total + reserved_remaining_total + unsettled_issued_total <= requested_quantity`. Reduce requested quantity only down to that protected total; below it returns a Vietnamese 409 without changing anything. Release unissued contributions or settle issued goods first, then retry the reduction. Never reduce below delivered_total, so outstanding cannot be negative. Increasing demand uses the same cycle lock and is forbidden after sealing.

Cancel a need by releasing all unissued reservations atomically. Reject cancellation while issued goods remain unsettled. Preserve requested quantity and actual delivered history; record the remaining demand as cancelled, expose `cancelled_remaining = requested_at_cancellation - delivered` (excluded from active outstanding), and label the need CANCELLED. Resolution checks terminal need state plus physical settlement, rather than inventing delivery for cancelled demand.

Commitment status is derived: PROPOSED before reservation; COMMITTED while reserved remainder exists; ISSUED while no reservation remains but issued goods are unsettled; DELIVERED when the original contribution was completely delivered; SETTLED when all goods were released/delivered/returned/lost with a mixed outcome; CANCELLED only if nothing was issued and the entire contribution was released. Show quantity progress beside status; partial issue/delivery is supported without an arbitrary state PATCH. Need FULFILLED additionally requires coordinator confirmation after delivered equals requested.

### 23.5 Asset, media and acceptance coverage

Vehicles and relief points remain mandatory. Vehicle scope is CRUD, organization/region, identifier, type, capacity/unit and active/inactive status; no routing, fuel, maintenance or automatic assignment engine. ReliefPoint scope is CRUD, scoped location, contact/operating information and active/inactive status, plus selection as a distribution destination. Inactivation blocks new use and preserves historical distributions. Neither entity implies an independent warehouse stock balance.

Photo and video evidence are supported. Demo allowlist: detected JPEG/PNG images up to 10 MiB each, MP4 with allowed H.264 video/AAC audio up to 50 MiB each; at most five READY/PENDING attachments and 100 MiB total per request/mission. Reserve attachment count and declared-byte quota under the owning object lock before upload, reject streams above the reservation/limit, and reconcile abandoned PENDING reservations so concurrent uploads cannot exceed quota. Each upload contains one media file; allow bounded multipart overhead in the HTTP body limit. Reject SVG, HTML, executables and unsupported container/codecs. Validate actual media/container content with maintained tooling selected in the setup spike; bound parser time/memory, stream uploads and configure matching Nginx/API body limits. No transcoding or AI media inference. Serve originals as private downloads with safe Content-Disposition and nosniff; previews must use validated media. Generated immutable keys and crash reconciliation remain required. Signed download TTL is 60 seconds; current authorization is checked before signing. Synthetic media only; real-data retention remains a pilot decision.

### 23.6 Adopted demonstration measurements and setup gates

Performance dataset: 10,000 synthetic stored requests across seeded regions, states and priorities, with representative needs/missions. Workload: 20 k6 VUs; 2-minute warm-up followed by a 10-minute measured interval; 80% scoped read requests and 20% valid SOS creation with unique idempotency keys. Keep the prepared 10,000-record baseline and report the resulting dataset growth. Use fixed seed, bounded filters and no upload in the SOS timing. Read p95 <= 2 s, SOS p95 <= 3 s, unexpected HTTP failures < 1%; negative/security scenarios are separate. Include Nginx and Identity introspection; record CPU/RAM/disk, OS, image/dependency versions, network placement and complete workload. These are demo targets, not national-scale or availability claims.

Node 24 LTS is the setup baseline; pin the exact supported patch, compatible Nest/TypeORM versions and PostgreSQL/PostGIS image digest after a migration/spatial-query/locking/OpenAPI compatibility spike. Choose CommonJS and Jest for the existing documented testing approach; verify against the selected Nest major. Current Nest documentation distinguishes application and CLI runtime floors. [Node releases](https://nodejs.org/en/about/previous-releases), [Nest migration guide](https://docs.nestjs.com/migration-guide).

Keep MinIO AIStor Free as selected. Verify the actual Free license, S3 read/write, private policies and isolated restore before acceptance; current Free licenses report no expiry, which must not be confused with a trial. Free still lacks MinIO encryption at rest/HA/SLA. [AIStor license info](https://docs.min.io/aistor/reference/cli/mc-license/mc-license-info/), [AIStor license limits](https://docs.min.io/aistor/operations/licenses/). Map/provider procurement and real-data policy remain separate gates; optional push/email/LLM are unnecessary for the core demo. AI stays disabled until its own contract/evaluation gates pass.

### 23.7 Additional planned acceptance cases

Preserve existing IDs. These cases are specifications and have not been executed.

| ID | Links | Required assertions |
|---|---|---|
| TC-BE-17 | FR-REQ-09, FR-LOG-03/05, NFR-REL-01 | Concurrent resolve and need creation/edit cannot produce RESOLVED with an open need; prevalidated delayed commands see the cycle seal; empty cycles are protected |
| TC-BE-18 | FR-REQ-09, NFR-REL-01 | Crash/timeout before/after seal and Response commit recovers with the same intent; abort cannot race a finalizer; no timed unseal; reopened cycle excludes old seal; cancellation freeze blocks delayed new needs/issues while permitting existing physical settlements |
| TC-BE-19 | FR-LOG-02..05 | Reduction below protected/delivered quantity conflicts; cancellation releases reservations, rejects unsettled issue and preserves history; return/loss allows replacement without overcommitment |
| TC-BE-20 | FR-IAM-01..03, NFR-SEC-02, NFR-L10N-01 | Web auth tokens absent from JS storage/JSON/URLs; cookie flags/paths, CSRF and Origin enforcement; native transport cannot bypass browser protection; concurrent refresh and logout cleanup behave as specified |
| TC-BE-21 | FR-LOG-01/04 | Vehicle/point CRUD and inactivation enforce scope, validation and history; inactive point cannot receive new distribution; unrelated organizations cannot access assets |
| TC-BE-22 | FR-FILE-01, FR-MSN-04 | JPEG/PNG/MP4 content and codecs, per-file/count/aggregate limits, orphan recovery, Vietnamese 413/errors and 60-second signed links; storage failure preserves the SOS |
| TC-BE-23 | FR-CAM-01, FR-LOG-03, FR-RPT-01 | Multi-item requests use separate needs/single-item contributions; attribution-changing reassignment is guarded; campaign reports retain historical scope and totals |
| TC-BE-24 | FR-REQ-02, FR-REQ-03, NFR-SEC-01 | Guest SOS succeeds with Identity stopped; retry with the same key/payload/secret after a simulated lost response returns the original request ID and tracking code and one row; same key with a different payload or secret returns 409; the secret is stored only as a purpose-bound hash and never appears in responses or logs; a donation secret cannot track an SOS; wrong/missing secret cannot read or supplement; coordinator-assisted recovery rebinds with audit and revokes the old secret; a soft-threshold burst from one IP or phone is stored as RATE_LIMITED_REVIEW and visible in the review lane, never dropped or used to lock out a phone; only the hard per-IP ceiling returns Vietnamese 429 with the 113/114/115 notice; unverified guest request cannot be triaged/dispatched; claiming after sign-in links the owner once and audits it; a guest cannot reach any route outside the NFR-SEC-01 list (donation routes are covered by TC-DON-02/07) |
| TC-BE-25 | FR-REQ-10, FR-REQ-04 | Contact attempts are logged; one NO_ANSWER neither verifies nor rejects; rejection for unreachability is refused below three attempts/30 minutes without a clearly-invalid reason; TWO_COORDINATOR_JUDGMENT fails for the same coordinator or an out-of-scope one; a declared-danger request unresolved past the threshold shows the overdue badge and notifies other scoped coordinators; AuthorityReferral is audited without changing state; no automatic priority or dispatch; Vietnamese messages |
| TC-BE-26 | FR-LOG-05, FR-RPT-01 | Need of 20 with 12 delivered then cancelled: outstanding 0, `cancelled_remaining` 8, active backlog excludes it; reducing a need records original and effective quantity; a report with one open (outstanding 8) and one cancelled need shows active outstanding 8 and cancelled 8 in separate columns; request resolution is not blocked by the cancelled remainder but is blocked by unsettled issued goods |
| TC-BE-27 | NFR-SEC-04, FR-REQ-01 | A script/HTML payload in an SOS description, donor note and team name renders inert in Web and Mobile; CSP, nosniff, no-referrer and no-store headers are present on the specified responses; tracking/donation secrets never appear in URLs, Referer, logs or analytics; dependency audit output is recorded |
| TC-BE-28 | NFR-REL-01 | A forced lock wait beyond `lock_timeout` and a slow statement beyond `statement_timeout` roll back cleanly and return the retryable Vietnamese error; retrying with the same key produces exactly one effect; pools never exceed the configured sum under the k6 workload |
| TC-BE-29 | FR-AUD-01, FR-RPT-02, FR-NOT-02 | State, decision, adjustment, distribution and role-change history is written with actor/time/before-after; no password, token, secret or signed URL appears in audit or logs; only restricted readers read it; if CSV export is implemented, PII is masked by role and the export is audited; if push is implemented, the payload carries only generic Vietnamese text plus notice ID, and a failed push never rolls back the business change |
| TC-PERF-01 | NFR-PERF-01/02 | Reproduce Section 23.6 with recorded host/build, per-operation p95 and unexpected failure rate; include introspection and real PostGIS queries |

Enforce one nonterminal intent per request with a database uniqueness constraint; adopt/abort commands use expected version and idempotency.

Slice 2 (SOS intake) additionally requires TC-BE-24 and TC-BE-25.

Slice gates in Section 22.5 additionally require TC-BE-20 for Identity, TC-BE-17/18/19/21/23/26 for workflow/Logistics, and TC-BE-22/27/28/29 and TC-PERF-01 for integration. Produce concrete OpenAPI/migrations before each slice rather than treating this decision table as executable contracts.

## 24. Risk register and defense preparation

**Status as of 2026-10-04 (v2.8 corrections applied; originally written 2026-10-01):** this repository contains documentation only. Nothing below has been implemented, executed or measured. Cross-references (FR/TC/UC identifiers) were machine-checked for dangling links on 2026-10-01; semantic consistency was reviewed by reading only. This section records residual risks accepted by the team and the answers prepared for the capstone defense. It does not change any requirement.

### 24.1 Risk register

| ID | Risk | Likelihood / impact | Mitigation or early signal | Owner action |
|---|---|---|---|---|
| R-01 | No working product at review time; all figures are targets, not results | High / Critical | Build Slice 1-2 end to end first (guest SOS, verification queue, map); record real command output and k6 results; never present planned tests as passed | Backend owner |
| R-02 | SRS/SDD/test-case/user-guide deliverables are not yet separate documents | High / High | Derive SRS and SDD from this plan; keep identifiers; plan Sections 7, 9, 13 map directly to SRS, Section 5, 6, 10, 22, 23 to SDD | Whole team |
| R-03 | Three-service design and the seal/intent protocol (Section 23.2) are the most complex parts; defects here are likely | Medium / High | Implement and test TC-BE-17/18 early with real PostgreSQL. The seal is protected scope: a check-then-write (read open needs, then write RESOLVED) is **not** equivalent because Logistics can create a need between the read and the write, so it is not an accepted fallback. If time runs out, cut other scope first in the order of Section 16; only if the seal still cannot be finished, disable the RESOLVE command for requests that have linked Logistics needs (feature cut, documented as a limitation), and amend FR-REQ-09, TC-BE-17/18, the demo script and defense claims together. Never claim distributed atomicity | Backend owner |
| R-04 | TypeORM + PostGIS + row-lock behavior unverified | Medium / High | One-day compatibility spike before Slice 1 (geometry migration, ST_DWithin, SELECT FOR UPDATE, concurrency test); switch ORM only if the spike fails | Backend owner |
| R-05 | MinIO AIStor Free license, artifact, S3 behavior and restore are unverified | Medium / Medium | Verify current terms from the primary source before use; code against the S3 client so the store is replaceable; keep local fallback for development; do not redistribute the binary | Backend owner |
| R-06 | Map/tile provider not selected | Medium / Medium | Select before the coordinator map slice; adapter keeps the choice swappable | Web owner |
| R-07 | Priority taxonomy, verification and closure policy are team proposals, not rescue-authority policy | High / Medium | State this openly; interview or survey a domain contact if possible; keep all labels configurable and "draft" | Whole team |
| R-08 | Guest SOS invites spam or malicious reports | Medium / Medium | Rate limits, strict validation, verification gate, hashed client-generated tracking secret; add captcha if abuse is seen; keep guest uploads on a lower quota | Backend owner |
| R-09 | Identity introspection on every authenticated request is a single point of failure for staff routes | Medium / Medium | Deliberate trade-off for immediate revocation; SOS intake does not depend on it; if k6 shows it as a bottleneck, add a short (seconds) cache and document the revocation window | Backend owner |
| R-10 | Single-host Compose has no high availability; scalability is not demonstrated beyond the stated k6 workload | Certain / Low | Claim only what is measured (Section 23.6); describe the scale-out path (stateless services, managed PostgreSQL, S3) as design intent | Whole team |
| R-11 | AI advisor is rules-based, not machine learning; labeled data is unavailable | Certain / Low | Present it as explainable rules with human review; claim no accuracy; keep disabled by default | AI/research owner |
| R-12 | Push notifications (FR-NOT-02) and offline queue (FR-OFF-01) are Should and may be dropped | Medium / Low | In-app notices and honest "pending" UI remain core; drop push before weakening authorization or inventory | Mobile owner |
| R-13 | Real-data privacy (location retention, deletion requests, provider data egress) is unresolved | High if used with real data / High | Use synthetic data only; say so in the demo; settle retention before any pilot | Whole team |
| R-14 | Plan was edited in many passes; residual contradictions between Sections 22/23 and earlier sections are possible | Medium / Medium | Treat Sections 22/23/24 as authoritative; fix any conflict found during SRS/SDD writing and bump the version | Whole team |
| R-15 | The original brief PDF `docs/Cuu_tro_thien_tai.pdf` is deleted in the working tree | Medium / Medium | Keep a copy outside the repository before committing | Whole team |
| R-16 | Rescue teams in the field lose mission-progress actions while Identity introspection is down (fail-closed trade-off of R-09) | Medium / High | Accepted for the demo and stated openly; the Mobile client keeps the pending action on the device with its idempotency key and shows 'chưa gửi được' until it is acknowledged (FR-OFF-01 covers mission actions; if it is cut, the UI must still show an explicit 'not sent' error and never report the action as done); if k6 or the outage test shows it is unacceptable, add a short documented revocation-window cache for mission-progress commands only | Backend owner / Mobile owner |
| R-17 | A guest closes the browser and loses the SOS tracking secret | Medium / Medium | Confirmation screen offers explicit save/copy of code and secret; sign-in claim; coordinator-assisted audited re-binding through the reporter's contact phone | Web owner |
| R-18 | One backend owner carries three services plus the Section 25 donation vertical; the schedule is the largest delivery risk | High / High | Follow the weekly integration table and cut order in Section 16; re-estimate after the R-04 spike; decide cuts at the end of weeks 5 and 7, not at the end | Whole team |

### 24.2 Prepared answers for likely defense questions

| Question | Answer grounded in this plan |
|---|---|
| Why three services instead of a monolith? | Separate data ownership and failure domains for accounts, emergency workflow and supplies: each service owns its schema and migrations, and an outage of one service has a bounded blast radius: guest SOS intake and tracking work with Identity down, while staff and rescue-team actions (including mission progress) fail closed with a Vietnamese 503 because every authenticated request checks current grants with Identity. A Logistics outage does not stop SOS or mission progress, only the supply panels and need commands. The cost is explicit: every authenticated request depends on Identity introspection (Section 10.3, R-09), cross-service flows use REST with idempotency, and resolution needs the seal protocol (Section 23.2). Three containers and one PostgreSQL instance on one host demonstrate ownership and independent deployability, not infrastructure fault tolerance. A modular monolith would be simpler; the team chose three services to demonstrate bounded contexts and independent deployability. |
| Why not Kafka or microservices at larger scale? | No independent consumers or replay need exists; measured need is the criterion in Section 4.4. |
| What happens if the SOS was stored but the response was lost? | The client generated the tracking secret and idempotency key before sending and saved them. Retrying with the same key, payload and secret returns the original request ID and tracking code; the server never needs to re-issue a secret (Section 22.2, TC-BE-24). |
| What if the reporter cannot be reached by phone? | The request stays VERIFYING and visible; each attempt is logged; the declared-danger flag and an overdue threshold alert other coordinators; verification can rest on corroboration, evidence or two coordinators' judgment; an authority referral can be recorded. The demo cannot contact emergency services, and the thresholds are team defaults pending domain review (Section 8.1, FR-REQ-10). |
| Who did you survey for this workflow, and how are P1–P4 defined? | State the evidence actually collected (Section 18 evidence list). Where none exists, say the priority criteria, verification rules and thresholds are team simulation rules based on published humanitarian practice and not validated by a rescue authority (R-07). |
| Can the system prevent corruption? | No. It supports traceability, reconciliation and discrepancy detection. Two reviewers can still collude, and matching records do not prove goods reached households (Section 25 limits). |
| Is the AI really AI? | The Section 12 advisor is explainable rules with human review; call it a decision-support rule set. Agreement with data produced by the same rules is not evidence of real-world accuracy. Report the research on options, data and evaluation, and the reason for integrating or not. |
| Why does a citizen not need an account? | In an emergency, registration is a barrier; the client-generated tracking secret gives the reporter access, and the verification gate plus rate limits contain abuse (Section 14). |
| How do you stop false or duplicate reports? | Idempotency keys, human verification, duplicate linking with a canonical request, and no dispatch before verification. |
| How do you prevent over-issuing stock? | Append-only ledger, check constraints, row locks in stable order, and the concurrency test TC-16 (to be executed). |
| What if a warehouse delivers only part of the need? | Requested, committed, issued, delivered and outstanding are tracked separately; the request stays open (demo: 12 of 20). |
| What if one service is down? | The board shows which panel is unavailable and its generated_at; SOS intake works without Identity; resolution fails closed. |
| Is the AI trustworthy? | It is an optional rule-based advisor; a coordinator decides; no accuracy is claimed; it can be disabled without affecting the workflow. |
| Is it scalable? | Demonstrated only to the Section 23.6 workload on one host; the stateless services can be replicated, which is a design path and not a measured result. |
| What is verified? | State precisely at the time of the defense which TC cases were executed, on which commit and hardware. Anything else is planned. |

## 25. In-kind donations, reconciliation, and accountable distribution

**Decision date: 2026-10-04.** User-authorized extension; core donation and distribution controls are Must scope. This section extends Sections 6–16 and 22–24 and governs extended intake, adjustment and distribution where earlier descriptions are less specific. Existing service ownership, fulfillment locks, resolution seals and Vietnamese-language policy remain mandatory. This is a design, not implemented functionality or proof that software eliminates corruption.

### 25.1 Research and scope

The [primary-source research note](research/in-kind-donation-reconciliation-patterns.md) records dated evidence and limits.

| Source | Pattern adapted | Boundary |
|---|---|---|
| Sahana Eden historical inventory/deployment documentation | Needed-item lists, partial contributions, original-versus-received quantities, receipts/waybills | Legacy blueprint mixes implemented/proposed features; guest access is a C48 decision |
| Logistics Cluster / WFP guide | Physical count/inspection, goods received note, documented discrepancy, authorized release and receiving evidence | Adapt workflow, not a claim of certification |
| IFRC Green Logistics Guide | Need-based acceptance, quality/expiry criteria, damaged/expired donation visibility | Do not maximize donation totals by accepting unusable goods |
| Odoo lot documentation | Source-batch tracing from receipt to outgoing movement | No Odoo dependency or per-piece serialization |

Supplies only: cash, payments and tax receipts are outside scope. Logistics owns donation drives, declarations, intake, provenance, reconciliation and distribution. Response continues to own rescue campaigns/requests; references are opaque IDs, not cross-service foreign keys. Identity supplies scoped staff grants. Guest creation/tracking does not call Identity. No fourth service, Python runtime, broker or blockchain is needed.

### 25.2 Vocabulary and workflow

Keep these distinct: DonationDrive (public warehouse collection drive, not Response Campaign), DonationPledge (future intention), DonationDelivery (one physical handover), donor-declared handed-over quantity, staff physical count, independently approved accepted stock, warehouse dispatch, relief-point receipt, and final beneficiary handout. One pledge may have many partial deliveries. A pledge never credits stock.

```text
Manager opens drive -> citizen optionally pledges -> donor declares actual handover
-> staff count/inspect -> compare declaration/count/condition -> independent review
-> accepted stock posted once -> source allocation -> approved dispatch + waybill
-> independent receiving confirmation -> beneficiary handout -> reconciliation.
```

Walk-in donations without pledges are supported. Staff-created walk-in records cannot fabricate donor agreement: missing donor confirmation stays UNCONFIRMED. Delivering less than pledged is an unfulfilled promise, not automatically a warehouse discrepancy. Guest access does not establish verified identity. Anonymous public recognition is supported; citizen registration/phone verification is not mandatory.

### 25.3 Authority and drive lifecycle

| Action | Grant / guard |
|---|---|
| Create/open/pause/close drive | Warehouse-scoped `DONATION_DRIVE_MANAGE`, normally warehouse manager |
| Declare/view own donation/dispute | Owning citizen or donation-specific guest capability; no inventory authority |
| Count/inspect receipt | Warehouse-scoped `DONATION_INTAKE` |
| Review receipt/discrepancy | Scoped `DONATION_REVIEW`; reviewer differs from every intake-count author |
| Prepare / approve distribution | `DISTRIBUTION_PREPARE` / `DISTRIBUTION_REVIEW`; distinct users |
| Confirm custody handoff | Authorized receiving custodian, different from dispatch actor |
| Approve stocktake correction | `STOCK_ADJUSTMENT_REVIEW`; distinct from count/preparation authors |

Operations managers can hold review grants. Holding multiple roles never permits self-approval; admin role management grants no implicit business approval. Seed at least two staff accounts. Reviewer absence creates pending work/escalation, not a silent bypass.

`DRAFT -> OPEN <-> PAUSED -> CLOSED`, also `OPEN -> CLOSED`. Only OPEN allows new pledges/new drop-offs. Closing stops solicitation but permits completion of recorded handovers, reviews, disputes and returns. Require reason/version; outstanding receipts remain visible and closing is not reconciliation. Publish canonical items/units, target amounts, intake location/time, quality/expiry acceptance criteria. Targets are guidance; accepting excess requires manager reason. Response campaign pause still has the documented cross-service race boundary; donation drives do not change campaign lifecycle.

### 25.4 Guest security and Vietnamese user flows

Public pages expose sanitized drive needs/dates/intake location and aggregate progress. Signed-in donors use account ownership. Before creation a guest client generates a cryptographically random 32-byte secret and independent idempotency key, submits over TLS and saves both for retries. Logistics validates secret format/length, stores only its purpose-bound hash, and scopes replay lookup to that capability. Same key/body/secret yields one record; a changed body conflicts. A lost creation response must not lose access or generate a duplicate donation.

Guest tracking uses an authorization header, never query strings, logs, analytics or public receipt QR. Receipt numbers are identifiers, not credentials. Web uses session storage/memory and offers explicit private recovery-code download; Mobile uses SecureStore. Explain recovery in Vietnamese. Lost secrets require audited staff-assisted ownership proof and revocation/reissue; phone/name alone is insufficient and failed recovery reveals nothing. Claiming a guest donation requires both authenticated citizen and valid capability; atomic claim binds ownership and revokes guest access. SOS and donation secrets cannot be interchanged.

Apply throttling, payload limits, scoped pagination and browser origin/CSRF controls from Section 23.1. Guest uploads require an existing capability; Logistics owns private evidence metadata and enforces Section 6.3/23.5 limits. No public donor list or beneficiary identity. Guest claims never grant staff permissions.

Citizen Web/Mobile: browse drives, optional pledge, actual handover form, private receipt, discrepancy/dispute and sanitized source progress. Staff Web: intake queue, count comparison/evidence, independent review, source stock, dispatch/receiving/handout and reconciliation queues. Use distinct Vietnamese labels: “Dự kiến đóng góp”, “Số lượng đã bàn giao”, “Kho kiểm đếm”, “Đã tiếp nhận”, “Đang chờ đối chiếu”, “Đã giao đến điểm cứu trợ”, “Đã phát cho người nhận”. Offline draft is not received before server ACK. Preserve entered names/content; all validation, notifications and exports follow the existing Vietnamese policy.

### 25.5 Comparison, review and stock posting

Canonical quantities use PostgreSQL `numeric(18,3)`, serialized as decimal strings; reject fractions beyond item scale (pieces require integer quantities). No floating-point comparison. Pack conversions are item-specific, approved, versioned and snapshotted; never automatically equate boxes and pieces or unknown item names.

Per delivery/item: pledge quantity if any, donor-declared handed-over quantity nullable, physical count, accepted, held and rejected. Require `counted = accepted + held + rejected`. When declaration exists, `count_delta = counted - donor_declared`. Quality rejection is separate even when count matches. Record condition/expiry, canonical unit, actors/times, immutable donor/count revisions, reason/evidence. Compare each partial handover, not repeated pledge totals.

Changes before review create immutable revisions and invalidate pending approval. Reviewer checks explicit expected versions. Every receipt needs independent review, including matching counts. A discrepancy needs documented disposition and donor notice. Silence is never donor agreement. A reviewer may approve an evidenced usable quantity despite donor disagreement with a reasoned override; complaint remains OPEN and visible for operations review. Undetermined/unsafe goods stay held and unavailable. Later acceptance of held goods requires reviewed disposition; rejected goods need return/disposal custody evidence.

Post accepted quantities once in one short Logistics transaction: approved exact receipt revision, source batch/balance, RECEIPT movement, aggregate balance, audit and notice. Unique receipt-line/revision posting constraints and idempotency prevent double credit. No external calls under locks. After posting, corrections use independently approved compensating movements referencing originals, never overwrite/delete ledger history. Corrections cannot reduce on-hand below reserved; first release/reallocate reservations under cycle guards or reject with conflict. Donor return uses a source-linked authorized stock-out and handover evidence, not an aid ISSUE.

### 25.6 Logical model and source accounting

Extend the Section 6.1 ERD with these Logistics-owned entities; reuse existing Item, Warehouse, StockMovement and Distribution.

```mermaid
erDiagram
  DONATION_DRIVE ||--o{ DONATION_DRIVE_ITEM : requests
  DONATION_DRIVE ||--o{ DONATION_PLEDGE : attracts
  DONATION_DRIVE ||--o{ DONATION_DELIVERY : receives
  DONATION_PLEDGE |o--o{ DONATION_DELIVERY : partially_fulfills
  DONATION_DELIVERY ||--o{ DONOR_DECLARATION_REVISION : preserves
  DONATION_DELIVERY ||--o{ DONATION_RECEIPT : inspected_by
  DONATION_RECEIPT ||--o{ DONATION_RECEIPT_LINE : counts
  DONATION_RECEIPT ||--o{ RECEIPT_REVIEW : reviewed_by
  DONATION_RECEIPT ||--o{ RECONCILIATION_CASE : investigates
  DONATION_RECEIPT_LINE ||--o{ STOCK_SOURCE_BATCH : originates
  STOCK_SOURCE_BATCH ||--o{ SOURCE_BALANCE : located_at
  STOCK_SOURCE_BATCH ||--o{ MOVEMENT_ALLOCATION : traces
  STOCK_MOVEMENT ||--o{ MOVEMENT_ALLOCATION : allocates
  DISTRIBUTION ||--o{ CUSTODY_HANDOFF : records
  CUSTODY_HANDOFF ||--o{ HANDOUT_LINE : distributes
  STOCKTAKE ||--o{ STOCKTAKE_LINE : compares
```

Minimum fields: warehouse/organization scope, donor opaque user ID nullable, guest capability hash, canonical quantities/units, immutable declaration/count versions, reviewer IDs, references and private evidence. Exact schema constraints/indexes are implementation gates. Each accepted receipt line creates a source batch; ordinary receipts/opening stock also get an explicit source root. SourceBalance stores usable on-hand/reserved by warehouse/item/source with eligibility/expiry. Allocation totals equal movement quantities; summed source balances equal aggregate warehouse/item balances.

Reserve/release, issue, transfer, return, correction and settlement retain source allocations. Transfers preserve receipt roots; physically verified returns preserve source and need condition inspection. Select eligible earliest expiry first, then intake time/source ID; overrides require reason. Held/expired goods cannot issue. For mixed supplies, donor progress reports accounting allocations, not identifiable physical objects. Baseline donation terms disclose pooling within drive purpose; hard donor earmarks/cross-purpose diversion are outside scope and must not be promised.

Extend lock order: current FulfillmentCycle first for request-linked commands, then need/commitment or distribution header, receipt/stocktake header where needed, then sorted warehouse/item aggregate balances, then sorted source balances. Receipt approval locks its header before stock. Never acquire cycle locks after stock locks. Unique keys handle new source rows; aggregate/source constraints, approval versions and idempotency commit together. No distributed transaction.

Every balance-changing/reservation command checks the durable count-window flag while holding the same warehouse/item balance lock used to start a stocktake, preventing a check-then-write race. Starting a count window never acquires a cycle lock after a stock lock. A correction that must release request reservations is staged outside the count approval transaction through the ordinary cycle-first commands, then the count is refreshed; never reverse the lock order to force an adjustment. Pending physical custody and administrative review may continue without altering frozen usable balances.

### 25.7 Distribution and physical custody

DistributionPlan contains purpose, need/request or campaign reference, warehouse, point/destination, custodian/team, quantities and vehicle where relevant. `DRAFT -> APPROVED -> DISPATCHED -> RECONCILED`; cancellation only before dispatch. A different reviewer approves exact version; material changes invalidate approval. Approval does not deduct stock. Dispatch rechecks scope/version, source availability/expiry and cycle guards; creates waybill plus one ISSUE atomically.

Preserve Section 8.3's two stock-out paths: request-linked Distribution references an issued commitment and never issues again; direct point/campaign distribution reserves/issues once locally. Each unit leaves warehouse stock through one ISSUE only. Store actual actors/times, quantities and receiving custodian, not only a planned driver.

Receiving confirms actual point quantities, discrepancies and remaining transit by source, independently from sender. Point receipt settles that custody leg, not beneficiary delivery. Point stock is Logistics custody, not warehouse available stock. Final direct-recipient delivery can skip the point stage; explicitly identify handoff type.

Handouts record date, broad location, item/source quantities, recipient household count or pseudonymous acknowledgment and independent confirmation. Do not require national IDs, beneficiary photos or public names. Partial handouts leave point-held remainder. Per leg: `dispatched = confirmed_received + verified_returned + approved_lost + remaining_in_transit`. At a point: `received = final_handouts + forwarded + returned_from_point + point_loss + still_held`. Refused/held arrivals remain unresolved custody until disposition. Forwarding opens a linked leg, not another warehouse ISSUE. No duplicate handoff; returns credit stock only after physical return/inspection; loss requires independent reasoned approval.

Need delivery semantics remain explicit: an existing designated-point need may settle at confirmed point receipt, while a final-household need only fulfills at final handout. Add immutable `delivery_target_kind` (`RELIEF_POINT` or `FINAL_RECIPIENT`) when creating a need; freeze it once committed. **Selection rule (no free choice at fulfillment time):** a need linked to a Response request defaults to `FINAL_RECIPIENT`; `RELIEF_POINT` is allowed only when the coordinator names a designated active point and records a reason, and it is shown on the board and the request timeline. A need created for a campaign or point stock replenishment defaults to `RELIEF_POINT`. The kind cannot be changed after any commitment exists, and only a scoped coordinator with the need-management grant can set it; fulfillment staff cannot choose or alter it. A RELIEF_POINT need that is fulfilled at point receipt is labelled 'Đã giao đến điểm cứu trợ' on the board and a request cannot be RESOLVED on that basis unless the coordinator's resolution record acknowledges that no final household handout is expected for it. Existing described point workflows default to RELIEF_POINT in future migrations. Request seal guards the chosen need target and cannot infer final aid from intermediate receipt. Point-held balances remain separately reported after request closure.

### 25.8 Reports and stocktakes

Donor views preserve declaration/count/acceptance differences, disposition, complaints and sanitized source progress. Public totals show items and broad destinations with generated_at; no contacts, capabilities, private evidence or beneficiary identities. Scoped operations views show unmatched handovers, held goods, stale approvals, open complaints and overdue custody. These are investigation signals, not accusations of theft/bribery.

Separate cumulative events from current positions. Per source, reconcile accepted/opening inflows and reviewed corrections against current warehouse stock (reserved is a subset), unresolved transit, point custody, final handouts, approved losses, donor returns and disposal. Transfers/return journeys move positions, not new donations. Rejected intake is outside usable stock; held intake has its own physical custody register. Never sum unlike units or count a returned/transferred unit twice. Reports trace receipt -> source movement -> dispatch -> receipt -> handout references. Application append-only history is not tamper-proof against host/database administrators; existing restricted access and separate backups remain necessary.

Stocktake: scoped preparer starts a durable count window for selected warehouse/items -> block stock mutations for those balances -> snapshot book quantities/versions -> count -> distinct reviewer approves source-linked correction -> close window. Do not hold DB transactions while physically counting. Incoming physical deliveries can enter pending custody but cannot post into frozen balances; unaffected stock continues. After failure, resume/cancel explicitly with audit, never silently expire the window. Unexpected snapshot changes invalidate approval and require recount. Negative/reserved constraints still apply; condition/expiry changes may need quarantine plus reservation release rather than arithmetic adjustment.

### 25.9 APIs and use cases

All paths are Logistics `/api/v1`; mutations use idempotency and expected versions. Stable error codes remain English, human-readable responses Vietnamese.

| Resource / command family | Access |
|---|---|
| `GET /donation-drives`, `GET /donation-drives/:id` | Public sanitized open drives; separate scoped staff history |
| `POST /donation-drives`, `POST /donation-drives/:id/{open,pause,resume,close}` | Scoped warehouse manager |
| `POST /donation-drives/:id/pledges`, `POST /donation-drives/:id/deliveries` | Citizen or guest; referenced pledge must share owner/drive |
| `GET /donations/:id`, `POST /donations/:id/{declarations,disputes,claim}` | Owner/capability; claim also requires account |
| `POST /donation-receipts`, `POST /donation-receipts/:id/{counts,review,post}` | Intake/reviewer separation; approved exact revision posts once |
| `POST /distributions/:id/{approve,dispatch,receive,handouts,return,settle-loss}` | Scoped per-stage staff; independent handoffs |
| `POST /stocktakes`, `POST /stocktakes/:id/{start,counts,approve,cancel}` | Scoped preparer/reviewer; durable count window |
| `GET /reconciliation`, `GET /donation-reports/:id` | Scoped operations or sanitized owner report |

UC-10 — Manage donation drives: publish needs/open; enforce scope/state; closing leaves outstanding reviews visible. UC-11 — Donate as citizen/guest: optional pledge, actual handover declaration, private tracking, partial delivery and safe retries. UC-12 — Verify receipt: independent count/review/post; preserve donor disagreement and corrections. UC-13 — Distribute relief: independently approved issue, receiving confirmation, final handout and partial return/loss. UC-14 — Reconcile stocktake: durable snapshot/count/review and compensating adjustment. These extend Section 9; produce exact OpenAPI schemas and migration constraints before implementing each slice.

### 25.10 AI only where justified

**Core reconciliation and distribution require no AI.** Exact unit comparison, SQL conservation, FEFO, scope/actor checks and overdue-custody rules are reproducible. Matching arithmetic does not prove counts truthful; physical evidence and independent review provide the control.

FR-AI-07 optionally prefills item/unit/quantity from a photographed note after the manual workflow works. Evaluate representative Vietnamese documents on a held-out set against manual entry: field accuracy, critical quantity/unit errors and correction time. Activate only with measured time benefit and mandatory review of every critical field; until then remain manual. QR/barcode identifier capture is ordinary software, not AI.

If justified, use Logistics-owned immutable jobs/worker and the bounded freshness/failure pattern of Section 12; no access to Response-owned AI tables, new service or Python. Documents are untrusted; minimize/redact PII, validate output schema, link suggestions to evidence, invalidate stale suggestions and require human confirmation. Provider remains unselected; no automatic external upload. Output is Vietnamese. AI cannot approve, modify stock, decide eligibility, allocate/dispatch aid or accuse anyone. Learned fraud scoring/forecasting is excluded without suitable data/evaluation. Provider outage leaves all core workflows usable.

### 25.11 Planned acceptance and delivery order

These are planned cases, not executed product tests.

| Test | Requirements | Expected evidence |
|---|---|---|
| TC-DON-01 | FR-DON-01 | Scoped manager opens/closes; denied cross-warehouse action; pending reviews remain visible |
| TC-DON-02 | FR-DON-02 | Citizen/guest/walk-in/partial donations; lost-response retry creates one record without Identity dependency |
| TC-DON-03 | FR-DON-03 | Pledge 100, handover 60, count 58, accepted 55/rejected 3: pledge gap 40, count delta -2, rejection 3 shown separately |
| TC-DON-04 | FR-DON-04 | All count authors denied self-review; accepted stock posts once; held stock unavailable |
| TC-DON-05 | FR-DON-03/04 | Changed declaration/count invalidates approval; competing approval/post retries yield one stock credit |
| TC-DON-06 | FR-DON-05 | Donor disagreement stays visible after reasoned review override; silence never becomes agreement |
| TC-DON-07 | FR-DON-02/05 | Receipt QR/other donor/SOS secret denied; claim revokes guest capability; recovery reveals no private record |
| TC-DON-08 | FR-DON-06 | Partial transfer/return retains receipt source; movement allocations equal source/aggregate balances |
| TC-DON-09 | FR-DON-03/06 | Invalid units/precision/conversion, expired/held batches and insufficient source rejected |
| TC-DIST-01 | FR-LOG-06 | Independent versioned approval; edits invalidate; both stock-out paths ISSUE exactly once |
| TC-DIST-02 | FR-LOG-06/07 | Dispatch 55, point receipt 50/loss 5, handout 35/held 15; no duplicate stock debit or false final delivery |
| TC-DIST-03 | FR-LOG-07 | Refusal/forwarding/return/loss conserve custody; no self-confirmed receipt or fabricated warehouse return |
| TC-DIST-04 | FR-LOG-06/07 | Concurrent issue respects request seal; FINAL_RECIPIENT need cannot fulfill at point receipt; request-linked need defaults to FINAL_RECIPIENT; RELIEF_POINT needs a named point and reason; staff without the need-management grant cannot set or change the kind; kind is frozen after the first commitment |
| TC-REC-01 | FR-REC-01 | Fixed dataset reconciles all stages without double-counting transfers/reservations/returns |
| TC-REC-02 | FR-REC-02 | Count window blocks selected mutations; durable recovery/cancel; stale snapshot requires recount |
| TC-REC-03 | FR-REC-02 | Independent correction preserves history and nonnegative/reserved invariants |
| TC-AI-DON-01 | FR-AI-07 | Disabled/unavailable AI never blocks core workflows |
| TC-AI-DON-02 | FR-AI-07 | Wrong OCR unit/quantity, stale input or injection cannot approve/post; human confirmation required |
| TC-AI-DON-03 | FR-AI-07 | Held-out Vietnamese accuracy/time comparison recorded before activation |

Extend TC-L10N-01..03 and private-file/export checks across guest donation, discrepancies, complaints, handoffs and optional OCR. SRS/SDD/test cases/user guide must preserve these IDs.

Delivery order: contracts/grants/units -> public drive and declarations -> independent intake/posting -> source allocations for every existing stock mutation -> approved distribution/custody/handouts -> stocktakes/reports -> optional evaluated extraction. Do not expose public donation intake before verified posting/source accounting works. Demo matching and 100/60/58/55 discrepant donations, denied self-approval, retry without duplicate credit, partial point handout and reconciled totals; AI is not required.

Remaining implementation gates: exact schemas/constraints, item-specific quality/expiry criteria, staffed grants, reviewed Vietnamese copy and authorized execution evidence. Synthetic demo defaults use open-ended complaint visibility and audited manual access recovery. Real operating/legal policy, response deadlines and production anti-fraud effectiveness are not established by this capstone plan. Routine design decisions have been delegated; do not reopen settled architecture.

## Appendix A. AI implementation and research handoff

**Execution guidance for AI use.** Section 22 supplies the current capstone workflow baseline; concrete OpenAPI/migration artifacts and execution evidence must be produced per slice.

### A.1 Reading order and decision authority

1. Read root AGENTS.md and any applicable directory instructions.
2. Read [project context](c48-project-context.md) for the assigned scope and deliverables.
3. Read this English plan, including the framework evaluation, expanded AI design in Section 12, storage decision in Section 6.3, open decisions, and this appendix.
4. Inspect the actual repository, existing contracts/migrations, and latest user instructions before writing code. Do not assume planned services or tests already exist.

The current technical baseline is NestJS/TypeScript, three services (Identity, Response, Logistics), REST/JSON, TypeORM, PostgreSQL/PostGIS, React/Vite, and React Native/Expo. Section 4 records the selection rationale and alternatives. The project brief defines scope; technology choices are design decisions, not requirements imposed by the brief.

Nginx and three NestJS service boundaries are the working baseline. MinIO AIStor Free is the selected single-node lab object store; each operator must obtain/use it under current terms, and the team must verify the artifact, private access, and restore path. AI remains optional. Draft business rules, numeric targets, and provider/retention policies remain open where marked.

Use the recorded baseline for implementation. Revisit it when new evidence materially changes the tradeoffs, rather than repeatedly reopening settled choices. Record new decisions and ask only for information or authorization actually missing for the affected work. Routine reversible implementation choices may proceed with documented assumptions.

### A.2 Implementation invariants

- Own database credentials and migrations per service; no direct cross-service SQL or foreign keys.
- Preserve requirement/use-case/test-case IDs across documents, code references, and test records.
- Keep priority, request lifecycle, mission lifecycle, and fulfillment state distinct.
- Enforce scope in querysets and object actions, including files, exports, and notifications.
- Commit each service's business change, audit history, and in-app notice atomically; make retryable commands idempotent.
- Preserve stock constraints, append-only movements, short transactions, deterministic locking, and idempotent commands.
- Apply Section 25: declarations never credit stock; independent reviewers approve counts; source allocations conserve quantities; point receipt is not final handout.
- Preserve coordinate order, location source, accuracy, capture time, and server receive time.
- Never label an offline draft as received before server ACK.
- Never let AI or reporting projections become authoritative dispatch/priority decisions.
- Never report planned tests as passed, or a single-host demo as highly available.

### A.3 Decision baseline and remaining slice gates

Sections 22 and 23 supersede the earlier architecture draft: three-service ownership, REST integration, multi-mission aggregation, single-team missions, campaign optionality/resume, mutually exclusive verification, partial fulfillment, stock accounting, revocation, and notification uniqueness. Do not reintroduce broker workflows without evidence meeting Section 4.4.

Before implementing a slice, finish its OpenAPI schemas, database migration constraints/indexes, authorization cases, and executable acceptance cases. These concrete artifacts are not yet present in this documentation-only repository. Priority definitions, external providers, real-data retention, and operational SLA remain subject to domain review before real use. Ordinary reversible implementation choices may proceed under the documented demo defaults.

### A.4 Implementation workflow for a future task

1. Identify the requested slice and its UR/FR, use case, state transitions, and planned tests. Separate required behavior from Should/Optional scope.
2. Inspect existing code and contracts before adding files or dependencies. Use Nest guards/pipes, TypeORM migrations/transactions, PostgreSQL constraints, and TypeScript types where they satisfy the requirement.
3. Resolve the slice's blocking decisions. Record assumptions and decision rationale; do not quietly select a guest policy, retention period, SLA, or external provider.
4. Specify database constraints/indexes, API request/response/errors, authorization, transaction boundaries, idempotency behavior, and failure responses.
5. Implement the end-to-end slice: migrations, domain logic, API, client states, and workers only where needed. Keep resource-intensive infrastructure optional in local profiles.
6. Follow the active task's testing authorization. When implementing under the approved delivery plan, use its corresponding tests and record exact commands/results, environment, and remaining gaps. Documentation translation alone does not execute product tests.
7. Update traceability, setup instructions, and any changed contracts. Report completed work separately from recommendations and unverified behavior.

Use the implementation sequence and acceptance gates in Sections 16 and 22. Complete each slice end to end before adding optional infrastructure.

### A.5 Further research protocol

- Recheck time-sensitive facts using primary sources before pinning versions/providers: Node/Nest/TypeORM compatibility and PostgreSQL/PostGIS image support, React Native/Expo permissions, object-storage maintenance/license, and map/provider usage terms.
- Treat the 2026-09-29 research findings as dated findings, not newly verified facts. A linked version-specific page is not automatically the selected runtime version.
- Record the question, research date, primary-source URLs, findings, design impact, tradeoffs, and unresolved points. Distinguish a documented fact from an inference or recommendation.
- Preserve approved architecture unless evidence justifies a change; record the reason and obtain any necessary decision before making a material switch.
- For AI research, start with explainable rules and evaluation design. Do not claim real-world triage accuracy from synthetic demo data, or send PII to an external model without an approved basis.
- Keep new research proportional to an actual decision. Do not add infrastructure solely because it is available.

### A.6 Session handoff template

When approaching the context limit or handing work to another AI, leave a concise Markdown handoff containing:

- Objective and current authorized scope.
- Files changed and relevant commit/branch, if any.
- Completed work, incomplete work, and known defects.
- Accepted decisions, assumptions, and unresolved questions with affected requirement IDs.
- Commands/checks actually run, results, and checks not run.
- Environment/dependency details needed to resume, excluding secrets.
- The next concrete task and any real blocker.

Link this English plan and project context. Do not present partial implementation as complete or reclassify proposed policy as approved in the handoff.
