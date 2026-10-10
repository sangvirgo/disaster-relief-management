import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res() response: Response): Promise<Response> {
    try {
      await this.dataSource.query('SELECT 1');
      return response.status(200).json({ status: 'ok' });
    } catch {
      return response.status(503).json({ status: 'unavailable' });
    }
  }
}
