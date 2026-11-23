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
- PR #22: `backend/scripts/deploy/reset-demo-data --reset` wipes and reseeds the demo data on the host (typed hostname confirmation, verified safety dump first, removes only `c48_pgdata`, never touches MinIO or S3, seeds with a one-command `NODE_ENV=development` override); the production guard in `lib.sh` now fails closed.
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
- `AGENTS.md` and plan section 6.3 still name MinIO as the object store, and `AGENTS.md` lists only `test-db --reset` and `reset-demo --reset` as reset commands (the new `reset-demo-data` follows the same rules but is not named). Not updated, awaiting the operator's go-ahead.
- The Cloudflare `grafana` hostname still has an old proxied A record to a stale address; Grafana is not deployed. Other tunnels and the wildcard record in that zone belong to other projects and must not be touched.
- Workflow action versions (`checkout@v4`, `setup-node@v4`, `docker/*@v3/v6`, `aws-actions/configure-aws-credentials@v4`) were written from memory; the runner already warns that Node 20 actions are deprecated.
- `GOOGLE_CLIENT_IDS` is empty on the host, so server-side Google sign-in is not usable yet.
- Demo data is not seeded. The seed refuses `NODE_ENV=production`; run it with `NODE_ENV=development` for that one command (see the runbook) and a password typed at a hidden prompt. `NODE_ENV=demo` is **invalid** (the services accept only development, test or production); an earlier version of the runbook said otherwise and was corrected.
- `require_nonproduction_env` in `backend/scripts/dev/lib.sh` used to fail open when `backend/.env` was unreadable (`awk` exit 2 was read as "not production"). Fixed in PR #22 and covered by a test.
- The Session Manager shell runs as `ssm-user` with `sh`, so commands that touch `/opt/c48` need `sudo`; `sudo -i` gives a root bash login shell for the session.
- An access key was once pasted into a chat during setup; it was deleted and replaced. Never paste keys, tokens or `.env` contents into chats, tickets or screenshots.

## 6. Not done

Daily backup to S3 (systemd timer, SHA-256 manifest, `pg_restore --list`, keep two) and adapting `scripts/db/backup` and `object-inventory.mjs`, which still assume MinIO; verifying the backup bucket lifecycle; enabling evidence-bucket versioning if wanted; restore and failure drills; Prometheus/Grafana/Alertmanager profile and `/metrics`; Cloudflare tunnel alert and an external uptime monitor; CloudWatch log shipping; `mem_limit` values from `docker stats`; k6 runs; k3s demo; EBS snapshots.

## 7. Checks actually run

Local: `tsc --noEmit`, eslint (0 errors), jest (170 suites, 1165 tests, with the two known-failing suites excluded), `npm run check:compose-env`, `nginx -t`, node tests (124 of 125, the one failure pre-existing), shell syntax of both deploy scripts, YAML validation of the workflow. CI on GitHub: same gates plus four Docker image builds (including `sharp` on Debian slim). On the host: `curl` to `/health/live`, `release status`, an SMTP `verify()` call (which showed the three mail faults), an S3 put/list/delete test through the instance role. Anonymous `docker manifest inspect` of all four images succeeded.

Not run: `reset-demo-data` on the real host (tested with fake docker only), a real rollback, a restore, an evidence upload to S3, an email delivery test, load tests, any phone/GPS test through the public URL.

## 8. Environment needed to resume

Operator machine: AWS CLI v2 and `session-manager-plugin`, a profile with permission to start an SSM session on the instance, `gh` logged in with `repo` scope. Host paths: `/opt/c48` (root-owned clone), `/opt/c48/backend/.env` (mode 600), `/var/lib/c48/` (release state). Use `sudo` for every command touching `/opt/c48`. In the SSM shell paste one line at a time; multi-line pastes get joined. Docker, Compose and the AWS CLI (snap) are installed on the host.

## 9. Next concrete task

