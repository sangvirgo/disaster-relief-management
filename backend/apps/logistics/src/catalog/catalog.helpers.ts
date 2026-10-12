import { hasPermission, Grant } from '../../../../packages/technical/src/security/permissions';

export function hasCatalogManageGrant(grants: readonly Grant[]): boolean {
  return grants.some((grant) => grant.role_code === 'OPERATIONS_MANAGER' &&
    grant.scope_type === 'ORGANIZATION' && Boolean(grant.organization_id) && !grant.region_code && !grant.campaign_id &&
    hasPermission([grant], 'CATALOG_MANAGE', { organizationId: grant.organization_id! }));
}
