import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityAdminSupport, IdentityPermissionGuard, IdentityServiceGuard } from './admin-security';

@Module({
  imports: [AuthModule],
  providers: [IdentityAdminSupport, IdentityPermissionGuard, IdentityServiceGuard],
  exports: [AuthModule, IdentityAdminSupport, IdentityPermissionGuard, IdentityServiceGuard],
})
export class AdminSecurityModule {}
