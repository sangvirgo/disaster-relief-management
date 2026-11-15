export const CAMPAIGN_CONFLICT_NOTIFIER = Symbol('CAMPAIGN_CONFLICT_NOTIFIER');

export interface CampaignConflictNotifier {
  requestCoordinatorGrants(campaignId: null): Promise<Array<{ user_id: string; scope_type: 'SYSTEM' | 'CAMPAIGN' }>>;
}
