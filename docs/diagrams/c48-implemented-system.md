# Reliva Implemented System Diagrams

The diagrams here summarize the backend that is present in this repository. They describe current API and database behavior; they are not a claim that every planned Web or Mobile screen has been built.

Sources of truth:

- [Backend implementation status](../backend/README.md)
- [Role and permission map](../backend/05-permissions.md)
- [Identity schema](../backend/schema/identity.sql)
- [Response schema](../backend/schema/response.sql)
- [Logistics schema](../backend/schema/logistics.sql)
- [OpenAPI contracts](../../contracts/openapi/)
- [Compose stack](../../backend/infra/compose.yaml)
- [Nginx gateway](../../backend/infra/nginx/nginx.conf)

The ERD in the reference image includes entities such as `PaymentTransaction` and `CampaignHousehold`; those are not tables in the current physical schemas. The ERDs below show the actual service-owned tables and selected core relationships. Cross-service IDs such as `user_id`, `campaign_id`, and `request_id` are opaque references, not cross-database foreign keys.

## Complete physical ERD decomposition

![ERD vật lý tổng thể Reliva — toàn bộ database](erd/c48-erd-physical-overall.svg)

[Editable full physical ERD](erd/c48-erd-physical-overall.drawio) · [All seven diagrams and previews](erd/README.md)

The full model shows all 65 tables, columns, SQL types, key markers, and declared local foreign keys. The six detail views cover the same tables at a more readable scale; gray boxes point to a same-service table detailed on another page. `REF` identifies an ID without a declared FK. The older sections below remain compact core-flow views; use the ERD set for the complete physical schema.

## 1. Runtime architecture and service connections

```mermaid
flowchart LR
  Client["Postman / API consumer"]

  subgraph Compose["Docker Compose network: c48-internal"]
    Gateway["Nginx API gateway<br/>PUBLIC_PORT, default 8080"]

    Identity["Identity API<br/>NestJS :3001"]
    Response["Response API<br/>NestJS :3002"]
    Logistics["Logistics API<br/>NestJS :3003"]

    PostgreSQL[("PostgreSQL + PostGIS")]
    IdentityDB[("c48_identity")]
    ResponseDB[("c48_response")]
    LogisticsDB[("c48_logistics")]
    MinIO[("MinIO AIStor<br/>optional evidence storage")]

    PostgreSQL --- IdentityDB
    PostgreSQL --- ResponseDB
    PostgreSQL --- LogisticsDB

    Identity --> IdentityDB
    Response --> ResponseDB
    Logistics --> LogisticsDB

    Response -. "service token: identity lookups / authorization" .-> Identity
    Logistics -. "service token: identity introspection" .-> Identity
    Response -. "service token: cycle freeze / seal / fulfillment" .-> Logistics
    Logistics -. "service token: request admission / campaign lookup" .-> Response

    Response -. "private evidence objects" .-> MinIO
    Logistics -. "private evidence objects" .-> MinIO
    Gateway -. "short-lived signed evidence URL" .-> MinIO
  end

  Client --> Gateway
  Gateway -->|"/api/v1/identity/*"| Identity
  Gateway -->|"/api/v1/response/*"| Response
  Gateway -->|"/api/v1/logistics/*"| Logistics
```

The public API is routed through Nginx by service prefix. The service ports are published on loopback in the local Compose stack for host-side checks; internal service calls use the Compose network and scoped service tokens. Health and internal endpoints are blocked at the public Nginx boundary. MinIO is an optional dependency for evidence storage.

## 2. Overall use-case diagram

![Sơ đồ ca sử dụng tổng thể Reliva](./c48-overall-use-cases.svg)

[Mở nguồn Draw.io để chỉnh sửa](./c48-overall-use-cases.drawio). Sơ đồ tổng hợp các luồng backend theo sáu nhóm; mỗi hình bầu dục ghi tên chức năng, không chèn mã yêu cầu. Gợi ý AI là tùy chọn, kiểm kê tồn kho đang hoãn triển khai. Ba sơ đồ theo lĩnh vực trong kế hoạch dự án là các góc nhìn bổ trợ.

## 3. Assistance request and rescue mission flow

