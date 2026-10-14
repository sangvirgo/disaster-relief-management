import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { ReporterSessionService, ReporterSession } from '../requests/reporter-session';
import { CreateTeamDto, UpdateTeamDto } from './teams.dto';
import { teamView, TeamRow, validateExpectedVersion } from './teams.helpers';
import { TeamsQueriesService } from './teams-queries.service';

type TeamCommandRequest = Request & { idempotencyKey?: string };

const memberErrorMappings = {
  unique: {
    team_member_one_team_uq: 'USER_IN_OTHER_TEAM',
    team_one_leader_uq: 'LEADER_REQUIRED',
  },
};

function cleanName(value: string): string {
  const normalized = value.trim();
  if (!normalized || value !== value.normalize('NFC')) throw new AppError('VALIDATION_FAILED', { status: 400 });
  return normalized;
}

function auditState(team: TeamRow): Record<string, unknown> {
  return {
    id: team.id,
    name: team.name,
    kind: team.team_kind,
    reporting_mode: team.reporting_mode,
    availability: team.availability,
    status: team.status,
    version: Number(team.version),
    skills: team.skills ?? [],
  };
}

@Injectable()
export class TeamsProfileService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    private readonly queries: TeamsQueriesService,
  ) {}

  async create(dto: CreateTeamDto, key: string, request: TeamCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    if (!hasPermission(session.grants, 'TEAM_MANAGE_ANY', {
      organizationId: dto.organization_id, regionCode: dto.operating_region_code,
    })) throw new AppError('FORBIDDEN', { status: 403 });

    const name = cleanName(dto.name);
    if (dto.reporting_mode === 'COORDINATOR' && !dto.external_contact_note?.trim()) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if (dto.reporting_mode === 'APP' && !dto.leader_user_id) {
      throw new AppError('LEADER_REQUIRED', { status: 409 });
    }

    await this.assertRegion(dto.operating_region_code);
    const skillCodes = [...dto.skill_codes].sort();
    await this.assertSkills(skillCodes);
    if (dto.leader_user_id) await this.assertEligibleLeader(dto.leader_user_id, dto.organization_id);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.team:create:${session.userId}`,
      command: 'response.teams.create',
      key,
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, dto }),
      databaseErrorMappings: memberErrorMappings,
      execute: async (manager) => {
        const inserted = await manager.query(
          `INSERT INTO rescue_team
             (organization_id,operating_region_code,name,team_kind,reporting_mode,external_contact_note)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [dto.organization_id, dto.operating_region_code, name, dto.team_kind, dto.reporting_mode, dto.external_contact_note ?? null],
        ) as Array<{ id: string }>;
        const teamId = inserted[0]?.id;
        if (!teamId) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.replaceSkills(manager, teamId, skillCodes);
        if (dto.leader_user_id) {
          await manager.query(
            `INSERT INTO team_member (team_id,user_id,member_role) VALUES ($1,$2,'LEADER')`,
            [teamId, dto.leader_user_id],
          );
        }
        const team = await this.queries.findTeam(manager, teamId);
        if (!team) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.audit(manager, session.userId, 'TEAM_CREATED', teamId, null, auditState(team));
        return { status: 201, value: teamView(team), resource: { type: 'rescue_team', id: teamId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'rescue_team') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const team = await this.queries.findTeam(manager, resource.id);
        if (!team) throw new AppError('NOT_FOUND', { status: 404 });
        return teamView(team);
      },
    });
  }

  async update(teamId: string, dto: UpdateTeamDto, key: string, request: TeamCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const current = await this.queries.findTeam(this.dataSource, teamId);
    if (!current) throw new AppError('NOT_FOUND', { status: 404 });
    await this.assertCanManage(current, session);
    if (dto.name === undefined && dto.skill_codes === undefined && dto.availability === undefined) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const name = dto.name === undefined ? undefined : cleanName(dto.name);
    const skillCodes = dto.skill_codes === undefined ? undefined : [...dto.skill_codes].sort();
    if (skillCodes) await this.assertSkills(skillCodes);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.team:${teamId}:${session.userId}`,
      command: 'response.teams.update',
      key,
      requestHash: canonicalRequestHash({ team_id: teamId, actor_user_id: session.userId, dto }),
      execute: async (manager) => {
        const row = await this.queries.findTeam(manager, teamId, true);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        await this.assertCanManage(row, session, manager);
        validateExpectedVersion(Number(row.version), dto.expected_version);
        if (dto.availability === 'AVAILABLE' && row.readiness_required) {
          throw new AppError('TEAM_NOT_ELIGIBLE', { status: 409, details: { reason: 'UNAVAILABLE' } });
        }
        if (dto.availability === 'AVAILABLE' || dto.availability === 'UNAVAILABLE') {
          const activeStatuses = dto.availability === 'UNAVAILABLE'
            ? "status='OFFERED'"
            : "status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE')";
          const active = await manager.query(
            `SELECT 1 FROM mission WHERE team_id=$1 AND ${activeStatuses} LIMIT 1`,
            [teamId],
          ) as unknown[];
          if (active.length) throw new AppError('TEAM_BUSY', { status: 409 });
        }
        const before = auditState(row);
        const [updated] = await manager.query(
          `UPDATE rescue_team
              SET name=COALESCE($3,name),availability=COALESCE($4,availability),version=version+1
            WHERE id=$1 AND version=$2
            RETURNING id`,
          [teamId, dto.expected_version, name ?? null, dto.availability ?? null],
        ) as [Array<{ id: string }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        if (skillCodes) await this.replaceSkills(manager, teamId, skillCodes);
        const next = await this.queries.findTeam(manager, teamId);
        if (!next) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.audit(manager, session.userId, 'TEAM_UPDATED', teamId, before, auditState(next));
        return { status: 200, value: teamView(next), resource: { type: 'rescue_team', id: teamId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'rescue_team') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const team = await this.queries.findTeam(manager, resource.id);
        if (!team) throw new AppError('NOT_FOUND', { status: 404 });
        return teamView(team);
      },
    });
  }

  private async assertRegion(regionCode: string): Promise<void> {
    const rows = await this.dataSource.query('SELECT 1 FROM region_boundary WHERE region_code=$1', [regionCode]) as unknown[];
    if (!rows.length) throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { operating_region_code: ['Mã khu vực không hợp lệ hoặc chưa được cấu hình.'] } });
  }

  private async assertSkills(codes: string[]): Promise<void> {
    if (!codes.length) return;
    const rows = await this.dataSource.query('SELECT code FROM skill WHERE code=ANY($1::text[])', [codes]) as Array<{ code: string }>;
    if (rows.length !== codes.length) throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { skill_codes: ['Mã kỹ năng không hợp lệ hoặc không tồn tại.'] } });
  }

  private async assertEligibleLeader(userId: string, organizationId: string): Promise<void> {
    const result = await this.sessions.teamLeaderEligibility(userId, organizationId);
    if (result.eligible) return;
    if (result.reason === 'USER_NOT_FOUND') throw new AppError('NOT_FOUND', { status: 404 });
    if (result.reason === 'USER_INACTIVE') {
      throw new AppError('TEAM_NOT_ELIGIBLE', { status: 409, details: { reason: 'INACTIVE' } });
    }
    throw new AppError('LEADER_REQUIRED', { status: 409 });
  }

  private async assertCanManage(team: TeamRow, session: ReporterSession, queryable: Pick<DataSource | EntityManager, 'query'> = this.dataSource): Promise<void> {
    if (hasPermission(session.grants, 'TEAM_MANAGE_ANY', {
      organizationId: team.organization_id, regionCode: team.operating_region_code,
    })) return;
    const leaders = await queryable.query(
      `SELECT 1 FROM team_member WHERE team_id=$1 AND user_id=$2 AND member_role='LEADER' AND left_at IS NULL LIMIT 1`,
      [team.id, session.userId],
    ) as unknown[];
    if (!leaders.length) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private async replaceSkills(manager: EntityManager, teamId: string, codes: string[]): Promise<void> {
    await manager.query('DELETE FROM team_skill WHERE team_id=$1', [teamId]);
    if (codes.length) {
      await manager.query(
        `INSERT INTO team_skill (team_id,skill_code)
         SELECT $1,code FROM unnest($2::text[]) AS code`,
        [teamId, codes],
      );
    }
  }

  private async audit(
    manager: EntityManager, actorId: string, action: string, teamId: string,
    before: Record<string, unknown> | null, after: Record<string, unknown>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
       VALUES ($1,$2,'rescue_team',$3,$4::jsonb,$5::jsonb)`,
      [actorId, action, teamId, before ? JSON.stringify(before) : null, JSON.stringify(after)],
    );
  }
}
