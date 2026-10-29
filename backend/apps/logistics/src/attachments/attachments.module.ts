import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import {
  createAttachmentStorage, loadAttachmentStorageConfig, LOGISTICS_ATTACHMENT_STORAGE,
} from './attachment-storage';
import { AttachmentLifecycleService } from './attachment-lifecycle.service';

const attachmentStorageConfig = Symbol('LOGISTICS_ATTACHMENT_STORAGE_CONFIG');

@Module({
  providers: [
    IdempotencyService,
    AttachmentLifecycleService,
    { provide: attachmentStorageConfig, useFactory: () => loadAttachmentStorageConfig() },
    {
      provide: LOGISTICS_ATTACHMENT_STORAGE,
      useFactory: createAttachmentStorage,
      inject: [attachmentStorageConfig],
    },
  ],
  exports: [AttachmentLifecycleService],
})
export class AttachmentsModule {}
