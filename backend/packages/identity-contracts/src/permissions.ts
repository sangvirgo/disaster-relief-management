/**
 * CAMPAIGN_MANAGE covers coordination-level campaign changes (detail edits, pause, resume, close).
 * CAMPAIGN_SETUP_MANAGE covers creating a campaign, activating it and changing its area; only COORDINATOR holds it, because coordinators draw campaigns from the SOS map.
 * CAMPAIGN_WAREHOUSE_VIEW reads a campaign's warehouse assignment (COORDINATOR and OPERATIONS_MANAGER).
 * CAMPAIGN_WAREHOUSE_MANAGE sets a manual primary warehouse and re-evaluates assignments; only OPERATIONS_MANAGER holds it.
 * NEED_ESTIMATE_CONFIRM generates estimated SOS goods needs and confirms or edits them (COORDINATOR; operations staff do not see SOS needs).
 * NEED_NORM_MANAGE reads and changes the per-person norm table; only OPERATIONS_MANAGER holds it, at system scope.
 * SUPPLY_GAP_VIEW reads supply-gap warnings and suggestions; only OPERATIONS_MANAGER holds it (user decision 2026-11-22).
 * SUPPLY_GAP_MANAGE accepts a suggested donation drive or dismisses a gap; only OPERATIONS_MANAGER holds it, at system scope.
 * SUPPLY_REQUEST_CREATE asks for goods for a mission and cancels an open request (user decision 2026-11-26). COORDINATOR holds
 * it to act on behalf of a team; a VOLUNTEER holds it too but may only act for a live mission of a team they belong to.
 * SUPPLY_REQUEST_HANDOVER reads the warehouse queue and hands goods over against the team's pickup code; only
 * OPERATIONS_MANAGER holds it. The queue never shows SOS location, description, people or the mission.
 * TEAM_MANAGE_ANY (team setup, roster and skills, readiness recording on behalf) is held by ADMIN only. COORDINATOR keeps TEAM_READ and sees team readiness (user decision 2026-11-22).
 * ADJUSTMENT_REVIEW (approve or reject a stock adjustment) is held by OPERATIONS_MANAGER only (user decision 2026-11-22).
 * Distribution slips, handoffs, loss review, pickup tickets and close-out were removed on 2026-11-26 with their permissions.
 */
export const ROLE_PERMISSIONS = {
  CITIZEN: ['REQUEST_CREATE_PROXY'],
  VOLUNTEER: ['REQUEST_CREATE_PROXY', 'SUPPLY_REQUEST_CREATE'],
  COORDINATOR: [
    'REQUEST_CREATE_PROXY', 'REQUEST_QUEUE_READ', 'REQUEST_DETAIL_READ', 'TEAM_READ', 'MISSION_OVERDUE_READ',
    'CAMPAIGN_READ', 'CAMPAIGN_SETUP_MANAGE', 'REQUEST_VERIFY', 'REQUEST_TRIAGE', 'REQUEST_CANCEL', 'REQUEST_REOPEN', 'REQUEST_RESOLVE',
    'REQUEST_UNASSIGNED_QUEUE', 'MISSION_ASSIGN', 'MISSION_RECORD_ON_BEHALF',
    'TEAM_POSITION_SET_ANY', 'MAP_READ', 'CAMPAIGN_MANAGE', 'REPORT_READ', 'RESPONSE_REPORT_READ', 'NEED_MANAGE',
    'NEED_ESTIMATE_CONFIRM', 'CAMPAIGN_WAREHOUSE_VIEW', 'SUPPLY_REQUEST_CREATE',
  ],
  OPERATIONS_MANAGER: [
    'REQUEST_CREATE_PROXY', 'MAP_READ', 'CAMPAIGN_READ', 'CAMPAIGN_MANAGE', 'CAMPAIGN_WAREHOUSE_VIEW', 'CAMPAIGN_WAREHOUSE_MANAGE', 'REPORT_READ', 'RESPONSE_REPORT_READ', 'CATALOG_MANAGE',
    'ASSET_MANAGE', 'DONATION_DRIVE_MANAGE', 'NEED_NORM_MANAGE', 'ADJUSTMENT_REVIEW', 'DONATION_INTAKE',
    'STOCK_ADJUST_REQUEST', 'SUPPLY_GAP_VIEW', 'SUPPLY_GAP_MANAGE', 'SUPPLY_REQUEST_HANDOVER',
  ],
  REVIEWER: ['DONATION_REVIEW'],
  ADMIN: ['USER_MANAGE', 'GRANT_MANAGE', 'AUDIT_READ', 'REQUEST_CREATE_PROXY', 'REPORT_READ', 'RESPONSE_REPORT_READ', 'TEAM_READ', 'TEAM_MANAGE_ANY'],
} as const;

