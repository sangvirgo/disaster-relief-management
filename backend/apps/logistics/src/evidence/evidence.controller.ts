import { Controller, Get, Headers, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AttachmentLifecycleService } from '../attachments/attachment-lifecycle.service';
import { DonationAttachmentsService } from '../drives/donation-attachments.service';
import { HandoffAttachmentsService } from '../distributions/handoff-attachments.service';
import { noStore } from '@c48/technical/http/response-headers';

@Controller()
export class EvidenceController {
  constructor(
    private readonly lifecycle: AttachmentLifecycleService,
    private readonly donations: DonationAttachmentsService,
    private readonly handoffs: HandoffAttachmentsService,
  ) {}

  @Get('evidence/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const owner = await this.lifecycle.ownerKind(id);
    return owner === 'HANDOFF'
      ? this.handoffs.download(id, request)
      : this.donations.download(id, secret, request);
  }
}
