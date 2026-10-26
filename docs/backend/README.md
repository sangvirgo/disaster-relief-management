# Reliva Backend

Reliva runs three NestJS APIs: **Identity** owns accounts and permissions, **Response** owns SOS reports and rescue missions, and **Logistics** owns donations, stock, and distribution. Each service has its own PostgreSQL database. The APIs communicate over versioned REST contracts.

> **Project status · 26 October 2026:** the repository contains the T20 Identity and Response work, including email OTP, Google sign-in/linking, reporter updates, and coordinator review of AI advisories. The latest recorded backend build and contract checks were run on Node 26.11.1, outside the declared Node 24 range. T20 tests, migrations, and seeding were not run. This remains an academic prototype; coordinators retain authority over verification, priority, and dispatch.

## Start a local demo

Read [backend setup](00-setup.md) before configuring or starting the stack. It documents the environment variables, demo accounts, database ownership, and operational rules.

From `backend/`:

```bash
cp -n .env.example .env
node scripts/dev/gen-keys.mjs
```

Fill the required local values in `.env`, including `SEED_PASSWORD` and `EMAIL_OTP_PEPPER`. Then start the existing Compose stack and load its declared demo seed job:

```bash
docker compose up --build -d
docker compose --profile seed up seed
```

Open **<http://127.0.0.1:8080>**. The public API paths are `/api/v1/identity`, `/api/v1/response`, and `/api/v1/logistics` on the same Nginx origin. Normal startup and seeding do not reset database volumes. Only use a documented reset command when intentionally discarding the primary demo database; MinIO data must be preserved.

## Test requests in Postman

Import the [C48 backend collection](../../backend/postman/C48-backend-demo.postman_collection.json). Its default base URLs point to the public Nginx ingress on port `8080`. Select your local `C48 Local Demo` environment and set `seedPassword` to the same value as `SEED_PASSWORD` in `backend/.env`. The local environment file is ignored by Git; create it in Postman if it is not already on your machine.

Each actor folder has a login request. Send that first, then run the requests for that actor one at a time. The collection stores returned IDs, versions, and access tokens for later requests. Its 304 requests cover all 189 non-internal OpenAPI operations; 15 service-to-service `/internal/` operations are intentionally omitted from the public collection.

Suggested flows:

1. **Citizen:** choose one registration request and set `citizenEmail` to a mailbox you can access that is not already registered. The request creates a unique username and saves the returned `challengeId`. Configure SMTP to receive email OTPs; enter the six-digit value in `emailOtpCode`, verify it, then log in with the new account.
2. **SOS:** create a SELF report, then try tracking, updating the report, and reading its events. Reporter edits are only accepted while the request is in an editable state; refresh its version before retrying a conflict.
3. **Coordinator:** log in as a coordinator to review requests, verify and triage them, and manage missions. AI advisory review needs an advisory on the request and a coordinator session. Gemini is optional; any AI output remains advisory.
4. **Logistics:** use the Operations Manager, Intake Staff, Reviewer, and Distribution Staff folders to walk through in-kind donation intake, independent review, stock, and distribution.

Google requests need `GOOGLE_CLIENT_IDS` and a valid Google ID token in `googleIdToken`. Evidence requests are skipped while the collection variable `aiStorAvailable` is not `true`; set it only after confirming the storage profile is running. Collection requests that write data create persistent rows in the main demo databases.

## API contracts and implementation notes

| Service | OpenAPI contract | Detailed guide |
|---|---|---|
| Identity | [identity.json](../../contracts/openapi/identity.json) | [Identity API](02-identity-api.md) |
| Response | [response.json](../../contracts/openapi/response.json) | [Response API](03-response-api.md) |
| Logistics | [logistics.json](../../contracts/openapi/logistics.json) | [Logistics API](04-logistics-api.md) |

The API snapshots currently describe **204 operations**: 37 Identity, 81 Response, and 86 Logistics. `contracts:check` checks exported route coverage, operation IDs, path parameters, local references, source provenance, and security declarations. The contracts and API examples use stable English codes and identifiers; backend messages shown to people are Vietnamese.

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

Implementation is broader than the evidence currently recorded. The open gates include AIStor private upload/download and restore; periodic overdue scheduling; authenticated heatmap timing at representative volume; populated fulfillment and large report plans; dashboard behavior; and runtime pool saturation, log review, restore, accessibility, and recorded performance. See [HANDOFF.md](HANDOFF.md) and [T19 traceability](T19-traceability.md) for evidence dates and exact gaps. Required standalone SRS, SDD, test-case package, installation instructions, and user guide also remain to be produced.
