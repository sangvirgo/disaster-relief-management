import { describe, expect, it } from '@jest/globals';
import {
  buildDriveDraft, calculateWarehouseGaps, ItemScale, NeedFact, reopensAfterDismissal, unmetUnits, WarehouseGapInput,
} from '../src/supply-gaps/supply-gap.calculator';
import { supplyGapReasonViews, SUPPLY_GAP_REASON_COPY } from '../src/supply-gaps/supply-gap-reasons';

const W = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const W3 = '33333333-3333-4333-8333-333333333333';
const CAMP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAMP_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WATER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RICE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const water: ItemScale = { item_id: WATER, scale: 0, name: 'Nước uống' };
const rice: ItemScale = { item_id: RICE, scale: 2, name: 'Gạo' };

function need(overrides: Partial<NeedFact> & { campaign_id: string; item_id: string }): NeedFact {
  return { source: 'DECLARED', requested: 0n, committed: 0n, ...overrides };
}

function input(overrides: Partial<WarehouseGapInput> = {}): WarehouseGapInput {
  return {
    warehouse_id: W,
    primary_campaign_ids: [CAMP_A],
    items: [water],
    needs: [],
    stock: [],
    pledges: [],
    backups: [],
    ...overrides,
  };
}

describe('unmetUnits', () => {
  it('subtracts commitments from the requested quantity', () => {
    expect(unmetUnits(100n, 40n)).toBe(60n);
  });

  it('clamps over-commitment to zero instead of going negative', () => {
    expect(unmetUnits(10n, 25n)).toBe(0n);
  });

  it('returns zero when the need is fully committed', () => {
    expect(unmetUnits(10n, 10n)).toBe(0n);
  });
});

describe('calculateWarehouseGaps: demand, supply and severity', () => {
  it('reports a RED gap when demand exceeds on-hand minus reserved stock', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 30n, reserved: 10n }],
    }));
    expect(result.gaps).toHaveLength(1);
    const [gap] = result.gaps;
    expect(gap).toMatchObject({ demand: 100n, available: 20n, pledged: 0n, supply: 20n, gap: 80n, severity: 'RED' });
    expect(gap?.reason_codes).toEqual(['DEMAND_EXCEEDS_SUPPLY']);
  });

  it('reports RED with NO_STOCK_AT_WAREHOUSE when the warehouse has no stock for the item', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 5n })],
    }));
    expect(result.gaps[0]).toMatchObject({ supply: 0n, gap: 5n, severity: 'RED' });
    expect(result.gaps[0]?.reason_codes).toEqual(['DEMAND_EXCEEDS_SUPPLY', 'NO_STOCK_AT_WAREHOUSE']);
  });

  it('does not report a gap when supply covers demand exactly below the warning ratio', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 79n })],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 100n, reserved: 0n }],
    }));
    expect(result.gaps).toEqual([]);
  });

  it('reports YELLOW at exactly 80 percent of supply (ratio >= 0.8) with no backup list', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 80n })],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 100n, reserved: 0n }],
      backups: [{ campaign_id: CAMP_A, warehouse_id: W2 }],
      pledges: [],
    }));
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ gap: -20n, severity: 'YELLOW', backup_warehouse_ids: [] });
    expect(result.gaps[0]?.reason_codes).toEqual(['NEAR_CAPACITY']);
  });

  it('treats demand equal to supply as YELLOW rather than RED (gap must be strictly positive)', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 50n })],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 50n, reserved: 0n }],
    }));
    expect(result.gaps[0]).toMatchObject({ gap: 0n, severity: 'YELLOW' });
  });

  it('never reports a warning when there is no supply and therefore no ratio', () => {
    const result = calculateWarehouseGaps(input({
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 0n, reserved: 0n }],
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 1n })],
    }));
    expect(result.gaps[0]?.severity).toBe('RED');
  });

  it('reports nothing when there is no demand, even with plenty of stock', () => {
    const result = calculateWarehouseGaps(input({
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 500n, reserved: 0n }],
    }));
    expect(result.gaps).toEqual([]);
    expect(result.forecasts).toEqual([]);
  });

  it('ignores needs that are already fully committed', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n, committed: 10n })],
    }));
    expect(result.gaps).toEqual([]);
  });

  it('subtracts commitments so that a committed need adds no demand', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 30n, committed: 12n })],
    }));
    expect(result.gaps[0]?.demand).toBe(18n);
  });
});

