import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission, ROLE_PERMISSIONS } from '../../../../packages/identity-contracts/src/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import { TeamPageQueryDto } from './teams.dto';
import { teamView, TeamRow } from './teams.helpers';

const teamSelect = `SELECT t.id,t.organization_id,t.operating_region_code,t.name,t.team_kind,t.reporting_mode,
                           t.availability,t.status,t.readiness_required,t.version,t.created_at,
                           COALESCE(s.skills,ARRAY[]::text[]) AS skills,
                           CASE WHEN p.team_id IS NULL THEN NULL ELSE greatest(0,floor(extract(epoch FROM clock_timestamp()-p.captured_at)))::int END AS position_age_s,
                           p.accuracy_m AS position_accuracy_m,p.source AS position_source,
                           ST_X(p.location::geometry)::float8 AS longitude,ST_Y(p.location::geometry)::float8 AS latitude
                      FROM rescue_team t
                      LEFT JOIN LATERAL (SELECT array_agg(ts.skill_code ORDER BY ts.skill_code) AS skills
                                           FROM team_skill ts WHERE ts.team_id=t.id) s ON true
                      LEFT JOIN team_position p ON p.team_id=t.id`;

function listFilters(route: string, userId: string, grants: unknown[], query: object): Record<string, unknown> {
  const queryFilters = { ...(query as Record<string, unknown>) };
  delete queryFilters.cursor;
  return { route, user_id: userId, grants, query: queryFilters };
}

function readScopeSql(grants: readonly { role_code: keyof typeof ROLE_PERMISSIONS; scope_type: string; organization_id: string | null; region_code?: string | null; campaign_id?: string | null }[], userId: string, values: unknown[], alias = 't'): string {
  const branches: string[] = [];
  for (const grant of grants) {
    if (!ROLE_PERMISSIONS[grant.role_code].includes('TEAM_READ' as never) || !grant.organization_id) continue;
    if (grant.scope_type === 'ORGANIZATION') {
      values.push(grant.organization_id);
      branches.push(`${alias}.organization_id=$${values.length}`);
    } else if (grant.scope_type === 'REGION' && grant.region_code) {
      values.push(grant.organization_id, grant.region_code);
      branches.push(`(${alias}.organization_id=$${values.length - 1} AND ${alias}.operating_region_code=$${values.length})`);
    }
  }
  values.push(userId);
  branches.push(`EXISTS (SELECT 1 FROM team_member tm WHERE tm.team_id=${alias}.id AND tm.user_id=$${values.length} AND tm.left_at IS NULL)`);
  return `(${branches.join(' OR ')})`;
}

@Injectable()
export class TeamsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
  ) {}

  async skills(request: Request): Promise<Record<string, unknown>> {
    await this.sessions.require(request);
    const rows = await this.dataSource.query(
      'SELECT code,display_name FROM skill ORDER BY code',
    ) as Array<{ code: string; display_name: string }>;
    return { items: rows };
  }

  async list(query: TeamPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = listFilters('response.teams', session.userId, session.grants, query);
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const values: unknown[] = [];
    const conditions = [readScopeSql(session.grants, session.userId, values)];
    const add = (clause: (index: number) => string, value: unknown) => {
      values.push(value);
      conditions.push(clause(values.length));
    };
    if (query.region_code) add((index) => `t.operating_region_code=$${index}`, query.region_code);
    if (query.availability) add((index) => `t.availability=$${index}`, query.availability);
    if (query.status) add((index) => `t.status=$${index}`, query.status);
    values.push(cursor?.sort[0] ?? null, cursor?.id ?? null);
    conditions.push(`($${values.length - 1}::uuid IS NULL OR (t.id,t.id)>($${values.length - 1}::uuid,$${values.length}::uuid))`);
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `${teamSelect} WHERE ${conditions.join(' AND ')} ORDER BY t.id,t.id LIMIT $${values.length}`,
      values,
    ) as TeamRow[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const next = more ? items.at(-1) : undefined;
    return {
      items: items.map((row) => teamView(row, hasPermission(session.grants, 'TEAM_READ', {
        organizationId: row.organization_id, regionCode: row.operating_region_code,
      }))),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.id], next.id, filters) } : {}),
    };
  }

  async detail(teamId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const row = await this.findTeam(this.dataSource, teamId);
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    const coordinatorRead = hasPermission(session.grants, 'TEAM_READ', {
      organizationId: row.organization_id, regionCode: row.operating_region_code,
    });
    if (!coordinatorRead) {
      const members = await this.dataSource.query(
        'SELECT 1 FROM team_member WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1',
        [teamId, session.userId],
      ) as unknown[];
      if (!members.length) throw new AppError('FORBIDDEN', { status: 403 });
    }
    return teamView(row, coordinatorRead);
  }

  async findTeam(queryable: Pick<DataSource | EntityManager, 'query'>, teamId: string, lock = false): Promise<TeamRow | undefined> {
    const rows = await queryable.query(
      `${teamSelect} WHERE t.id=$1${lock ? ' FOR UPDATE OF t' : ''}`,
      [teamId],
    ) as TeamRow[];
    return rows[0];
  }
}
