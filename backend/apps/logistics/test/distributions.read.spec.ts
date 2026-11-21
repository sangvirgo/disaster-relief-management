import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { readDistributionLines } from '../src/distributions/distributions.read';
import { readDistributionHandoffLines } from '../src/distributions/handoff-settlement.helpers';

const distributionId = '11111111-1111-4111-8111-111111111111';
const lineId = '22222222-2222-4222-8222-222222222222';

describe('distribution line queries', () => {
  it('reads distribution line custody without any relief point columns', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await readDistributionLines({ query } as unknown as DataSource, [distributionId]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('dl.in_transit_quantity');
    expect(sql).not.toMatch(/designated_point_id|at_point_quantity|POINT_RECEIPT/u);
  });

  it('reads handoff line context without relief point columns', async () => {
    const query = jest.fn().mockResolvedValue([{ id: lineId }]);

    await readDistributionHandoffLines({ query } as never, distributionId, [lineId]);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('dl.in_transit_quantity');
    expect(sql).not.toMatch(/designated_point_id|at_point_quantity/u);
  });
});