```mermaid
sequenceDiagram
  autonumber
  actor Reporter as Guest or citizen
  actor Coordinator
  actor Volunteer as Assigned team leader
  participant Nginx as Nginx gateway
  participant Response as Response API
  participant Identity as Identity API
  participant RDB as Response database
  participant Logistics as Logistics API

  Reporter->>Nginx: POST /api/v1/response/requests (SELF)
  Nginx->>Response: Forward request
  opt Signed-in reporter
    Response->>Identity: Validate session / user when required
    Identity-->>Response: Active user and grants
  end
  Response->>RDB: Store request + subject/location + initial event atomically
  Response-->>Reporter: Request ID + tracking capability

  Reporter->>Nginx: GET /api/v1/response/requests/track
  Nginx->>Response: Forward tracking-code / secret request
  Response->>RDB: Read reporter-visible request projection and events
  Response-->>Reporter: Current status and permitted timeline

  Coordinator->>Nginx: Read queue; verify / reject / mark duplicate
  Nginx->>Response: Forward scoped coordinator command
  Response->>Identity: Introspect actor and live grants
  Identity-->>Response: Grants and scope
  Response->>RDB: Save decision, verification snapshot, and event

  Coordinator->>Nginx: Triage with human priority; assign team mission
  Nginx->>Response: Forward scoped assignment command
  Response->>RDB: Save priority, mission offer, and audit/event data
  Volunteer->>Nginx: Read own missions; accept / decline / update status
  Nginx->>Response: Forward leader-authorized command
  Response->>RDB: Save mission event and request status

  opt Evidence upload is configured
    Volunteer->>Nginx: Upload mission evidence
    Nginx->>Response: Validate and stage evidence
    Response-->>Volunteer: Evidence metadata / upload result
  end

  Coordinator->>Nginx: Resolve request
  Nginx->>Response: Forward resolve command
  opt Request has been admitted to Logistics
    Response->>Logistics: GET internal fulfillment for the current work cycle
    Logistics-->>Response: Fulfillment evidence for current work cycle
  end
  Response->>RDB: Create pending resolution intent; move request to RESOLVING
  opt Request has been admitted to Logistics
    Response->>Logistics: POST cycle seal for resolution intent
    Logistics-->>Response: Seal accepted
  end
  alt Finalizer completes
    Response->>RDB: Mark intent complete; set RESOLVED and append event
  else Upstream failure or finalization deferred
    Response->>RDB: Keep intent pending for recovery
  end
  Response-->>Coordinator: 202 Accepted; resolution operation ID and state
```

Verification, priority, team assignment, and resolution are human-controlled. Resolution coordinates with Logistics only when that request was admitted there; the no-Logistics-admission path does not require a Logistics seal.

## 4. Donation, stock, and relief distribution flow

```mermaid
flowchart LR
  Donor["Guest / citizen donor"] -->|"Browse public drives; declare item delivery"| Drive["Donation drive + delivery declaration"]
  Drive --> Intake["Intake staff count goods"]
  Intake --> Review["Independent reviewer checks count"]
  Review -->|"Approve and post"| Receipt["Donation receipt"]
  Receipt --> Movement["Append stock movement"]
  Movement --> Balance["Warehouse stock balance"]

  Coordinator["Coordinator / operations manager"] --> NeedCommand["Submit relief need command"]
  NeedCommand --> Admission["Response API admits request + work cycle"]
  Admission --> Cycle["Logistics fulfillment cycle"]
  Cycle --> Need["Persist relief need"]
  Cycle --> Commitment["Reserve item quantity from warehouse"]
  Balance --> Commitment
  Commitment --> Distribution["Prepare distribution"]
  Distribution --> Approve["Independent approval"]
  Approve --> Dispatch["Dispatch stock"]
  Dispatch --> Handoff["Record delivery / point receipt / handout"]
  Handoff --> Settlement["Settle delivered, returned, or approved loss"]
  Settlement --> Reconcile["Reconcile fulfillment and stock ledger"]
```

Public donations represent goods delivered to a drive. The implemented schema and API do not contain a cash payment transaction. Stock changes are represented by append-only `stock_movement` rows; the service/database updates the derived balance.

## 5. Identity physical ERD (core)

