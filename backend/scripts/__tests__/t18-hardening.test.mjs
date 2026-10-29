import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nginx = readFileSync(new URL('../../infra/nginx/nginx.conf', import.meta.url), 'utf8');

test('the ingress keeps required security headers and excludes query strings from access logs', () => {
  const accessLog = nginx.match(/log_format privacy[^;]*/u)?.[0] ?? '';
  assert.match(accessLog, /\$uri/u);
  assert.doesNotMatch(accessLog, /\$(?:request|request_uri|args|remote_addr|remote_user|http_x_forwarded_for|http_user_agent|http_referer)\b/u);
  assert.match(nginx, /add_header X-Content-Type-Options nosniff always;/u);
  assert.match(nginx, /add_header Referrer-Policy no-referrer always;/u);
  const policies = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/gu)];
  assert.ok(policies.length > 0);
  for (const [, policy] of policies) {
    const directives = new Map(policy.split(';').map((entry) => {
      const [name, ...sources] = entry.trim().split(/\s+/u);
      return [name, sources];
    }));
    for (const [name, required] of [['default-src', "'self'"], ['base-uri', "'self'"], ['object-src', "'none'"], ['frame-ancestors', "'none'"]]) {
      assert.deepEqual(directives.get(name), [required]);
    }
    assert.ok(directives.get('script-src')?.includes("'self'"));
    assert.ok(!directives.get('script-src')?.includes("'unsafe-inline'"));
  }
  assert.match(nginx, /add_header Cache-Control no-store always;/u);
});

test('the Nginx throttle error carries no-store and a correlation ID', () => {
  const rateLimited = nginx.match(/location @rate_limited \{([\s\S]*?)\n    \}/u)?.[1] ?? '';
  assert.match(rateLimited, /add_header Cache-Control no-store always;/u);
  assert.match(rateLimited, /add_header X-Correlation-Id \$request_id always;/u);
  assert.match(rateLimited, /"correlation_id":"\$request_id"/u);
});

test('database backups are private and use only the existing main Compose service', () => {
  const backup = readFileSync(new URL('../db/backup', import.meta.url), 'utf8');
  const endpointVerifier = readFileSync(new URL('../db/verify-minio-endpoint.mjs', import.meta.url), 'utf8');
  const objectInventory = readFileSync(new URL('../db/object-inventory.mjs', import.meta.url), 'utf8');
  assert.match(backup, /umask 077/u);
  assert.match(backup, /infra\/compose\.yaml/u);
  assert.match(backup, /compose exec -T postgres/u);
  assert.match(backup, /compose config --format json/u);
  assert.match(backup, /verify-minio-endpoint\.mjs/u);
  assert.match(backup, /validate-mc-config\.mjs/u);
  assert.ok(backup.indexOf('validate-mc-config.mjs') < backup.indexOf('compose config --format json'));
  assert.match(backup, /object-inventory\.mjs/u);
  assert.match(backup, /object_inventory\.jsonl/u);
  assert.match(backup, /c48_identity[\s\S]*c48_response[\s\S]*c48_logistics/u);
  assert.match(backup, /c48-response-evidence[\s\S]*c48-logistics-evidence/u);
  assert.match(backup, /outside the repository/u);
  assert.match(endpointVerifier, /services\?\.minio\?\.ports/u);
  assert.match(endpointVerifier, /aliases\?\.\[alias\]\?\.url/u);
  assert.doesNotMatch(endpointVerifier, /accessKey|secretKey/u);
  assert.match(objectInventory, /bucket,/u);
  assert.match(objectInventory, /key:/u);
  assert.match(objectInventory, /size_bytes:/u);
  assert.match(objectInventory, /sha256,/u);
  assert.match(objectInventory, /isSymbolicLink/u);
  const mcConfigValidator = readFileSync(new URL('../db/validate-mc-config.mjs', import.meta.url), 'utf8');
  assert.match(mcConfigValidator, /lstatSync/u);
  assert.match(mcConfigValidator, /isSymbolicLink()/u);
  assert.match(mcConfigValidator, /isFile()/u);
  assert.match(mcConfigValidator, /0o077/u);
  assert.match(mcConfigValidator, /join\(directory\.absolutePath, 'config\.json'\)/u);
});

