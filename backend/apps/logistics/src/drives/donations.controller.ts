import {
  Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import {
  CreateDonationDeliveryDto, DeclarationRevisionDto, DonationRecoveryIssueDto, DonationRecoveryRedeemDto,
  OpenDonationDisputeDto,
} from './donations.dto';
import { DonationCommandRequest, DonationsService } from './donations.service';
import { DonationsQueriesService } from './donations-queries.service';
import { DonationAttachmentsService } from './donation-attachments.service';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function replay(response: Response, isReplay: boolean): void {
  if (isReplay) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class DonationsController {
  constructor(
    private readonly donations: DonationsService,
    private readonly queries: DonationsQueriesService,
    private readonly attachments: DonationAttachmentsService,
  ) {}

  @Post('public/donations/recover')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async recover(
    @Body() dto: DonationRecoveryRedeemDto,
    @Headers('x-recovery-code') recoveryCode: string | undefined,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.recover(dto, recoveryCode, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('public/donations/:id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async uploadEvidence(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Query('dispute_id', new ParseUUIDPipe({ version: 'all', optional: true })) disputeId: string | undefined,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.attachments.upload(id, disputeId, secret, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('public/donation-drives/:id/deliveries')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createDelivery(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) driveId: string,
    @Body() dto: CreateDonationDeliveryDto,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.createDelivery(driveId, dto, secret, request);
    replay(response, result.replay);
    return result.value;
  }

  @Get('public/donations/:id')
  track(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.track(id, secret, request);
  }

  @Post('public/donations/:id/declarations')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reviseDeclaration(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: DeclarationRevisionDto,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.reviseDeclaration(id, dto, secret, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('public/donations/:id/disputes')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async openDispute(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: OpenDonationDisputeDto,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.openDispute(id, dto, secret, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('public/donations/:id/claim')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async claim(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Headers('x-donation-secret') secret: string | undefined,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.claim(id, secret, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-deliveries/:id/assisted-declaration')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async assistedDeclaration(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: DeclarationRevisionDto,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.assistedDeclaration(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-deliveries/:id/capability/revoke')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async revokeCapability(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.revokeCapability(id, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-deliveries/:id/recovery')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async issueRecovery(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: DonationRecoveryIssueDto,
    @Req() request: DonationCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.donations.issueRecovery(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
