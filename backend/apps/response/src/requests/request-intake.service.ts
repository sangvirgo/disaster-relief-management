import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalRequestHash, IdempotencyService } from '../../../../packages/technical/src/idempotency';
import { AppError } from '../../../../packages/technical/src/errors';
import { hashPurposeBoundSecret, PepperSet } from '../../../../packages/technical/src/secret-hash';
import { CreateProxyRequestDto, CreateSelfRequestDto } from './request-intake.dto';
import { loadReporterTokenConfig, ReporterTokenConfig } from './reporter-token';

export const REQUEST_INTAKE_CONFIG = Symbol('REQUEST_INTAKE_CONFIG');
const trackingAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const trackingSecretPattern = /^[A-Za-z0-9_-]{43}$/;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequestIntakeConfig {
  auth: ReporterTokenConfig;
  organizationId: string;
  peppers: PepperSet;
  globalLimitPerMinute: number;
  softLimitPerMinute: number;
  proxyOpenCap: number;
  proxyDailySoftLimit: number;
}

export interface CreatedRequest {
  id: string;
  tracking_code: string;
  status: 'SUBMITTED';
  received_at: string;
  review_lane: 'NORMAL' | 'RATE_LIMITED_REVIEW' | 'PROXY_QUOTA_REVIEW';
}

interface ProxyFacts {
  relationship: string;
  beneficiaryContactPhone: string | null;
  alternateContactName: string | null;
  alternateContactPhone: string | null;
  informationSource: string;
  lastKnownSituationAt: string;
  contactability: 'REACHABLE' | 'UNREACHABLE' | 'UNKNOWN';
}

const proxyActivityWindowHours = 24;
const proxyDistinctLocationThreshold = 3;

