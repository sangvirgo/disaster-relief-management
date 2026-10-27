# Backend versions

Verified for T0 and T1 on 2026-10-10. Application package versions are exact pins in `backend/package.json` and `backend/package-lock.json`; update them only after the primary-source and compatibility checks required by Appendix A.5.

| Component | Version or pin | Notes |
|---|---|---|
| Node.js | `24.15.0` (`node:24.15.0-bookworm-slim`) | Docker resolved base-image manifest `sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d`; exact Node release: [Node.js 24.15.0](https://nodejs.org/en/blog/release/v24.15.0). |
| NestJS | Core, common, platform-express, testing `12.1.2`; CLI `12.0.8`; schematics `12.0.6`; Swagger and TypeORM integrations `12.0.2` | Nest’s current migration guide lists the supported Node versions: [NestJS migration guide](https://docs.nestjs.com/migration-guide). |
| TypeORM / PostgreSQL driver | TypeORM `1.1.2`; `pg` `8.23.1` | The schema files remain authoritative; migrations execute their SQL through TypeORM. See [TypeORM migrations](https://typeorm.io/docs/migrations/why/). |
| Access-token key | RS256, RSA 3072-bit; PKCS#8 private key and SPKI public key, base64-encoded in the local `.env` | Generated once by `backend/scripts/dev/gen-keys`; rerunning against populated secrets is refused. |
| TypeScript / tests | TypeScript `6.0.3`; Jest `30.5.2`; ts-jest `29.4.14`; Supertest `7.3.1` | Exact direct pins are in the lockfile. |
| Structured logging | Pino `10.4.0` | Exact registry version checked 2026-10-10; redaction paths follow [Pino's redaction documentation](https://github.com/pinojs/pino/blob/main/docs/redaction.md) and are tested for credential/PII fields. Current package listing: [Pino on npm](https://www.npmjs.com/package/pino). |
| Other direct runtime packages | argon2 `0.45.1`; class-transformer `0.5.1`; class-validator `0.15.1`; dotenv `18.0.7`; reflect-metadata `0.2.2`; RxJS `7.8.2` | `argon2` demo seed settings default to 65,536 KiB, 3 iterations, parallelism 1. These are implementation defaults for the prototype, not a recorded security-policy decision. |
| PostgreSQL + PostGIS | `postgis/postgis:17-3.5@sha256:01a6a70e41e6c4467c8f55f6063555ed72db2d6662cd0d571040d42eadaeb6f6` | The same main service backs local development and database checks in `infra/compose.yaml`. Official image project: [postgis/docker-postgis](https://github.com/postgis/docker-postgis). |
| Nginx | `nginx:1.30.5` | Versioned image tag; no `latest` tag. |
| MinIO Community | Server built from source tag `RELEASE.2025-10-15T17-29-55Z`; `mc` `RELEASE.2025-08-13T08-35-41Z` | Optional `storage` profile. No official Community image is pullable (Docker Hub removed; quay.io unauthorized), so `backend/infra/minio/Dockerfile` builds both from upstream source (AGPLv3, no license file). Upstream is archived: no security fixes, no admin web console; S3 API and `mc admin` user/policy commands work. Lab use with synthetic data only. |

The Node, PostGIS and Nginx values are used as versioned image references in the Dockerfiles/Compose files. Compose CLI version is host-installed and is not pinned by this repository.
