<div align="center">

<img src="frontend/web/public/reliva-logo.png" alt="Reliva logo" width="120" />

# Reliva

### Emergency Response and Disaster Relief Management System

*Hệ thống quản lý ứng phó khẩn cấp và cứu trợ thiên tai*

**From an SOS call to a verified rescue mission and an auditable relief delivery, in one coordinated workflow.**

[![Deploy](https://github.com/sangvirgo/disaster-relief-management/actions/workflows/deploy.yml/badge.svg)](https://github.com/sangvirgo/disaster-relief-management/actions/workflows/deploy.yml)
![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Expo](https://img.shields.io/badge/Expo-React%20Native-000020?logo=expo&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL%20%2B%20PostGIS-17-4169E1?logo=postgresql&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-EC2%20%2B%20S3-FF9900?logo=amazonaws&logoColor=white)
![Docker](https://img.shields.io/badge/Docker%20Compose-ready-2496ED?logo=docker&logoColor=white)
![OpenAPI](https://img.shields.io/badge/OpenAPI-contracts-6BA539?logo=openapiinitiative&logoColor=white)
![Language](https://img.shields.io/badge/UI-Ti%E1%BA%BFng%20Vi%E1%BB%87t-DA251D)

[Overview](#overview) · [Live demo](#live-demo) · [Screenshots](#screenshots) · [Features](#key-features) · [Architecture](#architecture) · [Operations](#operations-and-reliability) · [Test accounts](#test-accounts) · [Quick start](#quick-start) · [Docs](#documentation)

</div>

---

## Overview

During floods, storms, and landslides, information about people who need help, available rescue teams, and relief supplies arrives through disconnected channels: phone calls, social posts, chat groups, and spreadsheets. Responders cannot tell whether a report was received, who is reviewing it, which team accepted it, or what was actually delivered.

**Reliva** connects affected residents, rescue teams, coordinators, operations managers, and administrators through one shared, traceable system on **Web and Mobile**.

| | |
|---|---|
| **Report** | Residents send a GPS-based SOS, as a guest or signed in, for themselves or on behalf of a household. |
| **Verify** | Coordinators review reports, resolve duplicates, and set the official priority. A human always decides. |
| **Respond** | Eligible rescue teams receive missions, accept or decline, report progress, and record the outcome. |
| **Relieve** | Campaigns, donation drives, warehouses, stock, and distribution stay linked end to end. |
| **Account** | Every important decision keeps its actor, time, reason, and before/after state. |

> The core demo path is **SOS → human verification and priority → team assignment and progress → resolution**. Donations and logistics are supporting capabilities. AI is optional and only advises coordinators.

## Live demo

The stack runs on AWS behind a Cloudflare Tunnel: **<https://reliva.tansang.dpdns.org>**. Anyone can send or track an SOS as a guest. Staff screens need an account (see [Test accounts](#test-accounts)). The data is synthetic; please mark test reports with "[KIEM THU]".

## Screenshots

### Web

<table>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-citizen-sos-full-2026.png" alt="Citizen SOS form" /><br /><sub><b>Citizen SOS intake (GPS or map pin)</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-citizen-tracking-2026.png" alt="SOS tracking" /><br /><sub><b>Tracking by code, with the files already sent</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-coordinator-dashboard-2026.png" alt="Coordinator dashboard" /><br /><sub><b>Coordinator dashboard</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-coordinator-sos-queue-2026.png" alt="SOS queue" /><br /><sub><b>Verification queue and priority</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-coordinator-ai-priority-2026.png" alt="AI advisory" /><br /><sub><b>Human-reviewed AI priority advice</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-coordinator-cluster-suggestion-2026.png" alt="Duplicate cluster suggestion" /><br /><sub><b>Duplicate and cluster suggestions</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-coordinator-campaign-map-2026.png" alt="Campaign map" /><br /><sub><b>Campaign map and areas</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-citizen-rain-point-2026.png" alt="Weather point" /><br /><sub><b>Rain and weather layers at the SOS point</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-leader-mission-offer-2026.png" alt="Mission offer" /><br /><sub><b>Team leader: mission offer</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-leader-team-skills-2026.png" alt="Team skills" /><br /><sub><b>Team profile and skills</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-operations-warehouse-stock-map-2026.png" alt="Warehouse stock map" /><br /><sub><b>Warehouses and stock on the map</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-operations-ai-needs-2026.png" alt="AI needs extraction" /><br /><sub><b>Supply needs extraction (AI, reviewed)</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/web-operations-shortage-proposal-2026.png" alt="Shortage proposal" /><br /><sub><b>Shortage proposals</b></sub></td>
    <td align="center" valign="top"><img src="report/images/web-admin-users-2026.png" alt="Admin users" /><br /><sub><b>Accounts and access administration</b></sub></td>
  </tr>
</table>

### Mobile

<table>
  <tr>
    <td align="center" valign="top"><img src="report/images/trang%20ch%E1%BB%A7.jpg" alt="Home" width="170" /><br /><sub><b>Home</b></sub></td>
    <td align="center" valign="top"><img src="report/images/map.jpg" alt="Map" width="170" /><br /><sub><b>Map</b></sub></td>
    <td align="center" valign="top"><img src="report/images/Danh%20s%C3%A1ch%20nhi%E1%BB%87m%20v%E1%BB%A5.jpg" alt="Mission list" width="170" /><br /><sub><b>Mission list</b></sub></td>
    <td align="center" valign="top"><img src="report/images/Chi%20ti%E1%BA%BFt%20nhi%E1%BB%87m%20v%E1%BB%A5.jpg" alt="Mission detail" width="170" /><br /><sub><b>Mission detail</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/mobile-mission-detail-awaiting-acceptance.jpg" alt="Awaiting acceptance" width="170" /><br /><sub><b>Mission offer</b></sub></td>
    <td align="center" valign="top"><img src="report/images/mobile-mission-progress-arrived.jpg" alt="Arrived" width="170" /><br /><sub><b>Progress: arrived</b></sub></td>
    <td align="center" valign="top"><img src="report/images/mobile-mission-completion-form-evidence.jpg" alt="Completion form" width="170" /><br /><sub><b>Completion with evidence</b></sub></td>
    <td align="center" valign="top"><img src="report/images/mobile-mission-completed-evidence.jpg" alt="Completed" width="170" /><br /><sub><b>Completed mission</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/b%E1%BA%B1ng%20ch%E1%BB%A9ng.jpg" alt="Evidence" width="170" /><br /><sub><b>Evidence upload</b></sub></td>
    <td align="center" valign="top"><img src="report/images/B%E1%BA%A3ng%20%C4%91i%E1%BB%81u%20khi%E1%BB%83n%20%C4%91%E1%BB%99i%20tr%C6%B0%E1%BB%9Fng.jpg" alt="Team leader dashboard" width="170" /><br /><sub><b>Team leader dashboard</b></sub></td>
    <td align="center" valign="top"><img src="report/images/mobile-team-location-map-picker.jpg" alt="Team position" width="170" /><br /><sub><b>Team position picker</b></sub></td>
    <td align="center" valign="top"><img src="report/images/mobile-proxy-sos-needs-details.jpg" alt="Proxy SOS" width="170" /><br /><sub><b>Proxy SOS (report for others)</b></sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><img src="report/images/quy%C3%AAn%20g%C3%B3p%20c%E1%BB%A9u%20tr%E1%BB%A3.jpg" alt="Donate" width="170" /><br /><sub><b>Relief donation</b></sub></td>
    <td align="center" valign="top"><img src="report/images/Khai%20b%C3%A1o%20b%C3%A0n%20giao.jpg" alt="Handoff" width="170" /><br /><sub><b>Handoff declaration</b></sub></td>
    <td align="center" valign="top"><img src="report/images/m%C3%A3%20c%E1%BB%A9u%20tr%E1%BB%A3.jpg" alt="Tracking code" width="170" /><br /><sub><b>Tracking code</b></sub></td>
    <td align="center" valign="top"><img src="report/images/%C4%91%C4%83ng%20nh%E1%BA%ADp.jpg" alt="Sign in" width="170" /><br /><sub><b>Sign in</b></sub></td>
  </tr>
</table>

All user-facing copy is in **Vietnamese**, in line with the project's language policy.

## Key features

### Emergency response
- **GPS-based SOS** for a guest or signed-in resident, with `SELF` and `PROXY` (report for another household) modes.
- Reporter and affected-person details are stored separately. Location keeps its source, accuracy, capture time, and server receive time as distinct values.
- **Verification workflow**: decision and reason, duplicate-candidate review, official priority.
- **Mission assignment** to eligible teams. Teams accept or decline, post progress, and report results into the request timeline.
- **Scoped operational maps and queues** limited by organization, campaign, or assigned resource, with no public personal details.
- **Evidence photos and videos**: images above 2048 px are reduced on upload, downloads use private links that expire in 60 seconds, and reporters can reopen their own files from the tracking page.

### Relief and logistics
- Campaigns, supply needs, commitments, warehouses, vehicles, and relief points.
- **Independent counting and review**: a donor declaration never adds stock. Only goods counted and approved by a separate reviewer enter inventory.
- **Stock ledger**: stock movements are the single source of truth.
- Distribution, handoff, and delivery/return/loss reconciliation.

### Platform
- **Role-based and scope-based access** (resident, volunteer/team, coordinator, operations manager, reviewer, admin). Authorization is enforced in the APIs, not by hiding buttons.
- **Audit trail** with actor, time, reason, and before/after state; append-only event tables. Retryable commands use idempotency keys.
- **Private evidence storage** with per-owner authorization on every download.
- **Optional AI advice** (Gemini, schema-constrained output, Vietnamese explanations) that is always human-reviewed and never prioritizes or dispatches on its own. Key and quota usage are monitored (by key position only).

## Architecture

### Runtime

```mermaid
flowchart LR
  Citizen[Residents and reporters] --> Web[React Web]
  Team[Volunteers and rescue teams] --> Mobile[Expo Mobile]
  Coordinator[Coordinators and operations staff] --> Web
  Citizen --> Mobile
  Web --> Gateway[Nginx ingress]
  Mobile --> Gateway
  Gateway --> Identity[Identity API]
  Gateway --> Response[Response API]
  Gateway --> Logistics[Logistics API]
  Response <-->|versioned REST| Identity
  Logistics <-->|versioned REST| Identity
  Response <-->|versioned REST| Logistics
  Identity --> IdentityDB[(Identity database)]
  Response --> ResponseDB[(Response database<br/>PostgreSQL + PostGIS)]
  Logistics --> LogisticsDB[(Logistics database)]
  Response -. private evidence .-> Storage[S3 on AWS / MinIO locally]
  Logistics -. private evidence .-> Storage
  Response -. optional advice .-> AI[Gemini API]
  Prom[Prometheus + Grafana] -. internal /metrics .-> Identity
  Prom -.-> Response
  Prom -.-> Logistics
```

Reliva uses **three domain services**. Each NestJS service owns its database, credentials, migrations, and business records. Services exchange identifiers through versioned REST APIs, with **no shared tables and no cross-service foreign keys**.

| Service | Owns |
|---|---|
| **Identity** | Accounts, authentication, organizations, memberships, scoped grants, sessions. |
| **Response** | SOS requests, affected-person and location records, verification history, teams, missions, campaigns, notifications. |
| **Logistics** | Supply catalog, warehouses, drives, donor declarations, counts and reviews, stock ledger, needs, commitments, distributions, handoffs. |

### Deployment on AWS

<p align="center"><img src="docs/diagrams/deployment/c48-deployment-overview.svg" alt="Deployment overview: Cloudflare Tunnel, one EC2 instance, S3, backups and monitoring" width="100%" /></p>

One EC2 `t3.medium` with no inbound ports (access through SSM), a Cloudflare Tunnel in front of nginx, private S3 buckets for evidence and backups, and GitHub Actions that build images to GHCR and deploy over SSM with automatic rollback.

<table>
  <tr>
    <td width="50%"><img src="docs/diagrams/deployment/c48-delivery-pipeline.svg" alt="Delivery pipeline" /><br /><sub><b>Delivery pipeline</b>: push to <code>main</code>, CI, images, SSM deploy, health check, rollback</sub></td>
    <td width="50%"><img src="docs/diagrams/deployment/c48-reliability-backup-scaling.svg" alt="Reliability, backup and scaling" /><br /><sub><b>Reliability</b>: recovery paths, verified backups, rollback, scaling path</sub></td>
  </tr>
</table>

More diagrams: [system overview](docs/diagrams/c48-system-overview.svg) · [container architecture](docs/diagrams/c48-container-architecture.svg) · [use cases](docs/diagrams/c48-overall-use-cases.svg) · [physical ERD (65 tables)](docs/diagrams/erd/c48-erd-physical-overall.svg) · [deployment design (PDF)](docs/diagrams/deployment/c48-deployment-architecture.pdf)

## Operations and reliability

| Concern | What is in place |
|---|---|
| **Delivery** | GitHub Actions: lint, tests, contract check, four image builds; deploy over SSM; migrations before start; health checks; automatic rollback to the previous release. |
| **Backups** | A systemd timer takes a daily dump (02:00 Vietnam time), verifies it, uploads it to a private S3 bucket with SHA-256 checks and keeps the two newest. `restore-s3` restores it; one restore drill reproduced identical row counts. |
| **Monitoring** | Prometheus, Alertmanager, Grafana, node and Postgres exporters, one dashboard, 22 alert rules sent to Telegram (disk, memory, restarts, errors, latency, backups, Gemini quota). Cost on the 4 GB host: about 310 MB of memory. |
| **Resource limits** | `mem_limit` on every long-running container, set from measured `docker stats`. |
| **Load test** | k6 scenario for 20 virtual users. The first run is **not a pass** (token expiry and the SOS anti-spam limit distorted it); see the [k6 report](docs/c48-k6-report-2026-11-23.md). |

Procedures and annotated commands: [deployment runbook](docs/c48-deployment-runbook.md). Current state and open items: [deployment handoff](docs/c48-deployment-handoff.md).

## Test accounts

Sign in with the **username** (not an email) on the live demo or on your own stack. The shared password is the `SEED_PASSWORD` you set in `backend/.env` when seeding; it is intentionally **not** written in this repository.

| Role | Usernames | Can do |
|---|---|---|
| Admin | `admin` | Accounts, grants, audit |
| Coordinator (main) | `coord1` | Verify, prioritize, assign teams, campaign queue |
| Coordinator (campaign) | `coord2`, `coord3` | Only the campaigns they engage |
| Operations manager | `ops_mgr`, `ops_seed`, `ops_camp1` | Campaigns, warehouses, stock, distribution |
| Reviewer | `reviewer1`, `reviewer2` | Count review for donations |
| Resident | `citizen1`, `citizen2`, `citizen3` | Send and track SOS, donate |
| Team leader | `vol_leader1` .. `vol_leader4` | Accept missions, manage the team |
| Volunteer | `vol_member1`, `vol_free1` | Team member / not yet in a team |

Main demo flow: `citizen1` sends an SOS → `coord1` verifies and assigns → `vol_leader1` accepts and completes the mission. The full list and role rules are in [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md).

## Tech stack

| Layer | Technology |
|---|---|
| **Backend** | NestJS 12, TypeScript, TypeORM, REST/JSON, class-validator, prom-client |
| **Database** | PostgreSQL 17 with PostGIS 3.5, one database per service |
| **Web** | React 19, TypeScript, Vite, Leaflet, MapLibre GL |
| **Mobile** | React Native, Expo (Expo Router), TanStack Query, Zustand, react-native-maps |
| **API contracts** | OpenAPI for each service, with TypeScript types generated for the Web client |
| **Gateway and infra** | Nginx ingress, Docker Compose (single stack), Cloudflare Tunnel, AWS EC2 and SSM |
| **Object storage** | Amazon S3 on AWS (instance role, no keys on the host); MinIO Community for the local stack |
| **Observability** | Prometheus, Alertmanager, Grafana, node and Postgres exporters |
| **CI/CD** | GitHub Actions, GHCR, SSM Run Command |
| **Optional AI** | Gemini with schema-constrained output and coordinator review |

**Why NestJS?** It was chosen after comparison with Spring Boot, Django REST Framework, FastAPI, and Flask. One TypeScript stack across backend, Web, and Mobile keeps contracts consistent, and PostgreSQL/PostGIS provides relational transactions together with spatial queries. See the [technology and delivery plan](docs/c48-technology-and-delivery-plan.md).

## Data protection and integrity

- Locations use WGS84 (SRID 4326), with GeoJSON ordered longitude then latitude.
- Exact locations, phone numbers, files, queues, exports, and notifications are scoped to authorized roles and organizations.
- Buckets are private. Every download is authorized against its owning request, mission, or distribution.
- `/metrics` is internal only and no identifier or secret is ever a metric label.
- Machine-readable contracts (paths, field names, error codes, enums) stay stable and English. Clients branch on codes, never on Vietnamese message text.
- Use synthetic names, contacts, locations, and files for development and demos.

Scope boundaries: relief covers physical goods only (no cash or payments), and Reliva is a coordination tool that does not replace emergency services or incident commanders.

## Quick start

**Requirements:** Docker Engine with the Compose plugin, Node.js `>=24.15.0 <25`, npm `>=10 <13`.

```bash
# 1. Configure (from the repository root)
cp -n backend/.env.example backend/.env
node backend/scripts/dev/gen-keys.mjs
# Set SEED_PASSWORD and EMAIL_OTP_PEPPER in backend/.env, and keep .env private.

# 2. Start the stack (from backend/)
cd backend
docker compose up --build -d

# 3. Load synthetic demo data
docker compose --profile seed up seed
```

Open **<http://127.0.0.1:8080>** for the Web app and API ingress. API prefixes are `/api/v1/identity`, `/api/v1/response`, and `/api/v1/logistics`.

> Never run `docker compose down -v`. For an intentional demo reset use only `bash scripts/db/reset-demo --reset` or `bash scripts/db/test-db --reset` locally (on the AWS host: `reset-demo-data --reset`). These remove only PostgreSQL data. The optional MinIO store runs under the `storage` profile; the monitoring stack under the `observability` profile.

**Web or mobile against a running server** (no local backend build):

```bash
# Web: Vite proxies /api/v1 to the server
cd frontend/web && npm ci && C48_INGRESS_URL=https://reliva.tansang.dpdns.org npm run dev

# Mobile: point Expo at the server API (no trailing slash)
cd mobile && npm ci && EXPO_PUBLIC_API_BASE_URL=https://reliva.tansang.dpdns.org/api/v1 npx expo start -c
```

<details>
<summary><b>Development commands</b></summary>

```bash
# Backend (from backend/)
npm ci
npm run build
npm test
npm run contracts:check
npm run check:compose-env

# Web (from frontend/web/)
npm ci
npm run dev        # local dev server
npm run build      # typecheck and production build

# Mobile (from mobile/)
npm ci
npm start          # Expo
npm run lint
```

Integration and smoke checks run from the host against the main stack's APIs and primary databases. See the [backend setup guide](docs/backend/00-setup.md) first.

</details>

## Repository map

```text
backend/
  apps/identity/       Accounts, authentication, organizations, permissions
  apps/response/       SOS, verification, teams, missions, evidence, AI advice
  apps/logistics/      Donations, inventory, fulfillment, distribution
  packages/technical/  Shared HTTP, metrics, idempotency, media, AI client
  infra/compose.yaml   The single Compose definition (profiles: storage, seed, observability)
  infra/observability/ Prometheus rules, Alertmanager, Grafana dashboard
  scripts/deploy/      Release, rollback, backup-s3, restore-s3, reset-demo-data
  scripts/db/          Migrations, synthetic seed, local backup and recovery
  test/k6/             Load test and its runner
  postman/             API collection for demos
contracts/openapi/     Identity, Response, Logistics API contracts
frontend/web/          Vietnamese React Web application
mobile/                Vietnamese React Native / Expo application
docs/                  Plan, deployment design and runbook, backend guides, diagrams
report/                Project report (LaTeX) and its images
```

## Requirements traceability

Identifiers are preserved from the report through the implementation.

| Area | IDs |
|---|---|
| User requirements | `UR-01..10` |
| Identity and access | `FR-IAM-01..03` |
| SOS requests | `FR-REQ-01..11` |
| Teams and missions | `FR-TEAM-01`, `FR-MSN-01..06` |
| Maps | `FR-MAP-01` |
| Campaigns and logistics | `FR-CAM-01`, `FR-LOG-01..07` |
| Donations | `FR-DON-01..05` |
| Reconciliation, reports, audit | `FR-REC-01`, `FR-RPT-01`, `FR-AUD-01` |
| Files and notifications | `FR-FILE-01`, `FR-NOT-01..02` |
| Optional extensions | `FR-OFF-01`, `FR-AI-01..07`, `FR-EVT-01` |
| Use cases | `UC-01..18` |

Performance target (NFR-PERF-01): 10,000 requests at 20 concurrent virtual users, read API p95 at or below 2 s, SOS submission at or below 3 s excluding uploads, HTTP errors below 1%. Not yet demonstrated: see the [k6 report](docs/c48-k6-report-2026-11-23.md).

## Documentation

| Document | Link |
|---|---|
| Full project report (LaTeX) | [report/main.tex](report/main.tex) |
| Project scope and context | [docs/c48-project-context.md](docs/c48-project-context.md) |
| Technology and delivery plan | [docs/c48-technology-and-delivery-plan.md](docs/c48-technology-and-delivery-plan.md) |
| Deployment architecture | [docs/c48-deployment-architecture.md](docs/c48-deployment-architecture.md) |
| Deployment runbook (annotated commands) | [docs/c48-deployment-runbook.md](docs/c48-deployment-runbook.md) |
| Deployment handoff (state and open items) | [docs/c48-deployment-handoff.md](docs/c48-deployment-handoff.md) |
| k6 load test report | [docs/c48-k6-report-2026-11-23.md](docs/c48-k6-report-2026-11-23.md) |
| Backend setup and database rules | [docs/backend/00-setup.md](docs/backend/00-setup.md) |
| Backend architecture guide | [docs/backend/README.md](docs/backend/README.md) |
| API contracts | [Identity](contracts/openapi/identity.json) · [Response](contracts/openapi/response.json) · [Logistics](contracts/openapi/logistics.json) |
| System diagrams | [docs/diagrams/c48-implemented-system.md](docs/diagrams/c48-implemented-system.md) |
| Postman demo collection | [backend/postman](backend/postman/C48-backend-demo.postman_collection.json) |

---

<div align="center">

**Reliva** · capstone project (C48) · built to help responders see, decide, and act faster.

</div>
