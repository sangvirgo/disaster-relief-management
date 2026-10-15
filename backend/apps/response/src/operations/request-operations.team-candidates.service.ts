import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { ReporterSessionService } from '../requests/reporter-session';
import { teamView, TeamRow } from '../teams/teams.helpers';
import { TeamCandidatesQueryDto } from './request-operations.dto';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { rankTeamCandidates } from './request-operations.team-candidates.helpers';

interface TeamCandidateRow extends TeamRow {
  distance_m: number | null;
  recent_missions_24h: number;
}

@Injectable()
export class RequestOperationsTeamCandidatesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async list(requestId: string, query: TeamCandidatesQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const source = await this.persistence.staffRequest(this.dataSource, requestId, session, 'MISSION_ASSIGN');
    const radiusM = query.radius_m ?? 10_000;
    const toleranceM = source.priority === 'P1' ? 0 : source.priority === 'P2' ? 500 : 2_000;
    const parameters = {
      radius_m: radiusM,
      position_max_age_s: 1_800,
      priority: source.priority,
      distance_tolerance_m: toleranceM,
    };
    if (source.region_code === null) return { parameters, items: [], unknown_position: [] };

    const rows = await this.dataSource.query(
      `WITH target AS (
         SELECT r.id,r.organization_id,r.region_code,r.incident_category_code,s.location AS request_location,
                statement_timestamp() AS query_time
           FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
          WHERE r.id=$1 AND r.organization_id=$3 AND r.region_code IS NOT DISTINCT FROM $4
       ), eligible AS (
         SELECT t.id,t.organization_id,t.operating_region_code,t.name,t.team_kind,t.reporting_mode,t.availability,t.status,
                t.readiness_required,t.version,t.created_at,
                COALESCE((SELECT array_agg(ts.skill_code ORDER BY ts.skill_code) FROM team_skill ts WHERE ts.team_id=t.id),ARRAY[]::text[]) AS skills,
                floor(extract(epoch FROM (q.query_time-p.captured_at)))::int AS position_age_s,
                p.accuracy_m AS position_accuracy_m,p.source AS position_source,
                NULL::float8 AS longitude,NULL::float8 AS latitude,
                p.team_id AS position_team_id,p.captured_at,p.location AS position_location,q.request_location,q.query_time,
                CASE WHEN p.captured_at BETWEEN q.query_time-interval '30 minutes' AND q.query_time
                     THEN ST_Distance(q.request_location,p.location) END AS distance_m,
                recent.recent_missions_24h
           FROM rescue_team t CROSS JOIN target q
           LEFT JOIN team_position p ON p.team_id=t.id
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT m.id)::int AS recent_missions_24h
               FROM mission m
              WHERE m.team_id=t.id AND m.status NOT IN ('DECLINED','CANCELLED')
                AND (m.created_at BETWEEN q.query_time-interval '24 hours' AND q.query_time
                  OR EXISTS (SELECT 1 FROM mission_event me
                              WHERE me.mission_id=m.id
                                AND me.recorded_at BETWEEN q.query_time-interval '24 hours' AND q.query_time))
           ) recent ON true
          WHERE t.status='ACTIVE' AND t.availability='AVAILABLE' AND NOT t.readiness_required
            AND t.organization_id=q.organization_id AND t.operating_region_code=q.region_code
            AND ((t.reporting_mode='APP' AND EXISTS (
                    SELECT 1 FROM team_member tm WHERE tm.team_id=t.id AND tm.member_role='LEADER' AND tm.left_at IS NULL))
              OR (t.reporting_mode='COORDINATOR' AND NULLIF(btrim(t.external_contact_note),'') IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM mission active
                             WHERE active.team_id=t.id AND active.status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE'))
            AND NOT EXISTS (SELECT 1 FROM incident_category_skill required
                             WHERE required.category_code=q.incident_category_code
                               AND NOT EXISTS (SELECT 1 FROM team_skill ts
                                                WHERE ts.team_id=t.id AND ts.skill_code=required.skill_code))
       )
       SELECT id,organization_id,operating_region_code,name,team_kind,reporting_mode,availability,status,readiness_required,version,created_at,
              skills,position_age_s,position_accuracy_m,position_source,longitude,latitude,distance_m,recent_missions_24h
         FROM eligible
        WHERE position_team_id IS NULL
           OR captured_at < query_time-interval '30 minutes' OR captured_at > query_time
           OR (captured_at >= query_time-interval '30 minutes' AND captured_at <= query_time
               AND ST_DWithin(request_location,position_location,$2::float8))`,
      [requestId, radiusM, source.organization_id, source.region_code],
    ) as TeamCandidateRow[];

    const items = rankTeamCandidates(rows.filter((row): row is TeamCandidateRow & { distance_m: number } => row.distance_m !== null)
      .map((row) => ({ ...row, distance_m: Number(row.distance_m), recent_missions_24h: Number(row.recent_missions_24h) })), toleranceM)
      .map((row) => ({
        team: teamView(row), distance_m: Number(row.distance_m.toFixed(1)), position_age_s: row.position_age_s,
        accuracy_m: row.position_accuracy_m === null ? null : Number(row.position_accuracy_m),
        recent_missions_24h: row.recent_missions_24h, has_active_work: false, in_band: row.in_band, suggested: row.suggested,
      }));
    const unknownPosition = rows.filter((row) => row.distance_m === null).map((row) => ({
      team: teamView(row), distance_m: null, position_age_s: row.position_age_s,
      accuracy_m: row.position_accuracy_m === null ? null : Number(row.position_accuracy_m),
      recent_missions_24h: Number(row.recent_missions_24h), has_active_work: false, in_band: false, suggested: false,
    }));
    return { parameters, items, unknown_position: unknownPosition };
  }
}
