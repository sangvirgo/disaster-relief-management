export const ROLE_PERMISSIONS = {
  CITIZEN: ['REQUEST_CREATE_PROXY'],
  VOLUNTEER: ['REQUEST_CREATE_PROXY'],
  COORDINATOR: [
    'REQUEST_CREATE_PROXY', 'REQUEST_QUEUE_READ', 'REQUEST_DETAIL_READ', 'TEAM_READ', 'MISSION_OVERDUE_READ',
    'CAMPAIGN_READ', 'REQUEST_VERIFY', 'REQUEST_TRIAGE', 'REQUEST_CANCEL', 'REQUEST_REOPEN', 'REQUEST_RESOLVE',
    'REQUEST_UNASSIGNED_QUEUE', 'MISSION_ASSIGN', 'MISSION_RECORD_ON_BEHALF', 'TEAM_MANAGE_ANY',
    'TEAM_POSITION_SET_ANY', 'MAP_READ', 'CAMPAIGN_MANAGE', 'REPORT_READ', 'NEED_MANAGE',
  ],
  CAMPAIGN_MANAGER: ['REQUEST_CREATE_PROXY', 'CAMPAIGN_READ', 'CAMPAIGN_MANAGE', 'REPORT_READ', 'DONATION_DRIVE_MANAGE'],
  OPERATIONS_MANAGER: [
    'REQUEST_CREATE_PROXY', 'MAP_READ', 'CAMPAIGN_READ', 'CAMPAIGN_MANAGE', 'REPORT_READ', 'CATALOG_MANAGE',
    'ASSET_MANAGE', 'DONATION_DRIVE_MANAGE', 'NEED_MANAGE', 'COMMITMENT_MANAGE', 'DISTRIBUTION_PREPARE',
    'DISTRIBUTION_REVIEW', 'LOSS_APPROVE', 'ADJUSTMENT_REVIEW',
  ],
  INTAKE_STAFF: ['REQUEST_CREATE_PROXY', 'DONATION_INTAKE', 'DISTRIBUTION_PREPARE', 'DISTRIBUTION_DISPATCH', 'STOCK_ADJUST_REQUEST'],
  REVIEWER: ['DONATION_REVIEW', 'DISTRIBUTION_REVIEW', 'LOSS_APPROVE', 'ADJUSTMENT_REVIEW'],
  DISTRIBUTION_STAFF: ['REQUEST_CREATE_PROXY', 'DISTRIBUTION_PREPARE', 'DISTRIBUTION_DISPATCH', 'HANDOFF_RECORD', 'STOCK_ADJUST_REQUEST'],
  ADMIN: ['USER_MANAGE', 'GRANT_MANAGE', 'ORG_MANAGE', 'AUDIT_READ', 'REQUEST_CREATE_PROXY', 'REPORT_READ'],
} as const;

export type Role = keyof typeof ROLE_PERMISSIONS;
export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];
export type ScopeType = 'SYSTEM' | 'ORGANIZATION' | 'REGION' | 'CAMPAIGN';

export interface Grant {
  role_code: Role;
  scope_type: ScopeType;
  organization_id: string | null;
  region_code?: string | null;
  campaign_id?: string | null;
}

export interface ScopeTarget {
  organizationId?: string;
  regionCode?: string | null;
  campaignId?: string | null;
  systemAction?: Permission;
}

function matchesScope(grant: Grant, target: ScopeTarget, permission: Permission): boolean {
  if (grant.role_code === 'ADMIN') return grant.scope_type === 'SYSTEM' && grant.organization_id === null && !grant.region_code && !grant.campaign_id && target.systemAction === permission;
  if (grant.role_code === 'CITIZEN' || grant.role_code === 'VOLUNTEER') {
    if (!['SYSTEM', 'ORGANIZATION'].includes(grant.scope_type)) return false;
  } else if (grant.scope_type === 'SYSTEM') {
    return false;
  }
  if (grant.scope_type === 'SYSTEM') return grant.organization_id === null && !grant.region_code && !grant.campaign_id && target.systemAction === permission;
  if (!target.organizationId || grant.organization_id !== target.organizationId) return false;
  if (grant.scope_type === 'ORGANIZATION') return !grant.region_code && !grant.campaign_id;
  if (grant.scope_type === 'REGION') return Boolean(grant.region_code) && !grant.campaign_id && grant.region_code === target.regionCode;
  return Boolean(grant.campaign_id) && !grant.region_code && grant.campaign_id === target.campaignId;
}

export function hasPermission(grants: readonly Grant[], permission: Permission, target: ScopeTarget): boolean {
  return grants.some((grant) => {
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    return permissions.includes(permission) && matchesScope(grant, target, permission);
  });
}
