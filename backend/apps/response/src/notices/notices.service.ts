import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { ReporterSessionService } from '../requests/reporter-session';
import { NoticePageQueryDto } from './notices.dto';

interface NoticeRow {
  id: string;
  notice_type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
  read_at: Date | string | null;
  cursor_created_at: string;
}

const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const cursorIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function validCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  const timestamp = cursor.sort[0];
  return cursor.sort.length === 1 && typeof timestamp === 'string' &&
    cursorTimestampPattern.test(timestamp) && Number.isFinite(Date.parse(timestamp)) &&
    new Date(timestamp).toISOString().slice(0, 19) === timestamp.slice(0, 19) && cursorIdPattern.test(cursor.id);
}

@Injectable()
export class NoticesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
  ) {}

  async list(query: NoticePageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = {
      recipient_user_id: session.userId,
      ...(query.unread === undefined ? {} : { unread: query.unread }),
    };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && !validCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const limit = query.limit ?? 50;
    const unreadClause = query.unread === 'true' ? ' AND read_at IS NULL' : query.unread === 'false' ? ' AND read_at IS NOT NULL' : '';
    const rows = await this.dataSource.query(
      `SELECT id,notice_type,payload,created_at,read_at,
              to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM notice
        WHERE recipient_user_id=$1${unreadClause}
          AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY created_at DESC,id DESC LIMIT $4`,
      [session.userId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as NoticeRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;

    return {
      items: page.map((row) => ({
        id: row.id,
        notice_type: row.notice_type,
        payload: row.payload,
        created_at: toIso(row.created_at),
        read_at: row.read_at === null ? null : toIso(row.read_at),
      })),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}),
    };
  }

  async markRead(noticeId: string, request: Request): Promise<{ id: string; read_at: string }> {
    const session = await this.sessions.require(request);
    const [rows] = await this.dataSource.query(
      `UPDATE notice SET read_at=COALESCE(read_at,clock_timestamp())
        WHERE id=$1 AND recipient_user_id=$2 RETURNING id,read_at`,
      [noticeId, session.userId],
    ) as [Array<{ id: string; read_at: Date | string }>, number];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    return { id: row.id, read_at: toIso(row.read_at) };
  }
}
