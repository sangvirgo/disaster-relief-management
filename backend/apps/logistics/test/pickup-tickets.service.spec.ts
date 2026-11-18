import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '@c48/technical/errors/errors';
import { parseErrorCatalog } from '@c48/technical/errors/error-catalog';
import { PickupTicketsService } from '../src/pickup-tickets/pickup-tickets.service';
import { deriveStepKey, stepRequest } from '../src/pickup-tickets/pickup-tickets.helpers';
import { DistributionCommandsService } from '../src/distributions/distribution-commands.service';

const MISSION = '10000000-0000-4000-8000-000000000001';
const REQUEST = '10000000-0000-4000-8000-000000000002';
const CAMPAIGN = '10000000-0000-4000-8000-000000000003';
const TEAM = '10000000-0000-4000-8000-000000000004';
const WH_PRIMARY = '10000000-0000-4000-8000-000000000005';
const WH_BACKUP = '10000000-0000-4000-8000-000000000006';
const WATER = '10000000-0000-4000-8000-000000000007';
const RICE = '10000000-0000-4000-8000-000000000008';
const NEED_WATER = '10000000-0000-4000-8000-000000000009';
const NEED_RICE = '10000000-0000-4000-8000-00000000000a';
const TICKET = '10000000-0000-4000-8000-00000000000b';
const DIST = '10000000-0000-4000-8000-00000000000c';
const OPS = '10000000-0000-4000-8000-00000000000d';
const COORD = '10000000-0000-4000-8000-00000000000e';
const VOLUNTEER = '10000000-0000-4000-8000-00000000000f';
const OUTER_KEY = '20000000-0000-4000-8000-000000000001';
const OUTER_KEY_2 = '20000000-0000-4000-8000-000000000002';
const OUTER_KEY_3 = '20000000-0000-4000-8000-000000000003';

const OPS_SYSTEM = [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }] as const;
const COORD_SYSTEM = [{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }] as const;

interface Db {
  tickets: Array<Record<string, unknown>>;
  lines: Array<Record<string, unknown>>;
  needs: Array<Record<string, unknown>>;
  stock: Array<{ warehouse_id: string; item_id: string; on_hand: string; reserved: string }>;
  campaignWarehouses: Array<{ campaign_id: string; warehouse_id: string; role: string }>;
  distribution: Record<string, unknown>;
  distributionLines: Array<{ item_id: string; quantity: string; distribution_id: string }>;
  commitments: Record<string, { version: number; quantity: string; released_quantity: string; issued_quantity: string }>;
  custody: Map<string, string>;
  audits: string[];
}

function freshDb(): Db {
  return {
    tickets: [],
    lines: [],
    needs: [
      { relief_need_id: NEED_WATER, item_id: WATER, requested_quantity: '10', unit_scale: 0, committed: '0', status: 'OPEN', source: 'CONFIRMED', designated_point_id: null },
      { relief_need_id: NEED_RICE, item_id: RICE, requested_quantity: '5', unit_scale: 0, committed: '3', status: 'OPEN', source: 'DECLARED', designated_point_id: null },
    ],
    stock: [
      { warehouse_id: WH_PRIMARY, item_id: WATER, on_hand: '4', reserved: '0' },
      { warehouse_id: WH_PRIMARY, item_id: RICE, on_hand: '0', reserved: '0' },
      { warehouse_id: WH_BACKUP, item_id: RICE, on_hand: '8', reserved: '0' },
    ],
    campaignWarehouses: [
      { campaign_id: CAMPAIGN, warehouse_id: WH_PRIMARY, role: 'PRIMARY' },
      { campaign_id: CAMPAIGN, warehouse_id: WH_BACKUP, role: 'BACKUP' },
    ],
    distribution: { id: DIST, status: 'DRAFT', version: 1, approved_version: null, preparer_user_id: OPS, approver_user_id: null, campaign_id: CAMPAIGN },
    distributionLines: [],
    commitments: {},
    custody: new Map(),
    audits: [],
  };
}

