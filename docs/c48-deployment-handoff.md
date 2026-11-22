# Deployment handoff: Reliva (C48) on AWS, 2026-11-22

Follows plan [Appendix A.6](c48-technology-and-delivery-plan.md). Read first: [AGENTS.md](../AGENTS.md), [project context](c48-project-context.md), then the [deployment architecture](c48-deployment-architecture.md) (design, with section 15 listing where the build differs) and the [deployment runbook](c48-deployment-runbook.md) (procedures). This file records what happened; it does not turn proposals into approved policy.

No secret, account number, key id, IP address or mailbox is recorded here. Operators keep those in `/opt/c48/backend/.env` on the host, the GitHub `production` environment secrets and their own `~/.aws`.

## 1. Objective and authorized scope

Run the existing Compose stack on one AWS EC2 instance, publish it through a Cloudflare Tunnel, store evidence in S3, and deliver updates automatically from GitHub without manual pulls. The operator explicitly authorized: creating branches and pull requests, merging PRs #17 to #20 and enabling the deploy job, deleting the three stale private GHCR packages of this repository, and changing GitHub repository variables, the `production` environment and its secrets. Nothing outside this repository or the operator's AWS/Cloudflare consoles was changed.

## 2. Current state (verified or not)

| Area | State | How it is known |
|---|---|---|
| EC2 `t3.medium`, Ubuntu 24.04, 30 GiB gp3 encrypted, no inbound rules, SSM access, 2 GB swap, Docker + Compose | Live | Session Manager shell, `free`, `docker` output |
| Stack (postgres, 3 APIs, web, nginx) | Live, 6 containers healthy | `release status` output, `/health/live` through nginx returned `{"status":"ok"}` |
| Migrations | Applied: identity 9, response 17, logistics 16 | First successful deploy log (run 45033532949) |
| Cloudflare Tunnel `reliva-ec2` to `http://localhost:8080` | Live; the pipeline's external check of `/health/live` passed after the route was added | Run result and dashboard (tunnel Healthy) |
| GitHub Actions CI | Green on PRs and `main` (lint, compose-env, jest, node tests, 4 image builds) | Runs 45029723747, 45030126832 and later |
| CD (merge to main, SSM, release script) | Works end to end | Same run: SSM sent, four images pulled anonymously, migrate, start, health checks passed |
| S3 | Three private buckets (two evidence, one backup) with Block Public Access and SSE-S3; EC2 role can put, list and delete objects | `aws s3` test from the host. **Versioning is off.** The 3-day lifecycle rule on the backup bucket was requested but **not verified** |
| Email (Gmail SMTP) | Operator edited `.env` after three faults were found (port 465 with `secure=false`, empty `IDENTITY_EMAIL_FROM`, a 48-character password instead of a 16-character app password) and reported it fixed | **Delivery not verified by the assistant** |
| Rollback, pre-deploy dump | Implemented in `backend/scripts/deploy/release` | Tests with fake docker/git/curl only; **no real failure rehearsed** |

## 3. Changes (all merged to `main`)

- PR #17: S3 region and optional static keys in both storage services; Compose reads S3 settings from `.env`; `backend/.env.production.example`; nginx real client IP from `CF-Connecting-IP` and exposed `/health/live`; `backend/scripts/deploy/{init-env,release}`; `.github/workflows/deploy.yml`; runbook.
- PR #18: deploy job authenticates with a scoped IAM user key from environment secrets (job enabled by variable `DEPLOY_ENABLED`).
- PR #19: `release` runs `db/migrate` through `bash` (the file is not executable in Git; the first automated deploy stopped on this).
- PR #20: removed the automatic GHCR cleanup job (it looked up the wrong package name and "keep newest N" is unsafe with untagged child manifests).
- This branch: design doc updated (status, diagram, region, section 15), runbook link, this handoff, and the SVG/PDF diagrams (overview and reliability corrected; new delivery-pipeline page; PDF now 3 pages).

## 4. Decisions made and deviations from the design

- Region is Sydney (`ap-southeast-2`) because the account project is pinned there; moving needs *Activate advanced features* (effect on billing not verified, so not done).
- GitHub to AWS uses a scoped IAM user key, not OIDC, because the OIDC provider page is locked behind that same setting. The key can only send a shell command to one instance. Rotate roughly every 90 days. OIDC is the documented upgrade path.
- Images live at `ghcr.io/<owner>/<repository>/<image>:<commit-sha>`, are public, and are pulled anonymously.
- No CSP change for S3: the web opens signed links as navigation.
- Evidence buckets were created without versioning; the design asked for it.
- Response and Logistics share the instance IAM role, so per-service bucket isolation exists only in application configuration.
- Secrets stay in the host `.env`, not in GitHub Secrets. Public values (`VITE_GOOGLE_CLIENT_ID`) are GitHub variables.

