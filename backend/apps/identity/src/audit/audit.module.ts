import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({ imports: [AdminSecurityModule], controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
