/**
 * CAMPAIGN_MANAGE covers coordination-level campaign changes (detail edits, pause, resume, close).
 * CAMPAIGN_SETUP_MANAGE covers creating a campaign, activating it and changing its area; only OPERATIONS_MANAGER holds it.
 * CAMPAIGN_WAREHOUSE_VIEW reads a campaign's warehouse assignment (COORDINATOR and OPERATIONS_MANAGER).
 * CAMPAIGN_WAREHOUSE_MANAGE sets a manual primary warehouse and re-evaluates assignments; only OPERATIONS_MANAGER holds it.
 * NEED_ESTIMATE_CONFIRM generates estimated SOS goods needs and confirms or edits them (COORDINATOR and OPERATIONS_MANAGER).
 * NEED_NORM_MANAGE reads and changes the per-person norm table; only OPERATIONS_MANAGER holds it, at system scope.
 * SUPPLY_GAP_VIEW reads supply-gap warnings and suggestions (COORDINATOR and OPERATIONS_MANAGER, read-only).
 * SUPPLY_GAP_MANAGE accepts a suggested donation drive or dismisses a gap; only OPERATIONS_MANAGER holds it, at system scope.
 * PICKUP_TICKET_VIEW reads mission pickup tickets (COORDINATOR, OPERATIONS_MANAGER, and REVIEWER so the independent close-out reviewer can read the ticket).
 * PICKUP_TICKET_MANAGE creates, reserves, confirms and cancels pickup tickets (COORDINATOR and OPERATIONS_MANAGER). Each step
 * also passes the underlying commitment and distribution permissions, so handover stays with DISTRIBUTION_DISPATCH.
 * PICKUP_CLOSEOUT_SUBMIT drafts and submits a pickup close-out (COORDINATOR and OPERATIONS_MANAGER; the team lead acts through a coordinator in the demo).
 * PICKUP_CLOSEOUT_REVIEW approves or rejects a submitted close-out (OPERATIONS_MANAGER and REVIEWER). The reviewer must differ from the submitter and
 * from the user who handed the goods over. Approval that returns goods also needs DISTRIBUTION_DISPATCH or DONATION_INTAKE in the inner RETURN step.
 */
export const ROLE_PERMISSIONS = {
  CITIZEN: ['REQUEST_CREATE_PROXY'],
  VOLUNTEER: ['REQUEST_CREATE_PROXY'],
  COORDINATOR: [
    'REQUEST_CREATE_PROXY', 'REQUEST_QUEUE_READ', 'REQUEST_DETAIL_READ', 'TEAM_READ', 'MISSION_OVERDUE_READ',
    'CAMPAIGN_READ', 'REQUEST_VERIFY', 'REQUEST_TRIAGE', 'REQUEST_CANCEL', 'REQUEST_REOPEN', 'REQUEST_RESOLVE',
    'REQUEST_UNASSIGNED_QUEUE', 'MISSION_ASSIGN', 'MISSION_RECORD_ON_BEHALF', 'TEAM_MANAGE_ANY',
    'TEAM_POSITION_SET_ANY', 'MAP_READ', 'CAMPAIGN_MANAGE', 'REPORT_READ', 'RESPONSE_REPORT_READ', 'NEED_MANAGE',
    'DONATION_DRIVE_MANAGE', 'CAMPAIGN_WAREHOUSE_VIEW', 'NEED_ESTIMATE_CONFIRM', 'SUPPLY_GAP_VIEW',
    'PICKUP_TICKET_VIEW', 'PICKUP_TICKET_MANAGE', 'PICKUP_CLOSEOUT_SUBMIT',
  ],
  OPERATIONS_MANAGER: [
    'REQUEST_CREATE_PROXY', 'MAP_READ', 'CAMPAIGN_READ', 'CAMPAIGN_MANAGE', 'CAMPAIGN_SETUP_MANAGE', 'CAMPAIGN_WAREHOUSE_VIEW', 'CAMPAIGN_WAREHOUSE_MANAGE', 'REPORT_READ', 'RESPONSE_REPORT_READ', 'CATALOG_MANAGE',
    'ASSET_MANAGE', 'DONATION_DRIVE_MANAGE', 'NEED_MANAGE', 'NEED_ESTIMATE_CONFIRM', 'NEED_NORM_MANAGE', 'COMMITMENT_MANAGE', 'DISTRIBUTION_PREPARE',
    'DISTRIBUTION_REVIEW', 'LOSS_APPROVE', 'ADJUSTMENT_REVIEW', 'DONATION_INTAKE', 'DISTRIBUTION_DISPATCH',
    'STOCK_ADJUST_REQUEST', 'HANDOFF_RECORD', 'SUPPLY_GAP_VIEW', 'SUPPLY_GAP_MANAGE',
    'PICKUP_TICKET_VIEW', 'PICKUP_TICKET_MANAGE', 'PICKUP_CLOSEOUT_SUBMIT', 'PICKUP_CLOSEOUT_REVIEW',
  ],
  REVIEWER: ['DONATION_REVIEW', 'DISTRIBUTION_REVIEW', 'LOSS_APPROVE', 'ADJUSTMENT_REVIEW', 'PICKUP_CLOSEOUT_REVIEW', 'PICKUP_TICKET_VIEW'],
  ADMIN: ['USER_MANAGE', 'GRANT_MANAGE', 'AUDIT_READ', 'REQUEST_CREATE_PROXY', 'REPORT_READ', 'RESPONSE_REPORT_READ', 'TEAM_READ', 'TEAM_MANAGE_ANY'],
} as const;

export type Role = keyof typeof ROLE_PERMISSIONS;
export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];
export type ScopeType = 'SYSTEM' | 'CAMPAIGN';

export interface Grant {
  role_code: Role;
  scope_type: ScopeType;
  campaign_id?: string | null;
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
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    return permissions.includes(permission) && matchesScope(grant, target);
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
  return typeof grant.campaign_id === 'string' && uuidPattern.test(grant.campaign_id);
}
