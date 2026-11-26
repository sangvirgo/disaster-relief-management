import { Controller, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { LogisticsServiceTokenGuard } from '../auth/logistics-service-token.guard';
import { CampaignWarehouseService } from './campaign-warehouses.service';

/** Response calls this after a campaign is activated, resumed or its area changes; only the Response service token passes. */
@Controller('internal/campaigns/:id/warehouses')
@UseGuards(LogisticsServiceTokenGuard)
export class CampaignWarehousesInternalController {
  constructor(private readonly assignments: CampaignWarehouseService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async sync(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string): Promise<{ campaign_id: string; synced: true }> {
    await this.assignments.reevaluateCampaign(id, 'CAMPAIGN_CHANGED');
    return { campaign_id: id, synced: true };
  }
}
