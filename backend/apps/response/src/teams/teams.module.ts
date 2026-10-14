import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { TeamsController } from './teams.controller';
import { TeamsProfileService } from './teams-profile.service';
import { TeamsPositionService } from './teams-position.service';
import { TeamsQueriesService } from './teams-queries.service';
import { TeamsMembershipService } from './teams-membership.service';
import { TeamsService } from './teams.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsQueriesService, TeamsProfileService, TeamsPositionService, TeamsMembershipService],
  exports: [TeamsService],
})
export class TeamsModule {}
