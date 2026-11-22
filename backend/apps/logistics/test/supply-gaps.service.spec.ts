import { describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { SupplyGapsService } from '../src/supply-gaps/supply-gaps.service';
import { SupplyGapQueriesService } from '../src/supply-gaps/supply-gap-queries.service';

const W = '11111111-1111-4111-8111-111111111111';
const CAMP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WATER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GAP_ID = '55555555-5555-4555-8555-555555555555';
const DRIVE_ID = '66666666-6666-4666-8666-666666666666';
const OPS_USER = '99999999-9999-4999-8999-999999999999';
const KEY = '44444444-4444-4444-8444-444444444444';
const DAY = 24 * 60 * 60 * 1000;

interface GapRow {
  id: string;
  warehouse_id: string;
  item_id: string;
  status: string;
  severity: string;
  demand: string;
  supply: string;
  pledged: string;
  gap_qty: string;
  campaign_ids: string[];
  backup_warehouse_ids: string[];
  reason_codes: string[];
  draft: Record<string, unknown>;
  drive_id: string | null;
  dismissed_reason: string | null;
  dismissed_until: Date | null;
  version: number;
  scale: number;
  item_name: string;
  warehouse_name: string;
  unit_code: string;
  computed_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface NeedRow {
  campaign_id: string;
  item_id: string;
  source: string;
  requested: string;
  committed: string;
  item_name: string;
  scale: number;
}

interface Scenario {
  warehouseStatus: string;
  primaries: string[];
  needs: NeedRow[];
  stock: Array<{ warehouse_id: string; item_id: string; on_hand: string; reserved: string }>;
  backups: Array<{ campaign_id: string; warehouse_id: string }>;
  pledges: Array<{ item_id: string; target_quantity: string; received: string }>;
  reevaluateCandidates: string[];
  warehouseIds: string[];
}

function baseScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    warehouseStatus: 'ACTIVE',
    primaries: [CAMP_A],
    needs: [{ campaign_id: CAMP_A, item_id: WATER, source: 'DECLARED', requested: '100', committed: '0', item_name: 'Nước uống', scale: 0 }],
    stock: [{ warehouse_id: W, item_id: WATER, on_hand: '20.000', reserved: '0.000' }],
    backups: [],
    pledges: [],
    reevaluateCandidates: [],
    warehouseIds: [W],
    ...overrides,
  };
}

/**
 * In-memory stand-in for the SQL used by SupplyGapsService. It answers the statements by their text, so the tests
 * check the service logic and call shapes. It does not prove the SQL itself: that needs a real PostgreSQL run.
 */
class FakeDb {
  rows: GapRow[] = [];
  audits: Array<{ action: string; params: unknown[] }> = [];
  sql: string[] = [];
  private nextId = 1;

  constructor(public scenario: Scenario) {}

  seed(row: Partial<GapRow>): GapRow {
    const full: GapRow = {
      id: GAP_ID, warehouse_id: W, item_id: WATER, status: 'OPEN', severity: 'RED', demand: '100', supply: '20', pledged: '0',
      gap_qty: '80', campaign_ids: [CAMP_A], backup_warehouse_ids: [], reason_codes: ['DEMAND_EXCEEDS_SUPPLY'], draft: {},
      drive_id: null, dismissed_reason: null, dismissed_until: null, version: 1, scale: 0, item_name: 'Nước uống',
      unit_code: 'LITRE', warehouse_name: 'Kho trung tâm', computed_at: new Date(), created_at: new Date('2026-11-18T01:00:00Z'), updated_at: new Date(),
      ...row,
    };
    this.rows.push(full);
    return full;
  }

