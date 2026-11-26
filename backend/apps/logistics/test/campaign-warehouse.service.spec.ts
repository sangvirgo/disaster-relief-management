import { describe, expect, it, jest } from '@jest/globals';
import { AppError } from '@c48/technical/errors/errors';
import { CampaignWarehouseService } from '../src/campaign-warehouses/campaign-warehouses.service';
import { CandidateRow } from '../src/campaign-warehouses/campaign-warehouses.helpers';

const CAMPAIGN = '66666666-6666-4666-8666-666666666666';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OPS_USER = '99999999-9999-4999-8999-999999999999';
const KEY = '44444444-4444-4444-8444-444444444444';

interface FakeState {
  snapshot: Record<string, unknown> | null;
  stored: Array<Record<string, unknown>>;
  candidates: CandidateRow[];
  warehouseIds: string[];
  audits: unknown[][];
  sql: string[];
}

function candidate(id: string, distance: number, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    warehouse_id: id, name: `Kho ${id.slice(0, 4)}`, distance_m: distance,
    open_needed_items: 1, needed_items_in_stock: 0, open_supply_requests: 0, ...overrides,
  };
}

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    snapshot: { campaign_id: CAMPAIGN, status: 'ACTIVE', radius_m: 3000, assignment_version: 2, lat: 10, lng: 106 },
    stored: [
      { campaign_id: CAMPAIGN, warehouse_id: A, role: 'PRIMARY', source: 'AUTO', distance_m: 1000, version: 2 },
      { campaign_id: CAMPAIGN, warehouse_id: B, role: 'BACKUP', source: 'AUTO', distance_m: 2000, version: 2 },
    ],
    candidates: [candidate(A, 1000), candidate(B, 2000)],
    warehouseIds: [A, B],
    audits: [],
    sql: [],
    ...overrides,
  };
}

/** In-memory stand-in for the c48_logistics tables touched by the assignment service, routed by SQL text. */
function fakeManager(state: FakeState) {
  const query = jest.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    state.sql.push(sql);
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.includes('WITH needs AS')) return state.candidates.map((row) => ({ ...row }));
    if (sql.includes('SELECT id FROM warehouse WHERE id')) return state.warehouseIds.includes(params[0] as string) ? [{ id: params[0] }] : [];
    if (sql.includes('INSERT INTO campaign_area_snapshot')) {
      const [campaignId, lat, lng, radius, status] = params as [string, number | null, number | null, number | null, string];
      state.snapshot = {
        campaign_id: campaignId, status, radius_m: radius, assignment_version: state.snapshot?.assignment_version ?? 0,
        lat, lng,
      };
      return [];
    }
    if (sql.includes('FROM campaign_area_snapshot WHERE campaign_id')) return state.snapshot ? [{ ...state.snapshot }] : [];
    if (sql.includes('UPDATE campaign_area_snapshot SET assignment_version')) {
      state.snapshot = { ...state.snapshot, assignment_version: params[1] };
      return [];
    }
    if (sql.includes("UPDATE campaign_warehouse SET role='BACKUP'")) {
      state.stored = state.stored.map((row) => (row.role === 'PRIMARY' ? { ...row, role: 'BACKUP' } : row));
      return [];
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM campaign_warehouse WHERE campaign_id')) return state.stored.map((row) => ({ ...row }));
    if (sql.includes('DELETE FROM campaign_warehouse')) {
      const keep = params[1] as string[];
      state.stored = state.stored.filter((row) => keep.includes(row.warehouse_id as string));
      return [];
    }
    if (sql.includes('INSERT INTO campaign_warehouse')) {
      const [campaignId, warehouseId, role, source, distance, version] = params;
      const row = { campaign_id: campaignId, warehouse_id: warehouseId, role, source, distance_m: distance, version };
      state.stored = [...state.stored.filter((item) => item.warehouse_id !== warehouseId), row];
      return [];
    }
    if (sql.includes('INSERT INTO audit_log')) {
      state.audits.push(params);
      return [];
    }
    return [];
  });
  return { query };
}

