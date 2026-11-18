import { describe, expect, it } from '@jest/globals';
import {
  CandidateRow, StoredAssignment, deriveFlags, planAssignment, sameAssignment, serviceAreaChanged, warehouseServiceAreaFromView,
  rankCandidates,
} from '../src/campaign-warehouses/campaign-warehouses.helpers';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function candidate(id: string, overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    warehouse_id: id,
    name: `Kho ${id.slice(0, 4)}`,
    distance_m: 1000,
    open_needed_items: 1,
    needed_items_in_stock: 0,
    open_distributions: 0,
    ...overrides,
  };
}

function stored(id: string, role: 'PRIMARY' | 'BACKUP', source: 'AUTO' | 'MANUAL', distance = 1000): StoredAssignment {
  return { warehouse_id: id, role, source, distance_m: distance, version: 1 };
}

describe('campaign warehouse assignment planning', () => {
  it('gives two overlapping warehouses one PRIMARY and one BACKUP', () => {
    const plan = planAssignment({
      candidates: [candidate(B, { distance_m: 4000 }), candidate(A, { distance_m: 1500 })],
      stored: [], rerank: false, clearManual: false,
    });

    const primaries = plan.rows.filter((row) => row.role === 'PRIMARY');
    expect(primaries).toEqual([{ warehouse_id: A, role: 'PRIMARY', source: 'AUTO', distance_m: 1500 }]);
    expect(plan.rows.filter((row) => row.role === 'BACKUP')).toEqual([
      { warehouse_id: B, role: 'BACKUP', source: 'AUTO', distance_m: 4000 },
    ]);
  });

  it('ranks stock for open needs before lower load and shorter distance', () => {
    const ranked = rankCandidates([
      candidate(A, { distance_m: 500, needed_items_in_stock: 0 }),
      candidate(B, { distance_m: 3000, needed_items_in_stock: 2 }),
    ]);
    expect(ranked.map((row) => row.warehouse_id)).toEqual([B, A]);
  });

  it('ranks lower load before shorter distance when stock is equal', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 500, open_distributions: 3 }), candidate(B, { distance_m: 900, open_distributions: 1 })],
      stored: [], rerank: false, clearManual: false,
    });
    expect(plan.primaryId).toBe(B);
  });

  it('breaks full ties with the smallest warehouse id', () => {
    const plan = planAssignment({
      candidates: [candidate(C, { distance_m: 800 }), candidate(A, { distance_m: 800 })],
      stored: [], rerank: false, clearManual: false,
    });
    expect(plan.primaryId).toBe(A);
    expect(plan.rows.map((row) => row.warehouse_id)).toEqual([A, C]);
  });

  it('keeps a still-eligible AUTO primary when nothing requires a re-rank (sticky)', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 300 }), candidate(B, { distance_m: 2500 })],
      stored: [stored(B, 'PRIMARY', 'AUTO', 2500)], rerank: false, clearManual: false,
    });
    expect(plan.primaryId).toBe(B);
    expect(plan.rows.find((row) => row.warehouse_id === A)?.role).toBe('BACKUP');
  });

  it('re-ranks the AUTO primary when a warehouse or the area changed', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 300 }), candidate(B, { distance_m: 2500 })],
      stored: [stored(B, 'PRIMARY', 'AUTO', 2500)], rerank: true, clearManual: false,
    });
    expect(plan.primaryId).toBe(A);
    expect(plan.primarySource).toBe('AUTO');
  });

  it('falls back when the stored AUTO primary is no longer eligible (deactivated or out of range)', () => {
    const plan = planAssignment({
      candidates: [candidate(B, { distance_m: 2500 })],
      stored: [stored(A, 'PRIMARY', 'AUTO', 300)], rerank: false, clearManual: false,
    });
    expect(plan.primaryId).toBe(B);
    expect(plan.rows).toEqual([{ warehouse_id: B, role: 'PRIMARY', source: 'AUTO', distance_m: 2500 }]);
  });

  it('never replaces a MANUAL primary during re-evaluation', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 4000 }), candidate(B, { distance_m: 100 })],
      stored: [stored(A, 'PRIMARY', 'MANUAL', 4000)], rerank: true, clearManual: false,
    });
    expect(plan.primaryId).toBe(A);
    expect(plan.primarySource).toBe('MANUAL');
    expect(plan.rows.find((row) => row.warehouse_id === A)).toMatchObject({ role: 'PRIMARY', source: 'MANUAL' });
  });

  it('keeps an ineligible MANUAL primary row and flags it instead of replacing it', () => {
    const plan = planAssignment({
      candidates: [candidate(B, { distance_m: 900 })],
      stored: [stored(A, 'PRIMARY', 'MANUAL', 4000)], rerank: true, clearManual: false,
    });
    expect(plan.primaryId).toBe(A);
    expect(plan.rows[0]).toMatchObject({ warehouse_id: A, role: 'PRIMARY', source: 'MANUAL', distance_m: 4000 });
    expect(deriveFlags({
      hasArea: true,
      primary: { warehouse_id: A, source: 'MANUAL' },
      eligibleIds: new Set([B]),
    })).toEqual(['MANUAL_PRIMARY_INELIGIBLE']);
  });

  it('clears a MANUAL primary only when the manager asks for it', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 4000 }), candidate(B, { distance_m: 100 })],
      stored: [stored(A, 'PRIMARY', 'MANUAL', 4000)], rerank: true, clearManual: true,
    });
    expect(plan.primaryId).toBe(B);
    expect(plan.primarySource).toBe('AUTO');
  });

  it('applies a manager override as MANUAL and demotes the rest to BACKUP', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 100 }), candidate(B, { distance_m: 900 })],
      stored: [stored(A, 'PRIMARY', 'AUTO', 100)], rerank: false, clearManual: false, override: B,
    });
    expect(plan.rows).toEqual([
      { warehouse_id: B, role: 'PRIMARY', source: 'MANUAL', distance_m: 900 },
      { warehouse_id: A, role: 'BACKUP', source: 'AUTO', distance_m: 100 },
    ]);
  });

  it('produces no rows and a NO_SERVING_WAREHOUSE flag when no warehouse covers the campaign', () => {
    const plan = planAssignment({ candidates: [], stored: [stored(A, 'PRIMARY', 'AUTO')], rerank: true, clearManual: false });
    expect(plan.primaryId).toBeNull();
    expect(plan.rows).toEqual([]);
    expect(deriveFlags({ hasArea: true, primary: null, eligibleIds: new Set() })).toEqual(['NO_SERVING_WAREHOUSE']);
  });

  it('flags a campaign without an area as CAMPAIGN_AREA_MISSING', () => {
    expect(deriveFlags({ hasArea: false, primary: null, eligibleIds: new Set() })).toEqual([
      'CAMPAIGN_AREA_MISSING', 'NO_SERVING_WAREHOUSE',
    ]);
  });

  it('reports whether stored rows already match the desired rows', () => {
    const plan = planAssignment({
      candidates: [candidate(A, { distance_m: 100 }), candidate(B, { distance_m: 900 })],
      stored: [stored(A, 'PRIMARY', 'AUTO', 100), stored(B, 'BACKUP', 'AUTO', 900)], rerank: false, clearManual: false,
    });
    expect(sameAssignment(plan.rows, [stored(A, 'PRIMARY', 'AUTO', 100), stored(B, 'BACKUP', 'AUTO', 900)])).toBe(true);
    expect(sameAssignment(plan.rows, [stored(A, 'BACKUP', 'AUTO', 100), stored(B, 'PRIMARY', 'AUTO', 900)])).toBe(false);
  });
});

describe('warehouse change detection', () => {
  const base = { warehouse_id: A, status: 'ACTIVE' as const, location: { lat: 10, lng: 106 }, radius_m: 5000 };

  it('ignores changes that do not touch status, location or radius', () => {
    expect(serviceAreaChanged(base, { ...base })).toBe(false);
  });

  it('detects radius, location and status changes', () => {
    expect(serviceAreaChanged(base, { ...base, radius_m: 6000 })).toBe(true);
    expect(serviceAreaChanged(base, { ...base, location: { lat: 10.1, lng: 106 } })).toBe(true);
    expect(serviceAreaChanged(base, { ...base, status: 'INACTIVE' })).toBe(true);
  });

  it('maps the asset view (GeoJSON [lng, lat]) to the service area', () => {
    expect(warehouseServiceAreaFromView({
      id: A, status: 'ACTIVE', location: { type: 'Point', coordinates: [106, 10] }, service_radius_m: 5000,
    })).toEqual(base);
    expect(warehouseServiceAreaFromView({ id: A, status: 'ACTIVE', location: null, service_radius_m: null })).toEqual({
      warehouse_id: A, status: 'ACTIVE', location: null, radius_m: null,
    });
  });
});
