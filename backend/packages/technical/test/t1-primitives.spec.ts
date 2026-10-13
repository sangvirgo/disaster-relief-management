import { BadRequestException, ArgumentsHost, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import {
  ApiExceptionFilter,
  AppError,
  canonicalRequestHash,
  claimBatch,
  CircuitBreakerClient,
  CorrelationIdMiddleware,
  decodeKeysetCursor,
  encodeKeysetCursor,
  getCorrelationId,
  hashPurposeBoundSecret,
  hasPermission,
  jitteredInterval,
  loadErrorCatalog,
  LOG_REDACT_PATHS,
  IdempotencyKeyInterceptor,
  mapPostgresError,
  parseErrorCatalog,
  createPinoLogger,
  JobRunner,
  PinoNestLogger,
  postgresOptions,
  ROLE_PERMISSIONS,
  validateEnvironment,
  verifyPurposeBoundSecret,
  withDatabaseRetry,
  updateWhereVersion,
} from '../src';
import { of } from 'rxjs';

function filteredError(filter: ApiExceptionFilter, exception: unknown): { status: number; body: Record<string, unknown> } {
  let status = 0;
  let body: Record<string, unknown> = {};
  const response = {
    status(code: number) { status = code; return this; },
    json(value: Record<string, unknown>) { body = value; },
  };
  const host = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => response }) } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return { status, body };
}