/** Stateful fake of the SQL the facade issues. Unknown statements fail the test instead of silently returning nothing. */
function fakeManager(db: Db) {
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    const p = params as unknown[];
    if (sql.startsWith('SELECT id FROM warehouse WHERE id=$1')) return [{ id: p[0] }];
    if (sql.includes('FROM campaign_warehouse WHERE campaign_id=$1 AND warehouse_id=$2')) {
      return db.campaignWarehouses.filter((cw) => cw.campaign_id === p[0] && cw.warehouse_id === p[1]);
    }
    if (sql.includes("WHERE campaign_id=$1 AND role='PRIMARY'")) {
      return db.campaignWarehouses.filter((cw) => cw.campaign_id === p[0] && cw.role === 'PRIMARY');
    }
    if (sql.startsWith('SELECT id FROM pickup_ticket WHERE mission_id=$1')) return db.tickets.filter((t) => t.mission_id === p[0]);
    if (sql.includes('COALESCE((SELECT SUM(cm.quantity-cm.released_quantity-cm.returned_quantity-cm.lost_quantity)::text') && sql.includes('c.request_id=$1')) {
      return db.needs.filter((n) => ['OPEN', 'PARTIALLY_FULFILLED'].includes(String(n.status)) && n.source !== 'ESTIMATED' && n.designated_point_id === null);
    }
    if (sql.startsWith('INSERT INTO pickup_ticket (')) {
      const id = TICKET;
      db.tickets.push({
        id, mission_id: p[0], request_id: p[1], campaign_id: p[2], team_id: p[3], warehouse_id: p[4], status: 'OPEN',
        distribution_id: null, reserved_by: null, ready_at: null, confirmed_by: null, confirmed_at: null, handed_over_by: null,
        handed_over_at: null, collected_by_user_id: null, cancelled_at: null, cancel_reason: null, version: 1,
        created_at: '2026-11-18T01:00:00.000Z', updated_at: '2026-11-18T01:00:00.000Z',
      });
      return [{ id }];
    }
    if (sql.startsWith('INSERT INTO pickup_ticket_line')) {
      db.lines.push({
        ticket_id: p[0], relief_need_id: p[1], item_id: p[2], requested_quantity: p[3], reserved_quantity: '0', commitment_id: null,
      });
      return [];
    }
    if (sql.includes('FROM pickup_ticket_line l JOIN item i')) {
      return db.lines.filter((l) => l.ticket_id === p[0]).map((l) => ({
        ...l, item_name: l.item_id === WATER ? 'Nước uống' : 'Gạo', unit_code: 'CAI', unit_scale: 0,
      }));
    }
    if (sql.includes('FROM pickup_ticket WHERE id=$1')) {
      const found = db.tickets.find((t) => t.id === p[0]);
      return found ? [{ ...found }] : [];
    }
    if (sql.includes('FROM relief_need n JOIN item i ON i.id=n.item_id') && sql.includes('WHERE n.id=$1')) {
      return db.needs.filter((n) => n.relief_need_id === p[0]).map((n) => ({ ...n }));
    }
    if (sql.includes('FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2') && sql.includes('on_hand::text')) {
      return db.stock.filter((s) => s.warehouse_id === p[0] && s.item_id === p[1]).map((s) => ({ on_hand: s.on_hand, reserved: s.reserved }));
    }
    if (sql.startsWith('UPDATE pickup_ticket_line SET commitment_id')) {
      const line = db.lines.find((l) => l.ticket_id === p[0] && l.relief_need_id === p[1]);
      if (line) Object.assign(line, { commitment_id: p[2], reserved_quantity: p[3] });
      return [];
    }
    if (sql.includes('FROM campaign_warehouse cw JOIN stock_balance sb')) {
      return db.campaignWarehouses.filter((cw) => cw.role === 'BACKUP' && cw.campaign_id === p[0]).flatMap((cw) => (
        db.stock.filter((s) => s.warehouse_id === cw.warehouse_id && Number(s.on_hand) > Number(s.reserved) && (p[1] as string[]).includes(s.item_id))
          .map((s) => ({ warehouse_id: s.warehouse_id, item_id: s.item_id, available: String(Number(s.on_hand) - Number(s.reserved)), unit_scale: 0 }))
      ));
    }
    if (sql.includes("SET status='READY'")) {
      const t = db.tickets.find((x) => x.id === p[0]);
      if (!t || t.status !== 'OPEN' || t.version !== p[3]) return [];
      Object.assign(t, { status: 'READY', distribution_id: p[1], reserved_by: p[2], ready_at: '2026-11-18T01:05:00.000Z', version: Number(t.version) + 1 });
      return [{ id: t.id }];
    }
    if (sql.includes('SET confirmed_by=$2')) {
      const t = db.tickets.find((x) => x.id === p[0]);
      if (!t || t.version !== p[2] || t.status !== 'READY' || t.confirmed_at !== null) return [];
      Object.assign(t, { confirmed_by: p[1], confirmed_at: '2026-11-18T01:10:00.000Z', version: Number(t.version) + 1 });
      return [{ id: t.id }];
    }
    if (sql.includes("SET status='HANDED_OVER'")) {
      const t = db.tickets.find((x) => x.id === p[0]);
      if (!t || t.version !== p[3] || t.status !== 'READY') return [];
      Object.assign(t, {
        status: 'HANDED_OVER', handed_over_by: p[1], handed_over_at: '2026-11-18T02:00:00.000Z', collected_by_user_id: p[2],
        version: Number(t.version) + 1,
      });
      return [{ id: t.id }];
    }
    if (sql.includes('INSERT INTO team_custody')) {
      for (const line of db.distributionLines) {
        const key = `${p[0]}|${line.item_id}`;
        const current = db.custody.get(key) ?? '0';
        db.custody.set(key, String(Number(current) + Number(line.quantity)));
      }
      return [];
    }
    if (sql.includes("SET status='CANCELLED'") && sql.startsWith('UPDATE pickup_ticket')) {
      const t = db.tickets.find((x) => x.id === p[0]);
      if (!t || t.version !== p[2] || (t.status !== 'OPEN' && t.status !== 'READY')) return [];
      Object.assign(t, { status: 'CANCELLED', cancel_reason: p[1], version: Number(t.version) + 1 });
      return [{ id: t.id }];
    }
    if (sql.startsWith('SELECT id,status,version,approved_version FROM distribution WHERE id=$1')) {
      return p[0] === DIST ? [{ ...db.distribution }] : [];
    }
    if (sql.includes('FROM commitment WHERE id=$1')) {
      const row = db.commitments[String(p[0])];
      return row ? [{ ...row }] : [];
    }
    if (sql.startsWith('INSERT INTO audit_log')) {
      db.audits.push(String(p[1]));
      return [];
    }
    throw new Error(`Unexpected SQL in pickup-ticket spec: ${sql.slice(0, 120)}`);
  });
  return { query };
}

