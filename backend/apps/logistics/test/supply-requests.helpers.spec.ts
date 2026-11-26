import { describe, expect, it } from '@jest/globals';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { ResponseMission } from '../src/integrations/response/response-mission.client';
import {
  chooseWarehouse, coverage, needStatus, newPickupCode, requireHandover, supplyActor, SupplyLineRow, SupplyRequestRow, teamView,
  WarehouseCandidate, warehouseQueueView,
} from '../src/supply-requests/supply-requests.helpers';

const LEADER = '10000000-0000-4000-8000-000000000001';
const MEMBER = '10000000-0000-4000-8000-000000000002';
const OTHER = '10000000-0000-4000-8000-000000000003';
const CAMPAIGN = '10000000-0000-4000-8000-000000000004';

const mission: ResponseMission = {
  id: '10000000-0000-4000-8000-000000000010',
  status: 'EN_ROUTE',
  request_id: '10000000-0000-4000-8000-000000000011',
  campaign_id: CAMPAIGN,
  team_id: '10000000-0000-4000-8000-000000000012',
  team_name: 'Đội Phú Lộc',
  work_cycle: 1,
  member_user_ids: [LEADER, MEMBER],
  leader_user_ids: [LEADER],
};

const volunteer: Grant = { role_code: 'VOLUNTEER', scope_type: 'SYSTEM' };

function candidate(id: string, tier: 0 | 1 | 2, free: Record<string, bigint>, name = id): WarehouseCandidate {
  return { id, name, tier, free: new Map(Object.entries(free)) };
}

const row: SupplyRequestRow = {
  id: '10000000-0000-4000-8000-000000000020',
  mission_id: mission.id,
  request_id: mission.request_id,
  work_cycle: 1,
  campaign_id: CAMPAIGN,
  team_id: mission.team_id,
  team_name: mission.team_name,
  warehouse_id: '10000000-0000-4000-8000-000000000021',
  warehouse_name: 'Kho Huế',
  warehouse_address: '12 Lê Lợi',
  warehouse_lat: 16.46,
  warehouse_lng: 107.59,
  status: 'READY',
  pickup_code: '042137',
  requested_by: LEADER,
  on_behalf: false,
  expires_at: '2026-11-26T12:00:00.000Z',
  handed_over_by: null,
  handed_over_at: null,
  cancelled_by: null,
  cancelled_at: null,
  cancel_reason: null,
  version: 1,
  created_at: '2026-11-26T06:00:00.000Z',
  updated_at: '2026-11-26T06:00:00.000Z',
};

const lines: SupplyLineRow[] = [
  {
    supply_request_id: row.id, item_id: 'rice', item_name: 'Gạo', unit_code: 'KG', unit_name: 'Ki-lô-gam', unit_scale: 3,
    relief_need_id: 'need-1', commitment_id: 'commitment-1', requested_quantity: '20.000', reserved_quantity: '12.500',
  },
  {
    supply_request_id: row.id, item_id: 'water', item_name: 'Nước', unit_code: 'BOTTLE', unit_name: 'Chai', unit_scale: 0,
    relief_need_id: 'need-2', commitment_id: null, requested_quantity: '40', reserved_quantity: '0',
  },
];

describe('supply request warehouse choice', () => {
  const wanted = [{ item_id: 'rice', units: 20_000n }, { item_id: 'water', units: 40n }];

  it('weighs each line equally when measuring coverage', () => {
    expect(coverage(candidate('a', 0, { rice: 20_000n, water: 0n }), wanted)).toBe(500_000);
    expect(coverage(candidate('b', 0, { rice: 10_000n, water: 40n }), wanted)).toBe(750_000);
  });

  it('prefers the best-covering campaign warehouse and PRIMARY over BACKUP on a tie', () => {
    const primary = candidate('primary', 0, { rice: 20_000n });
    const backup = candidate('backup', 1, { rice: 20_000n });
    const better = candidate('better', 1, { rice: 20_000n, water: 40n });
    expect(chooseWarehouse([backup, primary], wanted)?.id).toBe('primary');
    expect(chooseWarehouse([primary, better], wanted)?.id).toBe('better');
  });

  it('falls back to another active warehouse only when no campaign warehouse holds any goods', () => {
    const outside = candidate('outside', 2, { rice: 20_000n, water: 40n });
    const campaign = candidate('campaign', 0, { water: 1n });
    expect(chooseWarehouse([outside, campaign], wanted)?.id).toBe('campaign');
    expect(chooseWarehouse([outside, candidate('empty', 0, {})], wanted)?.id).toBe('outside');
    expect(chooseWarehouse([candidate('empty', 0, {})], wanted)).toBeNull();
  });
});