describe('calculateWarehouseGaps: estimated lines and confirmed lines', () => {
  it('excludes ESTIMATED demand from the gap and reports it as forecast only', () => {
    const result = calculateWarehouseGaps(input({
      needs: [
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 40n, source: 'ESTIMATED' }),
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n, source: 'DECLARED' }),
      ],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 5n, reserved: 0n }],
    }));
    expect(result.gaps[0]).toMatchObject({ demand: 10n, supply: 5n, gap: 5n, severity: 'RED' });
    expect(result.forecasts).toEqual([{ item_id: WATER, scale: 0, forecast: 40n }]);
  });

  it('reports an estimate-only item as forecast without creating any gap row', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 40n, source: 'ESTIMATED' })],
    }));
    expect(result.gaps).toEqual([]);
    expect(result.forecasts).toEqual([{ item_id: WATER, scale: 0, forecast: 40n }]);
  });

  it('counts CONFIRMED lines as demand', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 7n, source: 'CONFIRMED' })],
    }));
    expect(result.gaps[0]?.demand).toBe(7n);
  });

  it('clamps ESTIMATED over-commitment to zero forecast', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 5n, committed: 9n, source: 'ESTIMATED' })],
    }));
    expect(result.forecasts).toEqual([]);
  });
});

describe('calculateWarehouseGaps: campaign ownership and contention', () => {
  it('ignores demand from campaigns whose PRIMARY is another warehouse', () => {
    const result = calculateWarehouseGaps(input({
      primary_campaign_ids: [CAMP_A],
      needs: [
        need({ campaign_id: CAMP_OTHER, item_id: WATER, requested: 999n }),
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 4n }),
      ],
    }));
    expect(result.gaps[0]).toMatchObject({ demand: 4n, campaign_ids: [CAMP_A] });
  });

  it('merges demand from two campaigns sharing a warehouse into one gap listing both, largest share first', () => {
    const result = calculateWarehouseGaps(input({
      primary_campaign_ids: [CAMP_A, CAMP_B],
      needs: [
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 30n }),
        need({ campaign_id: CAMP_B, item_id: WATER, requested: 50n }),
        need({ campaign_id: CAMP_B, item_id: WATER, requested: 10n }),
      ],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 20n, reserved: 0n }],
    }));
    expect(result.gaps).toHaveLength(1);
    const [gap] = result.gaps;
    expect(gap?.demand).toBe(90n);
    expect(gap?.gap).toBe(70n);
    expect(gap?.campaign_ids).toEqual([CAMP_B, CAMP_A]);
    expect(gap?.campaign_shares).toEqual([{ campaign_id: CAMP_B, unmet: 60n }, { campaign_id: CAMP_A, unmet: 30n }]);
    expect(gap?.reason_codes).toContain('CAMPAIGN_CONTENTION');
  });

  it('breaks equal shares by campaign id so the order is deterministic', () => {
    const result = calculateWarehouseGaps(input({
      primary_campaign_ids: [CAMP_A, CAMP_B],
      needs: [
        need({ campaign_id: CAMP_B, item_id: WATER, requested: 5n }),
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 5n }),
      ],
    }));
    expect(result.gaps[0]?.campaign_ids).toEqual([CAMP_A, CAMP_B]);
  });

  it('does not count a campaign with only fully committed needs in the contention list', () => {
    const result = calculateWarehouseGaps(input({
      primary_campaign_ids: [CAMP_A, CAMP_B],
      needs: [
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 5n }),
        need({ campaign_id: CAMP_B, item_id: WATER, requested: 5n, committed: 5n }),
      ],
    }));
    expect(result.gaps[0]?.campaign_ids).toEqual([CAMP_A]);
    expect(result.gaps[0]?.reason_codes).not.toContain('CAMPAIGN_CONTENTION');
  });
});

