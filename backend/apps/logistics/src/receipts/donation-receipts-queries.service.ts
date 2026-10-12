import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { Grant, hasPermission, Permission } from '../../../../packages/technical/src/security/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { hasWarehouseScope } from '../stock/stock.scope';
import { driveScopeSql } from '../drives/drives.helpers';
import { DonationPageQueryDto } from '../drives/donations.dto';
import { DonationDisputePageQueryDto } from './donation-receipts.dto';
import { readReceiptView } from './donation-receipts.read';

interface TimeRow {
  id: string;
  cursor_at: string;
}

@Injectable()
export class DonationReceiptsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async deliveries(query: DonationPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const permissions: Permission[] = ['DONATION_INTAKE', 'DONATION_REVIEW'];
    const filters = { route: 'logistics.donation-deliveries', user_id: session.userId, grants: session.grants,
      drive_id: query.drive_id ?? null, status: query.status ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validTimeCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [];
    const conditions = [driveScopeSql(session.grants, values, permissions, 'w')];
    if (query.drive_id) conditions.push(`d.id=$${values.push(query.drive_id)}`);
    if (query.status) conditions.push(`dd.status=$${values.push(query.status)}`);
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(dd.created_at,dd.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT dd.id,dd.drive_id,d.title AS drive_title,dd.public_code,dd.donor_name,
              dd.donor_phone,dd.status,dd.version,r.id AS receipt_id,
              dd.created_at,to_char(dd.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
         JOIN warehouse w ON w.id=d.intake_warehouse_id LEFT JOIN donation_receipt r ON r.delivery_id=dd.id
        WHERE ${conditions.join(' AND ')} ORDER BY dd.created_at DESC,dd.id DESC LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & TimeRow>;
    return page(rows, limit, filters);
  }

  async receipt(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const receipt = await readReceiptView(this.dataSource, id);
    assertReceiptRead(session.grants, receipt.organization_id, receipt.region_code);
    return { ...receipt.value, generated_at: new Date().toISOString() };
  }

  async disputes(query: DonationDisputePageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const permissions: Permission[] = ['DONATION_REVIEW'];
    const filters = { route: 'logistics.donation-disputes', user_id: session.userId, grants: session.grants,
      status: query.status ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validTimeCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [];
    const conditions = [driveScopeSql(session.grants, values, permissions, 'w')];
    if (query.status) conditions.push(`dis.status=$${values.push(query.status)}`);
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(dis.opened_at,dis.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT dis.id,dis.delivery_id,dis.status,dis.opened_by_kind,dis.reason,dis.resolution_note,
              dis.opened_at,dis.resolved_at,dd.public_code,dd.drive_id,d.title AS drive_title,
              dd.donor_phone,
              to_char(dis.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM donation_dispute dis JOIN donation_delivery dd ON dd.id=dis.delivery_id
         JOIN donation_drive d ON d.id=dd.drive_id JOIN warehouse w ON w.id=d.intake_warehouse_id
        WHERE ${conditions.join(' AND ')} ORDER BY dis.opened_at DESC,dis.id DESC LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & TimeRow>;
    return page(rows, limit, filters);
  }

}

function assertReceiptRead(grants: readonly Grant[], organizationId: string, regionCode: string): void {
  if (!hasWarehouseScope(grants, organizationId, regionCode)) throw new AppError('NOT_FOUND', { status: 404 });
  if (!hasPermission(grants, 'DONATION_INTAKE', { organizationId, regionCode }) &&
      !hasPermission(grants, 'DONATION_REVIEW', { organizationId, regionCode })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

function validTimeCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  const [sort] = cursor.sort;
  return cursor.sort.length === 1 && typeof sort === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(sort) && Number.isFinite(Date.parse(sort)) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor.id);
}

function page(rows: Array<Record<string, unknown> & TimeRow>, limit: number, filters: unknown): Record<string, unknown> {
  const items = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = items.at(-1);
  return {
    items: items.map(({ cursor_at: _cursorAt, donor_phone: phone, ...row }) => ({
      ...row,
      ...(phone === undefined ? {} : { donor_phone: maskDonorPhone(String(phone)) }),
      ...(row.created_at ? { created_at: new Date(row.created_at as Date | string).toISOString() } : {}),
      ...(row.opened_at ? { opened_at: new Date(row.opened_at as Date | string).toISOString() } : {}),
      ...(row.resolved_at !== undefined ? { resolved_at: row.resolved_at ? new Date(row.resolved_at as Date | string).toISOString() : null } : {}),
      ...(row.version === undefined ? {} : { version: Number(row.version) }),
    })),
    more,
    ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_at], last.id, filters) } : {}),
  };
}

function maskDonorPhone(phone: string): string {
  const prefixLength = phone.startsWith('+') ? 3 : 2;
  return `${phone.slice(0, prefixLength)}${'*'.repeat(Math.max(0, phone.length - prefixLength - 2))}${phone.slice(-2)}`;
}
