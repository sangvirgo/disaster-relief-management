import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialResponse1710000000000 } from './database/migrations/InitialResponse1710000000000';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialResponse1710000000000])),
    HealthModule,
  ],
})
export class AppModule {}