describe('calculateWarehouseGaps: drive pledges', () => {
  it('adds the remaining drive target to supply and reports the pledge', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 20n, reserved: 0n }],
      pledges: [{ warehouse_id: W, item_id: WATER, remaining: 30n }],
    }));
    expect(result.gaps[0]).toMatchObject({ available: 20n, pledged: 30n, supply: 50n, gap: 50n, severity: 'RED' });
    expect(result.gaps[0]?.reason_codes).toContain('DRIVE_PLEDGE_APPLIED');
  });

  it('closes the gap entirely when the pledge covers it and raises no warning', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
      pledges: [{ warehouse_id: W, item_id: WATER, remaining: 100n }],
    }));
    expect(result.gaps).toEqual([]);
  });

  it('does not bring back a YELLOW warning after an accepted draft pledges 1.10 x gap', () => {
    // Stock 0, demand 100, accepted draft target ceil(100 x 1.10) = 110: supply 110 >= demand, ratio 0.91.
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
      stock: [],
      pledges: [{ warehouse_id: W, item_id: WATER, remaining: 110n }],
    }));
    expect(result.gaps).toEqual([]);
  });

  it('keeps a RED gap when the pledge is smaller than the demand', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
      stock: [],
      pledges: [{ warehouse_id: W, item_id: WATER, remaining: 50n }],
    }));
    expect(result.gaps[0]).toMatchObject({ supply: 50n, gap: 50n, severity: 'RED' });
  });

  it('still warns YELLOW without any pledge when stock barely covers demand', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 90n })],
      stock: [{ warehouse_id: W, item_id: WATER, on_hand: 100n, reserved: 0n }],
    }));
    expect(result.gaps[0]).toMatchObject({ pledged: 0n, severity: 'YELLOW' });
  });

  it('ignores pledges at other warehouses or for other items', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n })],
      pledges: [
        { warehouse_id: W2, item_id: WATER, remaining: 100n },
        { warehouse_id: W, item_id: RICE, remaining: 100n },
      ],
    }));
    expect(result.gaps[0]).toMatchObject({ pledged: 0n, gap: 10n });
  });

  it('treats a negative remaining pledge as zero', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n })],
      pledges: [{ warehouse_id: W, item_id: WATER, remaining: -5n }],
    }));
    expect(result.gaps[0]?.pledged).toBe(0n);
  });
});

