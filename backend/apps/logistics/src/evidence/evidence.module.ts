import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { DrivesModule } from '../drives/drives.module';
import { EvidenceController } from './evidence.controller';

@Module({
  imports: [AttachmentsModule, DrivesModule],
  controllers: [EvidenceController],
})
export class EvidenceModule {}
