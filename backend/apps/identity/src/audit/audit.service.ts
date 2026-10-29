import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
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
  created_at: Date;
}

@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(dto: AuditListQueryDto): Promise<Record<string, unknown>> {
    const filters = { entity_type: dto.entity_type, entity_id: dto.entity_id ?? null };
    const cursor = dto.cursor ? decodeKeysetCursor(dto.cursor, filters) : null;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string')) throw new AppError('CURSOR_INVALID', { status: 400 });
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
    values.push(Math.min(dto.limit ?? 50, 100) + 1);
    const rows = await this.dataSource.query(
      `SELECT id, actor_user_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id, created_at
         FROM audit_log WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    ) as AuditRow[];
    const more = rows.length > (dto.limit ?? 50);
    const items = rows.slice(0, dto.limit ?? 50).map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString() }));
    const last = rows[Math.min(rows.length, dto.limit ?? 50) - 1];
    return {
      items,
      next_cursor: more && last ? encodeKeysetCursor([new Date(last.created_at).toISOString()], last.id, filters) : null,
    };
  }
}
