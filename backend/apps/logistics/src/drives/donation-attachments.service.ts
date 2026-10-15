import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { EvidenceMime } from '../../../../packages/technical/src/media/evidence-media';
import { AuthenticatedLogisticsSession, LogisticsSessionService } from '../auth/logistics-session.service';
import {
  DONATION_SECRET_CONFIG, DonationSecretConfig, donationCapabilityHash, verifyDonationCapability,
} from './donations.helpers';
import { AttachmentLifecycleService } from '../attachments/attachment-lifecycle.service';

const attachmentCountLimit = 5;
const attachmentBytesLimit = 100 * 1024 * 1024;
const guestHourlyBytesLimit = 50 * 1024 * 1024;
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

interface DonationAttachmentRow {
  id: string;
  delivery_id: string | null;
  dispute_id: string | null;
  handoff_id: null;
  object_key: string;
  state: 'PENDING' | 'READY' | 'FAILED';
  declared_bytes: number | string;
  size_bytes: number | string | null;
  detected_mime: EvidenceMime | null;
  checksum: string | null;
  created_at: Date | string;
}

interface DonationAttachmentOwner extends DeliveryRow {
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

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function hasCredential(request: Request): boolean {
  return Boolean(request.headers.authorization || request.headers.cookie);
}

@Injectable()
export class DonationAttachmentsService {
  private readonly quotaKey = randomBytes(32);
  private readonly guestQuota = new Map<string, GuestQuotaEntry>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
    @Inject(DONATION_SECRET_CONFIG) private readonly secretConfig: DonationSecretConfig,
    private readonly lifecycle: AttachmentLifecycleService,
  ) {}

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
    const scopeKey = session ? `user:${session.userId}` : `donation-capability:${deliveryId}:${capabilityHash}`;
    return this.lifecycle.upload(request, {
      command: 'logistics.donation-attachments.upload',
      scopeKey,
      requestHash: (file) => canonicalRequestHash({
        delivery_id: deliveryId,
        dispute_id: disputeId ?? null,
        uploader_user_id: session?.userId ?? null,
        file_bytes: file.size,
        detected_mime: file.mime,
        checksum: file.checksum,
      }, capabilityHash ?? undefined),
      afterStage: (file) => {
        if (!session || delivery.donor_user_id !== session.userId) this.reserveGuestIpBytes(requestIp(request), file.size);
      },
      reserve: async (manager, file) => {
        const lockedDelivery = await this.findDelivery(manager, deliveryId, true);
        this.assertDonorAccess(lockedDelivery, session, secret);
        if (disputeId) await this.assertDisputeOwner(manager, disputeId, deliveryId);
        await this.reserveOwnerQuota(manager, deliveryId, file.size);
        const id = randomUUID();
        const objectKey = `donation/${deliveryId}/${id}`;
        await manager.query(
          `INSERT INTO logistics_attachment (id,delivery_id,dispute_id,object_key,state,declared_bytes,uploader_user_id)
           VALUES ($1,$2,$3,$4,'PENDING',$5,$6)`,
          [id, disputeId ? null : deliveryId, disputeId ?? null, objectKey, file.size, session?.userId ?? null],
        );
        return { id, objectKey };
      },
      replay: (manager, resource) => this.replayUpload(manager, resource, deliveryId, disputeId),
    });
  }

  async download(
    attachmentId: string,
    secret: string | undefined,
    request: Request,
  ): Promise<{ url: string; expires_in: number }> {
    const rows = await this.dataSource.query(
      `SELECT a.id AS attachment_id,a.delivery_id AS attachment_delivery_id,a.dispute_id AS attachment_dispute_id,
              a.object_key,a.state,a.size_bytes,a.detected_mime,a.checksum,a.created_at,
              dd.id,dd.public_code,dd.donor_user_id,dd.capability_hash,dd.organization_id,
              w.region_code,d.campaign_id
         FROM logistics_attachment a
         LEFT JOIN donation_dispute dispute ON dispute.id=a.dispute_id
         JOIN donation_delivery dd ON dd.id=coalesce(a.delivery_id,dispute.delivery_id)
         JOIN donation_drive d ON d.id=dd.drive_id
         JOIN warehouse w ON w.id=d.intake_warehouse_id
        WHERE a.id=$1 AND a.state='READY' AND a.handoff_id IS NULL`, [attachmentId],
    ) as DonationAttachmentOwner[];
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
    return this.lifecycle.signedDownload(attachment.object_key, attachment.detected_mime);
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

  private async replayUpload(
    manager: Pick<EntityManager, 'query'>,
    resource: ResourceRef | null,
    deliveryId: string,
    disputeId?: string,
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'logistics_attachment') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      `SELECT id,delivery_id,dispute_id,handoff_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at
         FROM logistics_attachment WHERE id=$1 AND ${disputeId ? 'dispute_id=$3' : 'delivery_id=$2'} AND ${disputeId ? 'EXISTS (SELECT 1 FROM donation_dispute WHERE id=$3 AND delivery_id=$2)' : 'TRUE'}`,
      disputeId ? [resource.id, deliveryId, disputeId] : [resource.id, deliveryId],
    ) as DonationAttachmentRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    return row.state === 'READY' ? this.lifecycle.readyView(row) : { id: row.id, state: row.state };
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

  private async findDelivery(
    query: Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>,
    id: string,
    forUpdate = false,
  ): Promise<DeliveryRow> {
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
