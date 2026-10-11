import { DataSource, EntityManager } from 'typeorm';
import { jitteredInterval } from './postgres-errors';

export type JobWork = (manager: EntityManager) => Promise<number | void>;

export class JobRunner {
  constructor(private readonly dataSource: DataSource, private readonly onError: (jobName: string) => void = (jobName) => process.emitWarning(`Scheduled job failed: ${jobName}`)) {}

  async runOnce(name: string, work: JobWork): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [name]) as Array<{ locked: boolean }>;
      if (!rows[0]?.locked) return false;
      await work(manager);
      return true;
    });
  }

  schedule(name: string, intervalMs: number, work: JobWork, enabled = process.env.SCHEDULER_ENABLED === 'true'): () => void {
    if (!enabled) return () => undefined;
    let active = true;
    let timer: NodeJS.Timeout;
    const scheduleNext = () => {
      if (!active) return;
      timer = setTimeout(async () => {
        try {
          await this.runOnce(name, work);
        } catch {
          this.onError(name);
        } finally {
          scheduleNext();
        }
      }, jitteredInterval(intervalMs));
      timer.unref();
    };
    scheduleNext();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }
}

export async function claimBatch<T>(manager: Pick<EntityManager, 'query'>, selectSql: string, parameters: unknown[] = [], batchSize = 100): Promise<T[]> {
  const query = selectSql.trim().replace(/;$/, '');
  if (!/^SELECT\b/i.test(query) || /\b(?:LIMIT|OFFSET|FOR\s+UPDATE)\b/i.test(query) || !/\bORDER\s+BY\b/i.test(query)) {
    throw new TypeError('Job claim SQL must be an ordered SELECT without LIMIT or row locks');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new RangeError('Job batch size must be between 1 and 100');
  return manager.query(`${query} LIMIT $${parameters.length + 1} FOR UPDATE SKIP LOCKED`, [...parameters, batchSize]) as Promise<T[]>;
}
