import { Module } from '@nestjs/common';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({ imports: [LogisticsAuthModule], controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
