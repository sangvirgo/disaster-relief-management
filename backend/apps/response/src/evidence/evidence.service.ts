import { randomUUID } from 'node:crypto';
import { Logger, OnModuleDestroy, OnModuleInit, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { JobRunner } from '../../../../packages/technical/src/persistence/jobs';
import { hashPurposeBoundSecret } from '../../../../packages/technical/src/security/secret-hash';
import { ReporterSession, ReporterSessionService } from '../requests/reporter-session';
import { RequestIntakeConfig, REQUEST_INTAKE_CONFIG } from '../requests/request-intake.service';
import { ReporterAccessService, ReporterRequestRow } from '../tracking/reporter-access.service';
import { EvidenceMime } from './evidence-media';
import { stageEvidenceMultipart } from './evidence-upload';
import { EvidenceObjectStorage, EvidenceStorageConfig, RESPONSE_EVIDENCE_STORAGE } from './evidence-storage';

const requestAttachmentCountLimit = 5;
const ownerAttachmentByteLimit = 100 * 1024 * 1024;
const guestHourlyByteLimit = 200 * 1024 * 1024;
const maxMultipartBytes = 55 * 1024 * 1024;

interface EvidenceRow {
  id: string;
  request_id: string | null;
  mission_id: string | null;
  object_key: string;
  state: 'PENDING' | 'READY' | 'FAILED';
  declared_bytes: string | number;
  size_bytes: string | number | null;
  detected_mime: EvidenceMime | null;
  checksum: string | null;
  created_at: Date | string;
}

interface EvidenceView {
  id: string;
  state: 'READY';
  size_bytes: number;
  detected_mime: EvidenceMime;
  checksum: string;
  created_at: string;
}

function storageUnavailable(): AppError {
  return new AppError('STORAGE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function uploadEligible(row: Pick<ReporterRequestRow, 'review_lane' | 'status'>): boolean {
  return row.review_lane === 'NORMAL' && ['SUBMITTED', 'VERIFYING', 'VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(row.status);
}

function view(row: EvidenceRow): EvidenceView {
  if (row.state !== 'READY' || row.size_bytes == null || !row.detected_mime || !row.checksum) {
    throw new AppError('INTERNAL_ERROR', { status: 500 });
  }
  return {
    id: row.id, state: 'READY', size_bytes: Number(row.size_bytes), detected_mime: row.detected_mime,
    checksum: row.checksum, created_at: new Date(row.created_at).toISOString(),
  };
}

function evidenceKey(requestId: string, evidenceId: string, missionId?: string): string {
  return missionId ? `mission/${missionId}/${evidenceId}` : `req/${requestId}/${evidenceId}`;
}

interface MissionUploadOwner extends Pick<ReporterRequestRow, 'review_lane' | 'status' | 'organization_id' | 'region_code' | 'campaign_id'> {
  request_id: string;
  team_id: string;
  team_reporting_mode: 'APP' | 'COORDINATOR';
  team_status: 'ACTIVE' | 'INACTIVE';
  mission_status: string;
}

interface EvidenceUploadOwner {
  requestId: string;
  missionId?: string;
  session: ReporterSession | null;
  trackingCode?: string;
  trackingSecret?: string;
  hasTrackingCapability: boolean;
}

@Injectable()
export class EvidenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly jobs: JobRunner;
  private activeUploads = 0;
  private stopSchedule?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly access: ReporterAccessService,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly intakeConfig: RequestIntakeConfig,
    @Inject(RESPONSE_EVIDENCE_STORAGE) private readonly storage: EvidenceObjectStorage,
    @Inject('EVIDENCE_STORAGE_CONFIG') private readonly storageConfig: EvidenceStorageConfig,
  ) {
    this.jobs = new JobRunner(dataSource, () => this.logger.warn('SCHEDULED_JOB_FAILED response.evidence.reconcile'));
  }

  onModuleInit(): void {
    this.stopSchedule = this.jobs.schedule(
      'response.evidence.reconcile.timer', 30_000,
      async () => { queueMicrotask(() => { void this.reconcilePending().catch(() => this.logger.warn('SCHEDULED_JOB_FAILED response.evidence.reconcile')); }); },
    );
  }

  onModuleDestroy(): void {
    this.stopSchedule?.();
  }

  async upload(
    requestId: string,
    idempotencyKey: string,
    trackingCode: string | undefined,
    trackingSecret: string | undefined,
    request: Request,
  ): Promise<IdempotentResult<EvidenceView>> {
    const hasTrackingCapability = this.access.validTrackingSecret(trackingSecret);
    const session = await this.sessions.optional(request, hasTrackingCapability);
    const owner = await this.access.forRequest(requestId, trackingCode, trackingSecret, session);
    if (!uploadEligible(owner)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    return this.uploadOwned({
      requestId, session, hasTrackingCapability,
      ...(trackingCode === undefined ? {} : { trackingCode }),
      ...(trackingSecret === undefined ? {} : { trackingSecret }),
    }, idempotencyKey, request);
  }

  async uploadMission(missionId: string, idempotencyKey: string, request: Request): Promise<IdempotentResult<EvidenceView>> {
    const session = await this.sessions.require(request);
    const owner = await this.missionUploadOwner(this.dataSource, missionId, session);
    if (!uploadEligible(owner)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    return this.uploadOwned({ requestId: owner.request_id, missionId, session, hasTrackingCapability: false }, idempotencyKey, request);
  }

  private async uploadOwned(owner: EvidenceUploadOwner, idempotencyKey: string, request: Request): Promise<IdempotentResult<EvidenceView>> {
    const rawLength = request.headers['content-length'];
    if (typeof rawLength !== 'string' || !/^\d+$/.test(rawLength)) throw new AppError('LENGTH_REQUIRED', { status: 411 });
    const declaredBytes = Number(rawLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1) throw new AppError('LENGTH_REQUIRED', { status: 411 });
    if (declaredBytes > maxMultipartBytes) throw new AppError('PAYLOAD_TOO_LARGE', { status: 413 });
    if (this.activeUploads >= 20) throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: 1 });
    this.activeUploads++;
    let staged: Awaited<ReturnType<typeof stageEvidenceMultipart>> | undefined;
    let objectKey: string | undefined;
    let evidenceId: string | undefined;
    let scopeKey = '';
    try {
      staged = await stageEvidenceMultipart(request, declaredBytes);
      const sourceIpHash = hashPurposeBoundSecret(requestIp(request), 'sos-source-ip', this.intakeConfig.peppers, 'v1');
      const quotaIpHash = owner.session ? null : sourceIpHash;
      const capabilityHash = owner.hasTrackingCapability ? this.access.trackingSecretHash(owner.trackingSecret!) : undefined;
      scopeKey = owner.missionId
        ? `response.evidence.mission:${owner.missionId}:${owner.session!.userId}`
        : `response.evidence.request:${owner.requestId}:${owner.session?.userId ?? 'guest'}`;
      const requestHash = canonicalRequestHash(owner.missionId ? {
        mission_id: owner.missionId, uploader_user_id: owner.session?.userId ?? null, declared_bytes: declaredBytes,
        file_bytes: staged.size, detected_mime: staged.mime, checksum: staged.checksum,
      } : {
        request_id: owner.requestId, uploader_user_id: owner.session?.userId ?? null, declared_bytes: declaredBytes,
        file_bytes: staged.size, detected_mime: staged.mime, checksum: staged.checksum,
      }, capabilityHash);
      const result = await this.idempotency.execute(this.dataSource, {
        scopeKey,
        command: 'response.evidence.upload',
        key: idempotencyKey,
        requestHash,
        execute: async (manager) => {
          if (quotaIpHash) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [quotaIpHash]);
          const lockedOwner = owner.missionId
            ? await this.missionUploadOwner(manager, owner.missionId, owner.session!, true)
            : await this.access.forRequest(owner.requestId, owner.trackingCode, owner.trackingSecret, owner.session, manager, true);
          if (!uploadEligible(lockedOwner)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
          await this.reserveQuota(manager, owner.requestId, quotaIpHash, declaredBytes);
          evidenceId = randomUUID();
          objectKey = evidenceKey(owner.requestId, evidenceId, owner.missionId);
          await manager.query(
            `INSERT INTO evidence_metadata
              (id,request_id,mission_id,object_key,state,declared_bytes,uploader_user_id,upload_source_ip_hash)
             VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7)`,
            [evidenceId, owner.missionId ? null : owner.requestId, owner.missionId ?? null, objectKey, declaredBytes, owner.session?.userId ?? null, sourceIpHash],
          );
          return { status: 201, value: { id: evidenceId, state: 'PENDING' }, resource: { type: 'evidence_metadata', id: evidenceId } };
        },
        replay: async (manager, resource) => {
          if (resource?.type !== 'evidence_metadata') throw new AppError('INTERNAL_ERROR', { status: 500 });
          const ownerColumn = owner.missionId ? 'mission_id' : 'request_id';
          const ownerId = owner.missionId ?? owner.requestId;
          const rows = await manager.query(
            `SELECT id,request_id,mission_id,state,declared_bytes,size_bytes,detected_mime,checksum,created_at,object_key
               FROM evidence_metadata WHERE id=$1 AND ${ownerColumn}=$2`, [resource.id, ownerId],
          ) as EvidenceRow[];
          const row = rows[0];
          if (!row) throw new AppError('NOT_FOUND', { status: 404 });
          return row.state === 'READY' ? view(row) : { id: row.id, state: row.state } as unknown as EvidenceView;
        },
      });
      evidenceId = result.value.id;
      if (result.status >= 500) throw storageUnavailable();
      if (result.replay) {
        const ready = await this.waitUntilReady(evidenceId);
        return { status: 201, value: ready, replay: true };
      }

      const id = evidenceId;
      objectKey = evidenceKey(owner.requestId, id, owner.missionId);
      try {
        await this.storage.putObject(objectKey, staged.path, staged.size, staged.mime, staged.checksum);
        const [rows] = await this.dataSource.query(
          `UPDATE evidence_metadata SET state='READY',size_bytes=$2,detected_mime=$3,checksum=$4
            WHERE id=$1 AND state='PENDING'
            RETURNING id,request_id,mission_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at`,
          [id, staged.size, staged.mime, staged.checksum],
        ) as [EvidenceRow[], number];
        if (!rows[0]) throw storageUnavailable();
        return { status: 201, value: view(rows[0]), replay: false };
      } catch {
        await this.markFailed(id, scopeKey, idempotencyKey);
        await this.cleanupFailedObject(id, objectKey, 'upload');
        throw storageUnavailable();
      }
    } finally {
      try {
        if (staged) await staged.cleanup();
      } finally {
        this.activeUploads--;
      }
    }
  }

  async download(evidenceId: string, trackingCode: string | undefined, trackingSecret: string | undefined, request: Request): Promise<{ url: string; expires_in: number }> {
    const rows = await this.dataSource.query(
      `SELECT e.id,e.request_id,e.mission_id,e.object_key,e.state,
              r.tracking_code,r.reporter_user_id,r.organization_id,r.region_code,r.campaign_id,m.team_id
         FROM evidence_metadata e
         LEFT JOIN mission m ON m.id=e.mission_id
         JOIN assistance_request r ON r.id=coalesce(e.request_id,m.request_id)
        WHERE e.id=$1 AND e.state='READY'`, [evidenceId],
    ) as Array<{
      id: string; request_id: string | null; mission_id: string | null; object_key: string; state: string;
      tracking_code: string; reporter_user_id: string | null; organization_id: string; region_code: string | null;
      campaign_id: string | null; team_id: string | null;
    }>;
    const evidence = rows[0];
    if (!evidence) throw new AppError('NOT_FOUND', { status: 404 });
    const session = await this.sessions.optional(request, this.access.validTrackingSecret(trackingSecret));
    const staffAllowed = session && hasPermission(session.grants, 'REQUEST_DETAIL_READ', {
      organizationId: evidence.organization_id, regionCode: evidence.region_code, campaignId: evidence.campaign_id,
    });
    if (evidence.mission_id) {
      if (!session) throw new AppError('UNAUTHENTICATED', { status: 401 });
      const memberRows = evidence.team_id
        ? await this.dataSource.query(
          'SELECT 1 FROM team_member WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1',
          [evidence.team_id, session.userId],
        ) as unknown[]
        : [];
      const coordinatorAllowed = hasPermission(session.grants, 'MISSION_RECORD_ON_BEHALF', {
        organizationId: evidence.organization_id, regionCode: evidence.region_code, campaignId: evidence.campaign_id,
      });
      if (!memberRows.length && !staffAllowed && !coordinatorAllowed) throw new AppError('FORBIDDEN', { status: 403 });
    } else {
      if (!evidence.request_id) throw new AppError('INTERNAL_ERROR', { status: 500 });
      if (!staffAllowed) await this.access.forRequest(evidence.request_id, trackingCode, trackingSecret, session);
    }
    try {
      return { url: await this.storage.signedGetUrl(evidence.object_key, this.storageConfig.signedUrlTtlSeconds), expires_in: this.storageConfig.signedUrlTtlSeconds };
    } catch {
      throw storageUnavailable();
    }
  }

  async reconcilePending(): Promise<number> {
    let objects: Array<{ id: string; object_key: string }> = [];
    const ran = await this.jobs.runOnce('response.evidence.reconcile.pending', async (manager) => {
      const [rows] = await manager.query(
        `WITH candidates AS (
           SELECT id,state FROM evidence_metadata
            WHERE created_at<clock_timestamp()-interval '15 minutes'
              AND (state='PENDING' OR (state='FAILED' AND cleanup_completed_at IS NULL))
            ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
         ), failed AS (
           UPDATE evidence_metadata e SET state='FAILED'
             FROM candidates c WHERE e.id=c.id AND e.state='PENDING'
             RETURNING e.id,e.object_key
         )
         SELECT id,object_key FROM failed
         UNION ALL
         SELECT e.id,e.object_key FROM evidence_metadata e JOIN candidates c ON c.id=e.id
          WHERE c.state='FAILED' AND e.state='FAILED' AND e.cleanup_completed_at IS NULL`,
      ) as [Array<{ id: string; object_key: string }>, number];
      objects = rows;
      return rows.length;
    });
    if (!ran) return 0;
    await Promise.all(objects.map(({ id, object_key }) => this.cleanupFailedObject(id, object_key, 'reconcile')));
    return objects.length;
  }

  private async cleanupFailedObject(id: string, key: string, source: 'upload' | 'reconcile'): Promise<void> {
    try {
      await this.storage.deleteObject(key);
      await this.dataSource.query(
        "UPDATE evidence_metadata SET cleanup_completed_at=clock_timestamp() WHERE id=$1 AND state='FAILED' AND cleanup_completed_at IS NULL",
        [id],
      );
    } catch {
      this.logger.warn(`STORAGE_CLEANUP_FAILED response.evidence.${source}`);
    }
  }

  private async reserveQuota(manager: EntityManager, requestId: string, sourceIpHash: string | null, declaredBytes: number): Promise<void> {
    const ownerRows = await manager.query(
      `SELECT count(*)::int AS count,coalesce(sum(coalesce(size_bytes,declared_bytes)),0)::text AS used
         FROM evidence_metadata e
        WHERE (e.request_id=$1 OR e.mission_id IN (SELECT id FROM mission WHERE request_id=$1))
          AND e.state IN ('PENDING','READY')`, [requestId],
    ) as Array<{ count: number; used: string }>;
    const owner = ownerRows[0];
    if (!owner || owner.count >= requestAttachmentCountLimit || Number(owner.used) + declaredBytes > ownerAttachmentByteLimit) {
      throw new AppError('EVIDENCE_LIMIT_REACHED', { status: 409 });
    }
    if (sourceIpHash) {
      const ipRows = await manager.query(
        `SELECT coalesce(sum(declared_bytes),0)::text AS used FROM evidence_metadata
          WHERE upload_source_ip_hash=$1 AND created_at>=clock_timestamp()-interval '1 hour'`, [sourceIpHash],
      ) as Array<{ used: string }>;
      if (!ipRows[0] || Number(ipRows[0].used) + declaredBytes > guestHourlyByteLimit) {
        throw new AppError('EVIDENCE_LIMIT_REACHED', { status: 409 });
      }
    }
  }

  private async markFailed(id: string, scopeKey: string, key: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query("UPDATE evidence_metadata SET state='FAILED' WHERE id=$1 AND state='PENDING'", [id]);
      await manager.query(
        `UPDATE idempotency_record SET response_status=503
          WHERE scope_key=$1 AND command='response.evidence.upload' AND idempotency_key=$2`, [scopeKey, key],
      );
    });
  }

  private async waitUntilReady(id: string): Promise<EvidenceView> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const rows = await this.dataSource.query(
        'SELECT id,request_id,mission_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at FROM evidence_metadata WHERE id=$1', [id],
      ) as EvidenceRow[];
      const row = rows[0];
      if (!row || row.state === 'FAILED') throw storageUnavailable();
      if (row.state === 'READY') return view(row);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw storageUnavailable();
  }

  private async missionUploadOwner(
    queryable: Pick<DataSource | EntityManager, 'query'>,
    missionId: string,
    session: ReporterSession,
    lockRequest = false,
  ): Promise<MissionUploadOwner> {
    const rows = await queryable.query(
      `SELECT m.request_id,m.team_id,m.status AS mission_status,
              r.review_lane,r.status,r.organization_id,r.region_code,r.campaign_id,
              t.reporting_mode AS team_reporting_mode,t.status AS team_status
         FROM mission m
         JOIN assistance_request r ON r.id=m.request_id
         JOIN rescue_team t ON t.id=m.team_id
        WHERE m.id=$1${lockRequest ? ' FOR UPDATE OF r' : ''}`, [missionId],
    ) as MissionUploadOwner[];
    const owner = rows[0];
    if (!owner) throw new AppError('NOT_FOUND', { status: 404 });
    if (owner.team_status !== 'ACTIVE') throw new AppError('TEAM_NOT_ELIGIBLE', { status: 409 });

    const memberRows = await queryable.query(
      `SELECT member_role FROM team_member
        WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1`,
      [owner.team_id, session.userId],
    ) as Array<{ member_role: 'LEADER' | 'MEMBER' }>;
    const isLeader = owner.team_reporting_mode === 'APP' && memberRows[0]?.member_role === 'LEADER';
    const isScopedCoordinator = hasPermission(session.grants, 'MISSION_RECORD_ON_BEHALF', {
      organizationId: owner.organization_id, regionCode: owner.region_code, campaignId: owner.campaign_id,
    });
    if (!isLeader && !isScopedCoordinator) throw new AppError('FORBIDDEN', { status: 403 });
    return owner;
  }
}
