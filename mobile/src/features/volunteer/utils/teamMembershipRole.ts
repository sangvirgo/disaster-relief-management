import type { Mission } from '../../../types/api';

export type TeamMembershipRole = 'LEADER' | 'MEMBER' | 'UNKNOWN';

type MissionRoleView = Pick<Mission, 'team' | 'reporter_contact_phone'>;

/**
 * /missions/mine includes contact fields only for an active team leader.
 * Do not use this inference with the single-mission detail response, which
 * may also include contacts for scoped staff.
 */
export const getTeamRoleFromMissionView = (mission: MissionRoleView): Exclude<TeamMembershipRole, 'UNKNOWN'> =>
  Object.prototype.hasOwnProperty.call(mission, 'reporter_contact_phone') ? 'LEADER' : 'MEMBER';

export const getTeamRoleFromMissionList = (
  missions: MissionRoleView[],
  teamId?: string,
): TeamMembershipRole => {
  const teamMissions = teamId
    ? missions.filter((mission) => mission.team.id === teamId)
    : missions;
  if (teamMissions.length === 0) return 'UNKNOWN';

  const firstRole = getTeamRoleFromMissionView(teamMissions[0]);
  return teamMissions.every((mission) => getTeamRoleFromMissionView(mission) === firstRole)
    ? firstRole
    : 'UNKNOWN';
};