  find(id: string): GapRow {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`missing row ${id}`);
    return row;
  }

  async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    this.sql.push(sql);
    const s = this.scenario;
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('JOIN warehouse w ON w.id=g.warehouse_id')) {
      const rows = sql.includes('WHERE g.id=$3') ? this.rows.filter((row) => row.id === params[2]) : this.rows;
      return rows.map((row) => ({ ...row, forecast_demand: '0', cursor_created_at: '2026-11-18T01:00:00.000000Z' }));
    }
    if (sql.includes('FOR UPDATE')) {
      const row = this.rows.find((candidate) => candidate.id === params[0]);
      return row ? [{ id: row.id, warehouse_id: row.warehouse_id, item_id: row.item_id, status: row.status, severity: row.severity, version: row.version, draft: row.draft }] : [];
    }
    if (sql.includes('SELECT s.campaign_id FROM campaign_area_snapshot s')) return s.reevaluateCandidates.map((campaign_id) => ({ campaign_id }));
    if (sql.includes('SELECT DISTINCT cw.warehouse_id')) return s.warehouseIds.map((warehouse_id) => ({ warehouse_id }));
    if (sql.includes('SELECT status FROM warehouse')) return [{ status: s.warehouseStatus }];
    if (sql.includes("cw.role='PRIMARY' AND s.status = ANY")) return s.primaries.map((campaign_id) => ({ campaign_id }));
    if (sql.includes('fc.campaign_id, rn.item_id, rn.source')) return s.needs.map((need) => ({ ...need }));
    if (sql.includes("cw.role='BACKUP'")) return s.backups.map((backup) => ({ ...backup }));
    if (sql.includes('FROM stock_balance sb')) return s.stock.map((stock) => ({ ...stock }));
    if (sql.includes('donation_delivery dd')) return s.pledges.map((pledge) => ({ ...pledge }));
    if (sql.includes("SELECT item_id, draft FROM supply_gap")) {
      return this.rows.filter((row) => row.warehouse_id === params[0] && row.status === 'OPEN').map((row) => ({ item_id: row.item_id, draft: row.draft }));
    }
    if (sql.includes('DISTINCT ON (item_id)')) {
      const now = Date.now();
      return this.rows
        .filter((row) => row.warehouse_id === params[0] && row.status === 'DISMISSED' && row.dismissed_until !== null && row.dismissed_until.getTime() > now)
        .map((row) => ({ item_id: row.item_id, severity: row.severity, gap_qty: row.gap_qty }));
    }
    if (sql.includes('INSERT INTO supply_gap')) return [this.upsert(params)];
    if (sql.includes("SET status='EXPIRED'")) {
      const [warehouseId, keep] = params as [string, string[]];
      const expired: Array<{ id: string; severity: string }> = [];
      for (const row of this.rows) {
        if (row.warehouse_id === warehouseId && row.status === 'OPEN' && !keep.includes(row.item_id)) {
          row.status = 'EXPIRED';
          row.version += 1;
          expired.push({ id: row.id, severity: row.severity });
        }
      }
      return expired;
    }
    if (sql.includes("SET status='ACCEPTED'")) {
      const [id, driveId] = params as [string, string];
      const row = this.find(id);
      row.status = 'ACCEPTED';
      row.drive_id = driveId;
      row.version += 1;
      return [];
    }
    if (sql.includes("SET status='DISMISSED'")) {
      const [id, reason, days] = params as [string, string, number];
      const row = this.find(id);
      row.status = 'DISMISSED';
      row.dismissed_reason = reason;
      row.dismissed_until = new Date(Date.now() + days * DAY);
      row.version += 1;
      return [];
    }
    if (sql.includes('INSERT INTO audit_log')) {
      this.audits.push({ action: params[1] as string, params });
      return [];
    }
    throw new Error(`Unhandled SQL in fake: ${sql.slice(0, 120)}`);
  }

  /** Mirrors ON CONFLICT (warehouse_id,item_id) WHERE status='OPEN': refresh in place, bump version only on change. */
  private upsert(params: unknown[]): { id: string; inserted: boolean } {
    const [warehouseId, itemId, demand, supply, pledged, gap, severity, campaignIds, backupIds, reasonCodes, draftJson] = params as [
      string, string, string, string, string, string, string, string[], string[], string[], string,
    ];
    const draft = JSON.parse(draftJson) as Record<string, unknown>;
    const existing = this.rows.find((row) => row.warehouse_id === warehouseId && row.item_id === itemId && row.status === 'OPEN');
    const next = { demand, supply, pledged, gap_qty: gap, severity, campaign_ids: campaignIds, backup_warehouse_ids: backupIds, reason_codes: reasonCodes, draft };
    if (existing) {
      const changed = JSON.stringify([existing.demand, existing.supply, existing.pledged, existing.gap_qty, existing.severity,
        existing.campaign_ids, existing.backup_warehouse_ids, existing.reason_codes, existing.draft])
        !== JSON.stringify([next.demand, next.supply, next.pledged, next.gap_qty, next.severity, next.campaign_ids,
          next.backup_warehouse_ids, next.reason_codes, next.draft]);
      if (changed) existing.version += 1;
      Object.assign(existing, next, { computed_at: new Date(), updated_at: new Date() });
      return { id: existing.id, inserted: false };
    }
    const id = `${String(this.nextId++).padStart(8, '0')}-0000-4000-8000-000000000000`;
    this.seed({ id, warehouse_id: warehouseId, item_id: itemId, ...next, status: 'OPEN', version: 1 });
    return { id, inserted: true };
  }
}

