import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';

/** Verified-or-later, non-terminal statuses: the same set admission accepts. */
export const SUPPLY_CANDIDATE_STATUSES = ['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'] as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const filters = { route: 'response.supply-candidates' };

interface SupplyCandidateRow {
  request_id: string;
  work_cycle: number | string;
  campaign_id: string | null;
  status: string;
  people_affected: number | null;
  children_count: number | null;
  elderly_count: number | null;
  relief_items_text: string | null;
  verified_at: Date | string | null;
}

/**
 * Read-only scan for Logistics need extraction. It never sets attribution locks, never bumps the request version and
 * never writes an audit row: the admission route does all of that and must not be used for scanning.
 * Only the projection below leaves Response; the description, contacts and location are not selected.
 */
@Injectable()
export class SupplyCandidatesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(cursorValue: string | undefined, limitValue: number | undefined): Promise<Record<string, unknown>> {
    const limit = limitValue ?? 50;
    const cursor = cursorValue ? decodeKeysetCursor(cursorValue, filters) : null;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' || !uuidPattern.test(cursor.id) || cursor.sort[0] !== cursor.id)) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }
    const values: unknown[] = [[...SUPPLY_CANDIDATE_STATUSES]];
    const conditions = [
      'r.needs_relief_supplies=true',
      'r.status=ANY($1::text[])',
      `NOT EXISTS (SELECT 1 FROM request_event supplement WHERE supplement.request_id=r.id
          AND supplement.event_type='REPORTER_SUPPLEMENT' AND supplement.payload->>'pending_review'='true'
          AND NOT EXISTS (SELECT 1 FROM request_event review WHERE review.request_id=supplement.request_id
            AND review.event_type='SUPPLEMENT_REVIEW' AND review.payload->>'reviewed_event_id'=supplement.id::text))`,
    ];
    if (cursor) {
      values.push(cursor.id);
      conditions.push(`r.id>$${values.length}::uuid`);
    }
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT r.id AS request_id,r.work_cycle,r.campaign_id,r.status,
              s.people_affected,s.children_count,s.elderly_count,r.relief_items_text,
              (SELECT MAX(e.occurred_at) FROM request_event e WHERE e.request_id=r.id AND e.event_type='REQUEST_VERIFIED') AS verified_at
         FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.id ASC LIMIT $${values.length}`,
      values,
    ) as SupplyCandidateRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const more = rows.length > limit;
    return {
      items: page.map(candidateView),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.request_id], last.request_id, filters) } : {}),
    };
  }
}

function candidateView(row: SupplyCandidateRow): Record<string, unknown> {
  return {
    request_id: row.request_id,
    work_cycle: Number(row.work_cycle),
    campaign_id: row.campaign_id ?? null,
    status: row.status,
    people_affected: row.people_affected ?? null,
    children_count: row.children_count ?? null,
    elderly_count: row.elderly_count ?? null,
    relief_items_text: row.relief_items_text ?? null,
    verified_at: row.verified_at ? new Date(row.verified_at).toISOString() : null,
  };
}
