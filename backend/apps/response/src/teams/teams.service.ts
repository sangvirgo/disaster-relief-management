import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { CreateTeamDto, TeamPageQueryDto, UpdateTeamDto } from './teams.dto';
import { TeamsProfileService } from './teams-profile.service';
import { TeamsQueriesService } from './teams-queries.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly queries: TeamsQueriesService,
    private readonly profile: TeamsProfileService,
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
}
