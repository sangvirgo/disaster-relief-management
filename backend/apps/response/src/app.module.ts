import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialResponse1710000000000 } from './database/migrations/InitialResponse1710000000000';
import { AddRequestSourceIpIndex1710000000001 } from './database/migrations/AddRequestSourceIpIndex1710000000001';
import { RequestIntakeModule } from './requests/request-intake.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialResponse1710000000000, AddRequestSourceIpIndex1710000000001], 'response')),
    HealthModule,
    RequestIntakeModule,
  ],
})
export class AppModule {}
