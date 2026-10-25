type RankableTeamCandidate = { id: string; distance_m: number; recent_missions_24h: number; recent_missions_7d?: number };

export function rankTeamCandidates<T extends RankableTeamCandidate>(candidates: T[], toleranceM: number): Array<T & { in_band: boolean; suggested: boolean }> {
  if (!candidates.length) return [];
  const nearest = Math.min(...candidates.map(({ distance_m }) => distance_m));
  const compareId = (a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  // Distance defines a safety band; inside it, recent workload wins before distance.
  const recentLoad = (candidate: T) => candidate.recent_missions_24h * 4 + (candidate.recent_missions_7d ?? 0);
  const band = candidates.filter(({ distance_m }) => distance_m <= nearest + toleranceM)
    .sort((a, b) => recentLoad(a) - recentLoad(b) || a.distance_m - b.distance_m || compareId(a, b));
  const outside = candidates.filter(({ distance_m }) => distance_m > nearest + toleranceM)
    .sort((a, b) => a.distance_m - b.distance_m || compareId(a, b));
  return [...band.map((candidate, index) => ({ ...candidate, in_band: true, suggested: index === 0 })),
    ...outside.map((candidate) => ({ ...candidate, in_band: false, suggested: false }))];
}
