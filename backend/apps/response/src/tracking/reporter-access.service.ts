import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';

export interface ReporterRequestRow {
  id: string;
  tracking_code: string;
  tracking_secret_hash?: string | null;
  reporter_user_id: string | null;
  status: string;
  version: number;
  review_lane: string;
  received_at: Date | string;
  campaign_id: string | null;
  incident_category_code: string;
  description: string | null;
  reporter_declared_danger: boolean;
  needs_rescue: boolean;
  needs_relief_supplies: boolean;
}

type Queryable = Pick<DataSource | EntityManager, 'query'>;
const codePattern = /^[0-9A-HJKMNP-TV-Z]{10,16}$/;
const dummyTrackingCode = '0000000000';

export function trackingCodeMatches(expected: string, supplied: string | undefined): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from((supplied ?? '').slice(0, 16), 'utf8');
  const left = Buffer.alloc(16);
  const right = Buffer.alloc(16);
  expectedBytes.copy(left, 0, 0, 16);
  suppliedBytes.copy(right, 0, 0, 16);
  const equal = timingSafeEqual(left, right);
  return equal && codePattern.test(expected) && typeof supplied === 'string' && codePattern.test(supplied);
}

@Injectable()
export class ReporterAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async byTrackingCode(trackingCode: string | undefined, queryable: Queryable = this.dataSource): Promise<ReporterRequestRow> {
    if (typeof trackingCode !== 'string' || !codePattern.test(trackingCode)) {
      trackingCodeMatches(dummyTrackingCode, trackingCode);
      throw new AppError('NOT_FOUND', { status: 404 });
    }
    const rows = await queryable.query(
      `SELECT id, tracking_code, reporter_user_id, status, version, review_lane, received_at,
              campaign_id, incident_category_code, description,
              reporter_declared_danger,needs_rescue,needs_relief_supplies
         FROM assistance_request WHERE tracking_code = $1`,
      [trackingCode],
    ) as ReporterRequestRow[];
    const row = rows[0];
    const matchesCode = trackingCodeMatches(row?.tracking_code ?? dummyTrackingCode, trackingCode);
    if (!row || !matchesCode) throw new AppError('NOT_FOUND', { status: 404 });
    return row;
  }

  async forRequest(
    requestId: string,
    trackingCode: string | undefined,
    queryable: Queryable = this.dataSource,
    lock = false,
  ): Promise<ReporterRequestRow> {
    const rows = await queryable.query(
      `SELECT id, tracking_code, reporter_user_id, status, version, review_lane, received_at,
              campaign_id, description, reporter_declared_danger,needs_rescue,needs_relief_supplies
         FROM assistance_request WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as ReporterRequestRow[];
    const row = rows[0];
    const matchesCode = trackingCodeMatches(row?.tracking_code ?? dummyTrackingCode, trackingCode);
    if (!row || !matchesCode) throw new AppError('NOT_FOUND', { status: 404 });
    return row;
  }

}
