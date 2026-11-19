import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { JobRunner } from '@c48/technical/persistence/jobs';
import {
  NEED_EXTRACTION_MAX_PER_RUN, needExtractionCallLimit, NeedExtractionSweepService,
} from '../src/need-extraction/need-extraction-sweep.service';
import {
  loadNeedExtractionJobConfig, NEED_EXTRACTION_JOB_INTERVAL_MS, NEED_EXTRACTION_JOB_NAME, NeedExtractionScheduler,
} from '../src/need-extraction/need-extraction-scheduler.service';
import type { SupplyCandidate, SupplyCandidatePage } from '../src/integrations/response/response-supply-candidates.client';

afterEach(() => {
  jest.restoreAllMocks();
});

const waterId = '44444444-4444-4444-8444-444444444444';
const riceId = '45454545-4545-4545-8545-454545454545';

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function candidate(index: number, overrides: Partial<SupplyCandidate> = {}): SupplyCandidate {
  return {
    request_id: uuidFor(index),
    work_cycle: 1,
    campaign_id: null,
    status: 'VERIFIED',
    people_affected: 5,
    children_count: 1,
    elderly_count: 1,
    relief_items_text: 'cần nước uống',
    verified_at: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

interface FakeState {
  catalog: Array<Record<string, unknown>>;
  norms: Array<Record<string, unknown>>;
  quotaAllowed: boolean;
  logged: Array<{ request_id: string; work_cycle: number; status: string; source: string | null; error_code: string | null }>;
  cycleNeeds: Set<string>;
  inserts: Array<{ cycleRequest: string; basis: Record<string, unknown> }>;
  audits: Array<{ actor: string | null; action: string }>;
  sql: string[];
  failOn: Set<string>;
}

/** Routes the SQL the sweep and the estimate core issue to in-memory rows. Unknown SQL fails the test loudly. */
function fakeDatabase(state: FakeState) {
  const query = jest.fn(async (sql: string, values: unknown[] = []): Promise<unknown[]> => {
    state.sql.push(sql);
    if (sql.includes('FROM item') && sql.includes("status='ACTIVE'")) return state.catalog;
    if (sql.includes('FROM need_norm WHERE active ORDER BY category')) return state.norms;
    if (sql.includes('FROM need_norm WHERE active')) return state.norms;
    if (sql.includes('need_extraction_daily_usage')) return state.quotaAllowed ? [{ calls: 1 }] : [];
    if (sql.includes('FROM need_extraction_log l')) {
      const requestIds = values[0] as string[];
      const workCycles = values[1] as number[];
      return state.logged.filter((row) => requestIds.some((id, index) => id === row.request_id && workCycles[index] === row.work_cycle))
        .map((row) => ({ request_id: row.request_id, work_cycle: row.work_cycle }));
    }
    if (sql.includes('INSERT INTO need_extraction_log')) {
      state.logged.push({
        request_id: values[0] as string, work_cycle: values[1] as number, status: values[2] as string,
        source: values[3] as string | null, error_code: values[5] as string | null,
      });
      return [];
    }
    if (sql.startsWith('SELECT 1 FROM relief_need')) {
      const key = `${values[0]}:${values[1]}`;
      if (state.failOn.has(String(values[0]))) throw new Error('database unavailable');
      return state.cycleNeeds.has(key) ? [{ 1: 1 }] : [];
    }
    if (sql.includes('INSERT INTO fulfillment_cycle')) return [];
    if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) {
      return [{ id: `cycle-${values[0]}-${values[1]}`, request_id: values[0], work_cycle: values[1], campaign_id: null, state: 'OPEN' }];
    }
    if (sql.includes('n.source IN')) return [];
    if (sql.includes('WHERE i.id=ANY')) {
      const ids = values[0] as string[];
      return ids.map((id) => ({ id, item_type_code: id === waterId ? 'NUOC_UONG' : 'LUONG_THUC', status: 'ACTIVE', scale: 3 }));
    }
    if (sql.includes('INSERT INTO relief_need')) {
      const id = `need-${state.inserts.length + 1}`;
      state.inserts.push({ cycleRequest: String(values[0]), basis: JSON.parse(String(values[3])) as Record<string, unknown> });
      return [{ id }];
    }
    if (sql.includes('INSERT INTO audit_log')) {
      state.audits.push({ actor: values[0] as string | null, action: String(values[1]) });
      return [];
    }
    if (sql.includes('FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id') && sql.includes('WHERE n.id=$1')) {
      const need = state.inserts.find((entry, index) => `need-${index + 1}` === values[0]);
      const basis = need?.basis ?? {};
      return [{
        id: values[0], cycle_id: 'cycle', request_id: need?.cycleRequest ?? '', work_cycle: 1, campaign_id: null,
        item_id: basis.item_id, item_name: 'Item', unit_code: 'L', unit_name: 'Lít', unit_scale: 3,
        original_quantity: '1.000', requested_quantity: '1.000', cancelled_remaining: null, designated_point_id: null,
        status: 'OPEN', source: 'ESTIMATED', estimate_basis: basis, version: 1, created_at: '2026-11-18T10:00:00.000Z',
        reference_estimate_quantity: null,
      }];
    }
    throw new Error(`Unexpected SQL in fake database: ${sql.slice(0, 120)}`);
  });
  const manager = { query };
  const dataSource = {
    query,
    transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) => work(manager)),
  };
  return { dataSource: dataSource as unknown as DataSource, query, state };
}

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    catalog: [
      { id: waterId, name: 'Nước uống', item_type_code: 'NUOC_UONG', aliases: ['nước uống'] },
      { id: riceId, name: 'Gạo', item_type_code: 'LUONG_THUC', aliases: ['gạo'] },
    ],
    norms: [
      {
        id: 'norm-water', category: 'WATER', item_type_code: 'NUOC_UONG', quantity_basis: 'BY_GROUP',
        qty_adult: '3.000', qty_child: '1.000', qty_elderly: '2.000', people_per_unit: null, fixed_quantity: null,
        default_item_id: waterId, in_default_bundle: true, active: true, version: 1,
      },
      {
        id: 'norm-food', category: 'FOOD', item_type_code: 'LUONG_THUC', quantity_basis: 'BY_GROUP',
        qty_adult: '2.000', qty_child: '1.000', qty_elderly: '1.000', people_per_unit: null, fixed_quantity: null,
        default_item_id: riceId, in_default_bundle: true, active: true, version: 1,
      },
    ],
    quotaAllowed: true,
    logged: [],
    cycleNeeds: new Set(),
    inserts: [],
    audits: [],
    sql: [],
    failOn: new Set(),
    ...overrides,
  };
}