```mermaid
erDiagram
  APP_USER {
    uuid id PK
    string username
    string display_name
    string status
    int authz_version
  }
  ORGANIZATION {
    uuid id PK
    string name
    string organization_kind
    string status
  }
  REGION {
    string code PK
    string name
    string status
  }
  MEMBERSHIP {
    uuid user_id PK
    uuid organization_id PK
    string status
  }
  ROLE_GRANT {
    uuid id PK
    uuid user_id FK
    string role_code
    string scope_type
    uuid organization_id FK
    string region_code FK
    uuid campaign_id
    timestamp revoked_at
  }
  SESSION_FAMILY {
    uuid id PK
    uuid user_id FK
    string client_kind
    timestamp revoked_at
  }
  REFRESH_SESSION {
    string token_hash PK
    uuid family_id FK
    timestamp rotated_at
  }
  AUDIT_LOG {
    bigint id PK
    uuid actor_user_id
    string action
    string entity_type
    string entity_id
  }

  APP_USER ||--o{ MEMBERSHIP : joins
  ORGANIZATION ||--o{ MEMBERSHIP : has
  APP_USER ||--o{ ROLE_GRANT : receives
  ORGANIZATION o|--o{ ROLE_GRANT : scopes
  REGION o|--o{ ROLE_GRANT : scopes
  APP_USER ||--o{ SESSION_FAMILY : authenticates
  SESSION_FAMILY ||--o{ REFRESH_SESSION : rotates
```

`ROLE_GRANT.campaign_id` is an opaque Response campaign ID and has no foreign key to the Response database. The audit actor ID is not an FK. `ROLE_GRANT.organization_id` / `region_code` scope grants; the role catalog and role-to-permission rules are enforced by application code and database checks.

## 6. Response physical ERD (core)

```mermaid
erDiagram
  CAMPAIGN {
    uuid id PK
    uuid organization_id
    string region_code FK
    string name
    string status
  }
  INCIDENT_CATEGORY {
    string code PK
    string display_name
  }
  SKILL {
    string code PK
    string display_name
  }
  REGION_BOUNDARY {
    string region_code PK
    geometry geom
  }
  INCIDENT_CATEGORY_SKILL {
    string category_code PK
    string skill_code PK
  }
  ASSISTANCE_REQUEST {
    uuid id PK
    uuid campaign_id FK
    string incident_category_code FK
    uuid canonical_request_id FK
    uuid reporter_user_id
    uuid organization_id
    string region_code FK
    string status
    string priority
    int work_cycle
  }
  REQUEST_SUBJECT {
    uuid request_id PK
    geography location
    int people_affected
    string location_source
  }
  REQUEST_EVENT {
    uuid id PK
    uuid request_id FK
    string event_type
    timestamp occurred_at
  }
  VERIFICATION_DECISION {
    uuid id PK
    uuid request_id FK
    string outcome
    uuid reviewer_user_id
  }
  CONTACT_ATTEMPT {
    uuid id PK
    uuid request_id FK
    uuid actor_user_id
    string outcome
  }
  RESOLUTION_INTENT {
    uuid id PK
    uuid request_id FK
    int work_cycle
    string kind
    string state
  }
  RESCUE_TEAM {
    uuid id PK
    string name
    string operating_region_code FK
    string status
  }
  TEAM_MEMBER {
    uuid team_id PK
    uuid user_id PK
    string member_role
  }
  TEAM_SKILL {
    uuid team_id PK
    string skill_code PK
  }
  TEAM_POSITION {
    uuid team_id PK
    geography location
    timestamp captured_at
  }
  MISSION {
    uuid id PK
    uuid request_id FK
    uuid team_id FK
    uuid verification_revision FK
    int work_cycle
    string status
  }
  MISSION_EVENT {
    uuid id PK
    uuid mission_id FK
    string from_status
    string to_status
    timestamp occurred_at
  }
  EVIDENCE_METADATA {
    uuid id PK
    uuid request_id FK
    uuid mission_id FK
    string object_key
    string state
  }

  CAMPAIGN o|--o{ ASSISTANCE_REQUEST : relates
  REGION_BOUNDARY o|--o{ CAMPAIGN : scopes
  REGION_BOUNDARY o|--o{ ASSISTANCE_REQUEST : assigns_region
  INCIDENT_CATEGORY ||--o{ ASSISTANCE_REQUEST : classifies
  INCIDENT_CATEGORY ||--o{ INCIDENT_CATEGORY_SKILL : requires
  SKILL ||--o{ INCIDENT_CATEGORY_SKILL : required_by
  ASSISTANCE_REQUEST ||--|| REQUEST_SUBJECT : describes
  ASSISTANCE_REQUEST ||--o{ REQUEST_EVENT : records
  ASSISTANCE_REQUEST ||--o{ VERIFICATION_DECISION : reviews
  ASSISTANCE_REQUEST ||--o{ CONTACT_ATTEMPT : contacts
  ASSISTANCE_REQUEST ||--o{ RESOLUTION_INTENT : resolves
  ASSISTANCE_REQUEST o|--o{ ASSISTANCE_REQUEST : canonical_request
  ASSISTANCE_REQUEST ||--o{ MISSION : dispatches
  REQUEST_EVENT ||--o{ MISSION : verified_snapshot
  RESCUE_TEAM ||--o{ TEAM_MEMBER : includes
  REGION_BOUNDARY ||--o{ RESCUE_TEAM : operates_in
  RESCUE_TEAM ||--o{ TEAM_SKILL : qualified_for
  SKILL ||--o{ TEAM_SKILL : assigned
  RESCUE_TEAM ||--o| TEAM_POSITION : reports_position
  RESCUE_TEAM ||--o{ MISSION : receives
  MISSION ||--o{ MISSION_EVENT : records
  ASSISTANCE_REQUEST o|--o{ EVIDENCE_METADATA : evidence_for_request
  MISSION o|--o{ EVIDENCE_METADATA : evidence_for_mission
```

