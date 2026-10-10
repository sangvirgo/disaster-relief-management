import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';

@Module({
  imports: [AdminSecurityModule],
  controllers: [InternalController],
  providers: [InternalService],
})
export class InternalModule {}
