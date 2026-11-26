import { describe, expect, it, jest } from '@jest/globals';
import { CampaignWarehousesInternalController } from '../src/campaign-warehouses/campaign-warehouses-internal.controller';
import type { CampaignWarehouseService } from '../src/campaign-warehouses/campaign-warehouses.service';

describe('CampaignWarehousesInternalController', () => {
  it('re-evaluates the campaign primary warehouse right after a campaign change', async () => {
    const reevaluateCampaign = jest.fn(async () => undefined);
    const controller = new CampaignWarehousesInternalController({ reevaluateCampaign } as unknown as CampaignWarehouseService);
    const id = '55555555-5555-4555-8555-555555555555';
    await expect(controller.sync(id)).resolves.toEqual({ campaign_id: id, synced: true });
    expect(reevaluateCampaign).toHaveBeenCalledWith(id, 'CAMPAIGN_CHANGED');
  });
});
