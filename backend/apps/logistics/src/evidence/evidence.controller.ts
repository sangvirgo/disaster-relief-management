import { Controller, Get, Headers, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DonationAttachmentsService } from '../drives/donation-attachments.service';
import { noStore } from '@c48/technical/http/response-headers';

@Controller()
export class EvidenceController {
  constructor(
    private readonly donations: DonationAttachmentsService,
  ) {}

  @Get('evidence/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.donations.download(id, secret, request);
  }
}
