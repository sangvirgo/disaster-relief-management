import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialLogistics1710000000000 } from './database/migrations/InitialLogistics1710000000000';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialLogistics1710000000000])),
    HealthModule,
  ],
})
export class AppModule {}