function candidatesClient(pages: SupplyCandidatePage[]) {
  let call = 0;
  return {
    list: jest.fn(async (_cursor: string | null, _limit: number): Promise<SupplyCandidatePage> => {
      const page = pages[call] ?? { items: [], more: false, cursor: null };
      call++;
      return page;
    }),
    admit: jest.fn(),
  };
}

function pageOf(items: SupplyCandidate[]): SupplyCandidatePage {
  return { items, more: false, cursor: null };
}

describe('NeedExtractionSweepService', () => {
  it('creates ESTIMATED lines for an unprocessed candidate through the shared estimate core', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const client = candidatesClient([pageOf([candidate(1)])]);
    const sweep = new NeedExtractionSweepService(dataSource, client as never);

    const summary = await sweep.runOnce({});

    expect(summary).toMatchObject({ attempted: 1, created: 1, failed: 0, errors: 0 });
    expect(state.logged).toEqual([expect.objectContaining({ status: 'CREATED', source: 'ALIAS', error_code: null })]);
    expect(state.inserts.length).toBeGreaterThan(0);
    expect(state.inserts[0]!.basis).toMatchObject({
      extraction: { source: 'ALIAS', reason_codes: ['ALIAS_MATCHED'], unmatched_terms: [] },
    });
  });

  it('is a SYSTEM actor: no permission check, audit rows with a null actor, and no admission or attribution write', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const client = candidatesClient([pageOf([candidate(1)])]);
    await new NeedExtractionSweepService(dataSource, client as never).runOnce({});

    expect(client.admit).not.toHaveBeenCalled();
    expect(state.audits.length).toBeGreaterThan(0);
    expect(state.audits.every((audit) => audit.actor === null && audit.action === 'NEED_ESTIMATED')).toBe(true);
    for (const sql of state.sql) {
      expect(sql).not.toMatch(/attribution_locked_at|logistics_admitted_at|assistance_request/u);
      expect(sql).not.toMatch(/^\s*UPDATE\s+(?!need_extraction)/iu);
    }
  });

  it('caps the run at 20 attempts and leaves the rest for the next run', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const items = Array.from({ length: 25 }, (_, index) => candidate(index + 1));
    const sweep = new NeedExtractionSweepService(dataSource, candidatesClient([pageOf(items)]) as never);

    const summary = await sweep.runOnce({});

    expect(NEED_EXTRACTION_MAX_PER_RUN).toBe(20);
    expect(summary.attempted).toBe(20);
    expect(summary.created).toBe(20);
    expect(state.logged).toHaveLength(20);
  });

  it('never reprocesses a request already in the processed log', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const items = [candidate(1), candidate(2)];
    const sweep = new NeedExtractionSweepService(dataSource, candidatesClient([pageOf(items)]) as never);
    await sweep.runOnce({});
    const insertsAfterFirstRun = state.inserts.length;

    const second = await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf(items)]) as never).runOnce({});

    expect(second.attempted).toBe(0);
    expect(state.inserts.length).toBe(insertsAfterFirstRun);
  });

  it('records a request that yields no line and does not retry it on later runs', async () => {
    const state = freshState({ norms: [] });
    const { dataSource } = fakeDatabase(state);
    const items = [candidate(1)];
    const first = await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf(items)]) as never).runOnce({});
    expect(first).toMatchObject({ attempted: 1, noLines: 1 });
    expect(state.logged).toEqual([expect.objectContaining({ status: 'NO_LINES' })]);

    const second = await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf(items)]) as never).runOnce({});
    expect(second.attempted).toBe(0);
  });

  it('isolates a failing candidate: the others in the run are still processed', async () => {
    const state = freshState({ failOn: new Set([uuidFor(1)]) });
    const { dataSource } = fakeDatabase(state);
    const items = [candidate(1), candidate(2), candidate(3)];
    const summary = await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf(items)]) as never).runOnce({});

    expect(summary).toMatchObject({ attempted: 3, created: 2, errors: 1 });
    expect(state.logged.map((row) => row.request_id).sort()).toEqual([uuidFor(2), uuidFor(3)]);
  });

  it('records a candidate without a people count as SKIPPED with a stable code', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const summary = await new NeedExtractionSweepService(dataSource, candidatesClient([
      pageOf([candidate(1, { people_affected: null })]),
    ]) as never).runOnce({});
    expect(summary.skipped).toBe(1);
    expect(state.logged).toEqual([expect.objectContaining({ status: 'SKIPPED', error_code: 'NEED_PEOPLE_MISSING' })]);
  });

  it('skips a request whose cycle already has a need line and records that decision', async () => {
    const state = freshState({ cycleNeeds: new Set([`${uuidFor(1)}:1`]) });
    const { dataSource } = fakeDatabase(state);
    const summary = await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf([candidate(1)])]) as never).runOnce({});
    expect(summary.skipped).toBe(1);
    expect(state.inserts).toHaveLength(0);
    expect(state.logged).toEqual([expect.objectContaining({ status: 'SKIPPED', error_code: 'NEED_LINE_EXISTS' })]);
  });

  it('stops quietly when the Response scan is unavailable', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const client = { list: jest.fn(async () => { throw new Error('RESPONSE_UNAVAILABLE'); }), admit: jest.fn() };
    const summary = await new NeedExtractionSweepService(dataSource, client as never).runOnce({});
    expect(summary).toMatchObject({ attempted: 0, created: 0 });
  });

  it('uses Gemini through the enum-constrained call when a key is configured, and records source GEMINI with the model', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ item_ids: [riceId, 'hacked'], unmatched_terms: [] }) }] } }] }),
    } as unknown as Response);
    const sweep = new NeedExtractionSweepService(dataSource, candidatesClient([pageOf([candidate(1, { relief_items_text: 'cần gạo' })])]) as never);

    const summary = await sweep.runOnce({ GEMINI_API_KEYS: '["test-key"]', GEMINI_MODEL: 'test-model', GEMINI_DAILY_CALL_LIMIT: '10' });

    expect(summary.created).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body)) as {
      generationConfig: { responseSchema: { properties: { item_ids: { items: { enum: string[] } } } } };
    };
    expect(body.generationConfig.responseSchema.properties.item_ids.items.enum).toEqual([waterId, riceId]);
    expect(state.inserts[0]!.basis).toMatchObject({ extraction: { source: 'GEMINI', model: 'test-model' } });
  });

  it('does not call Gemini when the daily quota is exhausted, and uses the alias fallback', async () => {
    const state = freshState({ quotaAllowed: false });
    const { dataSource } = fakeDatabase(state);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const summary = await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf([candidate(1)])]) as never).runOnce({
      GEMINI_API_KEYS: '["test-key"]', GEMINI_DAILY_CALL_LIMIT: '1',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(summary.created).toBe(1);
    expect(state.inserts[0]!.basis).toMatchObject({ extraction: { source: 'ALIAS' } });
  });

  it('uses the default bundle with no Gemini key and an empty text', async () => {
    const state = freshState();
    const { dataSource } = fakeDatabase(state);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await new NeedExtractionSweepService(dataSource, candidatesClient([pageOf([candidate(1, { relief_items_text: null })])]) as never).runOnce({
      GEMINI_API_KEYS: '["test-key"]',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.inserts[0]!.basis).toMatchObject({ extraction: { source: 'DEFAULT_BUNDLE', reason_codes: ['DEFAULT_BUNDLE_USED'] } });
  });

  it('reads the daily call limit with the existing semantics (unset or 0 means no cap)', () => {
    expect(needExtractionCallLimit({})).toBe(0);
    expect(needExtractionCallLimit({ GEMINI_DAILY_CALL_LIMIT: '0' })).toBe(0);
    expect(needExtractionCallLimit({ GEMINI_DAILY_CALL_LIMIT: '25' })).toBe(25);
    expect(needExtractionCallLimit({ GEMINI_DAILY_CALL_LIMIT: '-3' })).toBe(0);
  });
});

