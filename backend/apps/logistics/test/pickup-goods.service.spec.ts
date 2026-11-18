import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '@c48/technical/errors/errors';
import { parseErrorCatalog } from '@c48/technical/errors/error-catalog';
import { PickupGoodsService } from '../src/pickup-tickets/pickup-goods.service';
import { UnaccountedGoodsGuard } from '../src/pickup-tickets/unaccounted-goods.service';

const TICKET = '30000000-0000-4000-8000-000000000001';
const DIST = '30000000-0000-4000-8000-000000000002';
const TEAM = '30000000-0000-4000-8000-000000000003';
const CAMPAIGN = '30000000-0000-4000-8000-000000000004';
const REQUEST = '30000000-0000-4000-8000-000000000005';
const WH = '30000000-0000-4000-8000-000000000006';
const WATER = '30000000-0000-4000-8000-000000000007';
const BOTTLE = '30000000-0000-4000-8000-000000000008';
const FOOD = '30000000-0000-4000-8000-000000000009';
const LINE_WATER = '30000000-0000-4000-8000-00000000000a';
const LINE_BOTTLE = '30000000-0000-4000-8000-00000000000b';
const LINE_FOOD = '30000000-0000-4000-8000-00000000000c';
const OPS_HANDOVER = '30000000-0000-4000-8000-00000000000d';
const COORD = '30000000-0000-4000-8000-00000000000e';
const OPS_REVIEW = '30000000-0000-4000-8000-00000000000f';
const REVIEWER_ONLY = '30000000-0000-4000-8000-000000000010';
const K = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const OPS_SYSTEM = [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }] as const;
const COORD_SYSTEM = [{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }] as const;
const REVIEWER_SYSTEM = [{ role_code: 'REVIEWER', scope_type: 'SYSTEM' }] as const;

interface DistLine { id: string; item_id: string; quantity: number; in_transit: number; at_point: number }

interface Db {
  ticket: Record<string, unknown>;
  lines: DistLine[];
  custody: Map<string, number>;
  stock: Map<string, number>;
  handoffs: Array<{ kind: string; lines: Array<{ distribution_line_id: string; quantity: number }> }>;
  handoffKeys: Set<string>;
  closeouts: Array<Record<string, unknown>>;
  closeoutLines: Array<Record<string, unknown>>;
  audits: string[];
  pendingLoss: boolean;
  seq: number;
}

const ITEMS: Record<string, { name: string; returnable: boolean; perishable: boolean }> = {
  [WATER]: { name: 'Nước uống', returnable: true, perishable: false },
  [BOTTLE]: { name: 'Bình chứa', returnable: false, perishable: false },
  [FOOD]: { name: 'Lương khô', returnable: true, perishable: true },
};

function freshDb(): Db {
  return {
    ticket: {
      id: TICKET, mission_id: '30000000-0000-4000-8000-0000000000aa', request_id: REQUEST, campaign_id: CAMPAIGN, team_id: TEAM,
      warehouse_id: WH, status: 'HANDED_OVER', distribution_id: DIST, ready_at: null, reserved_by: OPS_HANDOVER, confirmed_by: OPS_REVIEW,
      confirmed_at: null, handed_over_by: OPS_HANDOVER, handed_over_at: new Date().toISOString(), collected_by_user_id: null,
      cancelled_at: null, cancel_reason: null, closed_by: null, closed_at: null, version: 4,
      created_at: '2026-11-18T00:00:00.000Z', updated_at: '2026-11-18T00:00:00.000Z',
    },
    lines: [
      { id: LINE_WATER, item_id: WATER, quantity: 6, in_transit: 6, at_point: 0 },
      { id: LINE_BOTTLE, item_id: BOTTLE, quantity: 3, in_transit: 3, at_point: 0 },
      { id: LINE_FOOD, item_id: FOOD, quantity: 2, in_transit: 2, at_point: 0 },
    ],
    custody: new Map([[`${TEAM}:${WATER}`, 6], [`${TEAM}:${BOTTLE}`, 3], [`${TEAM}:${FOOD}`, 2]]),
    stock: new Map([[`${WH}:${WATER}`, 0]]),
    handoffs: [],
    handoffKeys: new Set(),
    closeouts: [],
    closeoutLines: [],
    audits: [],
    pendingLoss: false,
    seq: 0,
  };
}

