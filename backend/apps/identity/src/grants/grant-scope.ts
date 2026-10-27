import { Role, ScopeType } from '../../../../packages/identity-contracts/src/permissions';

export interface GrantScopeInput {
  role_code: Role;
  scope_type: ScopeType;
  organization_id?: string | null;
  region_code?: string | null;
  campaign_id?: string | null;
}

export function isSelfGrant(actorId: string, userId: string): boolean {
  return actorId.toLowerCase() === userId.toLowerCase();
}

export function grantScopeIsValid(grant: GrantScopeInput): boolean {
  const organization = grant.organization_id ?? null;
  const region = grant.region_code ?? null;
  const campaign = grant.campaign_id ?? null;
  const shape = grant.scope_type === 'SYSTEM'
    ? organization === null && region === null && campaign === null
    : grant.scope_type === 'ORGANIZATION'
      ? organization !== null && region === null && campaign === null
      : grant.scope_type === 'REGION'
        ? organization !== null && region !== null && campaign === null
        : organization !== null && region === null && campaign !== null;
  if (!shape) return false;
  if (grant.role_code === 'ADMIN') return grant.scope_type === 'SYSTEM';
  if (grant.role_code === 'CITIZEN' || grant.role_code === 'VOLUNTEER') {
    return grant.scope_type === 'SYSTEM' || grant.scope_type === 'ORGANIZATION';
  }
  return grant.scope_type !== 'SYSTEM';
}