describe('NeedExtractionScheduler and the job flag', () => {
  it('runs by default and disables only on the exact value false', () => {
    expect(loadNeedExtractionJobConfig({})).toEqual({ enabled: true, intervalMs: NEED_EXTRACTION_JOB_INTERVAL_MS });
    expect(loadNeedExtractionJobConfig({ C48_NEED_EXTRACTION_JOB_ENABLED: 'true' }).enabled).toBe(true);
    expect(loadNeedExtractionJobConfig({ C48_NEED_EXTRACTION_JOB_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('fails startup on any other value', () => {
    expect(() => loadNeedExtractionJobConfig({ C48_NEED_EXTRACTION_JOB_ENABLED: 'no' })).toThrow('C48_NEED_EXTRACTION_JOB_ENABLED');
    expect(() => loadNeedExtractionJobConfig({ C48_NEED_EXTRACTION_JOB_ENABLED: '' })).toThrow('C48_NEED_EXTRACTION_JOB_ENABLED');
    expect(() => loadNeedExtractionJobConfig({ C48_NEED_EXTRACTION_JOB_ENABLED: 'TRUE' })).toThrow('C48_NEED_EXTRACTION_JOB_ENABLED');
  });

  it('schedules nothing when the job is disabled by environment', () => {
    const schedule = jest.spyOn(JobRunner.prototype, 'schedule');
    const scheduler = new NeedExtractionScheduler(
      { enabled: false, intervalMs: NEED_EXTRACTION_JOB_INTERVAL_MS }, { runOnce: jest.fn() } as never, {} as never,
    );
    scheduler.onModuleInit();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('schedules the sweep under its own job name when enabled', () => {
    const schedule = jest.spyOn(JobRunner.prototype, 'schedule').mockReturnValue(() => undefined);
    const scheduler = new NeedExtractionScheduler(
      { enabled: true, intervalMs: NEED_EXTRACTION_JOB_INTERVAL_MS }, { runOnce: jest.fn() } as never, {} as never,
    );
    scheduler.onModuleInit();
    expect(schedule).toHaveBeenCalledWith(NEED_EXTRACTION_JOB_NAME, 5 * 60_000, expect.any(Function), true);
    expect(NEED_EXTRACTION_JOB_NAME).toBe('logistics.need-extraction-sweep');
    scheduler.onModuleDestroy();
  });

  it('does not run the sweep when another replica holds the advisory lock', async () => {
    const query = jest.fn(async (sql: string) => (sql.includes('pg_try_advisory_xact_lock') ? [{ locked: false }] : []));
    const dataSource = { transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) => work({ query })) };
    const work = jest.fn(async () => undefined);
    const ran = await new JobRunner(dataSource as unknown as DataSource).runOnce(NEED_EXTRACTION_JOB_NAME, work);
    expect(ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_try_advisory_xact_lock'), [NEED_EXTRACTION_JOB_NAME]);
  });
});
