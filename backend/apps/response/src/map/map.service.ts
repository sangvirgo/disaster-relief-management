import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { mapPostgresError } from '../../../../packages/technical/src/persistence/postgres-errors';
import { scopeSql } from '../operations/request-operations.helpers';
import { ReporterSessionService } from '../requests/reporter-session';
import { analyticsCacheKey, AnalyticsCache, dateWindowFilters, optionalText } from '../analytics/analytics.helpers';
import { MAP_CONFIG } from './map.config';
import type { MapConfig } from './map.config';
import { HeatmapQueryDto } from './map.dto';

const confirmedStatuses = "'VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'";
const unverifiedStatuses = "'SUBMITTED','VERIFYING'";
const supportedCellSizes = [250, 500, 1_000, 2_000, 5_000] as const;
const maxCells = 5_000;

interface HeatmapRow {
  cell: unknown;
  center: unknown;
  count: number | string;
}

@Injectable()
export class MapService implements OnModuleInit {
  private readonly cache = new AnalyticsCache<Record<string, unknown>>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(MAP_CONFIG) private readonly config: MapConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const projections = await this.dataSource.query(
      `SELECT srid FROM spatial_ref_sys
        WHERE srid=$1
          AND auth_name='EPSG'
          AND auth_srid=srid
          AND (
            (srtext LIKE 'PROJCS[%'
              AND srtext ~* ',UNIT\\["(metre|meter)",1(\\.0+)?(,|\\])')
            OR (srtext LIKE 'PROJCRS[%'
              AND substring(srtext FROM 'CS\\[Cartesian,2\\],(.*)$') ~* 'LENGTHUNIT\\["(metre|meter)",1(\\.0+)?\\]')
          )`,
      [this.config.projectionEpsg],
    ) as unknown[];
    if (projections.length === 0) {
      throw new Error('Invalid Response configuration: MAP_PROJECTION_EPSG must be a projected EPSG CRS that uses metres');
    }
  }

  async heatmap(query: HeatmapQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const dateFilters = dateWindowFilters(query as unknown as Record<string, unknown>, 31);
    const statusLayer = query.status_layer ?? 'confirmed';
    if (!['confirmed', 'unverified'].includes(statusLayer)) throw new AppError('VALIDATION_FAILED', { status: 400 });
    const category = optionalText(query.category, 80);
    const cellSize = query.cell_m ?? 1_000;
    if (!supportedCellSizes.includes(cellSize as typeof supportedCellSizes[number])) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const filters = { ...dateFilters, status_layer: statusLayer, category, cell_m: cellSize };
    const values: unknown[] = [];
    const scopes = [scopeSql(session.grants, 'MAP_READ', values, 'r')];
    if (statusLayer === 'unverified') scopes.push(scopeSql(session.grants, 'REQUEST_QUEUE_READ', values, 'r'));

    const clauses = [
      `(${scopes.join(') AND (')})`,
      `r.received_at >= $${values.push(filters.from)}`,
      `r.received_at < $${values.push(filters.to)}`,
      `r.status IN (${statusLayer === 'confirmed' ? confirmedStatuses : unverifiedStatuses})`,
    ];
    if (statusLayer === 'confirmed') clauses.push('r.canonical_request_id IS NULL');
    if (filters.region_code) clauses.push(`r.region_code=$${values.push(filters.region_code)}`);
    if (filters.campaign_id) clauses.push(`r.campaign_id=$${values.push(filters.campaign_id)}::uuid`);
    if (filters.category) clauses.push(`r.incident_category_code=$${values.push(filters.category)}`);
    const cellSizeParameter = values.push(cellSize);
    const key = analyticsCacheKey(session.userId, session.grants, filters);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const sql = `WITH located AS (
      SELECT ST_SnapToGrid(ST_Transform(s.location::geometry, ${this.config.projectionEpsg}), $${cellSizeParameter}::float8) AS center
        FROM assistance_request r
        JOIN request_subject s ON s.request_id=r.id
       WHERE ${clauses.join('\n         AND ')}
    ), cells AS (
      SELECT center, COUNT(*)::int AS count
        FROM located
       GROUP BY center
       ORDER BY ST_X(center), ST_Y(center)
       LIMIT 5001
    )
    SELECT ST_AsGeoJSON(ST_ForcePolygonCCW(ST_Transform(ST_MakeEnvelope(ST_X(center)-$${cellSizeParameter}::float8/2,
                                        ST_Y(center)-$${cellSizeParameter}::float8/2,
                                        ST_X(center)+$${cellSizeParameter}::float8/2,
                                        ST_Y(center)+$${cellSizeParameter}::float8/2,
                                        ${this.config.projectionEpsg}), 4326))) AS cell,
           ST_AsGeoJSON(ST_Transform(center, 4326)) AS center, count
      FROM cells
     ORDER BY ST_X(center), ST_Y(center)`;

    let rows: HeatmapRow[];
    try {
      rows = await this.dataSource.transaction(async (manager) => {
        await manager.query("SET LOCAL statement_timeout = '5s'");
        return manager.query(sql, values) as Promise<HeatmapRow[]>;
      });
    } catch (error) {
      throw mapPostgresError(error) ?? error;
    }
    if (rows.length > maxCells) throw new AppError('TOO_MANY_CELLS', { status: 400 });

    const result = {
      items: rows.map((row) => ({ cell: geoJson(row.cell), center: geoJson(row.center), count: safeCount(row.count) })),
      generated_at: new Date().toISOString(),
      filters,
    };
    this.cache.set(key, result, 30_000);
    return result;
  }
}

function geoJson(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new AppError('INTERNAL_ERROR', { status: 500 });
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return parsed as Record<string, unknown>;
}

function safeCount(value: number | string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return count;
}
