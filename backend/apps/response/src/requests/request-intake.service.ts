import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalRequestHash, IdempotencyService } from '../../../../packages/technical/src/idempotency';
import { AppError } from '../../../../packages/technical/src/errors';
import { hashPurposeBoundSecret, PepperSet } from '../../../../packages/technical/src/secret-hash';
import { CreateSelfRequestDto } from './request-intake.dto';
import { loadReporterTokenConfig, ReporterTokenConfig } from './reporter-token';

export const REQUEST_INTAKE_CONFIG = Symbol('REQUEST_INTAKE_CONFIG');
const trackingAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const trackingSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestIntakeConfig {
  auth: ReporterTokenConfig;
  organizationId: string;
  peppers: PepperSet;
  globalLimitPerMinute: number;
  softLimitPerMinute: number;
}

export interface CreatedSelfRequest {
  id: string;
  tracking_code: string;
  status: 'SUBMITTED';
  received_at: string;
  review_lane: 'NORMAL' | 'RATE_LIMITED_REVIEW';
}

function positiveInteger(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error(`Invalid Response configuration: ${name}`);
  return value;
}

export function loadRequestIntakeConfig(env: Record<string, string | undefined> = process.env): RequestIntakeConfig {
  const organizationId = env.DEMO_INTAKE_ORGANIZATION_ID ?? '';
  const pepper = env.SECRET_HASH_PEPPER_SOS ?? '';
  if (!uuidPattern.test(organizationId) || pepper.length < 32) throw new Error('Invalid Response configuration: DEMO_INTAKE_ORGANIZATION_ID, SECRET_HASH_PEPPER_SOS');
  return {
    auth: requireReporterConfig(env),
    organizationId,
    peppers: { v1: pepper },
    globalLimitPerMinute: positiveInteger(env, 'SOS_GLOBAL_PER_MIN', 300),
    softLimitPerMinute: positiveInteger(env, 'SOS_SOFT_LIMIT_PER_IP', 30),
  };
}

function requireReporterConfig(env: Record<string, string | undefined>): ReporterTokenConfig {
  return loadReporterTokenConfig(env);
}

export function generateTrackingCode(): string {
  let value = BigInt(`0x${randomBytes(7).toString('hex')}`) & ((1n << 50n) - 1n);
  const code = Array.from({ length: 10 }, () => '0');
  for (let index = code.length - 1; index >= 0; index--) {
    code[index] = trackingAlphabet[Number(value & 31n)]!;
    value >>= 5n;
  }
  return code.join('');
}

function invalidField(field: string, code: string): AppError {
  return new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { [field]: [code] } });
}

export function validatePoint(coordinates: readonly number[]): void {
  if (coordinates.length !== 2 || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) ||
      coordinates[0]! < -180 || coordinates[0]! > 180 || coordinates[1]! < -90 || coordinates[1]! > 90) {
    throw invalidField('location.coordinates', 'COORDINATES_OUT_OF_RANGE');
  }
}