`EVIDENCE_METADATA` must belong to exactly one request or mission. User and organization IDs are owned by Identity and intentionally have no cross-service foreign keys.

## 7. Logistics physical ERD (core)

```mermaid
erDiagram
  ITEM_TYPE {
    string code PK
    string display_name
  }
  UNIT {
    string code PK
    string display_name
    int scale
  }
  ITEM {
    uuid id PK
    string item_type_code FK
    string unit_code FK
    string name
    string status
  }
  WAREHOUSE {
    uuid id PK
    uuid organization_id
    string region_code
    string name
    string status
  }
  RELIEF_POINT {
    uuid id PK
    uuid organization_id
    string region_code
    string name
    string status
  }
  VEHICLE {
    uuid id PK
    uuid organization_id
    string identifier
    string status
  }
  DONATION_DRIVE {
    uuid id PK
    uuid campaign_id
    uuid intake_warehouse_id FK
    string title
    string status
  }
  DONATION_DELIVERY {
    uuid id PK
    uuid drive_id FK
    string status
    uuid donor_user_id
  }
  DONATION_DECLARATION {
    uuid delivery_id PK
    int revision PK
  }
  DONATION_LINE {
    uuid delivery_id PK
    int revision PK
    uuid item_id PK
    decimal quantity
  }
  DONATION_RECEIPT {
    uuid id PK
    uuid delivery_id FK
  }
  RECEIPT_COUNT {
    uuid receipt_id PK
    int revision PK
  }
  RECEIPT_COUNT_LINE {
    uuid receipt_id PK
    int revision PK
    uuid item_id PK
    decimal accepted_quantity
    decimal held_quantity
  }
  RECEIPT_REVIEW {
    uuid id PK
    uuid receipt_id FK
    uuid delivery_id
    int count_revision
    uuid reviewer_user_id
    string decision
  }
  STOCK_BALANCE {
    uuid id PK
    uuid warehouse_id FK
    uuid item_id FK
    decimal on_hand
    decimal reserved
  }
  STOCK_MOVEMENT {
    uuid id PK
    uuid balance_id FK
    uuid receipt_id FK
    string movement_type
    decimal delta_on_hand
    decimal delta_reserved
  }
  FULFILLMENT_CYCLE {
    uuid id PK
    uuid request_id
    int work_cycle
    string state
  }
  CYCLE_INTENT {
    uuid intent_id PK
    uuid cycle_id FK
    string kind
    string state
  }
  RELIEF_NEED {
    uuid id PK
    uuid cycle_id FK
    uuid item_id FK
    decimal requested_quantity
    string status
  }
  COMMITMENT {
    uuid id PK
    uuid relief_need_id FK
    uuid item_id FK
    uuid warehouse_id FK
    decimal quantity
    decimal issued_quantity
  }
  DISTRIBUTION {
    uuid id PK
    uuid warehouse_id FK
    uuid relief_point_id FK
    uuid vehicle_id FK
    string purpose
    string status
  }
  DISTRIBUTION_LINE {
    uuid id PK
    uuid distribution_id FK
    uuid commitment_id FK
    uuid item_id FK
    decimal quantity
  }
  HANDOFF_RECORD {
    uuid id PK
    uuid distribution_id FK
    string handoff_kind
    string confirmation_basis
  }
  HANDOFF_LINE {
    uuid id PK
    uuid handoff_id FK
    uuid distribution_line_id FK
    decimal quantity
  }
  ISSUED_LINE_SETTLEMENT {
    uuid handoff_line_id PK
    uuid commitment_id FK
    string settlement_type
  }

  ITEM_TYPE ||--o{ ITEM : categorizes
  UNIT ||--o{ ITEM : measures
  WAREHOUSE ||--o{ DONATION_DRIVE : receives
  DONATION_DRIVE ||--o{ DONATION_DELIVERY : collects
  DONATION_DELIVERY ||--o{ DONATION_DECLARATION : revises
  DONATION_DECLARATION ||--o{ DONATION_LINE : lists
  ITEM ||--o{ DONATION_LINE : declared_item
  DONATION_DELIVERY ||--o| DONATION_RECEIPT : has_receipt
  DONATION_RECEIPT ||--o{ RECEIPT_COUNT : counted_in
  RECEIPT_COUNT ||--o{ RECEIPT_COUNT_LINE : counts
  ITEM ||--o{ RECEIPT_COUNT_LINE : counted_item
  DONATION_RECEIPT ||--o{ RECEIPT_REVIEW : reviewed
  RECEIPT_COUNT ||--o{ RECEIPT_REVIEW : review_of
  WAREHOUSE ||--o{ STOCK_BALANCE : stores
  ITEM ||--o{ STOCK_BALANCE : balanced
  STOCK_BALANCE ||--o{ STOCK_MOVEMENT : changed_by
  DONATION_RECEIPT o|--o{ STOCK_MOVEMENT : posts_receipt
  FULFILLMENT_CYCLE ||--o{ CYCLE_INTENT : guarded_by
  FULFILLMENT_CYCLE ||--o{ RELIEF_NEED : contains
  ITEM ||--o{ RELIEF_NEED : requested
  RELIEF_NEED ||--o{ COMMITMENT : supplied_by
  ITEM ||--o{ COMMITMENT : committed_item
  WAREHOUSE ||--o{ COMMITMENT : reserves_from
  WAREHOUSE ||--o{ DISTRIBUTION : dispatches_from
  RELIEF_POINT o|--o{ DISTRIBUTION : destination
  VEHICLE o|--o{ DISTRIBUTION : transports
  DISTRIBUTION ||--o{ DISTRIBUTION_LINE : contains
  COMMITMENT o|--o{ DISTRIBUTION_LINE : fulfills
  ITEM ||--o{ DISTRIBUTION_LINE : distributed_item
  DISTRIBUTION ||--o{ HANDOFF_RECORD : records
  HANDOFF_RECORD ||--o{ HANDOFF_LINE : details
  DISTRIBUTION_LINE ||--o{ HANDOFF_LINE : handed_off
  HANDOFF_LINE ||--o| ISSUED_LINE_SETTLEMENT : settles
  COMMITMENT ||--o{ ISSUED_LINE_SETTLEMENT : reconciles
```

This is a core view, not every Logistics table. Donation disputes, attachments, stock adjustment review, and additional stock movement links are omitted to keep the ERD readable. `request_id`, `campaign_id`, `organization_id`, and user IDs are opaque references owned by other services where applicable.

## Deliberately not represented as implemented

- No Web or Mobile screen code is present in this workspace, so a screen-by-screen navigation diagram cannot be derived from implementation.
- Volunteer assignment is represented through scoped role grants and team membership; no self-service volunteer application screen or API is shown here.
- The current backend models in-kind donation deliveries and stock receipts; it has no cash checkout or `PaymentTransaction` table.
- No external weather-service integration or AI/LLM dispatch endpoint is represented. Request verification, priority, assignment, and dispatch remain human-controlled.
- These ERDs are intentionally simplified core views. Use the linked SQL files for the complete physical schema and constraints.