function harness(db: Db = freshDb()) {
  const manager = fakeManager(db);
  const dataSource = { query: manager.query, transaction: async (fn: (m: unknown) => unknown) => fn(manager) };
  const idempotency = {
    execute: jest.fn(async (_ds: unknown, command: { execute: (m: unknown) => Promise<{ status: number; value: unknown }>; command: string }) => {
      const outcome = await command.execute(manager);
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  };
  const sessions = { require: async (request: { session: unknown }) => request.session };
  const missions = {
    getMission: jest.fn(async () => ({
      id: MISSION, status: 'ACCEPTED', request_id: REQUEST, campaign_id: CAMPAIGN, team_id: TEAM, work_cycle: 1,
      member_user_ids: [VOLUNTEER],
    })),
  };
  const commitments = {
    create: jest.fn(async (needId: string, dto: { quantity: string }) => {
      const id = `commitment-${needId.slice(-4)}`;
      db.commitments[id] = { version: 1, quantity: dto.quantity, released_quantity: '0', issued_quantity: '0' };
      return { status: 201, value: { id, quantity: dto.quantity }, replay: false };
    }),
    release: jest.fn(async () => ({ status: 200, value: {}, replay: false })),
  };
  const distributions = {
    create: jest.fn(async (dto: { lines: Array<{ item_id: string; quantity: string; commitment_id: string }> }) => {
      db.distributionLines = dto.lines.map((line) => ({ item_id: line.item_id, quantity: line.quantity, distribution_id: DIST }));
      return { status: 201, value: { id: DIST }, replay: false };
    }),
    approve: jest.fn(async () => {
      Object.assign(db.distribution, { status: 'APPROVED', approver_user_id: 'set-by-approve', approved_version: 1, version: 2 });
      return { status: 200, value: {}, replay: false };
    }),
    dispatch: jest.fn(async () => {
      Object.assign(db.distribution, { status: 'DISPATCHED', version: 3 });
      return { status: 200, value: {}, replay: false };
    }),
    cancel: jest.fn(async () => {
      Object.assign(db.distribution, { status: 'CANCELLED', version: 2 });
      return { status: 200, value: {}, replay: false };
    }),
  };
  const service = new PickupTicketsService(
    dataSource as never, idempotency as never, sessions as never, missions as never, commitments as never, distributions as never,
  );
  return { db, service, idempotency, missions, commitments, distributions };
}

function req(userId: string, grants: unknown[], key: string) {
  return { idempotencyKey: key, session: { userId, grants } } as never;
}

async function expectCode(promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (status !== undefined) expect((error as AppError).status).toBe(status);
}

describe('pickup ticket: creation from the mission request', () => {
  it('creates one OPEN ticket at the campaign PRIMARY warehouse with the unmet quantity per live need', async () => {
    const { db, service } = harness();
    const result = await service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    expect(result.value).toMatchObject({ status: 'OPEN', warehouse_id: WH_PRIMARY, version: 1, team_id: TEAM });
    expect(db.lines).toEqual([
      expect.objectContaining({ relief_need_id: NEED_WATER, requested_quantity: '10' }),
      expect.objectContaining({ relief_need_id: NEED_RICE, requested_quantity: '2' }),
    ]);
    expect(db.audits).toEqual(['PICKUP_TICKET_CREATED']);
  });

  it('rejects a mission the team has not accepted yet', async () => {
    const { service, missions } = harness();
    missions.getMission.mockResolvedValueOnce({
      id: MISSION, status: 'OFFERED', request_id: REQUEST, campaign_id: CAMPAIGN, team_id: TEAM, work_cycle: 1, member_user_ids: [],
    });
    await expectCode(service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY)), 'PICKUP_MISSION_NOT_ASSIGNABLE', 409);
  });

  it('answers PICKUP_NO_PRIMARY_WAREHOUSE when the campaign has no PRIMARY warehouse', async () => {
    const db = freshDb();
    db.campaignWarehouses = [];
    const { service } = harness(db);
    await expectCode(service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY)), 'PICKUP_NO_PRIMARY_WAREHOUSE', 409);
  });

  it('refuses an explicit warehouse that the campaign does not use', async () => {
    const db = freshDb();
    db.campaignWarehouses = [];
    db.campaignWarehouses.push({ campaign_id: CAMPAIGN, warehouse_id: WH_PRIMARY, role: 'PRIMARY' });
    const { service } = harness(db);
    await expectCode(
      service.create({ mission_id: MISSION, warehouse_id: WH_BACKUP }, req(OPS, OPS_SYSTEM as never, OUTER_KEY)),
      'WAREHOUSE_NOT_ELIGIBLE', 409,
    );
  });

  it('allows only one ticket per mission', async () => {
    const db = freshDb();
    db.tickets.push({ id: 'existing', mission_id: MISSION });
    const { service } = harness(db);
    await expectCode(service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY)), 'PICKUP_TICKET_EXISTS', 409);
  });

  it('skips a need that designates a relief point, so a final-recipient ticket never fails on it', async () => {
    const db = freshDb();
    db.needs[0] = { ...db.needs[0], designated_point_id: '10000000-0000-4000-8000-0000000000aa' };
    const { service } = harness(db);
    await service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    expect(db.lines).toEqual([expect.objectContaining({ relief_need_id: NEED_RICE })]);
  });

  it('answers PICKUP_NO_NEEDS when the request has no confirmed or declared goods lines', async () => {
    const db = freshDb();
    db.needs = [];
    const { service } = harness(db);
    await expectCode(service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY)), 'PICKUP_NO_NEEDS', 409);
  });

  it('keeps a coordinator without campaign grant out of a campaign-scoped mission', async () => {
    const { service } = harness();
    const campaignCoordinator = [{ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: '10000000-0000-4000-8000-0000000000ff' }];
    await expectCode(service.create({ mission_id: MISSION }, req(COORD, campaignCoordinator, OUTER_KEY)), 'FORBIDDEN', 403);
  });
});