function fixtures(scenario: Scenario = baseScenario()) {
  const db = new FakeDb(scenario);
  const manager = { query: jest.fn((sql: string, params?: unknown[]) => db.query(sql, params)) };
  const dataSource = {
    query: jest.fn((sql: string, params?: unknown[]) => db.query(sql, params)),
    transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) => work(manager)),
  };
  const sessionFor = (role: 'OPERATIONS_MANAGER' | 'COORDINATOR') => ({
    userId: OPS_USER,
    grants: [{ role_code: role, scope_type: 'SYSTEM' as const }],
    identityHeaders: {},
  });
  let session = sessionFor('OPERATIONS_MANAGER');
  const sessions = { require: jest.fn(async () => session) };
  const drives = {
    create: jest.fn(async (_dto: unknown, _request: unknown) => ({ status: 201, value: { id: DRIVE_ID }, replay: false })),
  };
  const campaigns = { reevaluateCampaign: jest.fn(async (_campaignId: string, _reason?: string) => undefined) };
  const idempotency = {
    execute: jest.fn(async (_source: unknown, command: { execute: (m: typeof manager) => Promise<{ status: number; value: unknown }> }) => {
      const outcome = await command.execute(manager);
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  };
  const service = new SupplyGapsService(
    dataSource as never, idempotency as never, sessions as never, drives as never, campaigns as never,
  );
  const request = { idempotencyKey: KEY, headers: {} } as unknown as Request;
  return {
    db, service, drives, campaigns, dataSource,
    request,
    setRole(role: 'OPERATIONS_MANAGER' | 'COORDINATOR') {
      session = sessionFor(role);
    },
  };
}

describe('SupplyGapsService.recompute', () => {
  it('opens one RED gap with a draft drive for the largest-share campaign and refreshes it instead of duplicating', async () => {
    const { db, service } = fixtures();
    const first = await service.recompute();
    expect(first).toEqual({ warehouses: 1, failed: 0 });
    const open = db.rows.filter((row) => row.status === 'OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ severity: 'RED', demand: '100', supply: '20', gap_qty: '80', campaign_ids: [CAMP_A], version: 1 });
    expect(open[0]?.draft).toMatchObject({
      intake_warehouse_id: W,
      campaign_id: CAMP_A,
      title: 'Quyên góp bổ sung Nước uống',
      items: [{ item_id: WATER, target_quantity: '88' }],
    });
    expect(db.audits.map((audit) => audit.action)).toEqual(['SUPPLY_GAP_OPENED']);

    const second = await service.recompute();
    expect(second.failed).toBe(0);
    expect(db.rows.filter((row) => row.status === 'OPEN')).toHaveLength(1);
    expect(db.find(open[0]!.id).version).toBe(1);
    expect(db.audits.map((audit) => audit.action)).toEqual(['SUPPLY_GAP_OPENED']);
  });

  it('bumps the version when the demand changes and keeps the same row', async () => {
    const scenario = baseScenario();
    const { db, service } = fixtures(scenario);
    await service.recompute();
    const id = db.rows[0]!.id;
    scenario.needs[0]!.requested = '120';
    await service.recompute();
    expect(db.rows.filter((row) => row.status === 'OPEN')).toHaveLength(1);
    expect(db.find(id)).toMatchObject({ gap_qty: '100', version: 2 });
  });

  it('expires an OPEN gap once the shortage is gone', async () => {
    const scenario = baseScenario();
    const { db, service } = fixtures(scenario);
    await service.recompute();
    scenario.stock = [{ warehouse_id: W, item_id: WATER, on_hand: '500.000', reserved: '0.000' }];
    await service.recompute();
    expect(db.rows[0]).toMatchObject({ status: 'EXPIRED' });
    expect(db.audits.map((audit) => audit.action)).toEqual(['SUPPLY_GAP_OPENED', 'SUPPLY_GAP_EXPIRED']);
  });

  it('subtracts a drive pledge so the suggestion is not repeated for demand the drive already covers, and no YELLOW returns', async () => {
    const scenario = baseScenario({ pledges: [{ item_id: WATER, target_quantity: '90', received: '0' }] });
    const { db, service } = fixtures(scenario);
    await service.recompute();
    // Pledged 90 on top of stock 20 covers demand 100 (supply 110): no warning and no new suggestion.
    expect(db.rows).toEqual([]);
  });

  it('uses the largest contending campaign as the draft campaign and lists every contender', async () => {
    const scenario = baseScenario({
      primaries: [CAMP_A, CAMP_B],
      needs: [
        { campaign_id: CAMP_A, item_id: WATER, source: 'DECLARED', requested: '30', committed: '0', item_name: 'Nước uống', scale: 0 },
        { campaign_id: CAMP_B, item_id: WATER, source: 'CONFIRMED', requested: '90', committed: '0', item_name: 'Nước uống', scale: 0 },
      ],
      stock: [],
    });
    const { db, service } = fixtures(scenario);
    await service.recompute();
    expect(db.rows[0]).toMatchObject({ campaign_ids: [CAMP_B, CAMP_A], demand: '120' });
    expect(db.rows[0]?.draft).toMatchObject({ campaign_id: CAMP_B, items: [{ target_quantity: '132' }] });
    expect(db.rows[0]?.reason_codes).toContain('CAMPAIGN_CONTENTION');
  });

  it('reevaluates active campaigns and campaigns with live needs that have no PRIMARY before computing', async () => {
    const scenario = baseScenario({ primaries: [], needs: [], stock: [], reevaluateCandidates: [CAMP_A, CAMP_B] });
    const { service, campaigns } = fixtures(scenario);
    await service.recompute();
    expect(campaigns.reevaluateCampaign.mock.calls.map((call) => call[0])).toEqual([CAMP_A, CAMP_B]);
  });

  it('keeps going when one campaign reevaluation fails', async () => {
    const scenario = baseScenario({ primaries: [], needs: [], stock: [], reevaluateCandidates: [CAMP_A] });
    const { service, campaigns } = fixtures(scenario);
    campaigns.reevaluateCampaign.mockRejectedValueOnce(new AppError('RESPONSE_UNAVAILABLE', { status: 503 }));
    await expect(service.recompute()).resolves.toEqual({ warehouses: 1, failed: 0 });
  });

  it('never throws into the caller: a failed warehouse transaction is counted and logged', async () => {
    const { service, dataSource } = fixtures();
    dataSource.transaction.mockRejectedValueOnce(new AppError('LOCK_TIMEOUT', { status: 503 }));
    await expect(service.recompute()).resolves.toEqual({ warehouses: 0, failed: 1 });
  });

  it('does not throw when warehouse selection itself fails', async () => {
    const { service, dataSource } = fixtures();
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT cw.warehouse_id')) throw new Error('connection reset');
      return [];
    });
    await expect(service.recompute()).resolves.toEqual({ warehouses: 0, failed: 1 });
  });
});

