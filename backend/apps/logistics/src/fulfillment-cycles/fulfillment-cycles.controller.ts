import { Body, Controller, Header, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { LogisticsServiceTokenGuard } from '../auth/logistics-service-token.guard';
import { CycleIntentDto, SealCycleDto } from './fulfillment-cycles.dto';
import { FulfillmentCyclesService } from './fulfillment-cycles.service';

@Controller('internal/requests/:requestId/cycles/:cycle')
@UseGuards(LogisticsServiceTokenGuard)
export class FulfillmentCyclesController {
  constructor(private readonly cycles: FulfillmentCyclesService) {}

  @Post('freeze')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  freeze(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Param('cycle', ParseIntPipe) workCycle: number,
    @Body() dto: CycleIntentDto,
  ): Promise<Record<string, unknown>> {
    return this.cycles.freeze(requestId, workCycle, dto);
  }

  @Post('seal')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  seal(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Param('cycle', ParseIntPipe) workCycle: number,
    @Body() dto: SealCycleDto,
  ): Promise<Record<string, unknown>> {
    return this.cycles.seal(requestId, workCycle, dto);
  }

  @Post('unseal')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  unseal(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Param('cycle', ParseIntPipe) workCycle: number,
    @Body() dto: CycleIntentDto,
  ): Promise<Record<string, unknown>> {
    return this.cycles.unseal(requestId, workCycle, dto);
  }
}
