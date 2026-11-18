import { describe, expect, it, jest } from '@jest/globals';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { LOGISTICS_AUTH_CONFIG, LogisticsSessionService } from '../src/auth/logistics-session.service';
import { LOGISTICS_IDENTITY_CLIENT, LOGISTICS_IDENTITY_CONFIG, LogisticsIdentityService } from '../src/auth/logistics-identity.service';
import { PickupTicketsModule } from '../src/pickup-tickets/pickup-tickets.module';
import { AttachmentLifecycleService } from '../src/attachments/attachment-lifecycle.service';
import { PickupGoodsService } from '../src/pickup-tickets/pickup-goods.service';
import { UnaccountedGoodsGuard } from '../src/pickup-tickets/unaccounted-goods.service';
import { PickupTicketsService } from '../src/pickup-tickets/pickup-tickets.service';
import { HandoffCommandsService } from '../src/distributions/handoff-commands.service';
import { RESPONSE_ADMISSION_CLIENT, RESPONSE_ADMISSION_CONFIG, ResponseAdmissionClient } from '../src/needs/response-admission.client';
import { LOGISTICS_RESPONSE_CLIENT, LogisticsResponseCampaignClient, RESPONSE_CAMPAIGN_CONFIG } from '../src/integrations/response/response-campaign.client';

// Stands in for the TypeORM DataSource provider that the application registers globally.
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: { query: async () => [], transaction: async (fn: (m: unknown) => unknown) => fn({ query: async () => [] }) } }],
  exports: [DataSource],
})
class FakeDatabaseModule {}

describe('PickupTicketsModule wiring (Step 6b providers)', () => {
  it('resolves the close-out service and the unaccounted-goods guard with the distribution handoff writer', async () => {
    const module = await Test.createTestingModule({ imports: [FakeDatabaseModule, PickupTicketsModule] })
      .overrideProvider(AttachmentLifecycleService).useValue({})
      .overrideProvider(LOGISTICS_AUTH_CONFIG).useValue({})
      .overrideProvider(LogisticsSessionService).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LogisticsIdentityService).useValue({})
      .overrideProvider(RESPONSE_ADMISSION_CONFIG).useValue({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 })
      .overrideProvider(RESPONSE_ADMISSION_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(ResponseAdmissionClient).useValue({})
      .overrideProvider(RESPONSE_CAMPAIGN_CONFIG).useValue({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 })
      .overrideProvider(LOGISTICS_RESPONSE_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LogisticsResponseCampaignClient).useValue({ getCampaign: jest.fn() })
      .compile();
    expect(module.get(PickupGoodsService)).toBeInstanceOf(PickupGoodsService);
    expect(module.get(UnaccountedGoodsGuard)).toBeInstanceOf(UnaccountedGoodsGuard);
    expect(module.get(PickupTicketsService)).toBeInstanceOf(PickupTicketsService);
    expect(module.get(HandoffCommandsService)).toBeInstanceOf(HandoffCommandsService);
  });
});