1. Confirm email works: register a test account on the public URL and check that the code arrives; if not, rerun the `verify()` check from the runbook and fix the specific error.
2. Seed the demo data with `bash backend/scripts/deploy/reset-demo-data --reset` as root from `/opt/c48` (it also works on an empty database; the one-line seed in the runbook is the alternative), then test login and an SOS with GPS from a phone over HTTPS. Do not run it while a deploy is in progress (they share a lock).
3. Implement the daily backup (S3-aware script plus systemd timer), verify the lifecycle rule, and run one restore drill. This is the largest remaining gap.
4. Then monitoring, k6 measurement, and the `AGENTS.md` / plan 6.3 update.

No real blocker. The open choices belong to the operator: enable advanced features (to move to OIDC or another region), enable evidence-bucket versioning, and whether the video limit stays.

## 10. Update 2026-11-23 (second session)

No secret, account number, key id, IP address or mailbox is recorded here.

**Done and merged (PRs #24 to #29), each with CI green on its last commit and a successful CD run**

| PR | What | Verified how |
|---|---|---|
| #24 | `EmailSenderService` logs only the nodemailer/SMTP code (`EMAIL_SEND_FAILED code=EAUTH smtp_response=535`), with tests | jest 4 tests; on the host `nodemailer verify()` returned OK. **Mail delivery to an inbox is still not confirmed** (needs a human to register and read the mailbox) |
| #25 | `backup-s3` (3 dumps, `pg_restore --list`, SHA-256 manifest, S3-verified upload, keep newest 2), `restore-s3` (`--list --verify --counts --reset`), systemd timer 19:00 UTC installed by `release` | Fake-docker/aws tests (7 + 1). **Real host**: 3 consecutive runs left exactly 2 backups (10 objects); drill backup, `reset-demo-data`, `restore-s3 --reset`: 79 tables, row counts identical before and after, health checks passed |
| #26 | Fixed the 3 known failing tests (two stale tests/snapshots, one already passing) and removed the CI exclusions | Full jest 173 suites / 1180 tests; node tests all pass |
| #27 | Internal `/metrics` (prom-client) on the 3 APIs, Compose profile `observability` (Prometheus, Alertmanager, node_exporter, postgres_exporter, Grafana; digests pinned), rules, one dashboard, `container-metrics` textfile timer, optional `c48_monitor` role | jest 9 + node tests 150; `promtool check rules` and `amtool check-config`. On the host: `/metrics` answers directly, 404 with a proxy header |
| #28, #29 | `release` recreates nginx after the stack starts | #28 (reload) did not work: a single-file bind mount keeps the old inode after `git checkout`; #29 recreates the container. Host: `nginx -T` shows the `/metrics` rule, `/metrics` through nginx returns 404 |

**Verified on the host:** `reset-demo-data --reset` runs end to end (first real run). A 4000x3000 JPEG uploaded as a guest SOS evidence was stored as 2048x1536 (368 KB), and the signed 60-second S3 URL (regional S3 endpoint) downloaded it.

**Not done / needs a human**
- Profile `observability` is **not running yet**: it needs `GRAFANA_ADMIN_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` typed into `/opt/c48/backend/.env` by the operator and `C48_OBSERVABILITY=on`. `C48_MONITOR_PASSWORD` was generated on the host. Then Cloudflare: public hostname `grafana` to `http://localhost:3000` on tunnel `reliva-ec2`, an Access policy, and the Tunnel health notification. RAM before: about 1.16 GB used, 2.67 GB available (6 containers); after: not measured.
- Backup bucket lifecycle (expire after 3 days, abort incomplete multipart) not verified: the instance role cannot read it; the operator must check in the S3 console. Offsite copy: download one backup by hand.
- Logistics evidence upload through the public API not verified (creating a delivery needs a signed-in account).
- Not started: `mem_limit` values, CloudWatch Logs, k6 runs, AGENTS.md / plan 6.3 update (needs the operator's consent), Node 20 action warnings.

**Lessons**
- `git stash` is shared by all worktrees: a bare `git stash pop` applied the operator's older stash onto an agent worktree (undone; the stash is intact). Do not use stash in worktrees.
- Non-interactive SSM: a pty is required (`script -qec`); pass multi-line scripts as `sudo bash -c "echo <base64> | base64 -d | bash"`.

**Next concrete task:** operator sets the four `.env` values; then run `release`-equivalent start of the profile, measure `docker stats` and `free -m`, send a test alert, then Cloudflare Access.
