import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { SupplyCandidatesController } from './supply-candidates.controller';
import { SupplyCandidatesService } from './supply-candidates.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [SupplyCandidatesController],
  providers: [SupplyCandidatesService],
})
export class SupplyCandidatesModule {}
