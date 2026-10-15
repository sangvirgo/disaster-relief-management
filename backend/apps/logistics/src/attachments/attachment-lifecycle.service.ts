import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyService, IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency/idempotency';
import { JobRunner } from '../../../../packages/technical/src/persistence/jobs';
import { EvidenceMime } from '../../../../packages/technical/src/media/evidence-media';
import { stageEvidenceMultipart, StagedEvidenceFile } from '../../../../packages/technical/src/uploads/evidence-upload';
import { AttachmentStorage, LOGISTICS_ATTACHMENT_STORAGE } from './attachment-storage';

const maxMultipartBytes = 55 * 1024 * 1024;
const signedUrlTtlSeconds = 60;

export interface AttachmentRecord {
  id: string;
  delivery_id: string | null;
  dispute_id: string | null;
  handoff_id: string | null;
  object_key: string;
  state: 'PENDING' | 'READY' | 'FAILED';
  declared_bytes: number | string;
  size_bytes: number | string | null;
  detected_mime: EvidenceMime | null;
  checksum: string | null;
  created_at: Date | string;
}

interface UploadCommand {
  command: string;
  scopeKey: string;
  requestHash(file: StagedEvidenceFile): string;
  reserve(manager: EntityManager, file: StagedEvidenceFile): Promise<{ id: string; objectKey: string }>;
  replay(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>>;
  afterStage?(file: StagedEvidenceFile): void;
}

function storageUnavailable(): AppError {
  return new AppError('STORAGE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function readyView(row: AttachmentRecord): Record<string, unknown> {
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
export class AttachmentLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentLifecycleService.name);
  private readonly jobs: JobRunner;
  private activeUploads = 0;
  private stopSchedule?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    @Inject(LOGISTICS_ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
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
    request: Request & { idempotencyKey?: string },
    command: UploadCommand,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    const declaredBytes = this.declaredBodyBytes(request);
    if (this.activeUploads >= 20) throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: 1 });
    this.activeUploads++;
    let staged: StagedEvidenceFile | undefined;
    try {
      staged = await stageEvidenceMultipart(request, declaredBytes);
      command.afterStage?.(staged);
      return await this.uploadStagedFile(request, staged, command);
    } finally {
      this.activeUploads--;
      if (staged) await staged.cleanup().catch(() => this.logger.warn('UPLOAD_TEMP_CLEANUP_FAILED logistics.attachment'));
    }
  }

  async signedDownload(key: string, mime: EvidenceMime): Promise<{ url: string; expires_in: number }> {
    try {
      return {
        url: await this.storage.signedGetUrl(key, mime, signedUrlTtlSeconds),
        expires_in: signedUrlTtlSeconds,
      };
    } catch {
      throw storageUnavailable();
    }
  }

  async ownerKind(attachmentId: string): Promise<'DONATION' | 'HANDOFF'> {
    const rows = await this.dataSource.query(
      "SELECT handoff_id FROM logistics_attachment WHERE id=$1 AND state='READY'", [attachmentId],
    ) as Array<{ handoff_id: string | null }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0].handoff_id ? 'HANDOFF' : 'DONATION';
  }

  readyView(row: AttachmentRecord): Record<string, unknown> {
    return readyView(row);
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
        this.logger.warn('STORAGE_CLEANUP_FAILED logistics.attachment.reconcile');
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

  private async uploadStagedFile(
    request: Request & { idempotencyKey?: string },
    stagedFile: StagedEvidenceFile,
    command: UploadCommand,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const result = await this.idempotency.execute(this.dataSource, {
      scopeKey: command.scopeKey,
      command: command.command,
      key: request.idempotencyKey!,
      requestHash: command.requestHash(stagedFile),
      execute: async (manager) => {
        const reserved = await command.reserve(manager, stagedFile);
        return {
          status: 201,
          value: { id: reserved.id, state: 'PENDING', object_key: reserved.objectKey },
          resource: { type: 'logistics_attachment', id: reserved.id },
        };
      },
      replay: command.replay,
    });
    if (result.status >= 500) throw storageUnavailable();
    if (result.replay) {
      return { status: 201, value: await this.waitUntilReady(String(result.value.id)), replay: true };
    }

    const attachmentId = String(result.value.id);
    const objectKey = String(result.value.object_key ?? '');
    if (!objectKey) throw storageUnavailable();
    try {
      await this.storage.putObject(objectKey, stagedFile.path, stagedFile.size, stagedFile.mime, stagedFile.checksum);
    } catch {
      await this.failUpload(attachmentId, objectKey, command.scopeKey, request.idempotencyKey!, command.command);
      throw storageUnavailable();
    }

    let rows: AttachmentRecord[];
    try {
      [rows] = await this.dataSource.query(
        `UPDATE logistics_attachment SET state='READY',size_bytes=$2,detected_mime=$3,checksum=$4
          WHERE id=$1 AND state='PENDING'
          RETURNING id,delivery_id,dispute_id,handoff_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at`,
        [attachmentId, stagedFile.size, stagedFile.mime, stagedFile.checksum],
      ) as [AttachmentRecord[], number];
    } catch {
      throw storageUnavailable();
    }
    if (!rows[0]) throw storageUnavailable();
    return { status: 201, value: readyView(rows[0]), replay: false };
  }

  private async failUpload(
    id: string,
    objectKey: string,
    scopeKey: string,
    idempotencyKey: string,
    command: string,
  ): Promise<void> {
    let deleted = false;
    try {
      await this.storage.deleteObject(objectKey);
      deleted = true;
    } catch {
      this.logger.warn(`STORAGE_CLEANUP_FAILED ${command}`);
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        if (deleted) await manager.query("UPDATE logistics_attachment SET state='FAILED' WHERE id=$1 AND state='PENDING'", [id]);
        await manager.query(
          `UPDATE idempotency_record SET response_status=503
            WHERE scope_key=$1 AND command=$2 AND idempotency_key=$3`,
          [scopeKey, command, idempotencyKey],
        );
      });
    } catch {
      this.logger.warn(`ATTACHMENT_FAILURE_STATE_FAILED ${command}`);
    }
  }

  private async waitUntilReady(id: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const rows = await this.dataSource.query(
        `SELECT id,delivery_id,dispute_id,handoff_id,object_key,state,declared_bytes,size_bytes,detected_mime,checksum,created_at
           FROM logistics_attachment WHERE id=$1`, [id],
      ) as AttachmentRecord[];
      const row = rows[0];
      if (!row || row.state === 'FAILED') throw storageUnavailable();
      if (row.state === 'READY') return readyView(row);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw storageUnavailable();
  }
}