function lineRowsFor(db: Db) {
  return db.lines.map((line) => ({
    distribution_line_id: line.id, item_id: line.item_id, item_name: ITEMS[line.item_id]!.name, unit_code: 'CAI', unit_scale: 0,
    returnable: ITEMS[line.item_id]!.returnable, perishable: ITEMS[line.item_id]!.perishable,
    quantity: String(line.quantity), in_transit_quantity: String(line.in_transit), at_point_quantity: String(line.at_point),
  }));
}

/** Routes the SQL the service issues to the in-memory state. Any statement it does not know fails the test. */
function fakeQuery(db: Db) {
  return jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    const p = params as unknown[];
    if (sql.includes('FROM pickup_ticket_closeout WHERE ticket_id=$1 AND status IN (\'DRAFT\',\'SUBMITTED\')')) {
      return db.closeouts.filter((c) => c.ticket_id === p[0] && ['DRAFT', 'SUBMITTED'].includes(String(c.status))).map((c) => ({ ...c }));
    }
    if (sql.includes('ORDER BY (status IN (\'DRAFT\',\'SUBMITTED\')) DESC')) {
      return db.closeouts.filter((c) => c.ticket_id === p[0]).sort((a, b) => Number(b.seq) - Number(a.seq)).slice(0, 1).map((c) => ({ ...c }));
    }
    if (sql.startsWith('SELECT ticket_id FROM pickup_ticket_closeout WHERE id=$1')) {
      return db.closeouts.filter((c) => c.id === p[0]).map((c) => ({ ticket_id: c.ticket_id }));
    }
    if (sql.includes('FROM pickup_closeout_line WHERE closeout_id=$1')) {
      return db.closeoutLines.filter((l) => l.closeout_id === p[0]).map((l) => ({ ...l }));
    }
    if (sql.startsWith('INSERT INTO pickup_ticket_closeout')) {
      const id = K(1000 + db.seq++);
      db.closeouts.push({ id, ticket_id: p[0], status: 'DRAFT', version: 1, seq: db.seq, submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null, review_note: null });
      return [{ id }];
    }
    if (sql.includes('UPDATE pickup_ticket_closeout SET version=version+1')) {
      const c = db.closeouts.find((row) => row.id === p[0]);
      if (!c || c.version !== p[1] || c.status !== 'DRAFT') return [];
      c.version = Number(c.version) + 1;
      return [{ id: c.id }];
    }
    if (sql.includes("UPDATE pickup_ticket_closeout SET status='SUBMITTED'")) {
      const c = db.closeouts.find((row) => row.id === p[0]);
      if (!c || c.version !== p[2] || c.status !== 'DRAFT') return [];
      Object.assign(c, { status: 'SUBMITTED', submitted_by: p[1], submitted_at: new Date().toISOString(), version: Number(c.version) + 1 });
      return [{ id: c.id }];
    }
    if (sql.includes("UPDATE pickup_ticket_closeout SET status='DRAFT'")) {
      const c = db.closeouts.find((row) => row.id === p[0]);
      if (!c || c.version !== p[3] || c.status !== 'SUBMITTED') return [];
      Object.assign(c, { status: 'DRAFT', reviewed_by: p[1], review_note: p[2], version: Number(c.version) + 1 });
      return [{ id: c.id }];
    }
    if (sql.includes("UPDATE pickup_ticket_closeout SET status='APPROVED'")) {
      const c = db.closeouts.find((row) => row.id === p[0]);
      if (!c || c.version !== p[3] || c.status !== 'SUBMITTED') return [];
      Object.assign(c, { status: 'APPROVED', reviewed_by: p[1], review_note: p[2], version: Number(c.version) + 1 });
      return [{ id: c.id }];
    }
    if (sql.startsWith('INSERT INTO pickup_closeout_line')) {
      const row = {
        closeout_id: p[0], item_id: p[1], held_quantity: String(p[2]), delivered_quantity: String(p[3]),
        returned_quantity: String(p[4]), retired_quantity: String(p[5]), retire_reason: p[6], note: p[7],
      };
      const existing = db.closeoutLines.find((l) => l.closeout_id === p[0] && l.item_id === p[1]);
      if (existing) Object.assign(existing, row);
      else db.closeoutLines.push(row);
      return [];
    }
    if (sql.includes("UPDATE pickup_ticket SET status='CLOSED'")) {
      if (db.ticket.id !== p[0] || db.ticket.status !== 'HANDED_OVER') return [];
      Object.assign(db.ticket, { status: 'CLOSED', closed_by: p[1], closed_at: new Date().toISOString(), version: Number(db.ticket.version) + 1 });
      return [{ id: p[0] }];
    }
    if (sql.includes('UPDATE pickup_ticket SET version=version+1')) {
      if (db.ticket.id !== p[0] || db.ticket.version !== p[1] || db.ticket.status !== 'HANDED_OVER') return [];
      db.ticket.version = Number(db.ticket.version) + 1;
      return [{ id: p[0] }];
    }
    if (sql.includes('FROM pickup_ticket WHERE id=$1')) {
      return p[0] === db.ticket.id ? [{ ...db.ticket }] : [];
    }
    if (sql.includes('FROM pickup_ticket_line l JOIN item i')) return [];
    if (sql.includes('ORDER BY dl.item_id,dl.id')) return lineRowsFor(db);
    if (sql.includes("h.handoff_kind='DIRECT_HOUSEHOLD' GROUP BY dl.item_id")) {
      const totals = new Map<string, number>();
      for (const handoff of db.handoffs.filter((h) => h.kind === 'DIRECT_HOUSEHOLD')) {
        for (const line of handoff.lines) {
          const item = db.lines.find((l) => l.id === line.distribution_line_id)!.item_id;
          totals.set(item, (totals.get(item) ?? 0) + line.quantity);
        }
      }
      return [...totals].map(([item_id, delivered]) => ({ item_id, delivered: String(delivered) }));
    }
    if (sql.includes("h.handoff_kind='LOSS' AND r.handoff_id IS NULL")) return db.pendingLoss ? [{ '?column?': 1 }] : [];
    if (sql.includes('SELECT id,relief_point_id FROM distribution WHERE id=$1 FOR UPDATE')) {
      return p[0] === DIST ? [{ id: DIST, relief_point_id: null }] : [];
    }
    if (sql.includes('SELECT dl.id,dl.in_transit_quantity::text')) {
      return db.lines.map((line) => ({
        id: line.id, in_transit_quantity: String(line.in_transit), at_point_quantity: String(line.at_point), unit_scale: 0,
      }));
    }
    if (sql.includes('UPDATE distribution_line SET in_transit_quantity')) {
      const line = db.lines.find((l) => l.id === p[0])!;
      line.in_transit = Number(p[1]);
      line.at_point = Number(p[2]);
      return [];
    }
    if (sql.includes('UPDATE team_custody SET quantity_held=quantity_held-$3::numeric')) {
      const key = `${p[0]}:${p[1]}`;
      const held = db.custody.get(key);
      if (held === undefined || held < Number(p[2])) return [];
      db.custody.set(key, held - Number(p[2]));
      return [{ item_id: p[1] }];
    }
    if (sql.includes('INSERT INTO audit_log')) {
      db.audits.push(String(p[1]));
      return [];
    }
    if (sql.includes('HAVING SUM(')) {
      const rows = db.lines.filter((l) => l.in_transit + l.at_point > 0).map((l) => ({
        ticket_id: db.ticket.id, request_id: db.ticket.request_id, status: db.ticket.status, item_id: l.item_id,
        item_name: ITEMS[l.item_id]!.name, unaccounted_quantity: String(l.in_transit + l.at_point),
      }));
      if (sql.includes('t.request_id = $')) return rows.filter((row) => row.request_id === p[0]);
      return rows.filter((row) => (p[0] as string[]).includes(String(row.ticket_id)));
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 140)}`);
  });
}

/** Inner handoff writer stub. It mirrors the real effects (in-transit counter, RETURN stock) and replays by idempotency key. */
function handoffStub(db: Db) {
  return {
    create: jest.fn(async (_distributionId: string, dto: Record<string, unknown>, request: { idempotencyKey?: string }) => {
      const key = request.idempotencyKey!;
      if (db.handoffKeys.has(key)) return { status: 201, value: {}, replay: true };
      db.handoffKeys.add(key);
      const lines = dto.lines as Array<{ distribution_line_id: string; quantity: string }>;
      const kind = String(dto.handoff_kind);
      for (const line of lines) {
        const dl = db.lines.find((l) => l.id === line.distribution_line_id)!;
        const quantity = Number(line.quantity);
        if (quantity > dl.in_transit) throw new AppError('HANDOFF_EXCEEDS_BALANCE', { status: 409 });
        dl.in_transit -= quantity;
        if (kind === 'RETURN') {
          const stockKey = `${WH}:${dl.item_id}`;
          db.stock.set(stockKey, (db.stock.get(stockKey) ?? 0) + quantity);
        }
      }
      db.handoffs.push({ kind, lines: lines.map((line) => ({ distribution_line_id: line.distribution_line_id, quantity: Number(line.quantity) })) });
      return { status: 201, value: {}, replay: false };
    }),
  };
}

function harness(db: Db = freshDb()) {
  const query = fakeQuery(db);
  const dataSource = { query, transaction: async (fn: (m: unknown) => unknown) => fn({ query }) };
  const store = new Map<string, { status: number; value: unknown }>();
  const idempotency = {
    execute: jest.fn(async (_ds: unknown, command: { key: string; execute: (m: unknown) => Promise<{ status: number; value: unknown }> }) => {
      const stored = store.get(command.key);
      if (stored) return { ...stored, replay: true };
      const outcome = await command.execute({ query });
      store.set(command.key, { status: outcome.status, value: outcome.value });
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  };
  const sessions = { require: async (request: { session: unknown }) => request.session };
  const handoffs = handoffStub(db);
  const service = new PickupGoodsService(dataSource as never, idempotency as never, sessions as never, handoffs as never);
  const guard = new UnaccountedGoodsGuard(dataSource as never);
  return { db, service, guard, handoffs, query };
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

const SAVE_OK = {
  expected_version: 0,
  lines: [
    { item_id: WATER, returned_quantity: '4', retired_quantity: '2', retire_reason: 'CONSUMED' },
    { item_id: BOTTLE, returned_quantity: '0', retired_quantity: '3', retire_reason: 'NOT_RETURNABLE' },
    { item_id: FOOD, returned_quantity: '0', retired_quantity: '2', retire_reason: 'EXPIRED' },
  ],
};

describe('pickup deliveries', () => {
  it('refuses a delivery above the custody held for the item and calls no handoff', async () => {
    const h = harness();
    await expectCode(
      h.service.deliver(TICKET, { expected_version: 4, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: WATER, quantity: '7' }] }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(1))),
      'PICKUP_DELIVERY_EXCEEDS_CUSTODY', 409,
    );
    expect(h.handoffs.create).not.toHaveBeenCalled();
    expect(h.db.lines.find((l) => l.id === LINE_WATER)!.in_transit).toBe(6);
  });

  it('records goods delivered on scene: reduces in-transit and team custody, bumps the ticket version', async () => {
    const h = harness();
    const result = await h.service.deliver(TICKET, { expected_version: 4, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: WATER, quantity: '2' }] }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(2)));
    expect(result.value).toMatchObject({ version: 5, unaccounted_goods: true });
    expect(h.db.lines.find((l) => l.id === LINE_WATER)!.in_transit).toBe(4);
    expect(h.db.custody.get(`${TEAM}:${WATER}`)).toBe(4);
    expect(h.handoffs.create).toHaveBeenCalledTimes(1);
  });

  it('replays a retried delivery without a second handoff or custody change', async () => {
    const h = harness();
    const body = { expected_version: 4, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: WATER, quantity: '2' }] };
    await h.service.deliver(TICKET, body, req(OPS_HANDOVER, OPS_SYSTEM as never, K(3)));
    const retry = await h.service.deliver(TICKET, body, req(OPS_HANDOVER, OPS_SYSTEM as never, K(3)));
    expect(retry.replay).toBe(true);
    expect(h.handoffs.create).toHaveBeenCalledTimes(1);
    expect(h.db.custody.get(`${TEAM}:${WATER}`)).toBe(4);
  });

  it('shows a conflict when the ticket version is stale', async () => {
    const h = harness();
    await expectCode(
      h.service.deliver(TICKET, { expected_version: 3, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: WATER, quantity: '1' }] }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(4))),
      'VERSION_CONFLICT', 409,
    );
  });

  it('rejects an item that is not on the ticket', async () => {
    const h = harness();
    await expectCode(
      h.service.deliver(TICKET, { expected_version: 4, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: '30000000-0000-4000-8000-0000000000ff', quantity: '1' }] }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(5))),
      'PICKUP_ITEM_NOT_ON_TICKET', 400,
    );
  });

  it('allows deliveries only while the ticket is HANDED_OVER', async () => {
    const h = harness();
    h.db.ticket.status = 'READY';
    await expectCode(
      h.service.deliver(TICKET, { expected_version: 4, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: WATER, quantity: '1' }] }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(6))),
      'STATE_TRANSITION_INVALID', 409,
    );
  });
});

describe('pickup close-out draft', () => {
  it('proposes returns for returnable goods and retirements with default reasons for the rest', async () => {
    const h = harness();
    const view = await h.service.closeout(TICKET, req(COORD, COORD_SYSTEM as never, K(10)) as never);
    const lines = view.lines as Array<Record<string, unknown>>;
    expect(lines.find((l) => l.item_id === WATER)).toMatchObject({ returned_quantity: '6', retired_quantity: '0', balanced: true });
    expect(lines.find((l) => l.item_id === BOTTLE)).toMatchObject({ returned_quantity: '0', retired_quantity: '3', retire_reason: 'NOT_RETURNABLE' });
    expect(lines.find((l) => l.item_id === FOOD)).toMatchObject({ returned_quantity: '0', retired_quantity: '2', retire_reason: 'EXPIRED' });
    expect(view).toMatchObject({ closeout_status: null, can_submit: false, editable: true });
  });

  it('refuses a return of a non-returnable item (ITEM_NOT_RETURNABLE)', async () => {
    const h = harness();
    await expectCode(h.service.saveCloseout(TICKET, {
      expected_version: 0,
      lines: [
        { item_id: WATER, returned_quantity: '6', retired_quantity: '0' },
        { item_id: BOTTLE, returned_quantity: '1', retired_quantity: '2', retire_reason: 'LOST' },
        { item_id: FOOD, returned_quantity: '0', retired_quantity: '2', retire_reason: 'EXPIRED' },
      ],
    }, req(COORD, COORD_SYSTEM as never, K(11))), 'ITEM_NOT_RETURNABLE', 409);
  });

  it('refuses a split that breaks delivered + returned + retired = held (CLOSEOUT_INVARIANT_VIOLATED)', async () => {
    const h = harness();
    await expectCode(h.service.saveCloseout(TICKET, {
      expected_version: 0,
      lines: [
        { item_id: WATER, returned_quantity: '3', retired_quantity: '1', retire_reason: 'DAMAGED' },
        { item_id: BOTTLE, returned_quantity: '0', retired_quantity: '3', retire_reason: 'NOT_RETURNABLE' },
        { item_id: FOOD, returned_quantity: '0', retired_quantity: '2', retire_reason: 'EXPIRED' },
      ],
    }, req(COORD, COORD_SYSTEM as never, K(12))), 'CLOSEOUT_INVARIANT_VIOLATED', 409);
  });

  it('requires one line per item of the ticket', async () => {
    const h = harness();
    await expectCode(h.service.saveCloseout(TICKET, {
      expected_version: 0,
      lines: [{ item_id: WATER, returned_quantity: '6', retired_quantity: '0' }],
    }, req(COORD, COORD_SYSTEM as never, K(13))), 'CLOSEOUT_LINES_INVALID', 400);
  });

  it('requires a reason code for every retired quantity', async () => {
    const h = harness();
    await expectCode(h.service.saveCloseout(TICKET, {
      expected_version: 0,
      lines: [
        { item_id: WATER, returned_quantity: '4', retired_quantity: '2' },
        { item_id: BOTTLE, returned_quantity: '0', retired_quantity: '3', retire_reason: 'NOT_RETURNABLE' },
        { item_id: FOOD, returned_quantity: '0', retired_quantity: '2', retire_reason: 'EXPIRED' },
      ],
    }, req(COORD, COORD_SYSTEM as never, K(14))), 'CLOSEOUT_RETIRE_REASON_REQUIRED', 400);
  });

  it('shows a version conflict when the expected draft version is stale', async () => {
    const h = harness();
    await expectCode(h.service.saveCloseout(TICKET, { ...SAVE_OK, expected_version: 2 }, req(COORD, COORD_SYSTEM as never, K(15))), 'VERSION_CONFLICT', 409);
  });

  it('needs PICKUP_CLOSEOUT_SUBMIT to save (a reviewer cannot draft)', async () => {
    const h = harness();
    await expectCode(h.service.saveCloseout(TICKET, SAVE_OK, req(REVIEWER_ONLY, REVIEWER_SYSTEM as never, K(16))), 'FORBIDDEN', 403);
  });

  it('is not open to a ticket that is still READY', async () => {
    const h = harness();
    h.db.ticket.status = 'READY';
    await expectCode(h.service.saveCloseout(TICKET, SAVE_OK, req(COORD, COORD_SYSTEM as never, K(17))), 'STATE_TRANSITION_INVALID', 409);
  });
});

describe('pickup close-out review and approval', () => {
  async function submitted(h: ReturnType<typeof harness>, seed: number, submitter = COORD, grants: unknown[] = COORD_SYSTEM as never) {
    await h.service.saveCloseout(TICKET, SAVE_OK, req(submitter, grants, K(seed)));
    return h.service.submitCloseout(TICKET, { expected_version: 1 }, req(submitter, grants, K(seed + 1)));
  }

  it('locks the draft on submit and then blocks further deliveries', async () => {
    const h = harness();
    await submitted(h, 20);
    expect(h.db.closeouts[0]).toMatchObject({ status: 'SUBMITTED', version: 2 });
    await expectCode(
      h.service.deliver(TICKET, { expected_version: 4, occurred_at: '2026-11-18T02:00:00.000Z', lines: [{ item_id: WATER, quantity: '1' }] }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(22))),
      'STATE_TRANSITION_INVALID', 409,
    );
  });

  it('refuses a review by the submitter (SELF_REVIEW_FORBIDDEN)', async () => {
    const h = harness();
    // The submitter is an operations manager, the only role that holds both submit and review.
    await submitted(h, 30, OPS_REVIEW, OPS_SYSTEM as never);
    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(32))), 'SELF_REVIEW_FORBIDDEN', 403);
  });

  it('refuses a review by the user who handed the goods over (SELF_HANDOFF_FORBIDDEN)', async () => {
    const h = harness();
    await submitted(h, 40);
    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(OPS_HANDOVER, OPS_SYSTEM as never, K(42))), 'SELF_HANDOFF_FORBIDDEN', 403);
  });

  it('refuses a review by a coordinator, who lacks PICKUP_CLOSEOUT_REVIEW', async () => {
    const h = harness();
    await submitted(h, 50);
    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(REVIEWER_ONLY, COORD_SYSTEM as never, K(52))), 'FORBIDDEN', 403);
  });

  it('returns a rejected close-out to DRAFT with the note, and requires a note to reject', async () => {
    const h = harness();
    await submitted(h, 60);
    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'REJECT' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(62))), 'VALIDATION_FAILED', 400);
    const rejected = await h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'REJECT', note: 'Thiếu biên bản hủy' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(63)));
    expect(rejected.value).toMatchObject({ closeout_status: 'DRAFT', review_note: 'Thiếu biên bản hủy' });
    expect(h.db.ticket.status).toBe('HANDED_OVER');
    expect(h.handoffs.create).not.toHaveBeenCalled();
  });

  it('approves once: posts the return, retires the rest, clears custody and closes the ticket; a retry replays', async () => {
    const h = harness();
    await submitted(h, 70);
    const approved = await h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(72)));
    expect(approved.value).toMatchObject({ closeout_status: 'APPROVED', ticket_status: 'CLOSED' });
    expect(h.db.ticket.status).toBe('CLOSED');
    expect(h.db.stock.get(`${WH}:${WATER}`)).toBe(4);
    expect(h.handoffs.create).toHaveBeenCalledTimes(1);
    expect(h.db.lines.map((l) => [l.id, l.in_transit])).toEqual([[LINE_WATER, 0], [LINE_BOTTLE, 0], [LINE_FOOD, 0]]);
    expect(h.db.custody.get(`${TEAM}:${WATER}`)).toBe(0);
    expect(h.db.custody.get(`${TEAM}:${BOTTLE}`)).toBe(0);
    expect(h.db.custody.get(`${TEAM}:${FOOD}`)).toBe(0);

    const retry = await h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(72)));
    expect(retry.replay).toBe(true);
    expect(h.db.stock.get(`${WH}:${WATER}`)).toBe(4);
    expect(h.handoffs.create).toHaveBeenCalledTimes(1);

    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 3, decision: 'APPROVE' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(73))), 'STATE_TRANSITION_INVALID', 409);
  });

  it('refuses approval when the live ledger no longer matches the close-out (PICKUP_LEDGER_MISMATCH)', async () => {
    const h = harness();
    await submitted(h, 80);
    h.db.lines.find((l) => l.id === LINE_WATER)!.in_transit = 5;
    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(82))), 'PICKUP_LEDGER_MISMATCH', 409);
    expect(h.db.ticket.status).toBe('HANDED_OVER');
    expect(h.db.stock.get(`${WH}:${WATER}`)).toBe(0);
  });

  it('refuses approval while a LOSS handoff is still waiting for review', async () => {
    const h = harness();
    await submitted(h, 90);
    h.db.pendingLoss = true;
    await expectCode(h.service.reviewCloseout(TICKET, { expected_version: 2, decision: 'APPROVE' }, req(OPS_REVIEW, OPS_SYSTEM as never, K(92))), 'PICKUP_LEDGER_MISMATCH', 409);
  });
});

describe('unaccounted goods (resolution guard source)', () => {
  it('blocks resolution of a request while its HANDED_OVER ticket still holds goods', async () => {
    const h = harness();
    await expectCode(h.guard.assertRequestResolvable(REQUEST), 'PICKUP_UNACCOUNTED_GOODS', 409);
  });

  it('allows resolution once the ticket holds no goods', async () => {
    const h = harness();
    h.db.lines.forEach((line) => { line.in_transit = 0; });
    await expect(h.guard.assertRequestResolvable(REQUEST)).resolves.toBeUndefined();
  });
});

describe('pickup close-out: catalog', () => {
  it('gives every new close-out code a Vietnamese catalog row', () => {
    const catalog = parseErrorCatalog(readFileSync(resolve(process.cwd(), '../docs/backend/07-error-catalog.md'), 'utf8'));
    for (const code of [
      'PICKUP_ITEM_NOT_ON_TICKET', 'PICKUP_DELIVERY_EXCEEDS_CUSTODY', 'PICKUP_LEDGER_MISMATCH', 'PICKUP_UNACCOUNTED_GOODS',
      'CLOSEOUT_LINES_INVALID', 'CLOSEOUT_INVARIANT_VIOLATED', 'CLOSEOUT_RETIRE_REASON_REQUIRED', 'ITEM_NOT_RETURNABLE', 'CLOSEOUT_STALE',
    ]) {
      const entry = catalog.get(code);
      expect(entry).toBeDefined();
      expect([...(entry?.message ?? '')].some((char) => char.charCodeAt(0) > 127)).toBe(true);
    }
  });
});