describe('pickup ticket: reservation with shortfall', () => {
  async function openTicket(db: Db) {
    const h = harness(db);
    await h.service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    return h;
  }

  it('reserves what the primary warehouse holds, reports the shortfall and the backup hint, and moves to READY', async () => {
    const db = freshDb();
    const { service, distributions } = await openTicket(db);
    const result = await service.reserve(TICKET, { expected_version: 1 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2));

    expect(result.value).toMatchObject({ status: 'READY', version: 2, distribution_id: DIST });
    const shortfalls = (result.value as { shortfalls: Array<{ item_name: string; shortfall_quantity: string }> }).shortfalls;
    expect(shortfalls).toEqual([
      expect.objectContaining({ item_name: 'Nước uống', shortfall_quantity: '6' }),
      expect.objectContaining({ item_name: 'Gạo', shortfall_quantity: '2' }),
    ]);
    expect((result.value as { backup_warehouses: unknown[] }).backup_warehouses).toEqual([
      { warehouse_id: WH_BACKUP, item_id: RICE, available_quantity: '8' },
    ]);
    // Only the line that got stock becomes a distribution line, and only its commitment is used.
    expect(distributions.create.mock.calls[0]?.[0]).toMatchObject({
      warehouse_id: WH_PRIMARY, purpose: 'REQUEST_AID', campaign_id: CAMPAIGN,
      lines: [{ item_id: WATER, quantity: '4', commitment_id: 'commitment-0009' }],
    });
    expect(db.commitments['commitment-0009']).toMatchObject({ quantity: '4' });
    expect(db.audits).toContain('PICKUP_TICKET_RESERVED');
  });

  it('answers PICKUP_NOTHING_RESERVABLE and leaves the ticket OPEN when no line has stock', async () => {
    const db = freshDb();
    db.stock = [];
    const { service, distributions } = await openTicket(db);
    await expectCode(service.reserve(TICKET, { expected_version: 1 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2)), 'PICKUP_NOTHING_RESERVABLE', 409);
    expect(db.tickets[0]).toMatchObject({ status: 'OPEN', version: 1 });
    expect(distributions.create).not.toHaveBeenCalled();
  });

  it('rejects a stale expected_version with VERSION_CONFLICT before reserving anything', async () => {
    const db = freshDb();
    const { service, commitments } = await openTicket(db);
    await expectCode(service.reserve(TICKET, { expected_version: 7 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2)), 'VERSION_CONFLICT', 409);
    expect(commitments.create).not.toHaveBeenCalled();
  });

  it('refuses to reserve twice (wrong state)', async () => {
    const db = freshDb();
    const { service } = await openTicket(db);
    await service.reserve(TICKET, { expected_version: 1 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2));
    await expectCode(service.reserve(TICKET, { expected_version: 2 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_3)), 'STATE_TRANSITION_INVALID', 409);
  });
});

