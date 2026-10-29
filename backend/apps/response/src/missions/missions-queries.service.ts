import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import { asObject, filtersHash, scopeSql, toIso } from '../operations/request-operations.helpers';
import { MissionPageQueryDto } from './missions.dto';
import { MISSIONS_CONFIG, MissionsConfig } from './missions.config';

interface MissionRow extends Record<string, unknown> {
  id: string;
  request_id: string;
  team_id: string;
  team_name: string;
  work_cycle: number;
  status: string;
  mission_kind: string;
  version: number;
  created_at: Date | string;
  cursor_created_at: string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  approved_facts: unknown;
  member_role?: 'LEADER' | 'MEMBER';
}

function missionView(row: MissionRow, includeContacts: boolean, canManageMission: boolean): Record<string, unknown> {
  const facts = asObject(row.approved_facts);
  const view: Record<string, unknown> = {
    id: row.id,
    request_id: row.request_id,
    team: { id: row.team_id, name: row.team_name },
    status: row.status,
    mission_kind: row.mission_kind,
    version: Number(row.version),
    work_cycle: Number(row.work_cycle),
    created_at: toIso(row.created_at),
    category: facts.incident_category_code ?? null,
    description: facts.description ?? null,
    people_affected: facts.people_affected == null ? null : Number(facts.people_affected),
    location: facts.location ?? null,
    declared_danger: facts.reporter_declared_danger === true,
    can_manage_mission: canManageMission,
  };
  if (includeContacts) {
    view.reporter_contact_phone = facts.reporter_contact_phone ?? null;
    view.beneficiary_contact_phone = facts.beneficiary_contact_phone ?? null;
    view.alternate_contact = facts.alternate_contact ?? null;
  }
  return view;
}

