import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { TrackingModule } from '../tracking/tracking.module';
import { EvidenceController } from './evidence.controller';
import { createEvidenceStorage, loadEvidenceStorageConfig, RESPONSE_EVIDENCE_STORAGE } from './evidence-storage';
import { EvidenceService } from './evidence.service';

export const EVIDENCE_STORAGE_CONFIG = 'EVIDENCE_STORAGE_CONFIG';

@Module({
  imports: [RequestIntakeModule, TrackingModule],
  controllers: [EvidenceController],
  providers: [
    { provide: EVIDENCE_STORAGE_CONFIG, useFactory: () => loadEvidenceStorageConfig() },
    { provide: RESPONSE_EVIDENCE_STORAGE, useFactory: (config: ReturnType<typeof loadEvidenceStorageConfig>) => createEvidenceStorage(config), inject: [EVIDENCE_STORAGE_CONFIG] },
    EvidenceService,
  ],
})
export class EvidenceModule {}