function validUtcTimestamp(value: string): boolean {
  if (!utcTimestampPattern.test(value)) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString().startsWith(value.slice(0, 19));
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
    proxyOpenCap: positiveInteger(env, 'PROXY_OPEN_CAP', 3),
    proxyDailySoftLimit: positiveInteger(env, 'PROXY_DAILY_SOFT_LIMIT', 10),
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

export function normalizeReporterPhone(value: string, field = 'reporter_contact_phone'): string {
  const normalized = value.trim().replace(/[ ()-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(normalized)) throw invalidField(field, 'PHONE_INVALID');
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

export function validateProxyRequest(dto: CreateProxyRequestDto): void {
  validateSelfRequest(dto);
  for (const [field, value] of [
    ['relationship', dto.relationship],
    ['information_source', dto.information_source],
  ] as const) {
    if (!value || value.trim() === '' || value !== value.normalize('NFC')) throw invalidField(field, 'VALIDATION_FAILED');
  }
  for (const [field, value] of [
    ['alternate_contact.name', dto.alternate_contact?.name],
  ] as const) {
    if (value != null && (value.trim() === '' || value !== value.normalize('NFC'))) throw invalidField(field, 'VALIDATION_FAILED');
  }
  if (!validUtcTimestamp(dto.last_known_situation_at)) {
    throw invalidField('last_known_situation_at', 'VALIDATION_FAILED');
  }
  if (!['REACHABLE', 'UNREACHABLE', 'UNKNOWN'].includes(dto.contactability)) throw invalidField('contactability', 'VALIDATION_FAILED');
}

function trackingSecretHash(secret: string | undefined, config: RequestIntakeConfig): string | null {
  if (secret === undefined) return null;
  if (!trackingSecretPattern.test(secret) || Buffer.from(secret, 'base64url').length !== 32 || Buffer.from(secret, 'base64url').toString('base64url') !== secret) {
    throw new AppError('TRACKING_SECRET_INVALID', { status: 400 });
  }
  return hashPurposeBoundSecret(secret, 'sos-tracking', config.peppers, 'v1');
}

function createdResponse(row: { id: string; tracking_code: string; received_at: Date | string; review_lane: string }): CreatedRequest {
  if (!['NORMAL', 'RATE_LIMITED_REVIEW', 'PROXY_QUOTA_REVIEW'].includes(row.review_lane)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return { id: row.id, tracking_code: row.tracking_code, status: 'SUBMITTED', received_at: new Date(row.received_at).toISOString(), review_lane: row.review_lane as CreatedRequest['review_lane'] };
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
  ): Promise<{ status: number; value: CreatedRequest; replay: boolean }> {
    validateSelfRequest(dto);
    const secretHash = trackingSecretHash(trackingSecret, this.config);
    if (!reporterUserId && !secretHash) throw new AppError('TRACKING_SECRET_INVALID', { status: 400 });
    return this.create(dto, idempotencyKey, reporterUserId, secretHash, remoteIp);
  }

  async createProxy(
    dto: CreateProxyRequestDto,
    idempotencyKey: string,
    reporterUserId: string,
    remoteIp: string,
  ): Promise<{ status: number; value: CreatedRequest; replay: boolean }> {
    validateProxyRequest(dto);
    const proxy: ProxyFacts = {
      relationship: dto.relationship,
      beneficiaryContactPhone: dto.beneficiary_contact_phone == null ? null : normalizeReporterPhone(dto.beneficiary_contact_phone, 'beneficiary_contact_phone'),
      alternateContactName: dto.alternate_contact?.name ?? null,
      alternateContactPhone: dto.alternate_contact?.phone == null ? null : normalizeReporterPhone(dto.alternate_contact.phone, 'alternate_contact.phone'),
      informationSource: dto.information_source,
      lastKnownSituationAt: new Date(dto.last_known_situation_at).toISOString(),
      contactability: dto.contactability,
    };
    return this.create(dto, idempotencyKey, reporterUserId, null, remoteIp, proxy);
  }

  private async create(
    dto: CreateSelfRequestDto,
    idempotencyKey: string,
    reporterUserId: string | null,
    secretHash: string | null,
    remoteIp: string,
    proxy: ProxyFacts | null = null,
  ): Promise<{ status: number; value: CreatedRequest; replay: boolean }> {
    const phone = dto.reporter_contact_phone == null ? null : normalizeReporterPhone(dto.reporter_contact_phone);
    const categories = await this.dataSource.query('SELECT 1 FROM incident_category WHERE code = $1', [dto.incident_category_code]) as unknown[];
    if (categories.length === 0) throw invalidField('incident_category_code', 'CATEGORY_UNKNOWN');

    const location = dto.location;
    const canonicalPayload = {
      report_mode: proxy ? 'PROXY' : 'SELF',
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
      ...(proxy ? { proxy } : {}),
    };
    const requestHash = canonicalRequestHash(canonicalPayload, secretHash ?? undefined);
    const sourceIpHash = hashPurposeBoundSecret(remoteIp || 'unknown', 'sos-source-ip', this.config.peppers, 'v1');
    const scopeKey = proxy ? `response.requests.proxy:${reporterUserId}` : 'response.requests.self';
    const command = proxy ? 'response.requests.create-proxy' : 'response.requests.create-self';

    return this.idempotency.execute(this.dataSource, {
      scopeKey,
      command,
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
        let proxyQuotaReached = false;
        if (proxy) {
          const proxyCounts = await manager.query(
            `SELECT count(*) FILTER (WHERE status IN ('SUBMITTED','VERIFYING'))::int AS open_count,
                    count(*) FILTER (WHERE received_at >= $2::timestamptz - interval '24 hours')::int AS daily_count
               FROM assistance_request WHERE report_mode='PROXY' AND reporter_user_id=$1`,
            [reporterUserId, throttle.received_at],
          ) as Array<{ open_count: number; daily_count: number }>;
          const counts = proxyCounts[0];
          if (!counts) throw new AppError('INTERNAL_ERROR', { status: 500 });
          proxyQuotaReached = counts.open_count >= this.config.proxyOpenCap || counts.daily_count >= this.config.proxyDailySoftLimit;
        }
        const regionRows = await manager.query(
          `SELECT min(region_code) AS region_code FROM region_boundary
            WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
            HAVING count(*) = 1`,
          location.coordinates,
        ) as Array<{ region_code: string }>;
        const rateLimited = Number(throttle.ip_count) >= this.config.softLimitPerMinute ||
          Number(throttle.phone_count) >= this.config.softLimitPerMinute ||
          Number(throttle.global_count) >= this.config.globalLimitPerMinute;
        const reviewLane = proxy && proxyQuotaReached ? 'PROXY_QUOTA_REVIEW' : rateLimited ? 'RATE_LIMITED_REVIEW' : 'NORMAL';
        let request: { id: string; tracking_code: string; status: string; received_at: Date | string; review_lane: string } | undefined;
        for (let attempt = 0; attempt < 5 && !request; attempt++) {
          const rows = await manager.query(
            `INSERT INTO assistance_request
              (tracking_code, tracking_secret_hash, incident_category_code, report_mode, reporter_user_id,
               reporter_name, reporter_contact_phone, source_ip_hash, description, organization_id, region_code,
               review_lane, reporter_declared_danger, received_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (tracking_code) DO NOTHING
             RETURNING id, tracking_code, status, received_at, review_lane`,
            [generateTrackingCode(), secretHash, dto.incident_category_code, proxy ? 'PROXY' : 'SELF', reporterUserId,
              dto.reporter_name ?? null, phone, sourceIpHash, dto.description ?? null, this.config.organizationId,
              regionRows[0]?.region_code ?? null, reviewLane, dto.reporter_declared_danger ?? false, throttle.received_at],
          ) as Array<{ id: string; tracking_code: string; status: string; received_at: Date | string; review_lane: string }>;
          request = rows[0];
        }
        if (!request) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const [longitude, latitude] = location.coordinates;
        await manager.query(
          `INSERT INTO request_subject
            (request_id, people_affected, location, location_source, location_accuracy_m, location_captured_at,
             reporter_relationship, beneficiary_contact_phone, alternate_contact_name, alternate_contact_phone,
             information_source, last_known_situation_at, contactability)
           VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [request.id, dto.people_affected ?? null, longitude, latitude, location.source,
            location.source === 'GPS' ? location.accuracy_m : null, location.captured_at ?? null,
            proxy?.relationship ?? null, proxy?.beneficiaryContactPhone ?? null, proxy?.alternateContactName ?? null,
            proxy?.alternateContactPhone ?? null, proxy?.informationSource ?? null, proxy?.lastKnownSituationAt ?? null,
            proxy?.contactability ?? null],
        );
        await manager.query(
          `INSERT INTO request_event (request_id, actor_user_id, event_type, visibility, from_status, to_status, payload)
           VALUES ($1,$2,'REQUEST_SUBMITTED','REPORTER',NULL,'SUBMITTED',$3::jsonb)`,
          [request.id, reporterUserId, JSON.stringify({ public_text_code: 'RECEIVED', review_lane: request.review_lane })],
        );
        if (proxy) await this.recordProxyActivityFlag(manager, request.id, reporterUserId!, phone, throttle.received_at);
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

  private async recordProxyActivityFlag(
    manager: EntityManager,
    requestId: string,
    reporterUserId: string,
    reporterPhone: string | null,
    receivedAt: Date,
  ): Promise<void> {
    const rows = await manager.query(
      `WITH reports AS MATERIALIZED (
         SELECT r.id, r.status, r.report_mode, r.received_at,
                round(ST_X(s.location::geometry)::numeric,3) AS longitude_cell,
                round(ST_Y(s.location::geometry)::numeric,3) AS latitude_cell
           FROM assistance_request r JOIN request_subject s ON s.request_id = r.id
          WHERE r.reporter_user_id = $1 OR ($2::text IS NOT NULL AND r.reporter_contact_phone = $2)
       ), proxy_reports AS MATERIALIZED (
         SELECT * FROM reports WHERE report_mode = 'PROXY'
       ), recent_cells AS (
         SELECT longitude_cell, latitude_cell FROM proxy_reports
          WHERE received_at >= $3::timestamptz - interval '24 hours'
          GROUP BY longitude_cell, latitude_cell
       )
       SELECT (SELECT count(*)::int FROM recent_cells) AS distinct_locations,
              (SELECT count(*)::int FROM reports WHERE status='REJECTED') AS rejected_count,
              (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM (
                 SELECT id FROM proxy_reports WHERE received_at >= $3::timestamptz - interval '24 hours'
                  ORDER BY received_at DESC, id DESC LIMIT 10
               ) recent) AS recent_request_ids,
              (SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) FROM (
                 SELECT id FROM reports WHERE status='REJECTED' ORDER BY received_at DESC, id DESC LIMIT 10
               ) rejected) AS rejected_request_ids`,
      [reporterUserId, reporterPhone, receivedAt],
    ) as Array<{ distinct_locations: number; rejected_count: number; recent_request_ids: string[]; rejected_request_ids: string[] }>;
    const activity = rows[0];
    if (!activity) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const flags = [
      ...(activity.distinct_locations >= proxyDistinctLocationThreshold ? ['MULTIPLE_REPORTED_LOCATIONS'] : []),
      ...(activity.rejected_count > 0 ? ['PRIOR_REJECTIONS'] : []),
    ];
    if (flags.length === 0) return;
    await manager.query(
      `INSERT INTO request_event (request_id, actor_user_id, event_type, visibility, payload)
       VALUES ($1,NULL,'PROXY_ACTIVITY_FLAG','STAFF',$2::jsonb)`,
      [requestId, JSON.stringify({
        flags,
        window_hours: proxyActivityWindowHours,
        distinct_locations_approx_100m: activity.distinct_locations,
        recent_request_ids: activity.recent_request_ids,
        rejected_count: activity.rejected_count,
        rejected_request_ids: activity.rejected_request_ids,
      })],
    );
  }
}
