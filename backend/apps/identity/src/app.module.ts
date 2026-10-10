import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialIdentity1710000000000 } from './database/migrations/InitialIdentity1710000000000';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialIdentity1710000000000], 'identity')),
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