describe('calculateWarehouseGaps: backup warehouses', () => {
  const contested = (stock: WarehouseGapInput['stock'], backups: WarehouseGapInput['backups']) => calculateWarehouseGaps(input({
    primary_campaign_ids: [CAMP_A],
    needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
    stock: [{ warehouse_id: W, item_id: WATER, on_hand: 10n, reserved: 0n }, ...stock],
    backups,
  }));

  it('lists a BACKUP warehouse that can cover the whole gap', () => {
    const result = contested(
      [{ warehouse_id: W2, item_id: WATER, on_hand: 90n, reserved: 0n }],
      [{ campaign_id: CAMP_A, warehouse_id: W2 }],
    );
    expect(result.gaps[0]).toMatchObject({ gap: 90n, backup_warehouse_ids: [W2] });
    expect(result.gaps[0]?.reason_codes).toContain('BACKUP_STOCK_AVAILABLE');
  });

  it('excludes a BACKUP warehouse whose free stock is below the gap', () => {
    const result = contested(
      [{ warehouse_id: W2, item_id: WATER, on_hand: 89n, reserved: 0n }],
      [{ campaign_id: CAMP_A, warehouse_id: W2 }],
    );
    expect(result.gaps[0]?.backup_warehouse_ids).toEqual([]);
  });

  it('uses on_hand minus reserved for backup stock', () => {
    const result = contested(
      [{ warehouse_id: W2, item_id: WATER, on_hand: 200n, reserved: 150n }],
      [{ campaign_id: CAMP_A, warehouse_id: W2 }],
    );
    expect(result.gaps[0]?.backup_warehouse_ids).toEqual([]);
  });

  it('never lists the warehouse itself and deduplicates and sorts backup ids', () => {
    const result = contested(
      [{ warehouse_id: W2, item_id: WATER, on_hand: 500n, reserved: 0n }, { warehouse_id: W3, item_id: WATER, on_hand: 500n, reserved: 0n }],
      [
        { campaign_id: CAMP_A, warehouse_id: W },
        { campaign_id: CAMP_A, warehouse_id: W3 },
        { campaign_id: CAMP_A, warehouse_id: W2 },
        { campaign_id: CAMP_A, warehouse_id: W2 },
      ],
    );
    expect(result.gaps[0]?.backup_warehouse_ids).toEqual([W2, W3].sort());
  });

  it('ignores backups of campaigns that do not contribute to the gap', () => {
    const result = calculateWarehouseGaps(input({
      primary_campaign_ids: [CAMP_A],
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 100n })],
      stock: [{ warehouse_id: W2, item_id: WATER, on_hand: 500n, reserved: 0n }],
      backups: [{ campaign_id: CAMP_OTHER, warehouse_id: W2 }],
    }));
    expect(result.gaps[0]?.backup_warehouse_ids).toEqual([]);
  });
});

describe('calculateWarehouseGaps: units and item scale', () => {
  it('keeps each item in its own unit scale and never mixes them', () => {
    const result = calculateWarehouseGaps(input({
      items: [water, rice],
      needs: [
        need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n }),
        need({ campaign_id: CAMP_A, item_id: RICE, requested: 1250n }),
      ],
      stock: [{ warehouse_id: W, item_id: RICE, on_hand: 1000n, reserved: 0n }],
    }));
    // Gaps are ordered by item id, so WATER (dddd...) precedes RICE (eeee...).
    expect(result.gaps.map((gap) => [gap.item_id, gap.scale, gap.gap])).toEqual([
      [WATER, 0, 10n],
      [RICE, 2, 250n],
    ]);
  });

  it('does not count stock of the same item at another warehouse as local supply', () => {
    const result = calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n })],
      stock: [{ warehouse_id: W2, item_id: WATER, on_hand: 100n, reserved: 0n }],
    }));
    expect(result.gaps[0]).toMatchObject({ available: 0n, gap: 10n });
  });

  it('fails loudly when a need refers to an item that is not in the item list', () => {
    expect(() => calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: RICE, requested: 1n })],
      items: [water],
    }))).toThrow('SUPPLY_GAP_ITEM_UNKNOWN');
  });

  it('rejects an unknown need source instead of guessing its meaning', () => {
    expect(() => calculateWarehouseGaps(input({
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 1n, source: 'GUESSED' as never })],
    }))).toThrow('SUPPLY_GAP_NEED_SOURCE_UNKNOWN');
  });

  it('returns no gaps when no campaign has this warehouse as primary', () => {
    const result = calculateWarehouseGaps(input({
      primary_campaign_ids: [],
      needs: [need({ campaign_id: CAMP_A, item_id: WATER, requested: 10n })],
    }));
    expect(result).toEqual({ gaps: [], forecasts: [] });
  });
});

