import type { QueryRunner } from 'typeorm';
import { AllowAiAdvisoryRetries1793116235000 } from '../src/database/migrations/AllowAiAdvisoryRetries1793116235000';
import { AllowAiAdvisoryRetryAttempts1793117000000 } from '../src/database/migrations/AllowAiAdvisoryRetryAttempts1793117000000';
import { GrantAiAdvisoryRead1792953600002 } from '../src/database/migrations/GrantAiAdvisoryRead1792953600002';

describe('unbounded retry counter migration', () => {
  it('allows a non-negative attempt counter for durable provider retries', async () => {
    const statements: string[] = [];
    const queryRunner = { query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner;

    await new AllowAiAdvisoryRetryAttempts1793117000000().up(queryRunner);

    expect(statements).toEqual([
      'ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check',
      'ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts >= 0)',
    ]);
  });

  it('caps stored attempts before restoring the bounded constraint', async () => {
    const statements: string[] = [];
    const queryRunner = { query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner;

    await new AllowAiAdvisoryRetryAttempts1793117000000().down(queryRunner);

    expect(statements).toEqual([
      'UPDATE ai_advisory SET attempts=3 WHERE attempts>3',
      'ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check',
      'ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts BETWEEN 0 AND 3)',
    ]);
  });
});

describe('AI advisory retry migration', () => {
  it('allows three counted provider attempts per advisory', async () => {
    const statements: string[] = [];
    const queryRunner = { query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner;

    await new AllowAiAdvisoryRetries1793116235000().up(queryRunner);

    expect(statements).toEqual([
      'ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check',
      'ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts BETWEEN 0 AND 3)',
    ]);
  });

  it('restores the one-attempt constraint safely when rolled back', async () => {
    const statements: string[] = [];
    const queryRunner = { query: async (sql: string) => { statements.push(sql); return []; } } as unknown as QueryRunner;

    await new AllowAiAdvisoryRetries1793116235000().down(queryRunner);

    expect(statements).toEqual([
      'UPDATE ai_advisory SET attempts=1 WHERE attempts>1',
      'ALTER TABLE ai_advisory DROP CONSTRAINT IF EXISTS ai_advisory_attempts_check',
      'ALTER TABLE ai_advisory ADD CONSTRAINT ai_advisory_attempts_check CHECK (attempts BETWEEN 0 AND 1)',
    ]);
  });
});

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
