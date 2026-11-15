/** Minutes without a coordination command after which a campaign engagement stops granting access. */
export const ENGAGEMENT_TTL_MINUTES = 60;

/** SQL predicate for a currently active campaign engagement row; the single place the TTL appears in SQL. */
export function engagementActiveSql(alias = 'ce'): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(alias)) throw new TypeError('Invalid engagement alias');
  return `${alias}.ended_at IS NULL AND ${alias}.last_active_at > now() - interval '${ENGAGEMENT_TTL_MINUTES} minutes'`;
}
