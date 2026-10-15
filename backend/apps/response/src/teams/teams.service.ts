import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { AddTeamMemberDto, CreateTeamDto, SetTeamPositionDto, TeamPageQueryDto, TransferTeamLeaderDto, UpdateTeamDto } from './teams.dto';
import { TeamsProfileService } from './teams-profile.service';
import { TeamsPositionService } from './teams-position.service';
import { TeamsQueriesService } from './teams-queries.service';
import { TeamsMembershipService } from './teams-membership.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly queries: TeamsQueriesService,
    private readonly profile: TeamsProfileService,
    private readonly position: TeamsPositionService,
    private readonly membership: TeamsMembershipService,
  ) {}

  skills(request: Request): Promise<Record<string, unknown>> {
    return this.queries.skills(request);
  }

  list(query: TeamPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.list(query, request);
  }

  detail(teamId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.detail(teamId, request);
  }

  create(dto: CreateTeamDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.profile.create(dto, key, request as Request & { idempotencyKey?: string });
  }

  update(teamId: string, dto: UpdateTeamDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.profile.update(teamId, dto, key, request as Request & { idempotencyKey?: string });
  }

  setPosition(teamId: string, dto: SetTeamPositionDto, request: Request): Promise<void> {
    return this.position.set(teamId, dto, request);
  }

  addMember(teamId: string, dto: AddTeamMemberDto, key: string, request: Request) {
    return this.membership.addMember(teamId, dto, key, request as Request & { idempotencyKey?: string });
  }

  removeMember(teamId: string, userId: string, key: string, request: Request) {
    return this.membership.removeMember(teamId, userId, key, request as Request & { idempotencyKey?: string });
  }

  transferLeader(teamId: string, dto: TransferTeamLeaderDto, key: string, request: Request) {
    return this.membership.transferLeader(teamId, dto, key, request as Request & { idempotencyKey?: string });
  }
}
