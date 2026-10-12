import { missionProgressStatus, missionTransitionAllowed } from '../src/missions/missions.helpers';

describe('mission state rules', () => {
  it('allows only documented mission transitions', () => {
    expect(missionTransitionAllowed('OFFERED', 'ACCEPTED')).toBe(true);
    expect(missionTransitionAllowed('OFFERED', 'DECLINED')).toBe(true);
    expect(missionTransitionAllowed('ACCEPTED', 'EN_ROUTE')).toBe(true);
    expect(missionTransitionAllowed('EN_ROUTE', 'ON_SCENE')).toBe(true);
    expect(missionTransitionAllowed('ON_SCENE', 'COMPLETED')).toBe(true);
    expect(missionTransitionAllowed('ON_SCENE', 'FAILED')).toBe(true);
    expect(missionTransitionAllowed('COMPLETED', 'FAILED')).toBe(false);
    expect(missionTransitionAllowed('OFFERED', 'COMPLETED')).toBe(false);
  });

  it('recomputes request progress from active missions without overriding sealed states', () => {
    expect(missionProgressStatus(['OFFERED'])).toBe('DISPATCHED');
    expect(missionProgressStatus(['OFFERED', 'ACCEPTED'])).toBe('IN_PROGRESS');
    expect(missionProgressStatus(['COMPLETED', 'DECLINED'])).toBe('TRIAGED');
    expect(missionProgressStatus(['OFFERED'], 'RESOLVING')).toBeNull();
    expect(missionProgressStatus([], 'CANCELLED')).toBeNull();
  });
});
