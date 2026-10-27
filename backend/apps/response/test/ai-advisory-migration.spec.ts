import type { QueryRunner } from 'typeorm';
import { GrantAiAdvisoryRead1792953600002 } from '../src/database/migrations/GrantAiAdvisoryRead1792953600002';

describe('AI advisory runtime read grants', () => {
  it('grants the response application role read access to advisory records and usage counters', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => { statements.push(sql); return []; },
    } as unknown as QueryRunner;

    await new GrantAiAdvisoryRead1792953600002().up(queryRunner);

    expect(statements).toContain('GRANT SELECT ON ai_advisory, ai_daily_usage TO c48_response_app');
  });

  it('reverses the read grant', async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => { statements.push(sql); return []; },
    } as unknown as QueryRunner;

    await new GrantAiAdvisoryRead1792953600002().down(queryRunner);

    expect(statements).toContain('REVOKE SELECT ON ai_advisory, ai_daily_usage FROM c48_response_app');
  });
});
