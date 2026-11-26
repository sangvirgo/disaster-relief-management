import { describe, expect, it, jest } from '@jest/globals';
import { CampaignsController } from '../src/campaigns/campaigns.controller';
import type { CampaignsService } from '../src/campaigns/campaigns.service';
import type { CampaignCoordinationService } from '../src/campaigns/campaign-coordination.service';
import type { LogisticsCampaignWarehouseNotifier } from '../src/integrations/logistics/logistics-campaign-warehouse.client';

const id = '00000000-0000-4000-8000-0000000000c1';
const request = { headers: {}, idempotencyKey: 'key-1' } as never;
const response = { setHeader: jest.fn() } as never;

function setup(replay = false) {
  const outcome = { value: { id }, replay };
  const campaigns = {
    transition: jest.fn(async () => outcome), changeArea: jest.fn(async () => outcome), patch: jest.fn(async () => outcome),
  } as unknown as CampaignsService;
  const campaignChanged = jest.fn();
  const controller = new CampaignsController(campaigns, {} as CampaignCoordinationService,
    { campaignChanged } as unknown as LogisticsCampaignWarehouseNotifier);
  return { controller, campaignChanged };
}

describe('campaign primary warehouse sync trigger', () => {
  it('asks Logistics to choose the primary warehouse when a campaign starts, resumes or moves', async () => {
    const { controller, campaignChanged } = setup();
    await controller.activate(id, { expected_version: 1 }, request, response);
    await controller.resume(id, { expected_version: 2 }, request, response);
    await controller.changeArea(id, { expected_version: 3, center: { lat: 10, lng: 106 }, radius_m: 5000 }, request, response);
    expect(campaignChanged).toHaveBeenCalledTimes(3);
  });

  it('does not trigger on pause, on a patch without area, or on an idempotent replay', async () => {
    const { controller, campaignChanged } = setup();
    await controller.pause(id, { expected_version: 1, reason: 'Tạm dừng' }, request, response);
    await controller.patch(id, { expected_version: 1, name: 'Tên mới' }, request, response);
    const replayed = setup(true);
    await replayed.controller.activate(id, { expected_version: 1 }, request, response);
    expect(campaignChanged).not.toHaveBeenCalled();
    expect(replayed.campaignChanged).not.toHaveBeenCalled();
  });
});
