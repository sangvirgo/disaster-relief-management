import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { ReporterSession, ReporterSessionService } from '../requests/reporter-session';
import { AddTeamMemberDto, TeamMemberCandidatesQueryDto, TeamMembersPageQueryDto, TransferTeamLeaderDto } from './teams.dto';
import { teamView, TeamRow, validateExpectedVersion } from './teams.helpers';
import { TeamsQueriesService } from './teams-queries.service';

type TeamCommandRequest = Request & { idempotencyKey?: string };
type MemberRole = 'LEADER' | 'MEMBER';
type MemberRow = { user_id?: string; member_role: MemberRole; left_at: Date | string | null };
type TeamMembershipView = { team_id: string; user_id: string; member_role: MemberRole; joined_at: string };
type TeamMemberListRow = { user_id: string; member_role: MemberRole; joined_at: Date | string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const memberErrorMappings = {
  unique: {
    team_member_one_team_uq: 'USER_IN_OTHER_TEAM',
    team_one_leader_uq: 'LEADER_REQUIRED',
  },
};

function membershipEntityId(teamId: string, userId: string): string {
  return `${teamId}:${userId}`;
}

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return parsed.toISOString();
}

@Injectable()
export class TeamsMembershipService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    private readonly queries: TeamsQueriesService,
  ) {}

  async listMembers(teamId: string, dto: TeamMembersPageQueryDto, request: TeamCommandRequest) {
    const session = await this.sessions.require(request);
    const team = await this.findTeam(this.dataSource, teamId);
    const canManageMembers = await this.canManage(team, session);
    if (!canManageMembers) await this.assertCanRead(team, session);

    const filters = { route: 'response.team.members', team_id: teamId, user_id: session.userId, grants: session.grants };
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : undefined;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' ||
        !uuidPattern.test(cursor.id) || String(cursor.sort[0]).toLowerCase() !== cursor.id.toLowerCase())) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }

    const limit = dto.limit ?? 50;
    const rows = await this.dataSource.query(
      `SELECT tm.user_id,tm.member_role,
              COALESCE((SELECT a.created_at FROM audit_log a
                         WHERE a.entity_type='team_member' AND a.entity_id=($1::text || ':' || tm.user_id::text)
                           AND a.action='TEAM_MEMBER_ADDED'
                         ORDER BY a.created_at DESC,a.id DESC LIMIT 1),$3::timestamptz) AS joined_at
         FROM team_member tm
        WHERE tm.team_id=$1 AND tm.left_at IS NULL
          AND ($2::uuid IS NULL OR tm.user_id>$2::uuid)
        ORDER BY tm.user_id ASC LIMIT $4`,
      [teamId, cursor?.sort[0] ?? null, team.created_at, limit + 1],
    ) as TeamMemberListRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const profiles = await this.sessions.lookupUsers(page.map(({ user_id }) => user_id));
    const displayNames = new Map(profiles.map(({ id, display_name }) => [id, display_name]));
    const last = page.at(-1);

    return {
      team_id: teamId,
      can_manage_members: canManageMembers,
      items: page.map((row) => ({
        user_id: row.user_id,
        display_name: displayNames.get(row.user_id)!,
        member_role: row.member_role,
        joined_at: timestamp(row.joined_at),
      })),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.user_id], last.user_id, filters) } : {}),
    };
  }

  async listMemberCandidates(teamId: string, dto: TeamMemberCandidatesQueryDto, request: TeamCommandRequest) {
    const session = await this.sessions.require(request);
    const team = await this.findTeam(this.dataSource, teamId);
    await this.assertCanManage(team, session);

    const query = dto.query.trim().toLowerCase();
    const filters = { route: 'response.team.member-candidates', team_id: teamId, user_id: session.userId, grants: session.grants, query };
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : undefined;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' ||
        cursor.id.toLowerCase() !== teamId.toLowerCase())) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }

    const page = await this.sessions.searchActiveUsers(query, cursor?.sort[0] as string | undefined, dto.limit ?? 50);
    const ids = page.items.map(({ id }) => id);
    const assigned = ids.length ? await this.dataSource.query(
      'SELECT user_id FROM team_member WHERE user_id=ANY($1::uuid[]) AND left_at IS NULL', [ids],
    ) as Array<{ user_id: string }> : [];
    const assignedIds = new Set(assigned.map(({ user_id }) => user_id));

    return {
      items: page.items.filter(({ id }) => !assignedIds.has(id)).map(({ id, username, display_name }) => ({
        user_id: id, username, display_name,
      })),
      more: page.more,
      ...(page.cursor ? { cursor: encodeKeysetCursor([page.cursor], teamId, filters) } : {}),
    };
  }

  async addMember(
    teamId: string,
    dto: AddTeamMemberDto,
    key: string,
    request: TeamCommandRequest,
  ): Promise<IdempotentResult<TeamMembershipView>> {
    const session = await this.sessions.require(request);
    const team = await this.findTeam(this.dataSource, teamId);
    await this.assertCanManage(team, session);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.team:${teamId}:${session.userId}`,
      command: 'response.teams.members.add',
      key,
      requestHash: canonicalRequestHash({ team_id: teamId, actor_user_id: session.userId, dto }),
      databaseErrorMappings: memberErrorMappings,
      execute: async (manager) => {
        const account = await this.sessions.activeUserCheck(dto.user_id);
        if (!account.active) {
          if (account.reason === 'USER_NOT_FOUND') throw new AppError('NOT_FOUND', { status: 404 });
          throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        }
        const lockedTeam = await this.findTeam(manager, teamId, true);
        await this.assertCanManage(lockedTeam, session, manager);
        const activeTeams = await manager.query(
          'SELECT team_id FROM team_member WHERE user_id=$1 AND left_at IS NULL FOR UPDATE',
          [dto.user_id],
        ) as Array<{ team_id: string }>;
        if (activeTeams.some(({ team_id: activeTeamId }) => activeTeamId !== teamId)) {
          throw new AppError('USER_IN_OTHER_TEAM', { status: 409 });
        }

        const currentRows = await manager.query(
          'SELECT member_role,left_at FROM team_member WHERE team_id=$1 AND user_id=$2 FOR UPDATE',
          [teamId, dto.user_id],
        ) as MemberRow[];
        const current = currentRows[0];
        if (current?.left_at === null) {
          const joinedAt = await this.latestJoinedAt(manager, teamId, dto.user_id, lockedTeam.created_at);
          const membershipState = {
            team_id: teamId, user_id: dto.user_id, member_role: current.member_role, left_at: null,
          };
          await this.auditMember(
            manager,
            session.userId,
            'TEAM_MEMBER_ADD_CONFIRMED',
            teamId,
            dto.user_id,
            membershipState,
            { ...membershipState, joined_at: joinedAt, idempotency_key: key },
          );
          return {
            status: 201,
            value: { team_id: teamId, user_id: dto.user_id, member_role: current.member_role, joined_at: joinedAt },
            resource: { type: 'team_member', id: dto.user_id },
          };
        }

        let before: Record<string, unknown> | null = null;
        if (current) {
          before = { team_id: teamId, user_id: dto.user_id, member_role: current.member_role, left_at: current.left_at };
          await manager.query(
            `UPDATE team_member SET member_role='MEMBER',left_at=NULL WHERE team_id=$1 AND user_id=$2 RETURNING member_role`,
            [teamId, dto.user_id],
          );
        } else {
          await manager.query(
            `INSERT INTO team_member (team_id,user_id,member_role) VALUES ($1,$2,'MEMBER') RETURNING member_role`,
            [teamId, dto.user_id],
          );
        }
        const joinedAt = await this.auditMember(
          manager,
          session.userId,
          'TEAM_MEMBER_ADDED',
          teamId,
          dto.user_id,
          before,
          { team_id: teamId, user_id: dto.user_id, member_role: 'MEMBER', idempotency_key: key },
        );
        return {
          status: 201,
          value: { team_id: teamId, user_id: dto.user_id, member_role: 'MEMBER', joined_at: joinedAt },
          resource: { type: 'team_member', id: dto.user_id },
        };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'team_member' || resource.id !== dto.user_id) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return this.replayAddedMember(manager, teamId, dto.user_id, key);
      },
    });
  }

  async removeMember(
    teamId: string,
    userId: string,
    key: string,
    request: TeamCommandRequest,
  ): Promise<IdempotentResult<null>> {
    const session = await this.sessions.require(request);
    const team = await this.findTeam(this.dataSource, teamId);
    await this.assertCanManage(team, session);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.team:${teamId}:${session.userId}`,
      command: 'response.teams.members.remove',
      key,
      requestHash: canonicalRequestHash({ team_id: teamId, actor_user_id: session.userId, user_id: userId }),
      databaseErrorMappings: memberErrorMappings,
      execute: async (manager) => {
        const lockedTeam = await this.findTeam(manager, teamId, true);
        await this.assertCanManage(lockedTeam, session, manager);
        const rows = await manager.query(
          'SELECT member_role,left_at FROM team_member WHERE team_id=$1 AND user_id=$2 FOR UPDATE',
          [teamId, userId],
        ) as MemberRow[];
        const member = rows[0];
        if (!member || member.left_at !== null) throw new AppError('NOT_FOUND', { status: 404 });
        if (member.member_role === 'LEADER') throw new AppError('LEADER_REQUIRED', { status: 409 });
        const [updated] = await manager.query(
          `UPDATE team_member SET left_at=transaction_timestamp() WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL RETURNING left_at`,
          [teamId, userId],
        ) as [Array<{ left_at: Date | string }>, number];
        if (!updated?.[0]) throw new AppError('NOT_FOUND', { status: 404 });
        await this.auditMember(manager, session.userId, 'TEAM_MEMBER_REMOVED', teamId, userId,
          { team_id: teamId, user_id: userId, member_role: member.member_role },
          { team_id: teamId, user_id: userId, member_role: member.member_role, left_at: updated[0].left_at });
        return { status: 204, value: null, resource: null };
      },
      replay: async () => null,
    });
  }

  async transferLeader(
    teamId: string,
    dto: TransferTeamLeaderDto,
    key: string,
    request: TeamCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const team = await this.findTeam(this.dataSource, teamId);
    this.assertCanTransfer(team, session);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.team:${teamId}:${session.userId}`,
      command: 'response.teams.leader.transfer',
      key,
      requestHash: canonicalRequestHash({ team_id: teamId, actor_user_id: session.userId, dto }),
      databaseErrorMappings: memberErrorMappings,
      execute: async (manager) => {
        await this.assertEligibleLeader(dto.user_id, team.organization_id);
        const lockedTeam = await this.findTeam(manager, teamId, true);
        this.assertCanTransfer(lockedTeam, session);
        validateExpectedVersion(Number(lockedTeam.version), dto.expected_version);
        const targets = await manager.query(
          'SELECT member_role FROM team_member WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL FOR UPDATE',
          [teamId, dto.user_id],
        ) as Array<{ member_role: MemberRole }>;
        if (!targets[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const leaders = await manager.query(
          `SELECT user_id FROM team_member WHERE team_id=$1 AND member_role='LEADER' AND left_at IS NULL FOR UPDATE`,
          [teamId],
        ) as Array<{ user_id: string }>;
        const oldLeaderId = leaders[0]?.user_id ?? null;
        let version = Number(lockedTeam.version);
        if (oldLeaderId !== dto.user_id) {
          if (oldLeaderId) {
            await manager.query(
              `UPDATE team_member SET member_role='MEMBER' WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL RETURNING user_id`,
              [teamId, oldLeaderId],
            );
          }
          await manager.query(
            `UPDATE team_member SET member_role='LEADER' WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL RETURNING user_id`,
            [teamId, dto.user_id],
          );
          const [updated] = await manager.query(
            'UPDATE rescue_team SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version',
            [teamId, dto.expected_version],
          ) as [Array<{ version: number }>, number];
          if (!updated?.[0]) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(lockedTeam.version) } });
          version = Number(updated[0].version);
          await this.audit(manager, session.userId, 'TEAM_LEADER_TRANSFERRED', 'rescue_team', teamId,
            { leader_user_id: oldLeaderId, version: Number(lockedTeam.version) },
            { leader_user_id: dto.user_id, version, idempotency_key: key });
        } else {
          const state = { leader_user_id: dto.user_id, version };
          await this.audit(manager, session.userId, 'TEAM_LEADER_TRANSFER_CONFIRMED', 'rescue_team', teamId,
            state, { ...state, idempotency_key: key });
        }
        return {
          status: 200,
          value: { team_id: teamId, leader_user_id: dto.user_id, version },
          resource: { type: 'rescue_team', id: teamId },
        };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'rescue_team' || resource.id !== teamId) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return this.replayLeaderTransfer(manager, teamId, key);
      },
    });
  }

  private async findTeam(queryable: DataSource | EntityManager, teamId: string, forUpdate = false): Promise<TeamRow> {
    const team = await this.queries.findTeam(queryable, teamId, forUpdate);
    if (!team) throw new AppError('NOT_FOUND', { status: 404 });
    return team;
  }

  private async assertCanManage(
    team: TeamRow,
    session: ReporterSession,
    queryable: Pick<DataSource | EntityManager, 'query'> = this.dataSource,
  ): Promise<void> {
    if (await this.canManage(team, session, queryable)) return;
    throw new AppError('FORBIDDEN', { status: 403 });
  }

  private async canManage(
    team: TeamRow,
    session: ReporterSession,
    queryable: Pick<DataSource | EntityManager, 'query'> = this.dataSource,
  ): Promise<boolean> {
    if (hasPermission(session.grants, 'TEAM_MANAGE_ANY', {
      organizationId: team.organization_id, regionCode: team.operating_region_code,
    })) return true;
    const leaders = await queryable.query(
      `SELECT 1 FROM team_member WHERE team_id=$1 AND user_id=$2 AND member_role='LEADER' AND left_at IS NULL LIMIT 1`,
      [team.id, session.userId],
    ) as unknown[];
    return leaders.length > 0;
  }

  private async assertCanRead(team: TeamRow, session: ReporterSession): Promise<void> {
    if (hasPermission(session.grants, 'TEAM_READ', {
      organizationId: team.organization_id, regionCode: team.operating_region_code,
    })) return;
    const members = await this.dataSource.query(
      'SELECT 1 FROM team_member WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1',
      [team.id, session.userId],
    ) as unknown[];
    if (!members.length) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private assertCanTransfer(team: TeamRow, session: ReporterSession): void {
    if (!hasPermission(session.grants, 'TEAM_MANAGE_ANY', {
      organizationId: team.organization_id, regionCode: team.operating_region_code,
    })) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private async assertEligibleLeader(userId: string, organizationId: string): Promise<void> {
    const result = await this.sessions.teamLeaderEligibility(userId, organizationId);
    if (result.eligible) return;
    if (result.reason === 'USER_NOT_FOUND') throw new AppError('NOT_FOUND', { status: 404 });
    throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  }

  private async latestJoinedAt(manager: EntityManager, teamId: string, userId: string, fallback: Date | string): Promise<string> {
    const rows = await manager.query(
      `SELECT created_at FROM audit_log
        WHERE entity_type='team_member' AND entity_id=$1 AND action='TEAM_MEMBER_ADDED'
        ORDER BY created_at DESC,id DESC LIMIT 1`,
      [membershipEntityId(teamId, userId)],
    ) as Array<{ created_at: Date | string }>;
    return timestamp(rows[0]?.created_at ?? fallback);
  }

  private async replayAddedMember(
    manager: EntityManager,
    teamId: string,
    userId: string,
    key: string,
  ): Promise<TeamMembershipView> {
    const rows = await manager.query(
      `SELECT after_state,created_at FROM audit_log
        WHERE entity_type='team_member' AND entity_id=$1
          AND action IN ('TEAM_MEMBER_ADDED','TEAM_MEMBER_ADD_CONFIRMED')
          AND after_state->>'idempotency_key'=$2
        ORDER BY id DESC LIMIT 1`,
      [membershipEntityId(teamId, userId), key],
    ) as Array<{ after_state: Record<string, unknown>; created_at: Date | string }>;
    const row = rows[0];
    const snapshot = row?.after_state;
    if (!row || !snapshot || snapshot.team_id !== teamId || snapshot.user_id !== userId ||
        (snapshot.member_role !== 'LEADER' && snapshot.member_role !== 'MEMBER')) {
      throw new AppError('INTERNAL_ERROR', { status: 500 });
    }
    const joinedAt = typeof snapshot.joined_at === 'string' ? timestamp(snapshot.joined_at) : timestamp(row.created_at);
    return { team_id: teamId, user_id: userId, member_role: snapshot.member_role, joined_at: joinedAt };
  }

  private async replayLeaderTransfer(
    manager: EntityManager,
    teamId: string,
    key: string,
  ): Promise<Record<string, unknown>> {
    const rows = await manager.query(
      `SELECT after_state FROM audit_log
        WHERE entity_type='rescue_team' AND entity_id=$1
          AND action IN ('TEAM_LEADER_TRANSFERRED','TEAM_LEADER_TRANSFER_CONFIRMED')
          AND after_state->>'idempotency_key'=$2
        ORDER BY id DESC LIMIT 1`,
      [teamId, key],
    ) as Array<{ after_state: Record<string, unknown> }>;
    const snapshot = rows[0]?.after_state;
    if (!snapshot || typeof snapshot.leader_user_id !== 'string' || typeof snapshot.version !== 'number') {
      throw new AppError('INTERNAL_ERROR', { status: 500 });
    }
    return { team_id: teamId, leader_user_id: snapshot.leader_user_id, version: snapshot.version };
  }

  private async auditMember(
    manager: EntityManager,
    actorId: string,
    action: string,
    teamId: string,
    userId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Promise<string> {
    const rows = await manager.query(
      `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
       VALUES ($1,$2,'team_member',$3,$4::jsonb,$5::jsonb) RETURNING created_at`,
      [actorId, action, membershipEntityId(teamId, userId), before ? JSON.stringify(before) : null, JSON.stringify(after)],
    ) as Array<{ created_at: Date | string }>;
    if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return timestamp(rows[0].created_at);
  }

  private async audit(
    manager: EntityManager,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [actorId, action, entityType, entityId, JSON.stringify(before), JSON.stringify(after)],
    );
  }
}
