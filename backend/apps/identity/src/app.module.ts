import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialIdentity1710000000000 } from './database/migrations/InitialIdentity1710000000000';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { GrantsModule } from './grants/grants.module';
import { InternalModule } from './internal/internal.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RegionsModule } from './regions/regions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialIdentity1710000000000], 'identity')),
    HealthModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    GrantsModule,
    RegionsModule,
    AuditModule,
    InternalModule,
  ],
})
export class AppModule {}