export type Role = keyof typeof ROLE_PERMISSIONS;
export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];
export type ScopeType = 'SYSTEM' | 'CAMPAIGN';

export interface Grant {
  role_code: Role;
  scope_type: ScopeType;
  campaign_id?: string | null;
  /**
   * Set only by Response on a campaign grant it derives from a sub-coordinator's active campaign engagement. Such a
   * grant holds SUB_COORDINATOR_PERMISSIONS only. Never part of the Identity transport (validGrant rejects it).
   */
  engaged?: true;
}

/**
 * Sub-coordinator (user decision 2026-11-26): a COORDINATOR grant at CAMPAIGN scope without a campaign. It chooses
 * (engages) ACTIVE campaigns itself and, inside them only, verifies, prioritizes, assigns and resolves SOS. It never
 * handles SOS without a campaign, never creates or manages campaigns, teams or logistics, and is not a new role.
 */
export const SUB_COORDINATOR_PERMISSIONS = [
  'REQUEST_QUEUE_READ', 'REQUEST_DETAIL_READ', 'MISSION_OVERDUE_READ', 'CAMPAIGN_READ', 'REQUEST_VERIFY', 'REQUEST_TRIAGE',
  'REQUEST_CANCEL', 'REQUEST_REOPEN', 'REQUEST_RESOLVE', 'MISSION_ASSIGN', 'MISSION_RECORD_ON_BEHALF', 'SUPPLY_REQUEST_CREATE',
] as const satisfies readonly Permission[];

/** The floating grant a sub-coordinator holds in Identity: COORDINATOR, CAMPAIGN scope, no campaign. */
export function isSubCoordinatorGrant(grant: Pick<Grant, 'role_code' | 'scope_type' | 'campaign_id'>): boolean {
  return grant.role_code === 'COORDINATOR' && grant.scope_type === 'CAMPAIGN' && !grant.campaign_id;
}

/** True for a sub-coordinator that has no SYSTEM coordinator grant as well. */
export function isSubCoordinator(grants: readonly Grant[]): boolean {
  return grants.some(isSubCoordinatorGrant) &&
    !grants.some((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'SYSTEM');
}

/** Permissions a grant carries: the role catalog, narrowed for a campaign grant derived from an engagement. */
export function grantPermissions(grant: Pick<Grant, 'role_code' | 'engaged'>): readonly string[] {
  return grant.engaged ? SUB_COORDINATOR_PERMISSIONS : ROLE_PERMISSIONS[grant.role_code];
}

export interface ScopeTarget {
  campaignId?: string | null;
  systemAction?: Permission;
}

function matchesScope(grant: Grant, target: ScopeTarget): boolean {
  if ((grant.role_code === 'CITIZEN' || grant.role_code === 'VOLUNTEER') && grant.scope_type !== 'SYSTEM') return false;
  if (grant.role_code === 'ADMIN' && grant.scope_type !== 'SYSTEM') return false;
  if (grant.scope_type === 'SYSTEM') return !grant.campaign_id;
  return Boolean(grant.campaign_id) && grant.campaign_id === target.campaignId;
}

export function hasPermission(grants: readonly Grant[], permission: Permission, target: ScopeTarget): boolean {
  return grants.some((grant) => {
    return grantPermissions(grant).includes(permission) && matchesScope(grant, target);
  });
}

const scopes = new Set(['SYSTEM', 'CAMPAIGN']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Validate transport shape only; authorization still evaluates role, action and scope. */
export function validGrant(value: unknown): value is Grant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Record<string, unknown>;
  if (Object.keys(grant).some((key) => !['role_code', 'scope_type', 'campaign_id'].includes(key)) ||
      typeof grant.role_code !== 'string' || !Object.hasOwn(ROLE_PERMISSIONS, grant.role_code) ||
      typeof grant.scope_type !== 'string' || !scopes.has(grant.scope_type)) return false;
  if (grant.scope_type === 'SYSTEM') return grant.campaign_id === null || grant.campaign_id === undefined;
  if ((grant.campaign_id === null || grant.campaign_id === undefined) && grant.role_code === 'COORDINATOR') return true;
  return typeof grant.campaign_id === 'string' && uuidPattern.test(grant.campaign_id);
}
