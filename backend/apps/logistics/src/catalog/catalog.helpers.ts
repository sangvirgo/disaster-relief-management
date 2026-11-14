import { hasPermission, Grant } from '@c48/identity-contracts/permissions';

export function hasCatalogManageGrant(grants: readonly Grant[]): boolean {
  return grants.some((grant) => grant.role_code === 'OPERATIONS_MANAGER' &&
    grant.scope_type === 'ORGANIZATION' && Boolean(grant.organization_id) && !grant.campaign_id &&
    hasPermission([grant], 'CATALOG_MANAGE', { organizationId: grant.organization_id! }));
}
