import { describe, expect, it, jest } from '@jest/globals';
import type { Grant } from '@c48/identity-contracts/permissions';
import { CLAIM_TTL_MINUTES, claimConflictMessage, claimIsActive } from '../src/operations/request-claims.helpers';
import { RequestClaimGuard } from '../src/operations/request-claims.guard';
import { RequestClaimService } from '../src/operations/request-claims.service';
import { RequestOperationsCommandRunner } from '../src/operations/request-operations.command-runner.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const campaignOne = '22222222-2222-4222-8222-222222222222';
const campaignTwo = '33333333-3333-4333-8333-333333333333';
const me = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const dbNow = new Date('2026-11-14T10:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(dbNow.getTime() - minutes * 60_000);

const campaignCoordinator = (campaign_id: string): Grant => ({ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id });
const systemCoordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null };

interface Row {
  id: string;
  status: string;
  version: number;
  campaign_id: string | null;
  handled_by: string | null;
  handled_at: Date | null;
  db_now: Date;
}

function fixture(overrides: Partial<Row> = {}) {
  const current: Row = {
    id: requestId, status: 'VERIFIED', version: 4, campaign_id: campaignOne,
    handled_by: null, handled_at: null, db_now: dbNow, ...overrides,
  };
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes('FROM assistance_request') && sql.includes('handled_by') && sql.includes('FOR UPDATE')) return [{ ...current }];
      return [];
    }),
  };
  return { manager, queries, current };
}

function dependencies(session: { userId: string; grants: Grant[] }, holderName: string | null = 'Nguyễn Văn B') {
  const sessions = {
    require: jest.fn(async () => session),
    lookupUsers: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, username: 'user', display_name: holderName ?? '' }))),
  };
  const persistence = {
    insertEvent: jest.fn(async () => 'event-1'),
    currentRequestValue: jest.fn(async () => ({ id: requestId })),
  };
  const commandRunner = {
    runCommand: jest.fn(async (...args: unknown[]) => {
      const execute = args[5] as (manager: unknown) => Promise<{ value: unknown }>;
      return execute as unknown;
    }),
  };
  return { sessions, persistence, commandRunner };
}

function runWith(fx: ReturnType<typeof fixture>, deps: ReturnType<typeof dependencies>) {
  const service = new RequestClaimService(
    deps.sessions as never, deps.commandRunner as never, deps.persistence as never, new RequestClaimGuard(deps.sessions as never, deps.persistence as never),
  );
  const execute = async (method: 'claim' | 'release') => {
    const runCommand = deps.commandRunner.runCommand as unknown as jest.Mock;
    if (method === 'claim') await service.claim(requestId, 'idem-key-1', {} as never);
    else await service.release(requestId, 'idem-key-1', {} as never);
    const args = runCommand.mock.calls.at(-1) as unknown[];
    const executeFn = args[5] as (manager: unknown) => Promise<{ value: Record<string, unknown> }>;
    return executeFn(fx.manager);
  };
  return { service, execute };
}

describe('request claim helpers', () => {
  it('uses a 15 minute inactivity window', () => {
    expect(CLAIM_TTL_MINUTES).toBe(15);
  });

  it('treats a claim as active only inside the inactivity window', () => {
    expect(claimIsActive(minutesAgo(5), dbNow)).toBe(true);
    expect(claimIsActive(minutesAgo(16), dbNow)).toBe(false);
    expect(claimIsActive(null, dbNow)).toBe(false);
  });

  it('builds the Vietnamese conflict message naming the current holder', () => {
    expect(claimConflictMessage('Nguyễn Văn B')).toBe('Hồ sơ đang do Nguyễn Văn B xử lý.');
    expect(claimConflictMessage(null)).toBe('Hồ sơ đang do người khác xử lý.');
  });
});