describe('reopensAfterDismissal', () => {
  it('reopens when nothing was dismissed', () => {
    expect(reopensAfterDismissal({ severity: 'RED', gap: 1n }, null)).toBe(true);
  });

  it('keeps a dismissed RED gap closed until it grows by 25 percent', () => {
    const dismissed = { severity: 'RED' as const, gap: 1000n };
    expect(reopensAfterDismissal({ severity: 'RED', gap: 1249n }, dismissed)).toBe(false);
    expect(reopensAfterDismissal({ severity: 'RED', gap: 1000n }, dismissed)).toBe(false);
  });

  it('reopens a dismissed RED gap once it grew by at least 25 percent', () => {
    expect(reopensAfterDismissal({ severity: 'RED', gap: 1250n }, { severity: 'RED', gap: 1000n })).toBe(true);
    expect(reopensAfterDismissal({ severity: 'RED', gap: 5000n }, { severity: 'RED', gap: 1000n })).toBe(true);
  });

  it('never reopens a dismissed gap as a YELLOW warning', () => {
    expect(reopensAfterDismissal({ severity: 'YELLOW', gap: 0n }, { severity: 'RED', gap: 1n })).toBe(false);
    expect(reopensAfterDismissal({ severity: 'YELLOW', gap: 0n }, { severity: 'YELLOW', gap: 0n })).toBe(false);
  });

  it('reopens a dismissed YELLOW warning when it becomes RED', () => {
    expect(reopensAfterDismissal({ severity: 'RED', gap: 1n }, { severity: 'YELLOW', gap: 0n })).toBe(true);
  });
});

describe('buildDriveDraft', () => {
  const window = { opens_at: new Date('2026-11-18T00:00:00.000Z'), closes_at: new Date('2026-11-25T00:00:00.000Z') };

  it('targets gap times 1.10 rounded up at the item scale (integer item)', () => {
    const draft = buildDriveDraft({ warehouse_id: W, item: water, gap: 10n, campaign_id: CAMP_A, ...window });
    expect(draft.items).toEqual([expect.objectContaining({ item_id: WATER, target_quantity: '11' })]);
    const oneUnit = buildDriveDraft({ warehouse_id: W, item: water, gap: 1n, campaign_id: CAMP_A, ...window });
    expect((oneUnit.items as Array<{ target_quantity: string }>)[0]?.target_quantity).toBe('2');
  });

  it('keeps two decimals for a scale-2 item and rounds the margin up', () => {
    const draft = buildDriveDraft({ warehouse_id: W, item: rice, gap: 1n, campaign_id: CAMP_A, ...window });
    expect((draft.items as Array<{ target_quantity: string }>)[0]?.target_quantity).toBe('0.02');
    const exact = buildDriveDraft({ warehouse_id: W, item: rice, gap: 100n, campaign_id: CAMP_A, ...window });
    expect((exact.items as Array<{ target_quantity: string }>)[0]?.target_quantity).toBe('1.10');
  });

  it('carries the warehouse, campaign, window and an NFC Vietnamese title capped at 200 characters', () => {
    const longName = 'Ă'.repeat(300);
    const draft = buildDriveDraft({
      warehouse_id: W, item: { ...water, name: `  ${longName}  ` }, gap: 5n, campaign_id: CAMP_A, ...window,
    });
    expect(draft).toMatchObject({
      intake_warehouse_id: W,
      campaign_id: CAMP_A,
      opens_at: '2026-11-18T00:00:00.000Z',
      closes_at: '2026-11-25T00:00:00.000Z',
    });
    expect(String(draft.title).startsWith('Quyên góp bổ sung ')).toBe(true);
    expect(Array.from(String(draft.title))).toHaveLength(200);
    expect(String(draft.title).normalize('NFC')).toBe(draft.title);
  });
});

describe('supply gap reason copy', () => {
  it('maps every stable reason code to non-empty Vietnamese text', () => {
    for (const message of Object.values(SUPPLY_GAP_REASON_COPY)) {
      expect(message.trim().length).toBeGreaterThan(10);
      expect(/[À-ỹ]/u.test(message)).toBe(true);
    }
  });

  it('drops unknown codes instead of leaking them to clients', () => {
    expect(supplyGapReasonViews(['NEAR_CAPACITY', 'UNKNOWN_CODE'])).toEqual([
      { code: 'NEAR_CAPACITY', message: SUPPLY_GAP_REASON_COPY.NEAR_CAPACITY },
    ]);
  });
});