test('restore refuses primary databases and requires an explicitly isolated destination', () => {
  const restore = readFileSync(new URL('../db/restore', import.meta.url), 'utf8');
  assert.match(restore, /PGSERVICE_IDENTITY/u);
  assert.match(restore, /PGSERVICE_RESPONSE/u);
  assert.match(restore, /PGSERVICE_LOGISTICS/u);
  assert.match(restore, /I_HAVE_AN_ISOLATED_DESTINATION/u);
  assert.match(restore, /service_file_mode/u);
  assert.match(restore, /c48_identity[\s\S]*c48_response[\s\S]*c48_logistics/u);
  assert.match(restore, /compose exec -T postgres/u);
  assert.match(restore, /pg_control_system\(\)/u);
  assert.match(restore, /primary_system_identifier/u);
  assert.match(restore, /target_system_identifier/u);
  assert.match(restore, /could not inspect primary PostgreSQL cluster identity/u);
  assert.match(restore, /could not inspect recovery PostgreSQL cluster identity/u);
  const targetObjectQuery = restore.match(/user_object_query="\$\(cat <<'SQL'\n([\s\S]*?)\nSQL\n\)/u)?.[1] ?? '';
  assert.match(targetObjectQuery, /FROM pg_namespace/u);
  assert.match(targetObjectQuery, /FROM pg_class/u);
  assert.match(targetObjectQuery, /FROM pg_type/u);
  assert.match(targetObjectQuery, /FROM pg_proc/u);
  assert.match(targetObjectQuery, /FROM pg_operator/u);
  assert.match(targetObjectQuery, /FROM pg_largeobject_metadata/u);
  assert.match(targetObjectQuery, /FROM pg_publication/u);
  assert.match(targetObjectQuery, /FROM pg_foreign_data_wrapper/u);
  assert.match(targetObjectQuery, /FROM pg_foreign_server/u);
  assert.match(targetObjectQuery, /FROM pg_event_trigger/u);
  const extensionBranch = targetObjectQuery.split(/UNION ALL/u).find((part) => part.includes('FROM pg_extension x')) ?? '';
  assert.match(extensionBranch, /FROM pg_extension x/u);
  assert.match(extensionBranch, /x\.oid >= 16384/u);
  assert.doesNotMatch(extensionBranch, /extension_members/u);
  assert.match(targetObjectQuery, /FROM pg_subscription/u);
  for (const [catalog, alias] of [
    ['pg_am', 'a'],
    ['pg_cast', 'c'],
    ['pg_language', 'l'],
    ['pg_transform', 't'],
    ['pg_default_acl', 'd'],
    ['pg_user_mapping', 'm'],
  ]) {
    assert.match(targetObjectQuery, new RegExp(`FROM ${catalog} ${alias}`, 'u'));
    const branch = targetObjectQuery.split(/UNION ALL/u).find((part) => part.includes(`FROM ${catalog} ${alias}`)) ?? '';
    assert.match(branch, new RegExp(`${alias}\\.oid >= 16384`, 'u'));
    assert.match(branch, new RegExp(`classid = '${catalog}'::regclass`, 'u'));
    assert.match(branch, new RegExp(`objid = ${alias}\\.oid`, 'u'));
  }
  const languageBranch = targetObjectQuery.split(/UNION ALL/u).find((part) => part.includes('FROM pg_language l')) ?? '';
  assert.match(languageBranch, /l\.lanispl/u);
  const userMappingBranch = targetObjectQuery.split(/UNION ALL/u).find((part) => part.includes('FROM pg_user_mapping m')) ?? '';
  assert.doesNotMatch(userMappingBranch, /pg_foreign_server/u);
  const subscriptionBranch = targetObjectQuery.split(/UNION ALL/u).find((part) => part.includes('FROM pg_subscription s')) ?? '';
  assert.match(subscriptionBranch, /JOIN pg_database d ON d\.oid = s\.subdbid/u);
  assert.match(subscriptionBranch, /d\.datname = current_database\(\)/u);
  assert.match(targetObjectQuery, /classid = 'pg_foreign_data_wrapper'::regclass/u);
  assert.match(targetObjectQuery, /classid = 'pg_foreign_server'::regclass/u);
  assert.match(targetObjectQuery, /classid = 'pg_event_trigger'::regclass/u);
  assert.match(targetObjectQuery, /classid = 'pg_subscription'::regclass/u);
  assert.match(targetObjectQuery, /FROM user_namespaces n\s+WHERE n\.nspname <> 'public'/u);
  assert.match(targetObjectQuery, /FROM pg_class c JOIN user_namespaces n ON n\.oid = c\.relnamespace/u);
  assert.match(targetObjectQuery, /FROM pg_type t JOIN user_namespaces n ON n\.oid = t\.typnamespace/u);
  assert.match(targetObjectQuery, /FROM pg_proc p JOIN user_namespaces n ON n\.oid = p\.pronamespace/u);
  assert.match(targetObjectQuery, /SELECT count\(\*\) FROM user_objects/u);
  assert.match(targetObjectQuery, /NOT IN \('pg_catalog', 'information_schema'\)/u);
  assert.match(targetObjectQuery, /nspname !~ '\^pg_'/u);
  assert.match(targetObjectQuery, /nspname <> 'public'/u);
  assert.match(targetObjectQuery, /refclassid = 'pg_extension'::regclass AND deptype = 'e'/u);
  assert.match(restore, /target_user_object_count" == '0'/u);
  assert.match(restore, /could not verify recovery database has no user-created objects/u);
  const objectQueryExecution = restore.match(/if ! target_user_object_count=([\s\S]*?)\n  fi/u)?.[1] ?? '';
  assert.match(objectQueryExecution, /psql[\s\S]*--command="\$user_object_query"/u);
  assert.match(objectQueryExecution, /fail 'could not verify recovery database has no user-created objects'/u);
  assert.doesNotMatch(restore, /--clean\b|--create\b|DROP DATABASE|docker compose (?:down|rm)/u);
});

test('the performance scenario is gated before it can send SOS writes', () => {
  const k6 = readFileSync(new URL('../../test/k6/t18-hardening.js', import.meta.url), 'utf8');
  assert.match(k6, /K6_ENABLE_SOS_WRITES/u);
  assert.match(k6, /vus:\s*20/u);
  assert.match(k6, /duration:\s*['"]2m['"]/u);
  assert.match(k6, /duration:\s*['"]10m['"]/u);
  assert.match(k6, /__ITER\s*%\s*5/u);
  assert.match(k6, /read_latency_ms/u);
  assert.match(k6, /sos_latency_ms/u);
  assert.match(k6, /function isLoopbackBaseUrl/u);
  assert.match(k6, /if \(!isLoopbackBaseUrl\(publicBaseUrl\)\)/u);
  assert.match(k6, /localhost/u);
  assert.match(k6, /hostname === '\[::1\]'/u);
  assert.match(k6, /octets\[0\] === 127/u);
  assert.ok(k6.indexOf('if (!isLoopbackBaseUrl(publicBaseUrl))') < k6.indexOf("K6_ENABLE_SOS_WRITES !== '1'"));
});

test('the hardening smoke covers anonymous routes, invalid DTOs, and optional read-only audit access', () => {
  const smoke = readFileSync(new URL('../smoke/t18-hardening.mjs', import.meta.url), 'utf8');
  const invalidDtoCheck = smoke.match(/const invalidIntake = await request\([\s\S]*?verifyError\(invalidIntake,\s*\{[\s\S]*?\}\);/u)?.[0] ?? '';
  assert.match(smoke, /\/api\/v1\/identity\/me/u);
  assert.match(smoke, /\/api\/v1\/response\/requests\/mine\?limit=1/u);
  assert.match(smoke, /\/api\/v1\/logistics\/audit-logs\?entity_type=distribution/u);
  assert.match(smoke, /\/api\/v1\/response\/requests/u);
  assert.match(smoke, /C48_T18_AUDIT_READ_TOKEN/u);
  assert.match(smoke, /C48_T18_AUDIT_DENIED_TOKEN/u);
  assert.match(smoke, /AUDIT_READ/u);
  assert.match(smoke, /const auditItems = auditPage\.value\.items;\s*if \(auditItems\.length === 0\)/u);
  assert.match(smoke, /SKIP Logistics audit filtering: no distribution audit rows/u);
  assert.match(smoke, /assert\.ok\(auditItems\.length > 0,/u);
  assert.match(smoke, /entity_id=\$\{encodeURIComponent\(entityId\)\}/u);
  assert.match(smoke, /item\.entity_type === 'distribution' && item\.entity_id === entityId/u);
  assert.match(smoke, /const nonmatchingEntityId = randomUUID\(\)/u);
  assert.match(smoke, /assert\.notEqual\(nonmatchingEntityId, entityId\)/u);
  assert.match(smoke, /assert\.deepEqual\(unmatchedAudit\.value\?\.items, \[\]/u);
  assert.match(smoke, /PASS Logistics audit filtering: populated results match the requested entity_id; a valid nonmatching entity_id returns no rows/u);
  assert.match(smoke, /--direct-apis/u);
  assert.match(smoke, /'Idempotency-Key': randomUUID\(\)/u);
  assert.match(smoke, /checkIngressHeaders: !directApiMode/u);
  assert.doesNotMatch(smoke, /SKIP DTO POST/u);
  assert.match(invalidDtoCheck, /method: 'POST'/u);
  assert.match(invalidDtoCheck, /body: \{\}/u);
  assert.match(invalidDtoCheck, /status: 400/u);
  assert.match(invalidDtoCheck, /code: 'VALIDATION_FAILED'/u);
  assert.match(smoke, /127\.0\.0\.1:3001/u);
  assert.match(smoke, /127\.0\.0\.1:3002/u);
  assert.match(smoke, /127\.0\.0\.1:3003/u);
  assert.match(smoke, /VALIDATION_FAILED/u);
  assert.match(smoke, /UNAUTHENTICATED/u);
  assert.match(smoke, /cache-control/iu);
  assert.doesNotMatch(smoke, /\/auth\/(?:register|login)|\/auth\/refresh|node:child_process|from ['"]pg['"]/u);
});

test('the main-stack audit access smoke uses temporary Identity grants and removes only its own rows', () => {
  const smoke = readFileSync(new URL('../smoke/test-logistics-audit-access.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /C48_IDENTITY_DATABASE_URL/u);
  assert.match(smoke, /'c48_identity'/u);
  assert.match(smoke, /url\.port !== '55432'/u);
  assert.match(smoke, /\['127\.0\.0\.1', 'localhost', '\[::1\]'\]\.includes\(url\.hostname\)/u);
  assert.match(smoke, /url\.search \|\| url\.hash/u);
  assert.match(smoke, /\['postgres:', 'postgresql:'\]\.includes\(url\.protocol\)/u);
  assert.match(smoke, /createTemporaryActor\('ADMIN'/u);
  assert.match(smoke, /createTemporaryActor\('VOLUNTEER'/u);
  assert.match(smoke, /\/api\/v1\/identity\/auth\/login/u);
  assert.match(smoke, /\/api\/v1\/logistics\/audit-logs\?entity_type=distribution/u);
  assert.match(smoke, /assert\.equal\(allowed\.status, 200/u);
  assert.match(smoke, /if \(auditItems\.length === 0\)/u);
  assert.match(smoke, /SKIP Logistics audit filtering: no distribution audit rows/u);
  assert.match(smoke, /assert\.ok\(auditItems\.length > 0,/u);
  assert.match(smoke, /entity_id=\$\{encodeURIComponent\(entityId\)\}/u);
  assert.match(smoke, /item\.entity_type === 'distribution' && item\.entity_id === entityId/u);
  assert.match(smoke, /const nonmatchingEntityId = randomUUID\(\)/u);
  assert.match(smoke, /assert\.notEqual\(nonmatchingEntityId, entityId\)/u);
  assert.match(smoke, /assert\.deepEqual\(unmatchedAudit\.body\?\.items, \[\]/u);
  assert.match(smoke, /PASS Logistics audit filtering: populated results match the requested entity_id; a valid nonmatching entity_id returns no rows/u);
  assert.match(smoke, /assert\.equal\(denied\.body\?\.code, 'FORBIDDEN'/u);
  assert.match(smoke, /Bạn không có quyền thực hiện thao tác này\./u);
  assert.match(smoke, /DELETE FROM refresh_session/u);
  assert.match(smoke, /refresh_sessions: 0/u);
  assert.match(smoke, /DELETE FROM session_family/u);
  assert.match(smoke, /DELETE FROM role_grant/u);
  assert.match(smoke, /DELETE FROM app_user/u);
  assert.doesNotMatch(smoke, /DELETE\s+FROM\s+audit_log|TRUNCATE\s+audit_log/iu);
});

test('the audit smoke rejects PostgreSQL target overrides before connecting', () => {
  const smokePath = fileURLToPath(new URL('../smoke/test-logistics-audit-access.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [smokePath], {
    encoding: 'utf8',
    timeout: 3_000,
    env: {
      ...process.env,
      C48_IDENTITY_DATABASE_URL: 'postgresql://127.0.0.1:55432/c48_identity?host=192.0.2.1',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /primary loopback c48_identity database/u);
});

test('the runbook keeps recovery isolated and reports restore and load gates honestly', () => {
  const runbook = readFileSync(new URL('../../../docs/backend/t18-hardening.md', import.meta.url), 'utf8');
  assert.match(runbook, /c48_recovery_identity/u);
  assert.match(runbook, /must not be restored over/u);
  assert.match(runbook, /TC-29.*pending|pending.*TC-29/isu);
  assert.match(runbook, /k6.*not run|not run.*k6/isu);
  assert.match(runbook, /object restoration remains blocked until an operator independently verifies.*target buckets are empty/isu);
  assert.match(runbook, /MC_CONFIG_DIR[\s\S]*symlinks[\s\S]*0700[\s\S]*config\.json[\s\S]*0600/iu);
  const shellBlocks = [...runbook.matchAll(/```sh\n([\s\S]*?)\n```/gu)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(shellBlocks, /\bmc\b[\s\S]{0,120}\bmirror\b/u);
  assert.match(runbook, /foreign data wrappers, foreign servers, event triggers, access methods, casts, procedural languages, transforms, default privileges, user mappings, and subscriptions/u);
  assert.match(runbook, /OIDs at or above 16384/u);
  assert.match(runbook, /non-system extensions/u);
  assert.match(runbook, /`pg_extension` rows with OIDs at or above 16384/u);
  assert.match(runbook, /User mappings are checked independently/u);
  assert.match(runbook, /subscriptions scoped to the target database/u);
});

test('the setup and T18 evidence docs distinguish passed backend checks from pending acceptance gates', () => {
  const setup = readFileSync(new URL('../../../docs/backend/00-setup.md', import.meta.url), 'utf8');
  const runbook = readFileSync(new URL('../../../docs/backend/t18-hardening.md', import.meta.url), 'utf8');
  const tasks = readFileSync(new URL('../../../docs/backend/06-implementation-tasks.md', import.meta.url), 'utf8');
  const tracking = readFileSync(new URL('../../apps/response/src/tracking/tracking-read-rate-limiter.ts', import.meta.url), 'utf8');

  assert.match(setup, /TC-29 restore execution remains pending/u);
  assert.doesNotMatch(setup, /restore verified on an empty stack/u);
  assert.match(runbook, /## TC-BE acceptance evidence/u);
  assert.match(runbook, /TC-BE-27[\s\S]*backend[\s\S]*passed[\s\S]*Web\/Mobile[\s\S]*inert-rendering[\s\S]*pending/iu);
  assert.match(runbook, /TC-BE-28 — partial[\s\S]*statement-timeout rollback across three attempts[\s\S]*lock-timeout rollback[\s\S]*idempotent retries\/replays[\s\S]*Runtime pool saturation\/bounds remain \*\*PENDING\*\*/u);
  assert.match(runbook, /configuration unit test in `backend\/packages\/technical\/test\/t1-primitives\.spec\.ts` verifies that `DB_POOL_MAX=100` is accepted, `101` is rejected, and `postgresOptions` passes the configured value as `extra\.max`\./u);
  assert.match(tasks, /T18 \| \*\*Hardening \+ evidence — IMPLEMENTED; acceptance gates open\*\*[^\n]*Logistics admin-only audit reader/u);
  assert.match(tasks, /Main-stack direct checks pass anonymous 401, Vietnamese validation 400, audit allow\/deny, and populated `entity_id` filtering; auth timeout\/retry smoke passes and verifies cleanup\. The full Nginx ingress smoke passed on port 8081\. Web\/Mobile accessibility, TC-BE-28 runtime pool saturation, remaining TC-BE-29 cross-service log review and query-plan evidence, TC-29 restore, and hardware-recorded TC-PERF-01 remain open/u);
  assert.match(runbook, /TC-BE-29[\s\S]*2026-10-15 main-stack audit smoke passed populated matching\/nonmatching `entity_id` filters[\s\S]*source audit reviewed the known Identity, Response, and Logistics logger callsites and shared Pino redaction[\s\S]*CSV export and push are not implemented/iu);
  assert.match(runbook, /TC-BE-27[\s\S]*direct API and Nginx ingress smokes passed again on 2026-10-16[\s\S]*validation `400 VALIDATION_FAILED`[\s\S]*Port 8080 remains occupied[\s\S]*Web\/Mobile inert-rendering and accessibility checks remain pending/iu);
  assert.match(runbook, /C48_T18_PUBLIC_BASE_URL=http:\/\/127\.0\.0\.1:8081 node --env-file=\.env scripts\/smoke\/t18-hardening\.mjs/u);
  assert.match(runbook, /Direct API smoke covers anonymous Identity, Response, and Logistics audit 401 checks for `UNAUTHENTICATED`, Vietnamese messages, and `no-store`; it also covers an invalid DTO POST with `400 VALIDATION_FAILED`/iu);
  assert.match(runbook, /node --env-file=\.env scripts\/smoke\/test-logistics-audit-access\.mjs/u);
  assert.match(runbook, /Identity audit rows 0 -> 0/u);
  assert.doesNotMatch(runbook, /DTO POST explicitly skipped/u);
  assert.match(runbook, /Web\/Mobile inert-rendering and accessibility checks remain pending/u);
  assert.doesNotMatch(runbook, /direct smoke was blocked by sandbox `EPERM`|direct GET-only API smoke did not complete|direct runtime evidence remains pending too/u);
  assert.match(runbook, /node scripts\/__tests__\/t18-hardening\.test\.mjs.*PASS \(10\/10\)/u);
  assert.match(runbook, /node scripts\/__tests__\/t18-backup-safety\.test\.mjs.*PASS \(7\/7\)/u);
  assert.match(runbook, /git diff --check.*PASS/u);
  assert.match(tracking, /private lastPrunedAt = Number\.NEGATIVE_INFINITY/u);
  assert.match(tracking, /now - this\.lastPrunedAt >= trackingMinuteMs/u);
  assert.match(runbook, /Full-map cleanup runs at most once per minute/u);
  assert.match(runbook, /selected alias `url` in `\$MC_CONFIG_DIR\/config\.json`/u);
  assert.match(runbook, /system_identifier/u);
  assert.match(runbook, /object_inventory\.jsonl/u);
  assert.match(runbook, /rejects non-loopback URLs/u);
});
