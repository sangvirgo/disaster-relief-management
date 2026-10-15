import { rankTeamCandidates } from '../src/operations/request-operations.team-candidates.helpers';

function candidate(id: string, distance_m: number, recent_missions_24h: number) {
  return { id, distance_m, recent_missions_24h };
}

describe('rankTeamCandidates', () => {
  it.each(['P3', 'P4'])('%s balances workload within the 2 km band', () => {
    const result = rankTeamCandidates([
      candidate('near', 1_000, 5),
      candidate('lighter', 1_500, 1),
    ], 2_000);

    expect(result.map(({ id, suggested, in_band }) => ({ id, suggested, in_band }))).toEqual([
      { id: 'lighter', suggested: true, in_band: true },
      { id: 'near', suggested: false, in_band: true },
    ]);
  });

  it('keeps a P1 suggestion at the nearest team despite a heavier workload', () => {
    const result = rankTeamCandidates([
      candidate('near', 1_000, 5),
      candidate('lighter', 1_001, 0),
    ], 0);

    expect(result.find(({ suggested }) => suggested)?.id).toBe('near');
    expect(result.find(({ id }) => id === 'lighter')?.in_band).toBe(false);
  });

  it('ranks by raw distance when both displayed distances round to the same tenth', () => {
    const nearestDistance = 100.03;
    const fartherDistance = 100.04;
    expect(Math.round(nearestDistance * 10) / 10).toBe(Math.round(fartherDistance * 10) / 10);

    const result = rankTeamCandidates([
      candidate('farther', fartherDistance, 0),
      candidate('nearest', nearestDistance, 5),
    ], 0);

    expect(result.map(({ id, in_band, suggested }) => ({ id, in_band, suggested }))).toEqual([
      { id: 'nearest', in_band: true, suggested: true },
      { id: 'farther', in_band: false, suggested: false },
    ]);
  });

  it('uses the inclusive 500 m P2 band and keeps farther radius rows outside it', () => {
    const result = rankTeamCandidates([
      candidate('nearest', 1_000, 3),
      candidate('edge', 1_500, 1),
      candidate('farther', 9_000, 0),
    ], 500);

    expect(result.map(({ id, in_band, suggested }) => ({ id, in_band, suggested }))).toEqual([
      { id: 'edge', in_band: true, suggested: true },
      { id: 'nearest', in_band: true, suggested: false },
      { id: 'farther', in_band: false, suggested: false },
    ]);
  });

  it('breaks workload and distance ties by team id, including outside the band', () => {
    const result = rankTeamCandidates([
      candidate('b', 1_000, 1),
      candidate('a', 1_000, 1),
      candidate('outside-b', 5_000, 0),
      candidate('outside-a', 5_000, 3),
    ], 0);

    expect(result.map(({ id }) => id)).toEqual(['a', 'b', 'outside-a', 'outside-b']);
    expect(result.filter(({ suggested }) => suggested)).toHaveLength(1);
  });

  it('suggests nobody when there are no fresh in-radius candidates', () => {
    expect(rankTeamCandidates([], 2_000)).toEqual([]);
  });
});
