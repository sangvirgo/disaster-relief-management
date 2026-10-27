import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { AuditListQueryDto } from './audit.dto';

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  correlation_id: string | null;
  created_at: Date | string;
  cursor_created_at: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(dto: AuditListQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!hasPermission(session.grants, 'AUDIT_READ', { systemAction: 'AUDIT_READ' })) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }

    const limit = dto.limit ?? 50;
    const filters = { entity_type: dto.entity_type, entity_id: dto.entity_id ?? null };
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : null;
    const timestamp = cursor?.sort[0];
    const validTimestamp = typeof timestamp === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(timestamp) &&
      !Number.isNaN(Date.parse(timestamp)) &&
      new Date(timestamp).toISOString().slice(0, 19) === timestamp.slice(0, 19);
    if (cursor && (
      cursor.sort.length !== 1 || !validTimestamp ||
      !/^[1-9]\d{0,18}$/u.test(cursor.id) || BigInt(cursor.id) > 9_223_372_036_854_775_807n
    )) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }

    const values: unknown[] = [dto.entity_type];
    let where = 'entity_type = $1';
    if (dto.entity_id !== undefined) {
      values.push(dto.entity_id);
      where += ` AND entity_id = $${values.length}`;
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      where += ` AND (created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::bigint)`;
    }
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id, created_at,
              to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM audit_log WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    ) as AuditRow[];
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      actor_user_id: row.actor_user_id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      before_state: row.before_state,
      after_state: row.after_state,
      reason: row.reason,
      correlation_id: row.correlation_id,
      created_at: new Date(row.created_at).toISOString(),
    }));
    const last = rows[Math.min(rows.length, limit) - 1];
    return {
      items,
      next_cursor: rows.length > limit && last
        ? encodeKeysetCursor([last.cursor_created_at], last.id, filters)
        : null,
    };
  }
}