## 5. Known defects and caveats

- CI skips three tests that already fail on a clean `main`: `apps/logistics/test/donations-queries.service.spec.ts`, `apps/response/test/tracking-pagination.spec.ts`, and the node test "documented endpoint errors use catalog status and exact Vietnamese messages". Remove the exclusions in `deploy.yml` once fixed.
- `EmailSenderService.sendVerificationCode` swallows every error (`catch { return false }`) and logs nothing, so a mail failure is invisible. A change that logs only the error code (no address, no secret) was proposed and not made.
- `AGENTS.md` and plan section 6.3 still name MinIO as the object store; the design asked to update them. Not done, awaiting the operator's go-ahead.
- The Cloudflare `grafana` hostname still has an old proxied A record to a stale address; Grafana is not deployed. Other tunnels and the wildcard record in that zone belong to other projects and must not be touched.
- Workflow action versions (`checkout@v4`, `setup-node@v4`, `docker/*@v3/v6`, `aws-actions/configure-aws-credentials@v4`) were written from memory; the runner already warns that Node 20 actions are deprecated.
- `GOOGLE_CLIENT_IDS` is empty on the host, so server-side Google sign-in is not usable yet.
- Demo data is not seeded. The seed refuses `NODE_ENV=production`; run it with `NODE_ENV=demo` for that one command (see the runbook) and a `SEED_PASSWORD` typed at the prompt.
- An access key was once pasted into a chat during setup; it was deleted and replaced. Never paste keys, tokens or `.env` contents into chats, tickets or screenshots.

## 6. Not done

Daily backup to S3 (systemd timer, SHA-256 manifest, `pg_restore --list`, keep two) and adapting `scripts/db/backup` and `object-inventory.mjs`, which still assume MinIO; verifying the backup bucket lifecycle; enabling evidence-bucket versioning if wanted; restore and failure drills; Prometheus/Grafana/Alertmanager profile and `/metrics`; Cloudflare tunnel alert and an external uptime monitor; CloudWatch log shipping; `mem_limit` values from `docker stats`; k6 runs; k3s demo; EBS snapshots.

## 7. Checks actually run

Local: `tsc --noEmit`, eslint (0 errors), jest (170 suites, 1165 tests, with the two known-failing suites excluded), `npm run check:compose-env`, `nginx -t`, node tests (124 of 125, the one failure pre-existing), shell syntax of both deploy scripts, YAML validation of the workflow. CI on GitHub: same gates plus four Docker image builds (including `sharp` on Debian slim). On the host: `curl` to `/health/live`, `release status`, an SMTP `verify()` call (which showed the three mail faults), an S3 put/list/delete test through the instance role. Anonymous `docker manifest inspect` of all four images succeeded.

Not run: a real rollback, a restore, an evidence upload to S3, an email delivery test, load tests, any phone/GPS test through the public URL.

## 8. Environment needed to resume

Operator machine: AWS CLI v2 and `session-manager-plugin`, a profile with permission to start an SSM session on the instance, `gh` logged in with `repo` scope. Host paths: `/opt/c48` (root-owned clone), `/opt/c48/backend/.env` (mode 600), `/var/lib/c48/` (release state). Use `sudo` for every command touching `/opt/c48`. In the SSM shell paste one line at a time; multi-line pastes get joined. Docker, Compose and the AWS CLI (snap) are installed on the host.

## 9. Next concrete task

1. Confirm email works: register a test account on the public URL and check that the code arrives; if not, rerun the `verify()` check from the runbook and fix the specific error.
2. Seed the demo data, then test login and an SOS with GPS from a phone over HTTPS.
3. Implement the daily backup (S3-aware script plus systemd timer), verify the lifecycle rule, and run one restore drill. This is the largest remaining gap.
4. Then monitoring, k6 measurement, and the `AGENTS.md` / plan 6.3 update.

No real blocker. The open choices belong to the operator: enable advanced features (to move to OIDC or another region), enable evidence-bucket versioning, and whether the video limit stays.
