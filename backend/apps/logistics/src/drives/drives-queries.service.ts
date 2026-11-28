import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { Permission } from '@c48/identity-contracts/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { DrivePageQueryDto } from './drives.dto';
import { driveScopeSql } from './drives.helpers';

interface PublicDriveRow extends Record<string, unknown> {
  id: string;
  campaign_id: string | null;
  campaign_status: string | null;
  campaign_status_at?: Date | string | null;
  status: string;
  title: string;
  description: string | null;
  opens_at: Date | string | null;
  closes_at: Date | string | null;
  created_at: Date | string;
  cursor_created_at: string;
  warehouse_name: string;
  address_note: string | null;
  location_public: boolean;
  drive_located?: boolean;
  longitude: number | string | null;
  latitude: number | string | null;
  distance_m?: number | string | null;
}

interface DriveItemRow extends Record<string, unknown> {
  drive_id: string;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function validCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  const [sort] = cursor.sort;
  return cursor.sort.length === 1 && typeof sort === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(sort) && Number.isFinite(Date.parse(sort)) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor.id);
}

function publicDrive(row: PublicDriveRow, items: DriveItemRow[]): Record<string, unknown> {
  const location = (row.location_public || row.drive_located) && row.longitude !== null && row.longitude !== undefined &&
    row.latitude !== null && row.latitude !== undefined
    ? { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] }
    : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    campaign_status: row.campaign_status,
    campaign_status_at: iso(row.campaign_status_at ?? null),
    opens_at: iso(row.opens_at),
    closes_at: iso(row.closes_at),
    intake_location: { warehouse_name: row.warehouse_name, address_note: row.address_note, location },
    ...(row.distance_m !== undefined ? { distance_m: row.distance_m === null ? null : Number(row.distance_m) } : {}),
    items: items.map(({ drive_id: _driveId, ...item }) => item),
    created_at: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class DriveQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  /** Nearest-first listing for a donor who shared a position. Warehouses that hide their location sort last, with no distance. */
  private async publicNearest(query: DrivePageQueryDto, lat: number, lng: number): Promise<Record<string, unknown>> {
    const filters = { route: 'logistics.public-donation-drives.nearest', lat: lat.toFixed(4), lng: lng.toFixed(4) };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !(cursor.sort.length === 1 && typeof cursor.sort[0] === 'string' && /^\d{1,13}$/u.test(cursor.sort[0]) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor.id))) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }
    const values: unknown[] = [lng, lat];
    const after = cursor ? (values.push(cursor.sort[0], cursor.id), `WHERE (q.sort_key,q.id)>($3::bigint,$4::uuid)`) : '';
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT * FROM (
         SELECT ${publicDriveColumns},
                CASE WHEN d.location IS NOT NULL OR (w.location_public AND w.location IS NOT NULL)
                     THEN round(ST_Distance(COALESCE(d.location, w.location), ST_SetSRID(ST_MakePoint($1,$2),4326)::geography))::bigint END AS distance_m,
                COALESCE(CASE WHEN d.location IS NOT NULL OR (w.location_public AND w.location IS NOT NULL)
                     THEN round(ST_Distance(COALESCE(d.location, w.location), ST_SetSRID(ST_MakePoint($1,$2),4326)::geography))::bigint END, 9999999999999) AS sort_key
           FROM donation_drive d JOIN warehouse w ON w.id=d.intake_warehouse_id
          WHERE d.status='OPEN' AND (d.closes_at IS NULL OR d.closes_at > now())
       ) q ${after} ORDER BY q.sort_key,q.id LIMIT $${values.length}`,
      values,
    ) as Array<PublicDriveRow & { sort_key: string }>;
    const drives = rows.slice(0, limit);
    const grouped = await this.items(drives.map((row) => row.id));
    const more = rows.length > limit;
    const last = drives.at(-1);
    return {
      items: drives.map((row) => publicDrive(row, grouped.get(row.id) ?? [])),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([String(last.sort_key)], last.id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };
  }

  async publicList(query: DrivePageQueryDto): Promise<Record<string, unknown>> {
    if (query.lat !== undefined && query.lng !== undefined) return this.publicNearest(query, query.lat, query.lng);
    const filters = { route: 'logistics.public-donation-drives' };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const after = cursor ? (values.push(cursor.sort[0], cursor.id), 'AND (d.created_at,d.id)<($1::timestamptz,$2::uuid)') : '';
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT ${publicDriveColumns}
         FROM donation_drive d JOIN warehouse w ON w.id=d.intake_warehouse_id
        WHERE d.status='OPEN' AND (d.closes_at IS NULL OR d.closes_at > now()) ${after}
        ORDER BY d.created_at DESC,d.id DESC LIMIT $${values.length}`,
      values,
    ) as PublicDriveRow[];
    return this.page(rows, limit, filters);
  }

  async publicDetail(id: string): Promise<Record<string, unknown>> {
    const rows = await this.dataSource.query(
      `SELECT ${publicDriveColumns} FROM donation_drive d JOIN warehouse w ON w.id=d.intake_warehouse_id
        WHERE d.id=$1 AND d.status='OPEN' AND (d.closes_at IS NULL OR d.closes_at > now())`,
      [id],
    ) as PublicDriveRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const items = await this.items([id]);
    return { ...publicDrive(rows[0], items.get(id) ?? []), generated_at: new Date().toISOString() };
  }

  async list(query: DrivePageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const permissions: Permission[] = ['DONATION_DRIVE_MANAGE', 'DONATION_INTAKE', 'DONATION_REVIEW'];
    const filters = { route: 'logistics.donation-drives', user_id: session.userId, grants: session.grants, status: query.status ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const scope = driveScopeSql(session.grants, values, permissions, 'd');
    const conditions = [scope];
    if (query.status) {
      values.push(query.status);
      conditions.push(`d.status=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(d.created_at,d.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT d.id,d.intake_warehouse_id,d.campaign_id,d.campaign_status,d.campaign_status_at,d.status,d.title,d.description,
              d.opens_at,d.closes_at,d.version,d.created_at,d.location_note,w.name AS warehouse_name,
              (SELECT count(*)::int FROM donation_delivery dd WHERE dd.drive_id=d.id) AS delivery_count,
              (SELECT count(*)::int FROM donation_delivery dd WHERE dd.drive_id=d.id AND dd.status='POSTED') AS posted_delivery_count,
              ST_X(d.location::geometry)::float8 AS longitude,ST_Y(d.location::geometry)::float8 AS latitude,
              to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM donation_drive d JOIN warehouse w ON w.id=d.intake_warehouse_id WHERE ${conditions.join(' AND ')}
        ORDER BY d.created_at DESC,d.id DESC LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & { id: string; cursor_created_at: string }>;
    const items = rows.slice(0, limit);
    const grouped = await this.items(items.map((row) => row.id));
    const more = rows.length > limit;
    const last = items.at(-1);
    return {
      items: items.map(({ longitude, latitude, ...row }) => ({
        ...row,
        location: longitude == null || latitude == null ? null : { type: 'Point', coordinates: [Number(longitude), Number(latitude)] },
        opens_at: iso(row.opens_at as Date | string | null),
        closes_at: iso(row.closes_at as Date | string | null),
        campaign_status_at: iso((row.campaign_status_at as Date | string | null | undefined) ?? null),
        created_at: new Date(row.created_at as Date | string).toISOString(),
        version: Number(row.version),
        items: grouped.get(row.id) ?? [],
      })),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at], last.id, filters) } : {}),
    };
  }

  private async page(rows: PublicDriveRow[], limit: number, filters: unknown): Promise<Record<string, unknown>> {
    const drives = rows.slice(0, limit);
    const grouped = await this.items(drives.map((row) => row.id));
    const more = rows.length > limit;
    const last = drives.at(-1);
    return {
      items: drives.map((row) => publicDrive(row, grouped.get(row.id) ?? [])),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at], last.id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };
  }

  private async items(driveIds: string[]): Promise<Map<string, DriveItemRow[]>> {
    const grouped = new Map<string, DriveItemRow[]>();
    if (!driveIds.length) return grouped;
    const rows = await this.dataSource.query(
      `SELECT di.drive_id,di.item_id,i.name AS item_name,t.display_name AS item_type_name,u.code AS unit_code,
              u.display_name AS unit_name,u.scale,di.target_quantity::text AS target_quantity,di.acceptance_note,
              COALESCE(SUM(sm.delta_on_hand),0)::text AS accepted_total
         FROM drive_item di JOIN item i ON i.id=di.item_id JOIN item_type t ON t.code=i.item_type_code
         JOIN unit u ON u.code=i.unit_code
         LEFT JOIN donation_delivery dd ON dd.drive_id=di.drive_id
         LEFT JOIN donation_receipt r ON r.delivery_id=dd.id
         LEFT JOIN stock_movement sm ON sm.receipt_id=r.id AND sm.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')
           AND EXISTS (SELECT 1 FROM stock_balance sb WHERE sb.id=sm.balance_id AND sb.item_id=di.item_id)
        WHERE di.drive_id=ANY($1::uuid[])
        GROUP BY di.drive_id,di.item_id,i.name,t.display_name,u.code,u.display_name,u.scale,di.target_quantity,di.acceptance_note
        ORDER BY di.drive_id,i.name,di.item_id`,
      [driveIds],
    ) as DriveItemRow[];
    for (const row of rows) grouped.set(row.drive_id, [...(grouped.get(row.drive_id) ?? []), row]);
    return grouped;
  }
}

const publicDriveColumns = `d.id,d.campaign_status,d.campaign_status_at,d.status,d.title,d.description,d.opens_at,d.closes_at,d.created_at,
  to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
  w.name AS warehouse_name,COALESCE(d.location_note,w.address_note) AS address_note,w.location_public,(d.location IS NOT NULL) AS drive_located,
  CASE WHEN d.location IS NOT NULL THEN ST_X(d.location::geometry)::float8
       WHEN w.location_public THEN ST_X(w.location::geometry)::float8 ELSE NULL END AS longitude,
  CASE WHEN d.location IS NOT NULL THEN ST_Y(d.location::geometry)::float8
       WHEN w.location_public THEN ST_Y(w.location::geometry)::float8 ELSE NULL END AS latitude`;
