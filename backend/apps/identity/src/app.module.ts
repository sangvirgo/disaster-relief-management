import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialIdentity1710000000000 } from './database/migrations/InitialIdentity1710000000000';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialIdentity1710000000000])),
    HealthModule,
  ],
})
export class AppModule {}