describe('RequestClaimService.claim', () => {
  it('claims an unclaimed SOS for a coordinator in the request campaign', async () => {
    const fx = fixture();
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    const { execute } = runWith(fx, deps);

    const outcome = await execute('claim');

    expect(outcome.value).toMatchObject({ handled_by: me });
    const update = fx.queries.find(({ sql }) => sql.startsWith('UPDATE assistance_request'));
    expect(update?.values?.[1]).toBe(me);
    expect(deps.persistence.insertEvent).toHaveBeenCalledWith(expect.anything(), requestId, me, 'CLAIMED', 'STAFF', 'VERIFIED', 'VERIFIED', null, expect.anything());
  });

  it('rejects a second coordinator while the first claim is active, with the holder name in Vietnamese', async () => {
    const fx = fixture({ handled_by: other, handled_at: minutesAgo(1) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    const { execute } = runWith(fx, deps);

    const error = await execute('claim').catch((cause: unknown) => cause) as { code: string; status: number; userMessage: string };

    expect(error).toMatchObject({ code: 'REQUEST_ALREADY_CLAIMED', status: 409, userMessage: 'Hồ sơ đang do Nguyễn Văn B xử lý.' });
    expect(fx.queries.some(({ sql }) => sql.startsWith('UPDATE assistance_request'))).toBe(false);
  });

  it('lets another coordinator claim once the previous claim expired', async () => {
    const fx = fixture({ handled_by: other, handled_at: minutesAgo(CLAIM_TTL_MINUTES + 1) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    const { execute } = runWith(fx, deps);

    await expect(execute('claim')).resolves.toMatchObject({ value: { handled_by: me } });
  });

  it('refreshes the holder own claim without a conflict', async () => {
    const fx = fixture({ handled_by: me, handled_at: minutesAgo(5) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    const { execute } = runWith(fx, deps);

    await expect(execute('claim')).resolves.toMatchObject({ value: { handled_by: me } });
    expect(fx.queries.some(({ sql }) => sql.startsWith('UPDATE assistance_request') && sql.includes('handled_at'))).toBe(true);
  });

  it('refuses a coordinator outside the request campaign scope before writing', async () => {
    const fx = fixture();
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignTwo)] });
    const { execute } = runWith(fx, deps);

    await expect(execute('claim')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(fx.queries.some(({ sql }) => sql.startsWith('UPDATE assistance_request'))).toBe(false);
  });
});

describe('RequestClaimService.release', () => {
  it('lets the holder release their own claim', async () => {
    const fx = fixture({ handled_by: me, handled_at: minutesAgo(2) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    const { execute } = runWith(fx, deps);

    await expect(execute('release')).resolves.toMatchObject({ value: { handled_by: null } });
  });

  it('refuses a non-holder without a system grant', async () => {
    const fx = fixture({ handled_by: other, handled_at: minutesAgo(2) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    const { execute } = runWith(fx, deps);

    await expect(execute('release')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(fx.queries.some(({ sql }) => sql.startsWith('UPDATE assistance_request'))).toBe(false);
  });

  it('lets a system coordinator release another holder and records the release', async () => {
    const fx = fixture({ handled_by: other, handled_at: minutesAgo(2) });
    const deps = dependencies({ userId: me, grants: [systemCoordinator] });
    const { execute } = runWith(fx, deps);

    await expect(execute('release')).resolves.toMatchObject({ value: { handled_by: null } });
    expect(deps.persistence.insertEvent).toHaveBeenCalledWith(expect.anything(), requestId, me, 'CLAIM_RELEASED', 'STAFF',
      'VERIFIED', 'VERIFIED', null, expect.objectContaining({ previous_handled_by: other }));
  });
});

describe('RequestClaimGuard on coordination commands', () => {
  async function guard(fx: ReturnType<typeof fixture>, session: { userId: string; grants: Grant[] }, deps: ReturnType<typeof dependencies>) {
    const service = new RequestClaimGuard(deps.sessions as never, deps.persistence as never);
    return service.assertCanCoordinate(fx.manager as never, requestId, session, 'response.requests.verify');
  }

  it('lets a coordinator operate on an unclaimed request', async () => {
    const fx = fixture();
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    await expect(guard(fx, { userId: me, grants: [campaignCoordinator(campaignOne)] }, deps)).resolves.toBeUndefined();
  });

  it('rejects another coordinator while an active claim exists', async () => {
    const fx = fixture({ handled_by: other, handled_at: minutesAgo(3) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    await expect(guard(fx, { userId: me, grants: [campaignCoordinator(campaignOne)] }, deps))
      .rejects.toMatchObject({ code: 'REQUEST_ALREADY_CLAIMED', status: 409 });
  });

  it('lets the holder operate and refreshes the claim time', async () => {
    const fx = fixture({ handled_by: me, handled_at: minutesAgo(10) });
    const deps = dependencies({ userId: me, grants: [campaignCoordinator(campaignOne)] });
    await guard(fx, { userId: me, grants: [campaignCoordinator(campaignOne)] }, deps);
    expect(fx.queries.some(({ sql }) => sql.startsWith('UPDATE assistance_request') && sql.includes('handled_at=now()'))).toBe(true);
  });

  it('lets a system coordinator take over an active claim and writes an audit event', async () => {
    const fx = fixture({ handled_by: other, handled_at: minutesAgo(3) });
    const deps = dependencies({ userId: me, grants: [systemCoordinator] });
    await guard(fx, { userId: me, grants: [systemCoordinator] }, deps);
    expect(deps.persistence.insertEvent).toHaveBeenCalledWith(expect.anything(), requestId, me, 'CLAIM_TAKEN_OVER', 'STAFF',
      'VERIFIED', 'VERIFIED', null, expect.objectContaining({ previous_handled_by: other }));
    const update = fx.queries.find(({ sql }) => sql.startsWith('UPDATE assistance_request'));
    expect(update?.values?.[1]).toBe(me);
  });
});

describe('RequestOperationsCommandRunner claim enforcement', () => {
  async function runCommandFor(command: string) {
    const guard = { assertCanCoordinate: jest.fn(async () => undefined) };
    const idempotency = {
      execute: jest.fn(async (_dataSource: unknown, options: { execute: (manager: unknown) => Promise<unknown> }) => options.execute({})),
    };
    const runner = new RequestOperationsCommandRunner({} as never, idempotency as never, guard as never);
    const session = { userId: me, grants: [systemCoordinator] };
    const execute = jest.fn(async () => ({ status: 200, value: { ok: true } }));
    await runner.runCommand(requestId, session, 'idem-key-2', command, {}, execute as never, (async () => ({})) as never);
    return { guard, execute };
  }

  it('checks the active claim before a verification, triage, or campaign command', async () => {
    for (const command of ['response.requests.verify', 'response.requests.triage', 'response.requests.attach-campaign']) {
      const { guard, execute } = await runCommandFor(command);
      expect(guard.assertCanCoordinate).toHaveBeenCalledWith({}, requestId, expect.objectContaining({ userId: me }), command);
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  it('does not add the claim check to commands outside the coordination set', async () => {
    const { guard, execute } = await runCommandFor('response.requests.contact-attempt');
    expect(guard.assertCanCoordinate).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