describe('pickup ticket: confirmation, separation of duties and handover', () => {
  async function readyTicket(db: Db) {
    const h = harness(db);
    await h.service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    await h.service.reserve(TICKET, { expected_version: 1 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2));
    return h;
  }

  it('approves the reserved distribution with the confirming user as the approver', async () => {
    const db = freshDb();
    const { service, distributions } = await readyTicket(db);
    const confirmer = req(COORD, OPS_SYSTEM as never, OUTER_KEY_3);
    const result = await service.confirm(TICKET, { expected_version: 2 }, confirmer);

    expect(distributions.approve).toHaveBeenCalledTimes(1);
    const [approvedId, approveDto, approveRequest] = distributions.approve.mock.calls[0] as unknown as [string, { expected_version: number }, { session: { userId: string }; idempotencyKey: string }];
    expect(approvedId).toBe(DIST);
    expect(approveDto).toEqual({ expected_version: 1 });
    expect(approveRequest.session.userId).toBe(COORD);
    expect(approveRequest.idempotencyKey).not.toBe(OUTER_KEY_3);
    expect(result.value).toMatchObject({ status: 'READY', confirmed_by: COORD, version: 3 });
  });

  it('does not confirm an OPEN ticket', async () => {
    const db = freshDb();
    const h = harness(db);
    await h.service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    await expectCode(h.service.confirm(TICKET, { expected_version: 1 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_2)), 'STATE_TRANSITION_INVALID', 409);
  });

  it('hands over, dispatches the distribution and credits team custody once', async () => {
    const db = freshDb();
    const { service, distributions } = await readyTicket(db);
    await service.confirm(TICKET, { expected_version: 2 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_3));
    db.distributionLines = [{ item_id: WATER, quantity: '4', distribution_id: DIST }];
    const handover = await service.handover(
      TICKET, { expected_version: 3, collected_by_user_id: VOLUNTEER }, req(OPS, OPS_SYSTEM as never, '20000000-0000-4000-8000-000000000004'),
    );

    expect(distributions.dispatch).toHaveBeenCalledWith(DIST, { expected_version: 1 }, expect.anything());
    expect(handover.value).toMatchObject({ status: 'HANDED_OVER', collected_by_user_id: VOLUNTEER });
    expect(db.custody.get(`${TEAM}|${WATER}`)).toBe('4');
  });

  it('refuses a handover that was not confirmed first', async () => {
    const db = freshDb();
    const { service, distributions } = await readyTicket(db);
    await expectCode(service.handover(TICKET, { expected_version: 2 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_3)), 'PICKUP_NOT_CONFIRMED', 409);
    expect(distributions.dispatch).not.toHaveBeenCalled();
  });

  it('propagates the existing dispatch rule and leaves custody empty when the dispatcher is the approver', async () => {
    const db = freshDb();
    const { service, distributions } = await readyTicket(db);
    await service.confirm(TICKET, { expected_version: 2 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_3));
    distributions.dispatch.mockRejectedValueOnce(new AppError('FORBIDDEN', { status: 403 }));
    db.distributionLines = [{ item_id: WATER, quantity: '4', distribution_id: DIST }];
    await expectCode(service.handover(TICKET, { expected_version: 3 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_2)), 'FORBIDDEN', 403);
    expect(db.tickets[0]).toMatchObject({ status: 'READY' });
    expect(db.custody.size).toBe(0);
  });

  it('gives a coordinator without DISTRIBUTION_DISPATCH a 403 before any stock step runs', async () => {
    const db = freshDb();
    const { service, distributions } = await readyTicket(db);
    await service.confirm(TICKET, { expected_version: 2 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_3));
    await expectCode(service.handover(TICKET, { expected_version: 3 }, req(COORD, COORD_SYSTEM as never, OUTER_KEY_2)), 'FORBIDDEN', 403);
    expect(distributions.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a collector who is not an active member of the mission team', async () => {
    const db = freshDb();
    const { service, distributions, missions } = await readyTicket(db);
    await service.confirm(TICKET, { expected_version: 2 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_3));
    missions.getMission.mockResolvedValueOnce({
      id: MISSION, status: 'ACCEPTED', request_id: REQUEST, campaign_id: CAMPAIGN, team_id: TEAM, work_cycle: 1, member_user_ids: [],
    });
    await expectCode(
      service.handover(TICKET, { expected_version: 3, collected_by_user_id: VOLUNTEER }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2)),
      'PICKUP_COLLECTOR_NOT_MEMBER', 409,
    );
    expect(distributions.dispatch).not.toHaveBeenCalled();
  });

  it('never credits custody twice: a retry after the handover sees HANDED_OVER and changes nothing', async () => {
    const db = freshDb();
    const { service } = await readyTicket(db);
    await service.confirm(TICKET, { expected_version: 2 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_3));
    db.distributionLines = [{ item_id: WATER, quantity: '4', distribution_id: DIST }];
    await service.handover(TICKET, { expected_version: 3 }, req(OPS, OPS_SYSTEM as never, '20000000-0000-4000-8000-000000000004'));
    // The first handover moved the ticket to version 4; a retry with the current version reaches the state guard.
    await expectCode(
      service.handover(TICKET, { expected_version: 4 }, req(OPS, OPS_SYSTEM as never, '20000000-0000-4000-8000-000000000005')),
      'STATE_TRANSITION_INVALID', 409,
    );
    expect(db.custody.get(`${TEAM}|${WATER}`)).toBe('4');
  });
});