export function normalizeReporterPhone(value: string): string {
  const normalized = value.trim().replace(/[ ()-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(normalized)) throw invalidField('reporter_contact_phone', 'PHONE_INVALID');
  return normalized;
}

function validateSelfRequest(dto: CreateSelfRequestDto): void {
  validatePoint(dto.location.coordinates);
  const people = dto.people_affected;
  if (people !== undefined && people !== null && (!Number.isInteger(people) || people < 1 || people > 10_000)) {
    throw invalidField('people_affected', 'PEOPLE_AFFECTED_OUT_OF_RANGE');
  }
  if (dto.location.source === 'GPS' && (dto.location.accuracy_m === undefined || dto.location.accuracy_m === null || dto.location.captured_at === undefined || dto.location.captured_at === null)) {
    throw invalidField('location', 'ACCURACY_REQUIRED');
  }
  if (dto.location.accuracy_m !== undefined && dto.location.accuracy_m !== null &&
      (!Number.isFinite(dto.location.accuracy_m) || dto.location.accuracy_m < 0 || dto.location.accuracy_m > 9_999_999.9)) {
    throw invalidField('location.accuracy_m', 'VALIDATION_FAILED');
  }
  if (dto.location.source === 'MANUAL_PIN' && Object.hasOwn(dto.location, 'accuracy_m')) {
    throw invalidField('location.accuracy_m', 'VALIDATION_FAILED');
  }
  if (dto.reporter_name != null && (dto.reporter_name.trim() === '' || dto.reporter_name !== dto.reporter_name.normalize('NFC'))) {
    throw invalidField('reporter_name', 'VALIDATION_FAILED');
  }
}

function trackingSecretHash(secret: string | undefined, config: RequestIntakeConfig): string | null {
  if (secret === undefined) return null;
  if (!trackingSecretPattern.test(secret) || Buffer.from(secret, 'base64url').length !== 32 || Buffer.from(secret, 'base64url').toString('base64url') !== secret) {
    throw new AppError('TRACKING_SECRET_INVALID', { status: 400 });
  }
  return hashPurposeBoundSecret(secret, 'sos-tracking', config.peppers, 'v1');
}

function createdResponse(row: { id: string; tracking_code: string; received_at: Date | string; review_lane: string }): CreatedSelfRequest {
  if (!['NORMAL', 'RATE_LIMITED_REVIEW'].includes(row.review_lane)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return { id: row.id, tracking_code: row.tracking_code, status: 'SUBMITTED', received_at: new Date(row.received_at).toISOString(), review_lane: row.review_lane as CreatedSelfRequest['review_lane'] };
}

@Injectable()
export class RequestIntakeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly config: RequestIntakeConfig,
  ) {}

  async createSelf(
    dto: CreateSelfRequestDto,
    idempotencyKey: string,
    reporterUserId: string | null,
    trackingSecret: string | undefined,
    remoteIp: string,
  ): Promise<{ status: number; value: CreatedSelfRequest; replay: boolean }> {
    validateSelfRequest(dto);
    const secretHash = trackingSecretHash(trackingSecret, this.config);
    if (!reporterUserId && !secretHash) throw new AppError('TRACKING_SECRET_INVALID', { status: 400 });
    const phone = dto.reporter_contact_phone == null ? null : normalizeReporterPhone(dto.reporter_contact_phone);
    const categories = await this.dataSource.query('SELECT 1 FROM incident_category WHERE code = $1', [dto.incident_category_code]) as unknown[];
    if (categories.length === 0) throw invalidField('incident_category_code', 'CATEGORY_UNKNOWN');

    const location = dto.location;
    const canonicalPayload = {
      report_mode: 'SELF',
      reporter_user_id: reporterUserId,
      incident_category_code: dto.incident_category_code,
      description: dto.description ?? null,
      people_affected: dto.people_affected ?? null,
      reporter_name: dto.reporter_name ?? null,
      reporter_contact_phone: phone,
      reporter_declared_danger: dto.reporter_declared_danger ?? false,
      location: {
        type: 'Point', coordinates: location.coordinates, source: location.source,
        accuracy_m: location.accuracy_m ?? null, captured_at: location.captured_at ?? null,
      },
    };
    const requestHash = canonicalRequestHash(canonicalPayload, secretHash ?? undefined);
    const sourceIpHash = hashPurposeBoundSecret(remoteIp || 'unknown', 'sos-source-ip', this.config.peppers, 'v1');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: 'response.requests.self',
      command: 'response.requests.create-self',
      key: idempotencyKey,
      requestHash,
      databaseErrorMappings: { unique: { request_secret_uq: 'TRACKING_SECRET_IN_USE' } },
      execute: async (manager) => {
        const throttleRows = await manager.query(
          `WITH intake_time AS MATERIALIZED (SELECT clock_timestamp() AS at)
           SELECT intake_time.at AS received_at,
                  (SELECT count(*) FROM assistance_request r WHERE r.organization_id = $1 AND r.received_at >= intake_time.at - interval '1 minute') AS global_count,
                  (SELECT count(*) FROM assistance_request p WHERE $2::text IS NOT NULL AND p.reporter_contact_phone = $2 AND p.received_at >= intake_time.at - interval '1 minute') AS phone_count,
                  (SELECT count(*) FROM assistance_request i WHERE i.source_ip_hash = $3 AND i.received_at >= intake_time.at - interval '1 minute') AS ip_count
             FROM intake_time`,
          [this.config.organizationId, phone, sourceIpHash],
        ) as Array<{ received_at: Date; global_count: string; phone_count: string; ip_count: string }>;
        const throttle = throttleRows[0];
        if (!throttle) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const regionRows = await manager.query(
          `SELECT min(region_code) AS region_code FROM region_boundary
            WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
            HAVING count(*) = 1`,
          location.coordinates,
        ) as Array<{ region_code: string }>;
        const rateLimited = Number(throttle.ip_count) >= this.config.softLimitPerMinute ||
          Number(throttle.phone_count) >= this.config.softLimitPerMinute ||
          Number(throttle.global_count) >= this.config.globalLimitPerMinute;
        let request: { id: string; tracking_code: string; status: string; received_at: Date | string; review_lane: string } | undefined;
        for (let attempt = 0; attempt < 5 && !request; attempt++) {
          const rows = await manager.query(
            `INSERT INTO assistance_request
              (tracking_code, tracking_secret_hash, incident_category_code, report_mode, reporter_user_id,
               reporter_name, reporter_contact_phone, source_ip_hash, description, organization_id, region_code,
               review_lane, reporter_declared_danger, received_at)
             VALUES ($1,$2,$3,'SELF',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (tracking_code) DO NOTHING
             RETURNING id, tracking_code, status, received_at, review_lane`,
            [generateTrackingCode(), secretHash, dto.incident_category_code, reporterUserId, dto.reporter_name ?? null,
              phone, sourceIpHash, dto.description ?? null, this.config.organizationId, regionRows[0]?.region_code ?? null,
              rateLimited ? 'RATE_LIMITED_REVIEW' : 'NORMAL', dto.reporter_declared_danger ?? false, throttle.received_at],
          ) as Array<{ id: string; tracking_code: string; status: string; received_at: Date | string; review_lane: string }>;
          request = rows[0];
        }
        if (!request) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const [longitude, latitude] = location.coordinates;
        await manager.query(
          `INSERT INTO request_subject
            (request_id, people_affected, location, location_source, location_accuracy_m, location_captured_at)
           VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$6,$7)`,
          [request.id, dto.people_affected ?? null, longitude, latitude, location.source,
            location.source === 'GPS' ? location.accuracy_m : null, location.captured_at ?? null],
        );
        await manager.query(
          `INSERT INTO request_event (request_id, actor_user_id, event_type, visibility, from_status, to_status, payload)
           VALUES ($1,$2,'REQUEST_SUBMITTED','REPORTER',NULL,'SUBMITTED',$3::jsonb)`,
          [request.id, reporterUserId, JSON.stringify({ public_text_code: 'RECEIVED', review_lane: request.review_lane })],
        );
        const value = createdResponse(request);
        return { status: 201, value, resource: { type: 'assistance_request', id: request.id } };
      },
      replay: async (manager: EntityManager, resource) => {
        if (!resource || resource.type !== 'assistance_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query(
          `SELECT r.id, r.tracking_code, r.received_at, COALESCE(e.payload->>'review_lane', r.review_lane) AS review_lane
             FROM assistance_request r JOIN request_event e ON e.request_id = r.id
            WHERE r.id = $1 AND e.event_type = 'REQUEST_SUBMITTED'`,
          [resource.id],
        ) as Array<{ id: string; tracking_code: string; received_at: Date | string; review_lane: string }>;
        if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return createdResponse(rows[0]);
      },
    });
  }
}
