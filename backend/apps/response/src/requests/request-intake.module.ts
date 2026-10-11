import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency';
import { RequestIntakeController } from './request-intake.controller';
import { loadRequestIntakeConfig, REQUEST_INTAKE_CONFIG, RequestIntakeService } from './request-intake.service';

@Module({
  controllers: [RequestIntakeController],
  providers: [
    { provide: REQUEST_INTAKE_CONFIG, useFactory: () => loadRequestIntakeConfig() },
    IdempotencyService,
    RequestIntakeService,
  ],
  exports: [REQUEST_INTAKE_CONFIG, IdempotencyService],
})
export class RequestIntakeModule {}
