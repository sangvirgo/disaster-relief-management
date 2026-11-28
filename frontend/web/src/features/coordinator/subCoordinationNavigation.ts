/** Switching campaign scope must never carry a SOS from the previous scope. */
export function engagementUrl(currentUrl: string, campaignId: string, previousCampaignId?: string): URL {
  const url = new URL(currentUrl);
  if (campaignId !== previousCampaignId) {
    url.searchParams.delete('sos_id');
    url.searchParams.delete('sos_tab');
  }
  if (campaignId) url.searchParams.set('engagement_id', campaignId);
  else url.searchParams.delete('engagement_id');
  return url;
}
