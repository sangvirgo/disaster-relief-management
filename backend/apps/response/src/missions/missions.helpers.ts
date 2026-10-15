export type MissionStatus = 'OFFERED' | 'ACCEPTED' | 'EN_ROUTE' | 'ON_SCENE' | 'COMPLETED' | 'FAILED' | 'DECLINED' | 'CANCELLED';

const transitions: Record<MissionStatus, readonly MissionStatus[]> = {
  OFFERED: ['ACCEPTED', 'DECLINED', 'FAILED', 'CANCELLED'],
  ACCEPTED: ['EN_ROUTE', 'FAILED', 'CANCELLED'],
  EN_ROUTE: ['ON_SCENE', 'FAILED', 'CANCELLED'],
  ON_SCENE: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  DECLINED: [],
  CANCELLED: [],
};

const protectedRequestStatuses = new Set(['RESOLVING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE']);
const inProgressStatuses = new Set(['ACCEPTED', 'EN_ROUTE', 'ON_SCENE']);

export function missionTransitionAllowed(from: string, to: string): boolean {
  return Object.hasOwn(transitions, from) && transitions[from as MissionStatus].includes(to as MissionStatus);
}

export function missionProgressStatus(activeMissionStatuses: readonly string[], currentRequestStatus?: string): 'TRIAGED' | 'DISPATCHED' | 'IN_PROGRESS' | null {
  if (currentRequestStatus && protectedRequestStatuses.has(currentRequestStatus)) return null;
  if (activeMissionStatuses.some((status) => inProgressStatuses.has(status))) return 'IN_PROGRESS';
  if (activeMissionStatuses.includes('OFFERED')) return 'DISPATCHED';
  return 'TRIAGED';
}
