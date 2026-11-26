import { Role, ScopeType } from '@c48/identity-contracts/permissions';

export interface GrantScopeInput {
  role_code: Role;
  scope_type: ScopeType;
  campaign_id?: string | null;
}

export function isSelfGrant(actorId: string, userId: string): boolean {
  return actorId.toLowerCase() === userId.toLowerCase();
}

export function grantScopeIsValid(grant: GrantScopeInput): boolean {
  const campaign = grant.campaign_id ?? null;
  // A COORDINATOR at CAMPAIGN scope without a campaign is a sub-coordinator that chooses its campaigns in Response.
  const shape = grant.scope_type === 'SYSTEM' ? campaign === null : campaign !== null || grant.role_code === 'COORDINATOR';
  if (!shape) return false;
  if (grant.role_code === 'ADMIN') return grant.scope_type === 'SYSTEM';
  if (grant.role_code === 'CITIZEN' || grant.role_code === 'VOLUNTEER') return grant.scope_type === 'SYSTEM';
  return true;
}
