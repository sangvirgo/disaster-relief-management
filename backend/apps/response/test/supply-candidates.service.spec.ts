import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { SupplyCandidatesService, SUPPLY_CANDIDATE_STATUSES } from '../src/supply-candidates/supply-candidates.service';

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const idC = '33333333-3333-4333-8333-333333333333';
const campaignId = '44444444-4444-4444-8444-444444444444';

function setup(rows: Record<string, unknown>[]) {
  const query = jest.fn(async (_sql: string, _values: unknown[]) => rows);
  const service = new SupplyCandidatesService({ query } as unknown as DataSource);
  return { query, service };
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    request_id: id,
    work_cycle: '2',
    campaign_id: campaignId,
    status: 'VERIFIED',
    people_affected: 7,
    children_count: 2,
    elderly_count: 1,
    relief_items_text: 'nước uống, mì tôm',
    verified_at: new Date('2026-11-18T10:00:00.000Z'),
    ...overrides,
  };
}

describe('SupplyCandidatesService', () => {
  it('selects only relief-supply requests in a verified-or-later non-terminal status', async () => {
    const { query, service } = setup([]);
    await service.list(undefined, undefined);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('r.needs_relief_supplies=true');
    expect(sql).toContain('r.status=ANY($1::text[])');
    expect(values?.[0]).toEqual([...SUPPLY_CANDIDATE_STATUSES]);
    expect([...SUPPLY_CANDIDATE_STATUSES].sort()).toEqual(['DISPATCHED', 'IN_PROGRESS', 'TRIAGED', 'VERIFIED']);
    for (const excluded of ['SUBMITTED', 'VERIFYING', 'RESOLVING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE']) {
      expect(SUPPLY_CANDIDATE_STATUSES).not.toContain(excluded);
    }
  });

  it('excludes requests with a supplement still waiting for review', async () => {
    const { query, service } = setup([]);
    await service.list(undefined, undefined);
    expect(query.mock.calls[0]![0]).toContain("supplement.payload->>'pending_review'='true'");
  });

  it('projects only the allow-listed fields and never reads the description or contacts', async () => {
    const { query, service } = setup([row(idA)]);
    const result = await service.list(undefined, undefined);
    const sql = query.mock.calls[0]![0];
    expect(sql).not.toMatch(/description|reporter_|location|tracking/u);
    expect(result).toEqual({
      items: [{
        request_id: idA,
        work_cycle: 2,
        campaign_id: campaignId,
        status: 'VERIFIED',
        people_affected: 7,
        children_count: 2,
        elderly_count: 1,
        relief_items_text: 'nước uống, mì tôm',
        verified_at: '2026-11-18T10:00:00.000Z',
      }],
      more: false,
    });
  });

  it('issues read-only SQL only: no admission, lock, version or audit write', async () => {
    const { query, service } = setup([row(idA)]);
    await service.list(undefined, undefined);
    for (const [sql] of query.mock.calls) {
      expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/u);
      expect(sql).not.toMatch(/attribution_locked_at|logistics_admitted_at|audit_log/u);
    }
  });

  it('pages by request id with a keyset cursor and reports more only when a row follows', async () => {
    const { query, service } = setup([row(idA), row(idB), row(idC)]);
    const result = await service.list(undefined, 2);
    expect(query.mock.calls[0]![1]).toEqual([[...SUPPLY_CANDIDATE_STATUSES], 3]);
    expect(result.more).toBe(true);
    expect((result.items as unknown[]).length).toBe(2);
    expect(typeof result.cursor).toBe('string');

    const second = setup([row(idC)]);
    await second.service.list(result.cursor as string, 2);
    const [sql, values] = second.query.mock.calls[0]!;
    expect(sql).toContain('r.id>$2::uuid');
    expect(values).toEqual([[...SUPPLY_CANDIDATE_STATUSES], idB, 3]);
  });

  it('rejects a cursor that belongs to another route or is malformed', async () => {
    const { service } = setup([]);
    const foreign = encodeKeysetCursor([idA], idA, { route: 'logistics.other' });
    await expect(service.list(foreign, undefined)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    await expect(service.list('not-a-cursor', undefined)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });

  it('returns null for missing optional values instead of inventing them', async () => {
    const { service } = setup([row(idA, { campaign_id: null, relief_items_text: null, verified_at: null, people_affected: null })]);
    const result = await service.list(undefined, undefined);
    expect(result.items).toEqual([expect.objectContaining({ campaign_id: null, relief_items_text: null, verified_at: null, people_affected: null })]);
  });
});
