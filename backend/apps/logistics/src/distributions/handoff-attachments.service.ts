import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { EvidenceMime } from '../../../../packages/technical/src/media/evidence-media';
import { AttachmentLifecycleService, AttachmentRecord } from '../attachments/attachment-lifecycle.service';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { requireHandoffPermission } from './handoff-permissions.helpers';
import { hasWarehouseScope } from '../stock/stock.scope';

const attachmentCountLimit = 5;
const attachmentBytesLimit = 100 * 1024 * 1024;

interface HandoffAttachmentOwner {
  handoff_id: string;
  distribution_id: string;
  handoff_kind: 'DIRECT_HOUSEHOLD' | 'POINT_RECEIPT' | 'HOUSEHOLD_HANDOUT' | 'RETURN' | 'LOSS';
  organization_id: string;
  warehouse_region_code: string;
}

interface HandoffEvidenceRow extends Omit<AttachmentRecord, 'detected_mime'> {
  detected_mime: EvidenceMime;
  handoff_kind: HandoffAttachmentOwner['handoff_kind'];
  organization_id: string;
  warehouse_region_code: string;
}

@Injectable()
export class HandoffAttachmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
    private readonly lifecycle: AttachmentLifecycleService,
  ) {}

  async uploadHandoff(
    distributionId: string,
    handoffId: string,
    request: Request & { idempotencyKey?: string },
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const owner = await this.findHandoff(this.dataSource, distributionId, handoffId);
    requireHandoffPermission(session.grants, owner.handoff_kind === 'RETURN' ? 'RETURN' : 'HANDOFF_RECORD', owner);
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });

    return this.lifecycle.upload(request, {
      command: 'logistics.handoff-attachments.upload',
      scopeKey: `user:${session.userId}`,
      requestHash: (file) => canonicalRequestHash({
        distribution_id: distributionId,
        handoff_id: handoffId,
        uploader_user_id: session.userId,
        file_bytes: file.size,
        detected_mime: file.mime,
        checksum: file.checksum,
      }),
      reserve: async (manager, file) => {
        const lockedOwner = await this.findHandoff(manager, distributionId, handoffId, true);
        requireHandoffPermission(session.grants, lockedOwner.handoff_kind === 'RETURN' ? 'RETURN' : 'HANDOFF_RECORD', lockedOwner);
        await this.reserveQuota(manager, handoffId, file.size);
        const id = randomUUID();
        const objectKey = `handoff/${distributionId}/${handoffId}/${id}`;
        await manager.query(
          `INSERT INTO logistics_attachment (id,handoff_id,object_key,state,declared_bytes,uploader_user_id)
           VALUES ($1,$2,$3,'PENDING',$4,$5)`,
          [id, handoffId, objectKey, file.size, session.userId],
        );
        return { id, objectKey };
      },
      replay: (manager, resource) => this.replayUpload(manager, resource, distributionId, handoffId),
    });
  }

  async download(attachmentId: string, request: Request): Promise<{ url: string; expires_in: number }> {
    const rows = await this.dataSource.query(
      `SELECT a.id,a.delivery_id,a.dispute_id,a.handoff_id,a.object_key,a.state,a.declared_bytes,
              a.size_bytes,a.detected_mime,a.checksum,a.created_at,h.handoff_kind,d.organization_id,
              w.region_code AS warehouse_region_code
         FROM logistics_attachment a JOIN handoff_record h ON h.id=a.handoff_id
         JOIN distribution d ON d.id=h.distribution_id JOIN warehouse w ON w.id=d.warehouse_id
        WHERE a.id=$1 AND a.state='READY'`, [attachmentId],
    ) as HandoffEvidenceRow[];
    const attachment = rows[0];
    if (!attachment) throw new AppError('NOT_FOUND', { status: 404 });
    const session = await this.sessions.require(request);
    const inScope = hasWarehouseScope(session.grants, attachment.organization_id, attachment.warehouse_region_code);
    const allowed = inScope && (
      (attachment.handoff_kind === 'RETURN' && (
        hasPermission(session.grants, 'DONATION_INTAKE', {
          organizationId: attachment.organization_id, regionCode: attachment.warehouse_region_code,
        }) || hasPermission(session.grants, 'DISTRIBUTION_DISPATCH', {
          organizationId: attachment.organization_id, regionCode: attachment.warehouse_region_code,
        })
      )) ||
      (attachment.handoff_kind !== 'RETURN' && hasPermission(session.grants, 'HANDOFF_RECORD', {
        organizationId: attachment.organization_id, regionCode: attachment.warehouse_region_code,
      })) ||
      (attachment.handoff_kind === 'LOSS' && hasPermission(session.grants, 'LOSS_APPROVE', {
        organizationId: attachment.organization_id, regionCode: attachment.warehouse_region_code,
      }))
    );
    if (!allowed) throw new AppError('FORBIDDEN', { status: 403 });
    return this.lifecycle.signedDownload(attachment.object_key, attachment.detected_mime);
  }

  private async reserveQuota(manager: EntityManager, handoffId: string, fileBytes: number): Promise<void> {
    const rows = await manager.query(
      `SELECT count(*)::int AS count,coalesce(sum(coalesce(size_bytes,declared_bytes)),0)::text AS used
         FROM logistics_attachment
        WHERE state IN ('PENDING','READY') AND handoff_id=$1`,
      [handoffId],
    ) as Array<{ count: number; used: string }>;
    const quota = rows[0];
    if (!quota || quota.count >= attachmentCountLimit || Number(quota.used) + fileBytes > attachmentBytesLimit) {
      throw new AppError('EVIDENCE_LIMIT_REACHED', { status: 409 });
    }
  }

  private async replayUpload(
    manager: Pick<EntityManager, 'query'>,
    resource: ResourceRef | null,
    distributionId: string,
    handoffId: string,
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'logistics_attachment') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      `SELECT id,delivery_id,dispute_id,handoff_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at
         FROM logistics_attachment WHERE id=$1 AND handoff_id=$2
           AND EXISTS (SELECT 1 FROM handoff_record WHERE id=$2 AND distribution_id=$3)`,
      [resource.id, handoffId, distributionId],
    ) as AttachmentRecord[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    return row.state === 'READY' ? this.lifecycle.readyView(row) : { id: row.id, state: row.state };
  }

  private async findHandoff(
    query: Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>,
    distributionId: string,
    handoffId: string,
    forUpdate = false,
  ): Promise<HandoffAttachmentOwner> {
    const rows = await query.query(
      `SELECT h.id AS handoff_id,h.distribution_id,h.handoff_kind,d.organization_id,w.region_code AS warehouse_region_code
         FROM handoff_record h JOIN distribution d ON d.id=h.distribution_id
         JOIN warehouse w ON w.id=d.warehouse_id
        WHERE h.distribution_id=$1 AND h.id=$2${forUpdate ? ' FOR UPDATE OF d' : ''}`,
      [distributionId, handoffId],
    ) as HandoffAttachmentOwner[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }
}
