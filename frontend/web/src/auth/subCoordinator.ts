export type GrantShape = { role_code: string; scope_type: string; campaign_id?: string | null };

/**
 * Sub-coordinator: COORDINATOR granted at CAMPAIGN scope without a campaign and no SYSTEM coordinator grant. It
 * chooses campaigns itself and only works their SOS (no SOS without a campaign, no campaign setup, teams or reports).
 */
export function isSubCoordinatorGrants(grants: readonly GrantShape[]): boolean {
  return grants.some((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'CAMPAIGN' && !grant.campaign_id)
    && !grants.some((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'SYSTEM');
}

/** Coordinator pages a sub-coordinator may open; system dashboards, reports and teams stay with the primary coordinator. */
export const SUB_COORDINATOR_PAGES: readonly string[] = ['campaigns', 'notices'];