describe('SupplyGapsService cooldown after dismissal', () => {
  async function dismissed(scenario: Scenario) {
    const fx = fixtures(scenario);
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    fx.setRole('OPERATIONS_MANAGER');
    await fx.service.dismiss(gap.id, { expected_version: gap.version, reason: 'Đã có nguồn khác', dismissed_days: 3 }, fx.request);
    return { ...fx, gap };
  }

  it('does not reopen a dismissed gap while it has not grown by 25 percent', async () => {
    const scenario = baseScenario();
    const fx = await dismissed(scenario);
    expect(fx.db.rows.find((row) => row.id === fx.gap.id)).toMatchObject({ status: 'DISMISSED', dismissed_reason: 'Đã có nguồn khác' });
    scenario.needs[0]!.requested = '110'; // gap 90 is below 1.25 x 80
    await fx.service.recompute();
    expect(fx.db.rows.filter((row) => row.status === 'OPEN')).toHaveLength(0);
  });

  it('reopens as a new OPEN row once the gap grew by at least 25 percent', async () => {
    const scenario = baseScenario();
    const fx = await dismissed(scenario);
    scenario.needs[0]!.requested = '130'; // gap 110 is at least 1.25 x 80
    await fx.service.recompute();
    const open = fx.db.rows.filter((row) => row.status === 'OPEN');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ gap_qty: '110', severity: 'RED' });
    expect(open[0]?.id).not.toBe(fx.gap.id);
  });

  it('reopens after the cooldown ends regardless of growth', async () => {
    const scenario = baseScenario();
    const fx = await dismissed(scenario);
    fx.db.rows[0]!.dismissed_until = new Date(Date.now() - 1000);
    await fx.service.recompute();
    expect(fx.db.rows.filter((row) => row.status === 'OPEN')).toHaveLength(1);
  });
});

