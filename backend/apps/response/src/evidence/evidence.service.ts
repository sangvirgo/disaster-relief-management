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
import { ReporterSessionService } from '../requests/reporter-session';
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
  request_id: string;
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

function uploadEligible(row: ReporterRequestRow): boolean {
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

function evidenceKey(requestId: string, evidenceId: string): string {
  return `req/${requestId}/${evidenceId}`;
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
      const quotaIpHash = session ? null : sourceIpHash;
      const capabilityHash = hasTrackingCapability ? this.access.trackingSecretHash(trackingSecret!) : undefined;
      scopeKey = `response.evidence.request:${requestId}:${session?.userId ?? 'guest'}`;
      const requestHash = canonicalRequestHash({
        request_id: requestId, uploader_user_id: session?.userId ?? null, declared_bytes: declaredBytes,
        file_bytes: staged.size, detected_mime: staged.mime, checksum: staged.checksum,
      }, capabilityHash);
      const result = await this.idempotency.execute(this.dataSource, {
        scopeKey,
        command: 'response.evidence.upload',
        key: idempotencyKey,
        requestHash,
        execute: async (manager) => {
          if (quotaIpHash) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [quotaIpHash]);
          const lockedOwner = await this.access.forRequest(requestId, trackingCode, trackingSecret, session, manager, true);
          if (!uploadEligible(lockedOwner)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
          await this.reserveQuota(manager, requestId, quotaIpHash, declaredBytes);
          evidenceId = randomUUID();
          objectKey = evidenceKey(requestId, evidenceId);
          await manager.query(
            `INSERT INTO evidence_metadata
              (id,request_id,object_key,state,declared_bytes,uploader_user_id,upload_source_ip_hash)
             VALUES ($1,$2,$3,'PENDING',$4,$5,$6)`,
            [evidenceId, requestId, objectKey, declaredBytes, session?.userId ?? null, sourceIpHash],
          );
          return { status: 201, value: { id: evidenceId, state: 'PENDING' }, resource: { type: 'evidence_metadata', id: evidenceId } };
        },
        replay: async (manager, resource) => {
          if (resource?.type !== 'evidence_metadata') throw new AppError('INTERNAL_ERROR', { status: 500 });
          const rows = await manager.query('SELECT id,request_id,state,declared_bytes,size_bytes,detected_mime,checksum,created_at,object_key FROM evidence_metadata WHERE id=$1', [resource.id]) as EvidenceRow[];
          const row = rows[0];
          if (!row || row.request_id !== requestId) throw new AppError('NOT_FOUND', { status: 404 });
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
      objectKey = evidenceKey(requestId, id);
      try {
        await this.storage.putObject(objectKey, staged.path, staged.size, staged.mime, staged.checksum);
        const [rows] = await this.dataSource.query(
          `UPDATE evidence_metadata SET state='READY',size_bytes=$2,detected_mime=$3,checksum=$4
            WHERE id=$1 AND state='PENDING'
            RETURNING id,request_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at`,
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
      `SELECT e.id,e.request_id,e.object_key,e.state,r.tracking_code,r.reporter_user_id,r.organization_id,r.region_code,r.campaign_id
         FROM evidence_metadata e JOIN assistance_request r ON r.id=e.request_id
        WHERE e.id=$1 AND e.state='READY'`, [evidenceId],
    ) as Array<{ id: string; request_id: string; object_key: string; state: string; tracking_code: string; reporter_user_id: string | null; organization_id: string; region_code: string | null; campaign_id: string | null }>;
    const evidence = rows[0];
    if (!evidence) throw new AppError('NOT_FOUND', { status: 404 });
    const session = await this.sessions.optional(request, this.access.validTrackingSecret(trackingSecret));
    const staffAllowed = session && hasPermission(session.grants, 'REQUEST_DETAIL_READ', {
      organizationId: evidence.organization_id, regionCode: evidence.region_code, campaignId: evidence.campaign_id,
    });
    if (!staffAllowed) await this.access.forRequest(evidence.request_id, trackingCode, trackingSecret, session);
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
         FROM evidence_metadata WHERE request_id=$1 AND state IN ('PENDING','READY')`, [requestId],
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
        'SELECT id,request_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at FROM evidence_metadata WHERE id=$1', [id],
      ) as EvidenceRow[];
      const row = rows[0];
      if (!row || row.state === 'FAILED') throw storageUnavailable();
      if (row.state === 'READY') return view(row);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw storageUnavailable();
  }
}
