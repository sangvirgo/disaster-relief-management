import type { Mission } from '../../../types/api';

export type TeamMembershipRole = 'LEADER' | 'MEMBER' | 'UNKNOWN';

type MissionRoleView = Pick<Mission, 'reporter_contact_phone'>;

/**
 * /missions/mine includes contact fields only for an active team leader.
 * Do not use this inference with the single-mission detail response, which
 * may also include contacts for scoped staff.
 */
export const getTeamRoleFromMissionView = (mission: MissionRoleView): Exclude<TeamMembershipRole, 'UNKNOWN'> =>
  Object.prototype.hasOwnProperty.call(mission, 'reporter_contact_phone') ? 'LEADER' : 'MEMBER';

export const getTeamRoleFromMissionList = (missions: MissionRoleView[]): TeamMembershipRole => {
  if (missions.length === 0) return 'UNKNOWN';

  const firstRole = getTeamRoleFromMissionView(missions[0]);
  return missions.every((mission) => getTeamRoleFromMissionView(mission) === firstRole)
    ? firstRole
    : 'UNKNOWN';
};