@Injectable()
export class MissionsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(MISSIONS_CONFIG) private readonly config: MissionsConfig,
  ) {}

  async mine(query: MissionPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const teams = await this.dataSource.query(
      `SELECT team_id,member_role FROM team_member WHERE user_id=$1 AND left_at IS NULL ORDER BY team_id`, [session.userId],
    ) as Array<{ team_id: string; member_role: 'LEADER' | 'MEMBER' }>;
    if (!teams.length) throw new AppError('FORBIDDEN', { status: 403 });
    const teamIds = teams.map(({ team_id }) => team_id);
    const leaderTeams = new Set(teams.filter(({ member_role }) => member_role === 'LEADER').map(({ team_id }) => team_id));
    const filters = filtersHash(session.grants, session.userId, query, 'missions/mine');
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const limit = query.limit ?? 50;
    const rows = await this.dataSource.query(
      `SELECT m.id,m.request_id,m.team_id,t.name AS team_name,m.work_cycle,m.status,m.mission_kind,m.version,m.created_at,
              to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
              r.organization_id,r.region_code,r.campaign_id,e.payload->'approved_facts' AS approved_facts,
              tm.member_role
         FROM mission m JOIN rescue_team t ON t.id=m.team_id
         JOIN assistance_request r ON r.id=m.request_id
         JOIN request_event e ON e.id=m.verification_revision AND e.request_id=m.request_id
         JOIN team_member tm ON tm.team_id=m.team_id AND tm.user_id=$1 AND tm.left_at IS NULL
        WHERE m.team_id=ANY($2::uuid[])
          AND ($3::timestamptz IS NULL OR (m.created_at,m.id)>($3::timestamptz,$4::uuid))
        ORDER BY m.created_at,m.id LIMIT $5`,
      [session.userId, teamIds, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as MissionRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return {
      items: page.map((row) => {
        const isLeader = leaderTeams.has(row.team_id);
        return missionView(row, isLeader, isLeader);
      }),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}),
    };
  }

  async detail(missionId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const row = await this.findMission(this.dataSource, missionId);
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    const memberRows = await this.dataSource.query(
      `SELECT member_role FROM team_member WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1`,
      [row.team_id, session.userId],
    ) as Array<{ member_role: 'LEADER' | 'MEMBER' }>;
    const isMember = memberRows.length > 0;
    const staffAllowed = hasPermission(session.grants, 'REQUEST_DETAIL_READ', {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
    });
    if (!isMember && !staffAllowed) throw new AppError('FORBIDDEN', { status: 403 });
    const isLeader = memberRows[0]?.member_role === 'LEADER';
    const includeContacts = staffAllowed || isLeader;
    const [events, evidence] = await Promise.all([
      this.dataSource.query(
        `SELECT id,actor_user_id,from_status,to_status,recorded_basis,reported_by,reason,outcome_note,occurred_at,recorded_at
           FROM mission_event WHERE mission_id=$1 ORDER BY occurred_at,id`, [missionId],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT id,state,size_bytes,detected_mime,checksum,created_at
           FROM evidence_metadata WHERE mission_id=$1 AND state='READY' ORDER BY created_at,id`, [missionId],
      ) as Promise<Array<Record<string, unknown>>>,
    ]);
    return {
      ...missionView(row, includeContacts, isLeader),
      timeline: { items: events.map((event) => ({
        id: event.id, actor_user_id: event.actor_user_id, from_status: event.from_status, to_status: event.to_status,
        recorded_basis: event.recorded_basis, reported_by: event.reported_by, reason: event.reason,
        outcome_note: event.outcome_note, occurred_at: toIso(event.occurred_at as Date | string),
        recorded_at: toIso(event.recorded_at as Date | string), recorded_on_behalf: event.recorded_basis !== null,
      })) },
      evidence: { items: evidence.map((item) => ({
        id: item.id, state: item.state, size_bytes: Number(item.size_bytes), detected_mime: item.detected_mime,
        checksum: item.checksum, created_at: toIso(item.created_at as Date | string),
      })) },
    };
  }

  async overdueOffers(query: MissionPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = filtersHash(session.grants, session.userId, query, 'missions/overdue-offers');
    const values: unknown[] = [this.config.offerOverdueMinutes];
    const scope = scopeSql(session.grants, 'MISSION_OVERDUE_READ', values, 'r');
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const cursorTime = values.push(cursor?.sort[0] ?? null);
    const cursorId = values.push(cursor?.id ?? null);
    const limitIndex = values.push((query.limit ?? 50) + 1);
    const rows = await this.dataSource.query(
      `SELECT m.id,m.request_id,m.team_id,t.name AS team_name,m.status,m.mission_kind,m.version,m.created_at,
              to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
              r.region_code,r.campaign_id
         FROM mission m JOIN assistance_request r ON r.id=m.request_id JOIN rescue_team t ON t.id=m.team_id
        WHERE m.status='OFFERED' AND m.created_at<=statement_timestamp()-($1::int*interval '1 minute')
          AND ${scope}
          AND ($${cursorTime}::timestamptz IS NULL OR (m.created_at,m.id)>($${cursorTime}::timestamptz,$${cursorId}::uuid))
        ORDER BY m.created_at,m.id LIMIT $${limitIndex}`,
      values,
    ) as Array<MissionRow & { region_code: string | null; campaign_id: string | null }>;
    const limit = query.limit ?? 50;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return {
      items: page.map((row) => ({
        id: row.id, request_id: row.request_id, team: { id: row.team_id, name: row.team_name },
        status: row.status, version: Number(row.version), created_at: toIso(row.created_at),
        region_code: row.region_code,
      })),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}),
    };
  }

  async findMission(queryable: Pick<DataSource, 'query'>, missionId: string): Promise<MissionRow | undefined> {
    const rows = await queryable.query(
      `SELECT m.id,m.request_id,m.team_id,t.name AS team_name,m.work_cycle,m.status,m.mission_kind,m.version,m.created_at,
              to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
              r.organization_id,r.region_code,r.campaign_id,e.payload->'approved_facts' AS approved_facts
         FROM mission m JOIN rescue_team t ON t.id=m.team_id
         JOIN assistance_request r ON r.id=m.request_id
         JOIN request_event e ON e.id=m.verification_revision AND e.request_id=m.request_id
        WHERE m.id=$1`, [missionId],
    ) as MissionRow[];
    return rows[0];
  }
}
