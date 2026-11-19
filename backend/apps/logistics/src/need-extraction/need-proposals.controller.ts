import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { noStore } from '@c48/technical/http/response-headers';
import { NeedProposalQueryDto } from './need-proposals.dto';
import { NeedProposalsService } from './need-proposals.service';

@Controller('need-proposals')
export class NeedProposalsController {
  constructor(private readonly proposals: NeedProposalsService) {}

  @Get()
  async list(@Query() query: NeedProposalQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.proposals.list(query, request);
  }
}
