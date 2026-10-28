# Reliva Backend

Reliva runs three NestJS APIs: **Identity** owns accounts and permissions, **Response** owns SOS reports and rescue missions, and **Logistics** owns donations, stock, and distribution. Each service has its own PostgreSQL database. The APIs communicate over versioned REST contracts.

> **Project status · 27 October 2026:** the backend review fixes and ten-minute pending-registration flow are implemented. Local builds, unit/script tests, OpenAPI and Compose checks passed under Node 24.15.0. The main Compose stack is running with healthy PostgreSQL, migrations, APIs, Web, and Nginx; the new Identity migration has applied. The MinIO Community `storage` profile (no license needed) is running; private bucket initialization and per-service S3 read/write/cross-bucket denial were checked. T5/T12/T15 API upload/download smokes are currently blocked before upload by Identity test-user registration returning HTTP 400 `VALIDATION_FAILED`; isolated recovery and live OTP flows remain open. This remains an academic prototype; coordinators retain authority over verification, priority, and dispatch.

## Start a local demo

Read [backend setup](00-setup.md) before configuring or starting the stack. It documents the environment variables, demo accounts, database ownership, and operational rules.

From `backend/`:

```bash
cp -n .env.example .env
node scripts/dev/gen-keys.mjs
```

Fill the required local values in `.env`, including `SEED_PASSWORD` and `EMAIL_OTP_PEPPER`. From `backend/`, build and start the stack, run its migrations, and load the declared demo seed with one command:

```bash
docker compose -p c48 --env-file .env -f infra/compose.yaml --profile seed up --build -d
```

Private evidence storage uses the optional `storage` profile, which builds MinIO Community from the upstream source tag (`backend/infra/minio/Dockerfile`). No license is needed; run `docker compose --env-file .env --profile storage up --build -d`.

Existing databases need `AddPendingEmailRegistration1792953600001` through the declared `identity-migrate` job before the updated Identity API serves registration requests. The migration preserves active accounts and converts only unused legacy placeholders; review the [Identity lifecycle and rollback notes](02-identity-api.md) before applying it to an existing dataset.

Open **<http://127.0.0.1:8080>**. The public API paths are `/api/v1/identity`, `/api/v1/response`, and `/api/v1/logistics` on the same Nginx origin. Normal startup and seeding do not reset database volumes. Only use a documented reset command when intentionally discarding the primary demo database; MinIO data must be preserved.

## Test requests in Postman

Import only the [C48 backend collection](../../backend/postman/C48-backend-demo.postman_collection.json). It is self-contained and its default base URLs point to the public Nginx ingress on port `8080`; no separate Postman environment file is needed. Set the collection variable `seedPassword` to the same value as `SEED_PASSWORD` in `backend/.env` if it differs from the demo default.

Run the selected folder `00 · Luồng chính · SOS SELF đến kết thúc` for the primary demo. It has 26 ordered requests: prepare a fresh APP team and leader in the intake organization, submit a citizen SOS, make a pre-verification update, verify it, set official priority as a coordinator, offer and complete a rescue mission, resolve the SOS, and confirm the citizen can track the result. The folder switches between seeded admin, citizen, coordinator, and the newly created team leader; required logins and reads are included at the points where actors or versions change. Running the collection root also stops at the end of this primary flow. Select optional folders individually to run their scenarios.

The collection has 65 requests across six selectable folders: the 26-step main SOS flow; optional AI review (3); optional proxy reporting and independent verification (11); optional duplicate linking (6); optional guest recovery (10); and a short optional donation intake (9). Donations and stock are demonstrated only in that last folder. No folder attempts to cover every public API operation; use the OpenAPI contracts for the full route catalog. Service-to-service `/internal/` operations are not exposed through Nginx. Set `seedPassword` to match `SEED_PASSWORD` and `intakeOrganizationId` to match `DEMO_INTAKE_ORGANIZATION_ID` in `backend/.env`. The collection stores the active actor's token and rotates it at each required login. It uses bounded polling for asynchronous AI/resolve work and stops on a failed assertion. Running requests writes persistent records to the primary demo databases; each main run creates a new leader/team and new SOS, and rerunning state-changing operations against an older record may correctly fail version/state guards.

Use folder `10 · Tùy chọn · AI hỗ trợ rà soát` only when the SOS has a current advisory and the worker can complete it. Its decision is version-checked and remains a human coordinator action. Use folders `20`, `30`, and `40` for the independent proxy-verification, duplicate, and guest-recovery scenarios. Folder `50 · Tùy chọn · Quyên góp và nhập kho ngắn` shows one declaration, count, independent review, and stock posting; it is a supporting demo, not part of the required SOS workflow.

The selected scenarios need no SMTP, Google sign-in, MinIO, or Gemini unless you choose a folder that depends on them. Collection requests that write data create persistent rows in the main demo databases.

## API contracts and implementation notes

| Service | OpenAPI contract | Detailed guide |
|---|---|---|
| Identity | [identity.json](../../contracts/openapi/identity.json) | [Identity API](02-identity-api.md) |
| Response | [response.json](../../contracts/openapi/response.json) | [Response API](03-response-api.md) |
| Logistics | [logistics.json](../../contracts/openapi/logistics.json) | [Logistics API](04-logistics-api.md) |

The API snapshots currently describe **205 operations**: 37 Identity, 82 Response, and 86 Logistics. `contracts:check` checks exported route coverage, operation IDs, path parameters, local references, source provenance, and security declarations. The contracts and API examples use stable English codes and identifiers; backend messages shown to people are Vietnamese.

The main implementation references are:

- [Schema review and SQL invariants](01-schema-review.md)
- [Role permissions and scope rules](05-permissions.md)
- [Vietnamese error catalog](07-error-catalog.md)
- [Implementation sequence](06-implementation-tasks.md)
- [Detailed execution history and 16 October handoff](HANDOFF.md)
- [T19 baseline contract traceability](T19-traceability.md)
- [T18 security hardening](t18-hardening.md)

The [technology plan](../c48-technology-and-delivery-plan.md) governs business rules; the backend API guides and SQL schemas govern concrete request and column shapes. Each service owns only its database. Do not add cross-service database access or expose `/internal/` routes through Nginx. AI may suggest or summarize information; it does not set official priority or dispatch teams.

## Checks

Use the declared Node 24 engine range (`>=24.15.0 <25`) for release verification. Run backend checks from `backend/`:

```bash
npm ci
npm run build
npm test
npm run contracts:check
npm run check:compose-env
```

Database and HTTP integration checks use the existing Compose stack and the primary `c48_identity`, `c48_response`, and `c48_logistics` databases. There is no separate test database, Compose project, or helper container. The documented database suite requires an explicit `--reset` flag and resets primary PostgreSQL data; do not run it against demo records you want to keep. See [setup §8.5](00-setup.md) before running it.

## Remaining acceptance evidence

Implementation is broader than the evidence currently recorded. The open gates include private upload/download through the API and restore; periodic overdue scheduling; authenticated heatmap timing at representative volume; populated fulfillment and large report plans; dashboard behavior; and runtime pool saturation, log review, restore, accessibility, and recorded performance. See [HANDOFF.md](HANDOFF.md) and [T19 traceability](T19-traceability.md) for evidence dates and exact gaps. Required standalone SRS, SDD, test-case package, installation instructions, and user guide also remain to be produced.
