import type { DataSource, EntityManager } from 'typeorm';
import { EXTRACTION_MAX_CATALOG_ITEMS } from './need-extraction.logic';
import type { ExtractionCatalogItem, ExtractionNorm } from './need-extraction.types';

export type ProcessedStatus = 'CREATED' | 'NO_LINES' | 'SKIPPED' | 'FAILED';

/** ACTIVE items only, capped. Aliases are read from the catalog; they never set a quantity. */
export async function loadExtractionCatalog(manager: Pick<EntityManager, 'query'>): Promise<ExtractionCatalogItem[]> {
  const rows = await manager.query(
    `SELECT id,name,item_type_code,aliases FROM item
      WHERE status='ACTIVE' ORDER BY name ASC, id ASC LIMIT $1`,
    [EXTRACTION_MAX_CATALOG_ITEMS],
  ) as Array<{ id: string; name: string; item_type_code: string; aliases: string[] | null }>;
  return rows.map((row) => ({ id: row.id, name: row.name, item_type_code: row.item_type_code, aliases: row.aliases ?? [] }));
}

export async function loadExtractionNorms(manager: Pick<EntityManager, 'query'>): Promise<ExtractionNorm[]> {
  return manager.query(
    `SELECT category,item_type_code,in_default_bundle,default_item_id FROM need_norm WHERE active ORDER BY category`,
    [],
  ) as Promise<ExtractionNorm[]>;
}

/**
 * Consumes one Gemini call from today's count (Pacific day, the same reset point Response uses). The limit keeps the
 * existing GEMINI_DAILY_CALL_LIMIT meaning: 0 or unset means no cap. Runs outside the sweep's transaction, so a rollback
 * never gives a call back.
 */
export async function takeDailyGeminiCall(dataSource: Pick<DataSource, 'query'>, limit: number): Promise<boolean> {
  const rows = await dataSource.query(
    `INSERT INTO need_extraction_daily_usage (usage_date,calls)
     VALUES (date(timezone('America/Los_Angeles',now())),1)
     ON CONFLICT (usage_date) DO UPDATE SET calls=need_extraction_daily_usage.calls+1,updated_at=now()
     WHERE ($1=0 OR need_extraction_daily_usage.calls<$1) RETURNING calls`,
    [limit],
  ) as Array<{ calls: number }>;
  return rows.length > 0;
}

export async function processedKeys(
  manager: Pick<EntityManager, 'query'>,
  pairs: ReadonlyArray<{ request_id: string; work_cycle: number }>,
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const rows = await manager.query(
    `SELECT l.request_id,l.work_cycle FROM need_extraction_log l
      WHERE (l.request_id,l.work_cycle) IN (SELECT * FROM unnest($1::uuid[], $2::int[]))`,
    [pairs.map((pair) => pair.request_id), pairs.map((pair) => pair.work_cycle)],
  ) as Array<{ request_id: string; work_cycle: number }>;
  return new Set(rows.map((row) => `${row.request_id}:${Number(row.work_cycle)}`));
}

export async function recordProcessed(
  manager: Pick<EntityManager, 'query'>,
  input: { requestId: string; workCycle: number; status: ProcessedStatus; source: string | null; lineCount: number; errorCode: string | null },
): Promise<void> {
  await manager.query(
    `INSERT INTO need_extraction_log (request_id,work_cycle,status,source,line_count,error_code)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (request_id,work_cycle) DO NOTHING`,
    [input.requestId, input.workCycle, input.status, input.source, input.lineCount, input.errorCode],
  );
}

/** True when the cycle already has any need line (declared, confirmed, estimated or cancelled). */
export async function cycleHasNeeds(manager: Pick<EntityManager, 'query'>, requestId: string, workCycle: number): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1 FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
      WHERE c.request_id=$1 AND c.work_cycle=$2 LIMIT 1`,
    [requestId, workCycle],
  ) as unknown[];
  return rows.length > 0;
}
