import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { getGeminiApiKeys } from '@c48/technical/ai/gemini-api-keys';
import { callGeminiJson } from '@c48/technical/ai/gemini-json-client';
import {
  LogisticsResponseSupplyCandidatesClient, SupplyCandidate, SupplyCandidatePage,
} from '../integrations/response/response-supply-candidates.client';
import { EstimateFacts, persistEstimateBatch } from '../needs/need-estimate-batch';
import { ExtractionDependencies, extractNeedLines } from './need-extraction.logic';
import {
  cycleHasNeeds, loadExtractionCatalog, loadExtractionNorms, processedKeys, ProcessedStatus, recordProcessed, takeDailyGeminiCall,
} from './need-extraction.repository';
import type { ExtractionCatalogItem, ExtractionNorm } from './need-extraction.types';

export const NEED_EXTRACTION_MAX_PER_RUN = 20;
export const NEED_EXTRACTION_PAGE_SIZE = 50;
export const NEED_EXTRACTION_MAX_PAGES = 10;

export interface NeedExtractionRunSummary {
  /** Candidates with no log row that were attempted in this run (capped at NEED_EXTRACTION_MAX_PER_RUN). */
  attempted: number;
  created: number;
  noLines: number;
  skipped: number;
  failed: number;
  /** Unexpected errors (for example a database error). Not recorded, so the candidate is retried on a later run. */
  errors: number;
}

export type CandidateOutcome = ProcessedStatus | 'ERROR';

/** GEMINI_DAILY_CALL_LIMIT with the Response meaning: unset, invalid or 0 means no cap. */
export function needExtractionCallLimit(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.GEMINI_DAILY_CALL_LIMIT ?? '0');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Gemini is optional here: no key, or an invalid key setting, means the alias and default-bundle fallbacks run. */
export function needExtractionGemini(env: Record<string, string | undefined> = process.env): ExtractionDependencies['gemini'] {
  let apiKeys: string[];
  try {
    apiKeys = getGeminiApiKeys(env);
  } catch {
    return null;
  }
  if (apiKeys.length === 0) return null;
  const model = env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  return {
    model,
    call: (prompt, responseSchema) => callGeminiJson({
      model,
      apiKeys,
      prompt,
      responseSchema,
      timeoutMs: 15_000,
      deadlineMs: Date.now() + 25_000,
      maxOutputTokens: 1024,
    }),
  };
}

function candidateKey(candidate: Pick<SupplyCandidate, 'request_id' | 'work_cycle'>): string {
  return `${candidate.request_id}:${candidate.work_cycle}`;
}

function factsOf(candidate: SupplyCandidate): EstimateFacts {
  return {
    request_id: candidate.request_id,
    work_cycle: candidate.work_cycle,
    campaign_id: candidate.campaign_id,
    people_affected: candidate.people_affected,
    children_count: candidate.children_count,
    elderly_count: candidate.elderly_count,
  };
}

/**
 * Creates ESTIMATED lines for verified relief requests that have none yet. It never calls the Response admission route
 * (that route sets attribution locks and bumps the version), so Response is only read through the candidate scan.
 * Each candidate runs in its own transaction; a failure of one candidate is logged or counted and never stops the run.
 */
@Injectable()
export class NeedExtractionSweepService {
  private readonly logger = new Logger(NeedExtractionSweepService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly candidates: LogisticsResponseSupplyCandidatesClient,
  ) {}

