import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '@c48/technical';
import { InitialIdentity1710000000000 } from './database/migrations/InitialIdentity1710000000000';
import { AddPendingEmailRegistration1792953600001 } from './database/migrations/AddPendingEmailRegistration1792953600001';
import { AddAuthEmailOtpGoogle1792953600000 } from './database/migrations/AddAuthEmailOtpGoogle1792953600000';
import { GrantExternalIdentitySelect1794144543000 } from './database/migrations/GrantExternalIdentitySelect1794144543000';
import { RemoveRegionScope1794700800000 } from './database/migrations/RemoveRegionScope1794700800000';
import { RemoveOrganizationIdentity1794787200000 } from './database/migrations/RemoveOrganizationIdentity1794787200000';
import { AddCampaignCoordinatorRole1794960000000 } from './database/migrations/AddCampaignCoordinatorRole1794960000000';
import { RetireLegacyStaffRoles1795046400000 } from './database/migrations/RetireLegacyStaffRoles1795046400000';
import { RetireCampaignCoordinatorRole1795132800000 } from './database/migrations/RetireCampaignCoordinatorRole1795132800000';
import { AddPasswordResetOtp1795651200000 } from './database/migrations/AddPasswordResetOtp1795651200000';
import { AllowSubCoordinatorGrant1795694400000 } from './database/migrations/AllowSubCoordinatorGrant1795694400000';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { IdentityDashboardModule } from './dashboard/dashboard.module';
import { GrantsModule } from './grants/grants.module';
import { InternalModule } from './internal/internal.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialIdentity1710000000000, AddAuthEmailOtpGoogle1792953600000, AddPendingEmailRegistration1792953600001, GrantExternalIdentitySelect1794144543000, RemoveRegionScope1794700800000, RemoveOrganizationIdentity1794787200000, AddCampaignCoordinatorRole1794960000000, RetireLegacyStaffRoles1795046400000, RetireCampaignCoordinatorRole1795132800000, AddPasswordResetOtp1795651200000, AllowSubCoordinatorGrant1795694400000], 'identity')),
    HealthModule,
    AuthModule,
    UsersModule,
    GrantsModule,
    AuditModule,
    IdentityDashboardModule,
    InternalModule,
  ],
})
export class AppModule {}