describe('pickup ticket: cancellation', () => {
  it('cancels a READY ticket by cancelling the draft and releasing the unissued reservation', async () => {
    const db = freshDb();
    const h = harness(db);
    await h.service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    await h.service.reserve(TICKET, { expected_version: 1 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2));
    const result = await h.service.cancel(TICKET, { expected_version: 2, reason: 'Đổi kế hoạch cứu trợ' }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_3));

    expect(h.distributions.cancel).toHaveBeenCalledWith(DIST, { expected_version: 1 }, expect.anything());
    expect(h.commitments.release).toHaveBeenCalledWith(
      'commitment-0009', { expected_version: 1, quantity: '4', reason: 'Đổi kế hoạch cứu trợ' }, expect.anything(),
    );
    expect(result.value).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Đổi kế hoạch cứu trợ' });
  });

  it('cancels an OPEN ticket without touching stock', async () => {
    const db = freshDb();
    const h = harness(db);
    await h.service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    await h.service.cancel(TICKET, { expected_version: 1, reason: 'Hủy' }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2));
    expect(h.commitments.release).not.toHaveBeenCalled();
    expect(h.distributions.cancel).not.toHaveBeenCalled();
    expect(db.tickets[0]).toMatchObject({ status: 'CANCELLED' });
  });

  it('refuses cancellation after handover', async () => {
    const db = freshDb();
    const h = harness(db);
    await h.service.create({ mission_id: MISSION }, req(OPS, OPS_SYSTEM as never, OUTER_KEY));
    await h.service.reserve(TICKET, { expected_version: 1 }, req(OPS, OPS_SYSTEM as never, OUTER_KEY_2));
    await h.service.confirm(TICKET, { expected_version: 2 }, req(COORD, OPS_SYSTEM as never, OUTER_KEY_3));
    await h.service.handover(TICKET, { expected_version: 3 }, req(OPS, OPS_SYSTEM as never, '20000000-0000-4000-8000-000000000004'));
    await expectCode(
      h.service.cancel(TICKET, { expected_version: 4, reason: 'Muộn' }, req(OPS, OPS_SYSTEM as never, '20000000-0000-4000-8000-000000000005')),
      'STATE_TRANSITION_INVALID', 409,
    );
  });
});