describe('SupplyGapsService.accept', () => {
  it('creates a draft drive through DrivesService.create, links it back and marks the gap ACCEPTED', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    const result = await fx.service.accept(gap.id, { expected_version: gap.version }, fx.request);
    expect(fx.drives.create).toHaveBeenCalledTimes(1);
    const [dto, request] = fx.drives.create.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(dto).toMatchObject({
      title: 'Quyên góp bổ sung Nước uống',
      intake_warehouse_id: W,
      campaign_id: CAMP_A,
      items: [{ item_id: WATER, target_quantity: '88' }],
    });
    expect(request).toBe(fx.request);
    expect(fx.db.find(gap.id)).toMatchObject({ status: 'ACCEPTED', drive_id: DRIVE_ID, version: 2 });
    expect(result.value).toMatchObject({ id: gap.id, status: 'ACCEPTED', drive_id: DRIVE_ID, version: 2 });
    expect(fx.db.audits.map((audit) => audit.action)).toContain('SUPPLY_GAP_ACCEPTED');
  });

  it('applies manager overrides before the existing drive validation runs', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    await fx.service.accept(gap.id, {
      expected_version: gap.version,
      overrides: { title: 'Gạo và nước đợt 1', items: [{ item_id: WATER, target_quantity: '150' }], closes_at: '2026-12-01T00:00:00.000Z' },
    }, fx.request);
    expect(fx.drives.create.mock.calls[0]![0]).toMatchObject({
      title: 'Gạo và nước đợt 1',
      items: [{ item_id: WATER, target_quantity: '150' }],
      closes_at: '2026-12-01T00:00:00.000Z',
      campaign_id: CAMP_A,
    });
  });

  it('refuses a coordinator with 403 and never creates a drive', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    fx.setRole('COORDINATOR');
    await expect(fx.service.accept(gap.id, { expected_version: gap.version }, fx.request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(fx.drives.create).not.toHaveBeenCalled();
    expect(fx.db.find(gap.id).status).toBe('OPEN');
  });

  it('rejects a stale expected_version with VERSION_CONFLICT and creates nothing', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    await expect(fx.service.accept(gap.id, { expected_version: gap.version + 1 }, fx.request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(fx.drives.create).not.toHaveBeenCalled();
  });

  it('refuses a YELLOW warning because it has no draft to accept', async () => {
    const fx = fixtures(baseScenario({ stock: [{ warehouse_id: W, item_id: WATER, on_hand: '100.000', reserved: '0.000' }], needs: [
      { campaign_id: CAMP_A, item_id: WATER, source: 'DECLARED', requested: '85', committed: '0', item_name: 'Nước uống', scale: 0 },
    ] }));
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    expect(gap.severity).toBe('YELLOW');
    await expect(fx.service.accept(gap.id, { expected_version: gap.version }, fx.request))
      .rejects.toMatchObject({ code: 'SUPPLY_GAP_WARNING_ONLY', status: 409 });
    expect(fx.drives.create).not.toHaveBeenCalled();
  });

  it('refuses a gap that is no longer OPEN', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    await fx.service.accept(gap.id, { expected_version: gap.version }, fx.request);
    const version = fx.db.find(gap.id).version;
    await expect(fx.service.accept(gap.id, { expected_version: version }, fx.request))
      .rejects.toMatchObject({ code: 'SUPPLY_GAP_NOT_OPEN', status: 409 });
    expect(fx.drives.create).toHaveBeenCalledTimes(1);
  });

  it('leaves the gap OPEN when the drive rules refuse the draft (for example the campaign is not active)', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    fx.drives.create.mockRejectedValueOnce(new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 }));
    await expect(fx.service.accept(gap.id, { expected_version: gap.version }, fx.request))
      .rejects.toMatchObject({ code: 'CAMPAIGN_NOT_ACTIVE' });
    expect(fx.db.find(gap.id)).toMatchObject({ status: 'OPEN', version: 1, drive_id: null });
  });

  it('returns NOT_FOUND for an unknown gap', async () => {
    const fx = fixtures();
    await expect(fx.service.accept(GAP_ID, { expected_version: 1 }, fx.request)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('SupplyGapsService.dismiss', () => {
  it('records the reason and a cooldown of the requested days and audits the change', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    const before = Date.now();
    const result = await fx.service.dismiss(gap.id, { expected_version: gap.version, reason: '  Đã có nguồn khác  ', dismissed_days: 2 }, fx.request);
    const row = fx.db.find(gap.id);
    expect(row).toMatchObject({ status: 'DISMISSED', dismissed_reason: 'Đã có nguồn khác', version: 2 });
    const until = row.dismissed_until!.getTime();
    expect(until).toBeGreaterThanOrEqual(before + 2 * DAY - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 2 * DAY + 1000);
    expect(result.value).toMatchObject({ status: 'DISMISSED' });
    expect(fx.db.audits.at(-1)).toMatchObject({ action: 'SUPPLY_GAP_DISMISSED' });
  });

  it('refuses a coordinator and a version conflict', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const gap = fx.db.rows[0]!;
    fx.setRole('COORDINATOR');
    await expect(fx.service.dismiss(gap.id, { expected_version: gap.version, reason: 'x' }, fx.request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    fx.setRole('OPERATIONS_MANAGER');
    await expect(fx.service.dismiss(gap.id, { expected_version: 9, reason: 'x' }, fx.request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(fx.db.find(gap.id).status).toBe('OPEN');
  });
});

describe('SupplyGapQueriesService', () => {
  it('lets an operations manager read a page and a detail, and refuses a coordinator, with Vietnamese reason copy', async () => {
    const fx = fixtures();
    await fx.service.recompute();
    const sessions = { require: jest.fn(async () => ({ userId: OPS_USER, grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], identityHeaders: {} })) };
    const queries = new SupplyGapQueriesService(fx.dataSource as never, sessions as never);
    const coordinatorSessions = { require: jest.fn(async () => ({ userId: OPS_USER, grants: [{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], identityHeaders: {} })) };
    const coordinatorQueries = new SupplyGapQueriesService(fx.dataSource as never, coordinatorSessions as never);
    await expect(coordinatorQueries.list({ status: 'OPEN', limit: 10 }, fx.request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const gapId = fx.db.rows[0]!.id;
    const page = await queries.list({ status: 'OPEN', limit: 10 }, fx.request);
    expect(page).toMatchObject({ more: false, items: [expect.objectContaining({ id: gapId, severity: 'RED', demand: '100', gap_qty: '80' })] });
    const [item] = (page as { items: Array<{ reasons: Array<{ code: string; message: string }> }> }).items;
    expect(item?.reasons[0]).toMatchObject({ code: 'DEMAND_EXCEEDS_SUPPLY' });
    expect(item?.reasons[0]?.message).toContain('tồn kho');
    await expect(queries.detail(gapId, fx.request)).resolves.toMatchObject({ id: gapId });
  });

  it('rejects a cursor that does not match the filters with CURSOR_INVALID', async () => {
    const fx = fixtures();
    const sessions = { require: jest.fn(async () => ({ userId: OPS_USER, grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], identityHeaders: {} })) };
    const queries = new SupplyGapQueriesService(fx.dataSource as never, sessions as never);
    await expect(queries.list({ cursor: 'bm90LWEtY3Vyc29y' }, fx.request)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });
});