describe('T1 technical package', () => {
  it('loads the Vietnamese API catalog and never leaks Nest validation text', () => {
    const catalog = loadErrorCatalog();
    expect(catalog.get('VALIDATION_FAILED')?.message).toMatch(/Dữ liệu gửi lên/);
    expect(catalog.size).toBeGreaterThan(70);
    for (const entry of catalog.values()) {
      expect(entry.message.trim()).not.toBe('');
      expect(entry.message).toMatch(/[ăâđêôơưáàảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i);
      expect(entry.message).not.toMatch(/\b(the|your|please|invalid|failed|system error)\b/i);
    }
    const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? visit(path) : path.endsWith('.ts') ? [path] : [];
    });
    for (const file of [...visit(join(process.cwd(), 'apps')), ...visit(join(process.cwd(), 'packages'))]) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/new AppError\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) {
        expect(catalog.has(match[1]!)).toBe(true);
      }
    }

    const { body: envelope } = filteredError(new ApiExceptionFilter(catalog), new BadRequestException('Cannot process this request'));
    expect(envelope).toMatchObject({ code: 'VALIDATION_FAILED', message: catalog.get('VALIDATION_FAILED')?.message });
    expect(envelope.message).not.toContain('Cannot process');
    expect(envelope.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    for (const [exception, code] of [
      [new UnauthorizedException('Missing credentials'), 'UNAUTHENTICATED'],
      [new ForbiddenException('Denied'), 'FORBIDDEN'],
      [new ConflictException('Out of date'), 'STATE_TRANSITION_INVALID'],
    ] as const) {
      const result = filteredError(new ApiExceptionFilter(catalog), exception);
      expect(result.body.code).toBe(code);
      expect(result.body.message).not.toMatch(/Missing credentials|Denied|Out of date/);
    }
    const unavailable = filteredError(new ApiExceptionFilter(catalog, 'response'), new ServiceUnavailableException('Storage endpoint URL'));
    expect(unavailable).toMatchObject({ status: 503, body: { code: 'RESPONSE_UNAVAILABLE' } });
    expect(unavailable.body.message).not.toContain('Storage endpoint URL');
  });

  it('parses only catalog rows with stable codes and Vietnamese messages', () => {
    const catalog = parseErrorCatalog([
      '| `EXAMPLE` | 409 | shared | Dữ liệu không hợp lệ. |',
      '| `VALIDATION_FAILED` | 400 | shared | Dữ liệu gửi lên không hợp lệ. |',
      '| `INTERNAL_ERROR` | 500 | shared | Hệ thống gặp lỗi. |',
    ].join('\n'));
    expect(catalog.get('EXAMPLE')).toEqual({ status: 409, message: 'Dữ liệu không hợp lệ.' });
  });

  it('maps PostgreSQL conflicts and retries deadlocks outside the failed transaction', async () => {
    expect(mapPostgresError({ code: '23505', constraint: 'mission_team_one_active_uq' }, {
      unique: { mission_team_one_active_uq: 'TEAM_BUSY' },
    })).toMatchObject({ code: 'TEAM_BUSY', status: 409 });
    expect(mapPostgresError({ code: '23514', constraint: 'stock_balance_check' }, {
      check: { stock_balance_check: 'INSUFFICIENT_STOCK' },
    })).toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 });
    expect(mapPostgresError({ code: '57014' })).toMatchObject({ code: 'LOCK_TIMEOUT', status: 503 });

    const sleep = jest.fn().mockResolvedValue(undefined);
    const operation = jest.fn().mockRejectedValueOnce({ code: '40P01' }).mockRejectedValueOnce({ code: '55P03' }).mockResolvedValue('ok');
    await expect(withDatabaseRetry(operation, { sleep, random: () => 0 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    await expect(withDatabaseRetry(() => Promise.reject({ code: '40P01' }), { sleep, random: () => 0 }))
      .rejects.toMatchObject({ code: 'LOCK_TIMEOUT', status: 503 });
  });

  it('purpose-binds secrets and reports hashes that need pepper rotation', () => {
    const oldPeppers = { v1: 'old-pepper-with-enough-entropy-0123456789' };
    const hash = hashPurposeBoundSecret('capability', 'sos-tracking', oldPeppers, 'v1');
    expect(hash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(verifyPurposeBoundSecret('capability', 'sos-tracking', hash, oldPeppers, 'v1').valid).toBe(true);
    expect(verifyPurposeBoundSecret('capability', 'donation-capability', hash, oldPeppers, 'v1').valid).toBe(false);
    expect(verifyPurposeBoundSecret('capability', 'sos-tracking', hash, {
      v1: oldPeppers.v1,
      v2: 'new-pepper-with-enough-entropy-0123456789',
    }, 'v2')).toMatchObject({ valid: true, needsRebind: true, replacement: expect.stringMatching(/^v2:/) });
  });

  it('hashes canonical payloads and requires an idempotency UUID on writes', () => {
    expect(canonicalRequestHash({ b: 2, a: 1 })).toBe(canonicalRequestHash({ a: 1, b: 2 }));
    expect(canonicalRequestHash({ a: 1 }, 'v1:hash')).not.toBe(canonicalRequestHash({ a: 1 }, 'v1:other'));

    const request: { method: string; headers: Record<string, string>; idempotencyKey?: string } = { method: 'POST', headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) };
    const next = { handle: jest.fn(() => of('ok')) };
    const interceptor = new IdempotencyKeyInterceptor();
    expect(() => interceptor.intercept(context as never, next)).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_INVALID' }));
    request.headers['idempotency-key'] = '00000000-0000-4000-8000-000000000001';
    interceptor.intercept(context as never, next);
    expect(request.idempotencyKey).toBe(request.headers['idempotency-key']);
    expect(next.handle).toHaveBeenCalledTimes(1);
    const login = { method: 'POST', path: '/api/v1/identity/auth/login', headers: {} };
    expect(() => interceptor.intercept({ switchToHttp: () => ({ getRequest: () => login }) } as never, next)).not.toThrow();
    const internal = { method: 'POST', path: '/internal/operations/intent', headers: {} };
    expect(() => interceptor.intercept({ switchToHttp: () => ({ getRequest: () => internal }) } as never, next)).not.toThrow();
  });

  it('enforces role, permission, organization, and named SYSTEM-scope rules', () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('REQUEST_DETAIL_READ');
    expect(ROLE_PERMISSIONS.INTAKE_STAFF).not.toContain('DONATION_REVIEW');
    const grant = { role_code: 'COORDINATOR' as const, scope_type: 'REGION' as const, organization_id: 'org-1', region_code: 'R1' };
    expect(hasPermission([grant], 'REQUEST_VERIFY', { organizationId: 'org-1', regionCode: 'R1' })).toBe(true);
    expect(hasPermission([grant], 'REQUEST_VERIFY', { organizationId: 'org-1', regionCode: 'R2' })).toBe(false);
    const admin = { role_code: 'ADMIN' as const, scope_type: 'SYSTEM' as const, organization_id: null };
    expect(hasPermission([admin], 'USER_MANAGE', { organizationId: 'org-1' })).toBe(false);
    expect(hasPermission([admin], 'USER_MANAGE', { systemAction: 'USER_MANAGE' })).toBe(true);
    const invalidCitizenGrant = { role_code: 'CITIZEN' as const, scope_type: 'REGION' as const, organization_id: 'org-1', region_code: 'R1' };
    expect(hasPermission([invalidCitizenGrant], 'REQUEST_CREATE_PROXY', { organizationId: 'org-1', regionCode: 'R1' })).toBe(false);
  });

  it('encodes keyset cursors with filter binding and rejects changed filters', () => {
    const filters = { status: ['ACTIVE', 'OPEN'], region: 'R1' };
    const token = encodeKeysetCursor(['2026-10-10T00:00:00Z'], '00000000-0000-0000-0000-000000000001', filters);
    expect(decodeKeysetCursor(token, { region: 'R1', status: ['ACTIVE', 'OPEN'] })).toMatchObject({
      sort: ['2026-10-10T00:00:00Z'],
      id: '00000000-0000-0000-0000-000000000001',
    });
    expect(() => decodeKeysetCursor(token, { region: 'R2', status: ['ACTIVE', 'OPEN'] }))
      .toThrow(expect.objectContaining({ code: 'CURSOR_INVALID' }));
  });

  it('validates runtime database and network configuration without echoing credentials', () => {
    expect(validateEnvironment({ DATABASE_URL: 'postgresql://user:secret@localhost/c48', PORT: '3001', DB_LOCK_TIMEOUT_MS: '4500', DB_STATEMENT_TIMEOUT_MS: '12000' }, 'identity'))
      .toMatchObject({ port: 3001, dbPoolMax: 20, dbLockTimeoutMs: 4500, dbStatementTimeoutMs: 12000 });
    expect(() => validateEnvironment({ DATABASE_URL: 'not-a-url', PORT: '70000' }, 'identity'))
      .toThrow(expect.not.stringContaining('secret'));

    const original = {
      databaseUrl: process.env.DATABASE_URL,
      lockTimeout: process.env.DB_LOCK_TIMEOUT_MS,
      statementTimeout: process.env.DB_STATEMENT_TIMEOUT_MS,
    };
    process.env.DATABASE_URL = 'postgresql://user:secret@localhost/c48';
    process.env.DB_LOCK_TIMEOUT_MS = '4500';
    process.env.DB_STATEMENT_TIMEOUT_MS = '12000';
    try {
      expect(postgresOptions([], 'identity')).toMatchObject({
        extra: { options: '-c lock_timeout=4500 -c statement_timeout=12000' },
      });
    } finally {
      if (original.databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original.databaseUrl;
      if (original.lockTimeout === undefined) delete process.env.DB_LOCK_TIMEOUT_MS;
      else process.env.DB_LOCK_TIMEOUT_MS = original.lockTimeout;
      if (original.statementTimeout === undefined) delete process.env.DB_STATEMENT_TIMEOUT_MS;
      else process.env.DB_STATEMENT_TIMEOUT_MS = original.statementTimeout;
    }
  });

  it('propagates a validated correlation id through async context', async () => {
    const middleware = new CorrelationIdMiddleware();
    const req = { headers: { 'x-correlation-id': '00000000-0000-4000-8000-000000000001' } } as never;
    const res = { setHeader: jest.fn() } as never;
    await new Promise<void>((resolve) => middleware.use(req, res, () => {
      expect(getCorrelationId()).toBe('00000000-0000-4000-8000-000000000001');
      resolve();
    }));
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-Id', '00000000-0000-4000-8000-000000000001');
  });

  it('uses Pino redaction and never writes supplied secrets to its destination', () => {
    expect(LOG_REDACT_PATHS).toEqual(expect.arrayContaining(['authorization', 'req.headers.authorization', 'phone', 'location']));
    let output = '';
    const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const logger = createPinoLogger('identity', 'info', stream);
    logger.info({ headers: { authorization: 'bearer-private', 'x-tracking-secret': 'tracking-private' }, phone: '0900000000', location: 'private-location', password: 'private-password', body: { csrf_token: 'csrf-private', tracking_secret_hash: 'hash-private' } }, 'test');
    expect(output).not.toContain('private');
    expect(output).not.toContain('csrf-private');
    expect(output).not.toContain('hash-private');
    expect(output).toContain('[REDACTED]');
    logger.flush();
    let nestOutput = '';
    const nestLogger = new PinoNestLogger(createPinoLogger('identity', 'info', new Writable({ write(chunk, _encoding, callback) { nestOutput += chunk.toString(); callback(); } })));
    nestLogger.error('Bearer secret and phone 0900000000');
    expect(nestOutput).not.toContain('Bearer secret');
    expect(nestOutput).toContain('Backend error');
    nestLogger.warn('request from phone 0900000000 at private-location');
    expect(nestOutput).not.toContain('0900000000');
    expect(nestOutput).not.toContain('private-location');
  });

  it('redacts signed URLs and named reporter PII from nested log fields', () => {
    let output = '';
    const logger = createPinoLogger('response', 'info', new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } }));
    logger.info({
      req: { url: '/evidence?X-Amz-Signature=signed-request-private', headers: { referer: 'https://example.test/?token=referer-private' } },
      evidence: { signed_url: 'https://example.test/evidence?X-Amz-Signature=signed-field-private', download_url: 'https://example.test/evidence?signature=download-private' },
      reporter_contact_phone: 'reporter-phone-private',
      beneficiary_contact_phone: 'beneficiary-phone-private',
      alternate_contact_phone: 'alternate-phone-private',
      location: { coordinates: [105.123456, 21.123456] },
    }, 'test');
    expect(output).not.toContain('signed-request-private');
    expect(output).not.toContain('referer-private');
    expect(output).not.toContain('signed-field-private');
    expect(output).not.toContain('download-private');
    expect(output).not.toContain('reporter-phone-private');
    expect(output).not.toContain('beneficiary-phone-private');
    expect(output).not.toContain('alternate-phone-private');
    expect(output).not.toContain('105.123456');
    logger.flush();
  });

  it('updates versioned rows with an optimistic version predicate', async () => {
    const manager = { queryRunner: { isTransactionActive: true }, query: jest.fn().mockResolvedValue([[{ id: 'req-1', status: 'TRIAGED', version: 3 }], 1]) };
    await expect(updateWhereVersion(manager as never, {
      table: 'assistance_request', idColumn: 'id', id: 'req-1', expectedVersion: 2, changes: { status: 'TRIAGED' },
    })).resolves.toEqual({ id: 'req-1', status: 'TRIAGED', version: 3 });
    expect(manager.query).toHaveBeenCalledWith(
      'UPDATE "assistance_request" SET "status" = $1, "version" = "version" + 1 WHERE "id" = $2 AND "version" = $3 RETURNING *',
      ['TRIAGED', 'req-1', 2],
    );
    manager.query.mockResolvedValueOnce([[], 0]);
    await expect(updateWhereVersion(manager as never, {
      table: 'assistance_request', idColumn: 'id', id: 'req-1', expectedVersion: 2, changes: { status: 'TRIAGED' },
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(updateWhereVersion(manager as never, {
      table: 'assistance_request; DELETE FROM app_user', idColumn: 'id', id: 'req-1', expectedVersion: 2, changes: { status: 'TRIAGED' },
    })).rejects.toThrow(TypeError);
  });

  it('runs a job only after taking its transaction advisory lock', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ locked: true }]) };
    const dataSource = { transaction: (work: (manager: typeof manager) => unknown) => work(manager) };
    const work = jest.fn().mockResolvedValue(1);
    await expect(new JobRunner(dataSource as never).runOnce('cleanup', work)).resolves.toBe(true);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_xact_lock'), ['cleanup']);
    expect(work).toHaveBeenCalledWith(manager);
    expect(jitteredInterval(1_000, () => 0.5)).toBe(1_000);
    expect(jitteredInterval(1_000, () => 0)).toBe(800);
    expect(jitteredInterval(1_000, () => 1)).toBe(1_200);
    const claimManager = { query: jest.fn().mockResolvedValue([]) };
    await claimBatch(claimManager as never, 'SELECT id FROM notice WHERE read_at IS NULL ORDER BY created_at, id', [], 100);
    expect(claimManager.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1 FOR UPDATE SKIP LOCKED'), [100]);
    await expect(claimBatch(claimManager as never, 'SELECT id FROM notice ORDER BY id', [], 101)).rejects.toThrow(RangeError);
  });

  it('coalesces identical live service calls and opens a per-callee circuit after five failures', async () => {
    let hits = 0;
    let fail = false;
    const server: Server = createServer((request, response) => {
      hits++;
      if (fail) {
        response.statusCode = 503;
        response.end('{}');
        return;
      }
      setTimeout(() => { response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); }, 30);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const client = new CircuitBreakerClient(`http://127.0.0.1:${address.port}`, 'IDENTITY_UNAVAILABLE');
    try {
      const [a, b] = await Promise.all([
        client.get('/internal/introspect', { singleFlightKey: 'sid-1' }),
        client.get('/internal/introspect', { singleFlightKey: 'sid-1' }),
      ]);
      expect(a.body).toEqual({ ok: true });
      expect(b.body).toEqual({ ok: true });
      expect(hits).toBe(1);

      await Promise.all([
        client.get('/internal/introspect', { singleFlightKey: 'sid-2', headers: { authorization: 'Bearer user-a' } }),
        client.get('/internal/introspect', { singleFlightKey: 'sid-2', headers: { authorization: 'Bearer user-b' } }),
      ]);
      expect(hits).toBe(3);

      fail = true;
      for (let i = 0; i < 5; i++) await expect(client.get('/failure')).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
      const hitsAtOpen = hits;
      await expect(client.get('/failure')).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE', status: 503 });
      expect(hits).toBe(hitsAtOpen);
    } finally {
      client.close();
      server.close();
    }
  });
});
