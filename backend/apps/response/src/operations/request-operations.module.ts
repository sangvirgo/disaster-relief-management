import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { RequestOperationsController } from './request-operations.controller';
import { RequestOperationsService, REQUEST_OPERATIONS_CONFIG } from './request-operations.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [RequestOperationsController],
  providers: [
    { provide: REQUEST_OPERATIONS_CONFIG, useFactory: () => RequestOperationsService.config() },
    RequestOperationsService,
  ],
  exports: [RequestOperationsService],
})
export class RequestOperationsModule {}
