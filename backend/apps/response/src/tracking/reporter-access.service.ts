import { Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hashPurposeBoundSecret, verifyPurposeBoundSecret } from '../../../../packages/technical/src/security/secret-hash';
import { RequestIntakeConfig, REQUEST_INTAKE_CONFIG } from '../requests/request-intake.service';
import { ReporterSession } from '../requests/reporter-session';

export interface ReporterRequestRow {
  id: string;
  tracking_code: string;
  tracking_secret_hash: string | null;
  reporter_user_id: string | null;
  status: string;
  version: number;
  review_lane: string;
  received_at: Date | string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  description: string | null;
  reporter_declared_danger: boolean;
  needs_rescue: boolean;
  needs_relief_supplies: boolean;
}

type Queryable = Pick<DataSource | EntityManager, 'query'>;
const codePattern = /^[0-9A-HJKMNP-TV-Z]{10,16}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
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

function lookupHash(secret: string | undefined, config: RequestIntakeConfig): string {
  const valid = typeof secret === 'string' && secretPattern.test(secret) && Buffer.from(secret, 'base64url').length === 32 && Buffer.from(secret, 'base64url').toString('base64url') === secret;
  return hashPurposeBoundSecret(valid ? secret : 'invalid-tracking-capability', 'sos-tracking', config.peppers, 'v1');
}

@Injectable()
export class ReporterAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly config: RequestIntakeConfig,
  ) {}

  async byTrackingCapability(
    trackingCode: string | undefined,
    trackingSecret: string | undefined,
    session?: ReporterSession | null,
    queryable: Queryable = this.dataSource,
  ): Promise<ReporterRequestRow> {
    if (session && trackingCode) {
      const rows = await queryable.query(
        `SELECT id, tracking_code, tracking_secret_hash, reporter_user_id, status, version, review_lane, received_at,
                organization_id, region_code, campaign_id, description, reporter_declared_danger,needs_rescue,needs_relief_supplies
           FROM assistance_request WHERE reporter_user_id = $1 AND tracking_code = $2`,
        [session.userId, trackingCode],
      ) as ReporterRequestRow[];
      const row = rows[0];
      if (row && trackingCodeMatches(row.tracking_code, trackingCode)) return row;
    } else {
      trackingCodeMatches(dummyTrackingCode, trackingCode);
    }

    const hash = lookupHash(trackingSecret, this.config);
    const rows = await queryable.query(
      `SELECT id, tracking_code, tracking_secret_hash, reporter_user_id, status, version, review_lane, received_at,
              organization_id, region_code, campaign_id, description, reporter_declared_danger,needs_rescue,needs_relief_supplies
         FROM assistance_request WHERE tracking_secret_hash = $1`,
      [hash],
    ) as ReporterRequestRow[];
    const row = rows[0];
    const matchesCode = trackingCodeMatches(row?.tracking_code ?? dummyTrackingCode, trackingCode);
    const matchesSecret = row?.tracking_secret_hash
      ? verifyPurposeBoundSecret(trackingSecret ?? '', 'sos-tracking', row.tracking_secret_hash, this.config.peppers, 'v1').valid
      : false;
    if (!row || !matchesCode || !matchesSecret) throw new AppError('NOT_FOUND', { status: 404 });
    return row;
  }

  async forRequest(
    requestId: string,
    trackingCode: string | undefined,
    trackingSecret: string | undefined,
    session?: ReporterSession | null,
    queryable: Queryable = this.dataSource,
    lock = false,
  ): Promise<ReporterRequestRow> {
    const rows = await queryable.query(
      `SELECT id, tracking_code, tracking_secret_hash, reporter_user_id, status, version, review_lane, received_at,
              organization_id, region_code, campaign_id, description, reporter_declared_danger,needs_rescue,needs_relief_supplies
         FROM assistance_request WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as ReporterRequestRow[];
    const row = rows[0];
    const matchesCode = trackingCodeMatches(row?.tracking_code ?? dummyTrackingCode, trackingCode);
    const guestSecretValid = row?.tracking_secret_hash
      ? verifyPurposeBoundSecret(trackingSecret ?? '', 'sos-tracking', row.tracking_secret_hash, this.config.peppers, 'v1').valid
      : false;
    const sessionOwner = Boolean(row && session && row.reporter_user_id === session.userId);
    if (!row || !matchesCode || (!sessionOwner && !guestSecretValid)) throw new AppError('NOT_FOUND', { status: 404 });
    return row;
  }

  trackingSecretHash(secret: string): string {
    return hashPurposeBoundSecret(secret, 'sos-tracking', this.config.peppers, 'v1');
  }

  validTrackingSecret(secret: string | undefined): boolean {
    return typeof secret === 'string' && secretPattern.test(secret) && Buffer.from(secret, 'base64url').length === 32 && Buffer.from(secret, 'base64url').toString('base64url') === secret;
  }
}
