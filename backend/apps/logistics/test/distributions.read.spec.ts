import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { readDistributionLines } from '../src/distributions/distributions.read';
import { readDistributionHandoffLines } from '../src/distributions/handoff-settlement.helpers';

const distributionId = '11111111-1111-4111-8111-111111111111';
const lineId = '22222222-2222-4222-8222-222222222222';

describe('distribution delivery target queries', () => {
  it('derives distribution line targets from designated_point_id', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await readDistributionLines({ query } as unknown as DataSource, [distributionId]);

    expect(query.mock.calls[0]?.[0]).toContain(
      "CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind",
    );
    expect(query.mock.calls[0]?.[0]).not.toContain('n.delivery_target_kind');
  });

  it('derives handoff line targets from designated_point_id', async () => {
    const query = jest.fn().mockResolvedValue([{ id: lineId, delivery_target_kind: 'RELIEF_POINT' }]);

    await readDistributionHandoffLines({ query } as never, distributionId, [lineId]);

    expect(query.mock.calls[0]?.[0]).toContain(
      "CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind",
    );
    expect(query.mock.calls[0]?.[0]).not.toContain('n.delivery_target_kind');
  });
});
