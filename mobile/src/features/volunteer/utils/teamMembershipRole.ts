import type { Mission } from '../../../types/api';

export type TeamMembershipRole = 'LEADER' | 'MEMBER' | 'UNKNOWN';

type MissionRoleView = Pick<Mission, 'team' | 'can_manage_mission'>;

/**
 * Mission views include the server-derived permission flag so clients do not
 * infer authority from the presence of private contact fields.
 */
export const getTeamRoleFromMissionView = (mission: MissionRoleView): Exclude<TeamMembershipRole, 'UNKNOWN'> =>
  mission.can_manage_mission ? 'LEADER' : 'MEMBER';

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
