import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { hasPermission } from '@c48/identity-contracts/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import { SetTeamPositionDto } from './teams.dto';

interface TeamPositionTeam {
  organization_id: string;
  operating_region_code: string;
  reporting_mode: 'APP' | 'COORDINATOR';
  status: 'ACTIVE' | 'INACTIVE';
}

interface TeamPositionRow {
  longitude: number;
  latitude: number;
  accuracy_m: string | null;
  captured_at: Date | string;
  source: 'GPS' | 'MANUAL_PIN' | 'COORDINATOR_REPORTED';
  set_by_user_id: string;
  within_window: boolean;
  distance_m: string | number;
}

function invalidCoordinates(): AppError {
  return new AppError('VALIDATION_FAILED', {
    status: 400,
    fieldErrors: { 'location.coordinates': ['COORDINATES_OUT_OF_RANGE'] },
  });
}

@Injectable()
export class TeamsPositionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
  ) {}

  async set(teamId: string, dto: SetTeamPositionDto, request: Request): Promise<void> {
    const session = await this.sessions.require(request);
    const [longitude, latitude] = dto.location.coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw invalidCoordinates();
    }

    await this.dataSource.transaction(async (manager) => {
      const teams = await manager.query(
        `SELECT organization_id,operating_region_code,reporting_mode,status
           FROM rescue_team WHERE id=$1 FOR UPDATE`, [teamId],
      ) as TeamPositionTeam[];
      const team = teams[0];
      if (!team) throw new AppError('NOT_FOUND', { status: 404 });

      if (dto.location.source === 'COORDINATOR_REPORTED') {
        if (!hasPermission(session.grants, 'TEAM_POSITION_SET_ANY', {
          organizationId: team.organization_id, regionCode: team.operating_region_code,
        })) throw new AppError('FORBIDDEN', { status: 403 });
      } else {
        const leaders = team.reporting_mode === 'APP' && team.status === 'ACTIVE'
          ? await manager.query(
            `SELECT 1 FROM team_member
              WHERE team_id=$1 AND user_id=$2 AND member_role='LEADER' AND left_at IS NULL LIMIT 1`,
            [teamId, session.userId],
          ) as unknown[]
          : [];
        if (!leaders.length) throw new AppError('FORBIDDEN', { status: 403 });
      }

      const currentRows = await manager.query(
        `SELECT ST_X(location::geometry)::float8 AS longitude,ST_Y(location::geometry)::float8 AS latitude,
                accuracy_m,captured_at,source,set_by_user_id,
                captured_at >= clock_timestamp() - interval '15 seconds' AS within_window,
                ST_Distance(location,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS distance_m
           FROM team_position WHERE team_id=$1 FOR UPDATE`, [teamId, longitude, latitude],
      ) as TeamPositionRow[];
      const current = currentRows[0];
      // shortcut: captured_at is the only stored position time; use a server receive timestamp if device clock skew must not affect suppression.
      if (current?.within_window) return;
      // A team that has not moved keeps its stored location, accuracy, source and owner but still refreshes captured_at,
      // because team candidates treat a fix older than 30 minutes as an unknown position. It writes no audit row.
      const stationary = current !== undefined && Number(current.distance_m) < 25;
      if (current && stationary) {
        if (new Date(dto.captured_at).getTime() > new Date(current.captured_at).getTime()) {
          await manager.query('UPDATE team_position SET captured_at=$2 WHERE team_id=$1', [teamId, dto.captured_at]);
        }
        return;
      }

      const values = [teamId, longitude, latitude, dto.accuracy_m ?? null, dto.captured_at, dto.location.source, session.userId];
      if (current) {
        await manager.query(
          `UPDATE team_position
              SET location=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,accuracy_m=$4,
                  captured_at=$5,source=$6,set_by_user_id=$7
            WHERE team_id=$1`, values,
        );
      } else {
        await manager.query(
          `INSERT INTO team_position (team_id,location,accuracy_m,captured_at,source,set_by_user_id)
           VALUES ($1,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,$4,$5,$6,$7)`, values,
        );
      }

      if (!current || current.source !== dto.location.source || dto.location.source === 'COORDINATOR_REPORTED') {
        // shortcut: note has no position column, so it survives only with required audits; add explicit metadata if every note must persist.
        const before = current ? {
          location: { type: 'Point', coordinates: [Number(current.longitude), Number(current.latitude)] },
          accuracy_m: current.accuracy_m === null ? null : Number(current.accuracy_m),
          captured_at: current.captured_at,
          source: current.source,
          set_by_user_id: current.set_by_user_id,
        } : null;
        const after = {
          location: { type: 'Point', coordinates: [longitude, latitude] },
          accuracy_m: dto.accuracy_m ?? null,
          captured_at: dto.captured_at,
          source: dto.location.source,
          set_by_user_id: session.userId,
          ...(dto.note === undefined ? {} : { note: dto.note }),
        };
        await manager.query(
          `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
           VALUES ($1,'TEAM_POSITION_SET','rescue_team',$2,$3::jsonb,$4::jsonb)`,
          [session.userId, teamId, before ? JSON.stringify(before) : null, JSON.stringify(after)],
        );
      }
    });
  }
}