describe('supply request access', () => {
  it('lets the team leader act for the team, not a plain member or another volunteer', () => {
    expect(supplyActor([volunteer], LEADER, mission)).toEqual({ onBehalf: false });
    expect(() => supplyActor([volunteer], MEMBER, mission)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => supplyActor([volunteer], OTHER, mission)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('lets a coordinator of the campaign act on behalf of the team', () => {
    expect(supplyActor([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], OTHER, mission)).toEqual({ onBehalf: true });
    expect(supplyActor([{ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: CAMPAIGN }], OTHER, mission)).toEqual({ onBehalf: true });
    expect(() => supplyActor([{ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: 'other' }], OTHER, mission))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => supplyActor([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], OTHER, mission))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('keeps the hand-over with operations managers in scope', () => {
    expect(() => requireHandover([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], CAMPAIGN)).not.toThrow();
    expect(() => requireHandover([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], CAMPAIGN)).toThrow();
    expect(() => requireHandover([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: 'other' }], CAMPAIGN)).toThrow();
  });
});

describe('supply request views', () => {
  it('shows the team its pickup code, warehouse and shortfall', () => {
    const view = teamView(row, lines);
    expect(view).toMatchObject({
      pickup_code: '042137',
      mission_id: mission.id,
      has_shortfall: true,
      warehouse: { name: 'Kho Huế', address_note: '12 Lê Lợi', location: { lat: 16.46, lng: 107.59 } },
    });
    expect(view.lines).toEqual([
      expect.objectContaining({ item_name: 'Gạo', requested_quantity: '20.000', reserved_quantity: '12.500', shortfall_quantity: '7.500' }),
      expect.objectContaining({ item_name: 'Nước', requested_quantity: '40', reserved_quantity: '0', shortfall_quantity: '40' }),
    ]);
    expect(teamView({ ...row, status: 'HANDED_OVER' }, lines).pickup_code).toBeNull();
  });

  it('shows the warehouse the team name and reserved goods only, never the SOS, mission or code', () => {
    const view = warehouseQueueView(row, lines);
    expect(view).toEqual({
      id: row.id,
      team_name: 'Đội Phú Lộc',
      status: 'READY',
      warehouse: { id: row.warehouse_id, name: 'Kho Huế' },
      expires_at: '2026-11-26T12:00:00.000Z',
      handed_over_at: null,
      cancelled_at: null,
      version: 1,
      created_at: '2026-11-26T06:00:00.000Z',
      lines: [{ item_id: 'rice', item_name: 'Gạo', unit_code: 'KG', unit_name: 'Ki-lô-gam', quantity: '12.500' }],
    });
    const serialized = JSON.stringify(view);
    for (const hidden of [row.pickup_code, row.mission_id, row.request_id, '12 Lê Lợi']) expect(serialized).not.toContain(hidden);
  });
});

describe('supply request small rules', () => {
  it('derives the need status from delivered and requested quantities', () => {
    expect(needStatus(0n, 5n)).toBe('OPEN');
    expect(needStatus(2n, 5n)).toBe('PARTIALLY_FULFILLED');
    expect(needStatus(5n, 5n)).toBe('FULFILLED');
  });

  it('issues six-digit pickup codes', () => {
    for (let index = 0; index < 50; index += 1) expect(newPickupCode()).toMatch(/^[0-9]{6}$/u);
  });
});
