import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { IdentityDashboardController } from './dashboard.controller';
import { IdentityDashboardService } from './dashboard.service';

@Module({ imports: [AdminSecurityModule], controllers: [IdentityDashboardController], providers: [IdentityDashboardService] })
export class IdentityDashboardModule {}
