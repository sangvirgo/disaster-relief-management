import { jest } from '@jest/globals';
import { ScopeFailureReviewsToMissionVersion1795900000000 } from '../src/database/migrations/ScopeFailureReviewsToMissionVersion1795900000000';

describe('failure review migration rollback safety', () => {
  it('refuses rollback before dropping the index when revisioned history would violate old uniqueness', async () => {
    const query = jest.fn(async () => [{ present: true }]);
    await expect(new ScopeFailureReviewsToMissionVersion1795900000000().down({ query } as never)).rejects.toThrow('Cannot restore mission-only uniqueness');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
