import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { TeamsController } from './teams.controller';
import { TeamsProfileService } from './teams-profile.service';
import { TeamsQueriesService } from './teams-queries.service';
import { TeamsService } from './teams.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsQueriesService, TeamsProfileService],
  exports: [TeamsService],
})
export class TeamsModule {}
