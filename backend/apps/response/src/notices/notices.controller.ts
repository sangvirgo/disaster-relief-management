import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NoticePageQueryDto } from './notices.dto';
import { NoticesService } from './notices.service';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

@Controller()
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get('notices')
  async list(@Query() query: NoticePageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.notices.list(query, request);
  }

  @Post('notices/:id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.notices.markRead(id, request);
  }
}
