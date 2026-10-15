import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [NoticesController],
  providers: [NoticesService],
})
export class NoticesModule {}
