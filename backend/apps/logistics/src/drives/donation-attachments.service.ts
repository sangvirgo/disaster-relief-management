import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency/idempotency';
import { JobRunner } from '../../../../packages/technical/src/persistence/jobs';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { hashPurposeBoundSecret } from '../../../../packages/technical/src/security/secret-hash';
import { EvidenceMime } from '../../../../packages/technical/src/media/evidence-media';
import { stageEvidenceMultipart, StagedEvidenceFile } from '../../../../packages/technical/src/uploads/evidence-upload';
import { AuthenticatedLogisticsSession, LogisticsSessionService } from '../auth/logistics-session.service';
import { DONATION_SECRET_CONFIG, DonationSecretConfig, donationCapabilityHash, verifyDonationCapability } from './donations.helpers';
import { DonationAttachmentStorage, LOGISTICS_ATTACHMENT_STORAGE } from './donation-attachment-storage';

const attachmentCountLimit = 5;
const attachmentBytesLimit = 100 * 1024 * 1024;
const guestHourlyBytesLimit = 50 * 1024 * 1024;
const maxMultipartBytes = 55 * 1024 * 1024;
const signedUrlTtlSeconds = 60;
const quotaWindowMs = 60 * 60_000;
const maxRememberedIps = 10_000;

interface DeliveryRow {
  id: string;
  public_code: string;
  donor_user_id: string | null;
  capability_hash: string | null;
  organization_id: string;
  region_code: string;
  campaign_id: string | null;
}

interface AttachmentRow {
  id: string;
  delivery_id: string | null;
  dispute_id: string | null;
  object_key: string;
  state: 'PENDING' | 'READY' | 'FAILED';
  declared_bytes: number | string;
  size_bytes: number | string | null;
  detected_mime: EvidenceMime | null;
  checksum: string | null;
  created_at: Date | string;
}

interface AttachmentOwner extends DeliveryRow {
  attachment_id: string;
  attachment_delivery_id: string | null;
  attachment_dispute_id: string | null;
  object_key: string;
  state: 'READY';
  size_bytes: number | string;
  detected_mime: EvidenceMime;
  checksum: string;
  created_at: Date | string;
}

interface GuestQuotaEntry {
  startedAt: number;
  bytes: number;
}