  async runOnce(env: Record<string, string | undefined> = process.env): Promise<NeedExtractionRunSummary> {
    const summary: NeedExtractionRunSummary = { attempted: 0, created: 0, noLines: 0, skipped: 0, failed: 0, errors: 0 };
    let catalog: ExtractionCatalogItem[];
    let norms: ExtractionNorm[];
    try {
      catalog = await loadExtractionCatalog(this.dataSource);
      norms = await loadExtractionNorms(this.dataSource);
    } catch {
      this.logger.warn('NEED_EXTRACTION_CATALOG_FAILED');
      return summary;
    }
    const limit = needExtractionCallLimit(env);
    const deps: ExtractionDependencies = {
      gemini: needExtractionGemini(env),
      takeGeminiQuota: () => takeDailyGeminiCall(this.dataSource, limit),
      onGeminiSkipped: (code) => this.logger.warn(code),
    };

    let cursor: string | null = null;
    for (let page = 0; page < NEED_EXTRACTION_MAX_PAGES && summary.attempted < NEED_EXTRACTION_MAX_PER_RUN; page++) {
      let result: SupplyCandidatePage;
      try {
        result = await this.candidates.list(cursor, NEED_EXTRACTION_PAGE_SIZE);
      } catch {
        this.logger.warn('NEED_EXTRACTION_SCAN_FAILED');
        break;
      }
      const known = await this.knownKeys(result.items);
      for (const candidate of result.items) {
        if (summary.attempted >= NEED_EXTRACTION_MAX_PER_RUN) break;
        if (known.has(candidateKey(candidate))) continue;
        summary.attempted++;
        const outcome = await this.processCandidate(candidate, catalog, norms, deps);
        if (outcome === 'CREATED') summary.created++;
        else if (outcome === 'NO_LINES') summary.noLines++;
        else if (outcome === 'SKIPPED') summary.skipped++;
        else if (outcome === 'FAILED') summary.failed++;
        else summary.errors++;
      }
      if (!result.more || !result.cursor) break;
      cursor = result.cursor;
    }
    return summary;
  }

  private async knownKeys(items: readonly SupplyCandidate[]): Promise<Set<string>> {
    try {
      return await processedKeys(this.dataSource, items);
    } catch {
      this.logger.warn('NEED_EXTRACTION_LOG_READ_FAILED');
      return new Set(items.map(candidateKey));
    }
  }

  private async processCandidate(
    candidate: SupplyCandidate,
    catalog: readonly ExtractionCatalogItem[],
    norms: readonly ExtractionNorm[],
    deps: ExtractionDependencies,
  ): Promise<CandidateOutcome> {
    const { request_id: requestId, work_cycle: workCycle } = candidate;
    try {
      if (candidate.people_affected === null) {
        await recordProcessed(this.dataSource, { requestId, workCycle, status: 'SKIPPED', source: null, lineCount: 0, errorCode: 'NEED_PEOPLE_MISSING' });
        return 'SKIPPED';
      }
      if (await cycleHasNeeds(this.dataSource, requestId, workCycle)) {
        await recordProcessed(this.dataSource, { requestId, workCycle, status: 'SKIPPED', source: null, lineCount: 0, errorCode: 'NEED_LINE_EXISTS' });
        return 'SKIPPED';
      }

      // Gemini (network) runs outside any database transaction.
      const extraction = await extractNeedLines({ text: candidate.relief_items_text, catalog, norms }, deps);
      try {
        return await this.dataSource.transaction(async (manager) => {
          if (await cycleHasNeeds(manager, requestId, workCycle)) {
            await recordProcessed(manager, { requestId, workCycle, status: 'SKIPPED', source: null, lineCount: 0, errorCode: 'NEED_LINE_EXISTS' });
            return 'SKIPPED' as const;
          }
          const batch = await persistEstimateBatch(manager, {
            admission: factsOf(candidate),
            lines: extraction.lines,
            actor: { userId: null, grants: null },
            extraction: extraction.basis,
          });
          const status: ProcessedStatus = batch.ids.length > 0 ? 'CREATED' : 'NO_LINES';
          await recordProcessed(manager, {
            requestId, workCycle, status, source: extraction.basis.source, lineCount: batch.ids.length, errorCode: null,
          });
          return status;
        });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        // A stable business or state code is recorded and not retried automatically (no endless retries).
        this.logger.warn('NEED_EXTRACTION_FAILED', `code:${error.code}`);
        await recordProcessed(this.dataSource, {
          requestId, workCycle, status: 'FAILED', source: extraction.basis.source, lineCount: 0, errorCode: error.code,
        });
        return 'FAILED';
      }
    } catch {
      this.logger.warn('NEED_EXTRACTION_CANDIDATE_ERROR');
      return 'ERROR';
    }
  }
}
