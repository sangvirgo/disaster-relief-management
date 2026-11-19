import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { noStore } from '@c48/technical/http/response-headers';
import { ResponseServiceTokenGuard } from '../campaigns/service-token.guard';
import { SupplyCandidatesQueryDto } from './supply-candidates.dto';
import { SupplyCandidatesService } from './supply-candidates.service';

@Controller()
export class SupplyCandidatesController {
  constructor(private readonly candidates: SupplyCandidatesService) {}

  @Get('internal/requests/supply-candidates')
  @UseGuards(ResponseServiceTokenGuard)
  async list(@Query() query: SupplyCandidatesQueryDto, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.candidates.list(query.cursor, query.limit);
  }
}