function storageUnavailable(): AppError {
  return new AppError('STORAGE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function hasCredential(request: Request): boolean {
  return Boolean(request.headers.authorization || request.headers.cookie);
}

function attachmentView(row: AttachmentRow): Record<string, unknown> {
  if (row.state !== 'READY' || row.size_bytes === null || !row.detected_mime || !row.checksum) {
    throw storageUnavailable();
  }
  return {
    id: row.id,
    state: 'READY',
    size_bytes: Number(row.size_bytes),
    detected_mime: row.detected_mime,
    checksum: row.checksum,
    created_at: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class DonationAttachmentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DonationAttachmentsService.name);
  private readonly jobs: JobRunner;
  private readonly quotaKey = randomBytes(32);
  private readonly guestQuota = new Map<string, GuestQuotaEntry>();
  private activeUploads = 0;
  private stopSchedule?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    @Inject(DONATION_SECRET_CONFIG) private readonly secretConfig: DonationSecretConfig,
    @Inject(LOGISTICS_ATTACHMENT_STORAGE) private readonly storage: DonationAttachmentStorage,
  ) {
    this.jobs = new JobRunner(dataSource, () => this.logger.warn('SCHEDULED_JOB_FAILED logistics.attachments.reconcile'));
  }

  onModuleInit(): void {
    this.stopSchedule = this.jobs.schedule(
      'logistics.attachments.reconcile.timer', 30_000,
      async () => { await this.reconcilePending(); },
    );
  }

  onModuleDestroy(): void {
    this.stopSchedule?.();
  }

  async upload(
    deliveryId: string,
    disputeId: string | undefined,
    secret: string | undefined,
    request: Request & { idempotencyKey?: string },
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.optionalSession(request);
    const delivery = await this.findDelivery(this.dataSource, deliveryId);
    this.assertDonorAccess(delivery, session, secret);
    const capabilityHash = donationCapabilityHash(secret, this.secretConfig);
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    const declaredBytes = this.declaredBodyBytes(request);
    if (this.activeUploads >= 20) throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: 1 });
    this.activeUploads++;
    let staged: StagedEvidenceFile | undefined;
    let attachmentId: string | undefined;
    let objectKey: string | undefined;
    let scopeKey = '';
    try {
      const stagedFile = await stageEvidenceMultipart(request, declaredBytes);
      staged = stagedFile;
      if (!session || delivery.donor_user_id !== session.userId) this.reserveGuestIpBytes(requestIp(request), stagedFile.size);
      scopeKey = session ? `user:${session.userId}` : `donation-capability:${deliveryId}:${capabilityHash}`;
      const requestHash = canonicalRequestHash({
        delivery_id: deliveryId,
        dispute_id: disputeId ?? null,
        uploader_user_id: session?.userId ?? null,
        file_bytes: stagedFile.size,
        detected_mime: stagedFile.mime,
        checksum: stagedFile.checksum,
      }, capabilityHash ?? undefined);
      const result = await this.idempotency.execute(this.dataSource, {
        scopeKey,
        command: 'logistics.donation-attachments.upload',
        key: request.idempotencyKey,
        requestHash,
        execute: async (manager) => {
          const lockedDelivery = await this.findDelivery(manager, deliveryId, true);
          this.assertDonorAccess(lockedDelivery, session, secret);
          if (disputeId) await this.assertDisputeOwner(manager, disputeId, deliveryId);
          await this.reserveOwnerQuota(manager, deliveryId, stagedFile.size);
          attachmentId = randomUUID();
          objectKey = `donation/${deliveryId}/${attachmentId}`;
          await manager.query(
            `INSERT INTO logistics_attachment (id,delivery_id,dispute_id,object_key,state,declared_bytes,uploader_user_id)
             VALUES ($1,$2,$3,$4,'PENDING',$5,$6)`,
            [attachmentId, disputeId ? null : deliveryId, disputeId ?? null, objectKey, stagedFile.size, session?.userId ?? null],
          );
          return { status: 201, value: { id: attachmentId, state: 'PENDING' }, resource: { type: 'logistics_attachment', id: attachmentId } };
        },
        replay: async (manager, resource) => this.replayUpload(manager, resource, deliveryId, disputeId),
      });
      if (result.status >= 500) throw storageUnavailable();
      if (result.replay) {
        return { status: 201, value: await this.waitUntilReady(String(result.value.id)), replay: true };
      }
      attachmentId = String(result.value.id);
      objectKey = `donation/${deliveryId}/${attachmentId}`;
      try {
        await this.storage.putObject(objectKey, stagedFile.path, stagedFile.size, stagedFile.mime, stagedFile.checksum);
      } catch {
        await this.failUpload(attachmentId, objectKey, scopeKey, request.idempotencyKey);
        throw storageUnavailable();
      }

      let rows: AttachmentRow[];
      try {
        [rows] = await this.dataSource.query(
          `UPDATE logistics_attachment SET state='READY',size_bytes=$2,detected_mime=$3,checksum=$4
            WHERE id=$1 AND state='PENDING'
            RETURNING id,delivery_id,dispute_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at`,
          [attachmentId, stagedFile.size, stagedFile.mime, stagedFile.checksum],
        ) as [AttachmentRow[], number];
      } catch {
        throw storageUnavailable();
      }
      if (!rows[0]) throw storageUnavailable();
      return { status: 201, value: attachmentView(rows[0]), replay: false };
    } finally {
      this.activeUploads--;
      if (staged) await staged.cleanup().catch(() => this.logger.warn('UPLOAD_TEMP_CLEANUP_FAILED logistics.donation_attachment'));
    }
  }

  async download(attachmentId: string, secret: string | undefined, request: Request): Promise<{ url: string; expires_in: number }> {
    const rows = await this.dataSource.query(
      `SELECT a.id AS attachment_id,a.delivery_id AS attachment_delivery_id,a.dispute_id AS attachment_dispute_id,
              a.object_key,a.state,a.size_bytes,a.detected_mime,a.checksum,a.created_at,
              dd.id,dd.public_code,dd.donor_user_id,dd.capability_hash,dd.organization_id,w.region_code,d.campaign_id
         FROM logistics_attachment a
         LEFT JOIN donation_dispute dispute ON dispute.id=a.dispute_id
         JOIN donation_delivery dd ON dd.id=coalesce(a.delivery_id,dispute.delivery_id)
         JOIN donation_drive d ON d.id=dd.drive_id
         JOIN warehouse w ON w.id=d.intake_warehouse_id
        WHERE a.id=$1 AND a.state='READY'`, [attachmentId],
    ) as AttachmentOwner[];
    const attachment = rows[0];
    if (!attachment) throw new AppError('NOT_FOUND', { status: 404 });
    const session = await this.optionalSession(request);
    const donorAllowed = (session && attachment.donor_user_id === session.userId) ||
      verifyDonationCapability(secret, attachment.capability_hash, this.secretConfig);
    const staffAllowed = session && (
      hasPermission(session.grants, 'DONATION_INTAKE', {
        organizationId: attachment.organization_id, regionCode: attachment.region_code, campaignId: attachment.campaign_id,
      }) || hasPermission(session.grants, 'DONATION_REVIEW', {
        organizationId: attachment.organization_id, regionCode: attachment.region_code, campaignId: attachment.campaign_id,
      })
    );
    if (!donorAllowed && !staffAllowed) {
      if (session) throw new AppError('FORBIDDEN', { status: 403 });
      throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
    }
    try {
      return {
        url: await this.storage.signedGetUrl(attachment.object_key, attachment.detected_mime, signedUrlTtlSeconds),
        expires_in: signedUrlTtlSeconds,
      };
    } catch {
      throw storageUnavailable();
    }
  }

  async reconcilePending(): Promise<number> {
    let pending: Array<{ id: string; object_key: string }> = [];
    const ran = await this.jobs.runOnce('logistics.attachments.reconcile.pending', async (manager) => {
      pending = await manager.query(
        `SELECT id,object_key FROM logistics_attachment
          WHERE state='PENDING' AND created_at<clock_timestamp()-interval '15 minutes'
          ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
      ) as Array<{ id: string; object_key: string }>;
      return pending.length;
    });
    if (!ran) return 0;
    await Promise.all(pending.map(async ({ id, object_key }) => {
      try {
        await this.storage.deleteObject(object_key);
        await this.dataSource.query("UPDATE logistics_attachment SET state='FAILED' WHERE id=$1 AND state='PENDING'", [id]);
      } catch {
        this.logger.warn('STORAGE_CLEANUP_FAILED logistics.donation_attachment.reconcile');
      }
    }));
    return pending.length;
  }

  private declaredBodyBytes(request: Request): number {
    const length = request.headers['content-length'];
    if (typeof length !== 'string' || !/^\d+$/u.test(length)) throw new AppError('LENGTH_REQUIRED', { status: 411 });
    const bytes = Number(length);
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new AppError('LENGTH_REQUIRED', { status: 411 });
    if (bytes > maxMultipartBytes) throw new AppError('PAYLOAD_TOO_LARGE', { status: 413 });
    return bytes;
  }

  private reserveGuestIpBytes(ip: string, bytes: number, now = Date.now()): void {
    // shortcut: this IP quota is process-local because logistics_attachment has no IP hash; persist a keyed quota before adding Logistics replicas.
    const key = createHmac('sha256', this.quotaKey).update(ip).digest('hex');
    const current = this.guestQuota.get(key);
    if (!current || now - current.startedAt >= quotaWindowMs) {
      if (!current && this.guestQuota.size >= maxRememberedIps) this.guestQuota.delete(this.guestQuota.keys().next().value!);
      if (bytes > guestHourlyBytesLimit) throw new AppError('RATE_LIMITED', { status: 429 });
      this.guestQuota.set(key, { startedAt: now, bytes });
      return;
    }
    if (current.bytes + bytes > guestHourlyBytesLimit) throw new AppError('RATE_LIMITED', { status: 429 });
    current.bytes += bytes;
    this.guestQuota.delete(key);
    this.guestQuota.set(key, current);
  }

  private async reserveOwnerQuota(manager: EntityManager, deliveryId: string, fileBytes: number): Promise<void> {
    const rows = await manager.query(
      `SELECT count(*)::int AS count,coalesce(sum(coalesce(size_bytes,declared_bytes)),0)::text AS used
         FROM logistics_attachment a
        WHERE a.state IN ('PENDING','READY')
          AND (a.delivery_id=$1 OR a.dispute_id IN (SELECT id FROM donation_dispute WHERE delivery_id=$1))`,
      [deliveryId],
    ) as Array<{ count: number; used: string }>;
    const quota = rows[0];
    if (!quota || quota.count >= attachmentCountLimit || Number(quota.used) + fileBytes > attachmentBytesLimit) {
      throw new AppError('EVIDENCE_LIMIT_REACHED', { status: 409 });
    }
  }

  private async failUpload(id: string, objectKey: string, scopeKey: string, idempotencyKey: string): Promise<void> {
    let deleted = false;
    try {
      await this.storage.deleteObject(objectKey);
      deleted = true;
    } catch {
      this.logger.warn('STORAGE_CLEANUP_FAILED logistics.donation_attachment.upload');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        if (deleted) await manager.query("UPDATE logistics_attachment SET state='FAILED' WHERE id=$1 AND state='PENDING'", [id]);
        await manager.query(
          `UPDATE idempotency_record SET response_status=503
            WHERE scope_key=$1 AND command='logistics.donation-attachments.upload' AND idempotency_key=$2`,
          [scopeKey, idempotencyKey],
        );
      });
    } catch {
      this.logger.warn('ATTACHMENT_FAILURE_STATE_FAILED logistics.donation_attachment.upload');
    }
  }

  private async replayUpload(
    manager: Pick<EntityManager, 'query'>,
    resource: ResourceRef | null,
    deliveryId: string,
    disputeId?: string,
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'logistics_attachment') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      `SELECT id,delivery_id,dispute_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at
         FROM logistics_attachment WHERE id=$1 AND ${disputeId ? 'dispute_id=$3' : 'delivery_id=$2'} AND ${disputeId ? 'EXISTS (SELECT 1 FROM donation_dispute WHERE id=$3 AND delivery_id=$2)' : 'TRUE'}`,
      disputeId ? [resource.id, deliveryId, disputeId] : [resource.id, deliveryId],
    ) as AttachmentRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    return row.state === 'READY' ? attachmentView(row) : { id: row.id, state: row.state };
  }

  private async waitUntilReady(id: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const rows = await this.dataSource.query(
        `SELECT id,delivery_id,dispute_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at
           FROM logistics_attachment WHERE id=$1`, [id],
      ) as AttachmentRow[];
      const row = rows[0];
      if (!row || row.state === 'FAILED') throw storageUnavailable();
      if (row.state === 'READY') return attachmentView(row);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw storageUnavailable();
  }

  private async assertDisputeOwner(manager: Pick<EntityManager, 'query'>, disputeId: string, deliveryId: string): Promise<void> {
    const rows = await manager.query('SELECT 1 FROM donation_dispute WHERE id=$1 AND delivery_id=$2', [disputeId, deliveryId]) as unknown[];
    if (!rows.length) throw new AppError('NOT_FOUND', { status: 404 });
  }

  private async optionalSession(request: Request): Promise<AuthenticatedLogisticsSession | null> {
    return hasCredential(request) ? this.sessions.require(request) : null;
  }

  private assertDonorAccess(delivery: DeliveryRow, session: AuthenticatedLogisticsSession | null, secret: string | undefined): void {
    if (session && delivery.donor_user_id === session.userId) return;
    if (verifyDonationCapability(secret, delivery.capability_hash, this.secretConfig)) return;
    throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
  }

  private async findDelivery(query: Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>, id: string, forUpdate = false): Promise<DeliveryRow> {
    const rows = await query.query(
      `SELECT dd.id,dd.public_code,dd.donor_user_id,dd.capability_hash,dd.organization_id,w.region_code,d.campaign_id
         FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
         JOIN warehouse w ON w.id=d.intake_warehouse_id WHERE dd.id=$1${forUpdate ? ' FOR UPDATE OF dd' : ''}`,
      [id],
    ) as DeliveryRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }
}