describe('pickup ticket: step keys and catalog', () => {
  it('derives stable, distinct, valid UUID keys per step', () => {
    const a = deriveStepKey(OUTER_KEY, 'approve');
    expect(a).toBe(deriveStepKey(OUTER_KEY, 'approve'));
    expect(a).not.toBe(deriveStepKey(OUTER_KEY, 'dispatch'));
    expect(a).not.toBe(deriveStepKey(OUTER_KEY_2, 'approve'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('refuses to derive a step key from a missing outer key', () => {
    expect(() => stepRequest({} as never, 'approve')).toThrow(AppError);
  });

  it('gives every new code a Vietnamese catalog row (Logistics owner)', () => {
    const catalog = parseErrorCatalog(readFileSync(resolve(process.cwd(), '../docs/backend/07-error-catalog.md'), 'utf8'));
    for (const code of [
      'PICKUP_MISSION_NOT_FOUND', 'PICKUP_MISSION_NOT_ASSIGNABLE', 'PICKUP_TICKET_EXISTS', 'PICKUP_NO_PRIMARY_WAREHOUSE',
      'PICKUP_NO_NEEDS', 'PICKUP_NOTHING_RESERVABLE', 'PICKUP_NOT_CONFIRMED', 'PICKUP_COLLECTOR_NOT_MEMBER',
    ]) {
      const entry = catalog.get(code);
      expect(entry).toBeDefined();
      expect(entry?.message).toMatch(/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/u);
    }
  });
});

describe('DistributionCommandsService.dispatch: existing approver rule used by handover', () => {
  it('rejects a dispatch by the same user who approved the distribution', async () => {
    const userId = OPS;
    const row = {
      id: DIST, warehouse_id: WH_PRIMARY, warehouse_status: 'ACTIVE', relief_point_id: null, relief_point_status: null,
      vehicle_id: null, vehicle_status: null, vehicle_capacity: null, vehicle_capacity_unit: null, vehicle_capacity_scale: null,
      campaign_id: CAMPAIGN, purpose: 'REQUEST_AID', status: 'APPROVED', preparer_user_id: VOLUNTEER, approver_user_id: userId,
      approved_version: 2, dispatch_actor_user_id: null, dispatched_at: null, reconciled_at: null,
      created_at: '2026-11-18T00:00:00.000Z', version: 2,
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM distribution d JOIN warehouse w')) return [row];
      if (sql.includes('SELECT status FROM warehouse')) return [{ status: 'ACTIVE' }];
      throw new Error(`unexpected: ${sql.slice(0, 80)}`);
    });
    const service = Object.create(DistributionCommandsService.prototype) as DistributionCommandsService;
    Object.assign(service, {
      dataSource: { query, transaction: (fn: (m: unknown) => unknown) => fn({ query }) },
      idempotency: { execute: async (_ds: unknown, cmd: { execute: (m: unknown) => unknown }) => ({ status: 200, value: await cmd.execute({ query }), replay: false }) },
      sessions: { require: async () => ({ userId, grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }] }) },
      campaigns: {},
    });
    await expectCode(
      service.dispatch(DIST, { expected_version: 2 }, { idempotencyKey: '30000000-0000-4000-8000-000000000001' } as never),
      'FORBIDDEN', 403,
    );
  });
});