function harness(state: FakeState, grants = [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }]) {
  const manager = fakeManager(state);
  const dataSource = {
    manager,
    transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(manager)),
    query: jest.fn(async (): Promise<unknown[]> => []),
  };
  const idempotency = {
    execute: jest.fn(async (_dataSource: unknown, command: { execute: (m: unknown) => Promise<{ status: number; value: unknown }> }) => {
      const outcome = await command.execute(manager);
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  };
  const sessions = { require: jest.fn(async () => ({ userId: OPS_USER, grants, identityHeaders: {} })) };
  const campaigns = {
    getCampaign: jest.fn(async () => ({ id: CAMPAIGN, status: 'ACTIVE', version: 4, center: { lat: 10, lng: 106 }, radius_m: 3000 })),
  };
  const service = new CampaignWarehouseService(
    dataSource as never,
    idempotency as never,
    sessions as never,
    campaigns as never,
  );
  return { service, manager, dataSource, idempotency, sessions, campaigns };
}

const putRequest = { idempotencyKey: KEY } as never;

describe('Campaign warehouse assignment service', () => {
  it('lets a manager set a manual primary, demotes the old primary, bumps the version and audits the change', async () => {
    const state = freshState();
    const { service } = harness(state);

    const result = await service.setPrimary(CAMPAIGN, { warehouse_id: B, expected_version: 2, reason: 'Kho gần vùng ngập hơn' }, putRequest);

    expect(result.value).toMatchObject({
      campaign_id: CAMPAIGN, assignment_version: 3, primary: { warehouse_id: B, source: 'MANUAL', eligible: true },
    });
    expect(state.stored.find((row) => row.warehouse_id === B)).toMatchObject({ role: 'PRIMARY', source: 'MANUAL', version: 3 });
    expect(state.stored.find((row) => row.warehouse_id === A)).toMatchObject({ role: 'BACKUP', source: 'AUTO', version: 3 });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]?.[0]).toBe(OPS_USER);
    expect(state.audits[0]?.[1]).toBe('CAMPAIGN_PRIMARY_WAREHOUSE_SET');
    expect(state.audits[0]?.[5]).toBe('Kho gần vùng ngập hơn');
  });

  it('rejects a manual override of a warehouse outside every eligible radius and writes nothing', async () => {
    const state = freshState({ candidates: [candidate(A, 1000)] });
    const { service } = harness(state);
    const before = JSON.stringify(state.stored);

    const failure = await service.setPrimary(CAMPAIGN, { warehouse_id: B, expected_version: 2, reason: 'Thử nghiệm' }, putRequest)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: 'WAREHOUSE_NOT_ELIGIBLE', status: 409 });
    expect(JSON.stringify(state.stored)).toBe(before);
    expect(state.audits).toEqual([]);
    expect(state.snapshot?.assignment_version).toBe(2);
  });

  it('rejects a stale expected_version with VERSION_CONFLICT before any write', async () => {
    const state = freshState();
    const { service } = harness(state);

    await expect(service.setPrimary(CAMPAIGN, { warehouse_id: B, expected_version: 1, reason: 'Cũ' }, putRequest))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, details: { current_version: 2 } });
    expect(state.audits).toEqual([]);
    expect(state.stored.find((row) => row.warehouse_id === B)?.role).toBe('BACKUP');
  });

  it('denies a coordinator the manual primary change before fetching the campaign or starting a command', async () => {
    const state = freshState();
    const { service, campaigns, idempotency } = harness(state, [{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }]);

    await expect(service.setPrimary(CAMPAIGN, { warehouse_id: B, expected_version: 2, reason: 'Không có quyền' }, putRequest))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(campaigns.getCampaign).not.toHaveBeenCalled();
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('lets a coordinator read the assignment', async () => {
    const state = freshState();
    const { service } = harness(state, [{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }]);

    const view = await service.list(CAMPAIGN, { headers: {} } as never);

    expect(view).toMatchObject({
      campaign_id: CAMPAIGN,
      primary: { warehouse_id: A, source: 'AUTO', eligible: true },
      flags: [],
    });
  });

  it('serves GET strictly read-only: no transaction, lock, INSERT, UPDATE, DELETE or audit, and the stored state is unchanged', async () => {
    const state = freshState({
      snapshot: { campaign_id: CAMPAIGN, status: 'ACTIVE', radius_m: 3000, assignment_version: 2, lat: 10.5, lng: 106 },
      stored: [{ campaign_id: CAMPAIGN, warehouse_id: B, role: 'BACKUP', source: 'AUTO', distance_m: 2000, version: 2 }],
      candidates: [candidate(A, 300), candidate(B, 2000)],
    });
    const { service, manager, dataSource, idempotency } = harness(state);
    const storedBefore = JSON.stringify(state.stored);
    const snapshotBefore = JSON.stringify(state.snapshot);

    const view = await service.list(CAMPAIGN, { headers: {} } as never);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(idempotency.execute).not.toHaveBeenCalled();
    const statements = manager.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.length).toBeGreaterThan(0);
    for (const sql of statements) {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT)\b/u);
      expect(sql).not.toContain('pg_advisory');
    }
    expect(JSON.stringify(state.stored)).toBe(storedBefore);
    expect(JSON.stringify(state.snapshot)).toBe(snapshotBefore);
    expect(state.audits).toEqual([]);
    expect(view).toMatchObject({ assignment_version: 2, primary: null, proposed_primary_warehouse_id: A, flags: [] });
  });

  it('evaluates GET eligibility against the latest Response area without persisting it', async () => {
    const state = freshState({
      snapshot: { campaign_id: CAMPAIGN, status: 'ACTIVE', radius_m: 3000, assignment_version: 2, lat: 10, lng: 106 },
      candidates: [candidate(A, 1000)],
    });
    const { service, manager, campaigns } = harness(state);
    campaigns.getCampaign.mockResolvedValueOnce({ id: CAMPAIGN, status: 'ACTIVE', version: 5, center: { lat: 11, lng: 107 }, radius_m: 9000 });

    const view = await service.list(CAMPAIGN, { headers: {} } as never);

    const eligibility = manager.query.mock.calls.find(([sql]) => String(sql).includes('WITH needs AS'));
    expect(eligibility?.[1]).toEqual([CAMPAIGN, expect.any(Number), 107, 11, 9000]);
    expect(view).toMatchObject({ area: { center: { lat: 11, lng: 107 }, radius_m: 9000 }, assignment_version: 2 });
    expect(state.snapshot).toMatchObject({ lat: 10, lng: 106, radius_m: 3000 });
  });

  it('returns no proposed primary in GET when a PRIMARY is stored, and reports no serving warehouse when nothing is eligible', async () => {
    const withPrimary = harness(freshState());
    expect(await withPrimary.service.list(CAMPAIGN, { headers: {} } as never)).not.toHaveProperty('proposed_primary_warehouse_id');

    const none = harness(freshState({ stored: [], candidates: [] }));
    expect(await none.service.list(CAMPAIGN, { headers: {} } as never)).toMatchObject({
      primary: null, proposed_primary_warehouse_id: null, flags: ['NO_SERVING_WAREHOUSE'],
    });
  });

  it('assigns a primary for a brand-new campaign during reevaluateCampaign without any GET', async () => {
    const state = freshState({ snapshot: null, stored: [], candidates: [candidate(A, 1000), candidate(B, 2000)] });
    const { service } = harness(state);

    await service.reevaluateCampaign(CAMPAIGN);

    expect(state.stored.find((row) => row.role === 'PRIMARY')).toMatchObject({ warehouse_id: A, source: 'AUTO', version: 1 });
    expect(state.snapshot).toMatchObject({ campaign_id: CAMPAIGN, assignment_version: 1, lat: 10, lng: 106 });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]?.[5]).toBe('SCHEDULED_SWEEP');
  });

  it('keeps a MANUAL primary through a manager re-evaluation and clears it only when asked', async () => {
    const state = freshState({
      stored: [
        { campaign_id: CAMPAIGN, warehouse_id: B, role: 'PRIMARY', source: 'MANUAL', distance_m: 2000, version: 2 },
        { campaign_id: CAMPAIGN, warehouse_id: A, role: 'BACKUP', source: 'AUTO', distance_m: 1000, version: 2 },
      ],
    });
    const { service } = harness(state);

    await service.reevaluate(CAMPAIGN, false, putRequest);
    expect(state.stored.find((row) => row.role === 'PRIMARY')).toMatchObject({ warehouse_id: B, source: 'MANUAL' });
    expect(state.audits).toEqual([]);

    await service.reevaluate(CAMPAIGN, true, { idempotencyKey: '55555555-5555-4555-8555-555555555555' } as never);
    expect(state.stored.find((row) => row.role === 'PRIMARY')).toMatchObject({ warehouse_id: A, source: 'AUTO' });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]?.[0]).toBe(OPS_USER);
  });

  it('re-evaluates affected campaigns when a warehouse is deactivated, so a deactivated primary falls back', async () => {
    const state = freshState({ candidates: [candidate(B, 2000)] });
    const { service, dataSource } = harness(state);
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM campaign_area_snapshot s')) return [{ campaign_id: CAMPAIGN }];
      return [];
    });

    await service.onWarehouseChanged({
      before: { warehouse_id: A, status: 'ACTIVE', location: { lat: 10, lng: 106 }, radius_m: 5000 },
      after: { warehouse_id: A, status: 'INACTIVE', location: { lat: 10, lng: 106 }, radius_m: 5000 },
    });

    expect(state.stored.find((row) => row.warehouse_id === B)).toMatchObject({ role: 'PRIMARY', source: 'AUTO' });
    expect(state.stored.find((row) => row.warehouse_id === A)).toBeUndefined();
    expect(state.audits[0]?.[5]).toBe('WAREHOUSE_CHANGED');
  });

  it('never fails the warehouse command when the re-evaluation trigger fails', async () => {
    const state = freshState();
    const { service, dataSource } = harness(state);
    dataSource.query.mockRejectedValue(new Error('connection reset'));

    await expect(service.onWarehouseChanged({
      before: null,
      after: { warehouse_id: B, status: 'ACTIVE', location: { lat: 10, lng: 106 }, radius_m: 5000 },
    })).resolves.toBeUndefined();
  });

  it('re-ranks the AUTO primary when the campaign area changes', async () => {
    const state = freshState({
      snapshot: { campaign_id: CAMPAIGN, status: 'ACTIVE', radius_m: 3000, assignment_version: 2, lat: 10.5, lng: 106 },
      stored: [{ campaign_id: CAMPAIGN, warehouse_id: B, role: 'PRIMARY', source: 'AUTO', distance_m: 2000, version: 2 }],
      candidates: [candidate(A, 300), candidate(B, 2000)],
    });
    const { service } = harness(state);

    await service.reevaluateCampaign(CAMPAIGN);

    expect(state.stored.find((row) => row.role === 'PRIMARY')).toMatchObject({ warehouse_id: A, source: 'AUTO' });
    expect(state.snapshot).toMatchObject({ lat: 10, lng: 106, assignment_version: 3 });
  });

  it('applies the eligibility predicate with the warehouse radius plus the campaign radius, inside the Logistics database', async () => {
    const state = freshState();
    const { service } = harness(state);

    await service.list(CAMPAIGN, { headers: {} } as never);

    const eligibility = state.sql.find((sql) => sql.includes('WITH needs AS'));
    expect(eligibility).toContain("w.status = 'ACTIVE'");
    expect(eligibility).toContain('ST_DWithin(w.location, a.center, (w.service_radius_m + a.radius_m)::float8)');
    expect(eligibility).toContain("rn.status IN ('OPEN','PARTIALLY_FULFILLED')");
  });
});
