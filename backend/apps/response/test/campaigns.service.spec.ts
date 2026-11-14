import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppError } from '@c48/technical/errors/errors';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import { CampaignCreateDto } from '../src/campaigns/campaigns.dto';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { campaignNextStatus, campaignScopePredicate } from '../src/campaigns/campaigns.helpers';

const campaignId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000004';
const request = {} as never;
const idemKey = '00000000-0000-4000-8000-000000000005';

function session(grants: ReporterSession['grants']): ReporterSession {
  return { userId, grants };
}

function fixture(grants: ReporterSession['grants'] = []) {
  const dataSourceQuery = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
  const dataSource = { query: dataSourceQuery } as unknown as DataSource;
  const sessions = {
    require: jest.fn<(...args: unknown[]) => Promise<ReporterSession>>().mockResolvedValue(session(grants)),
  } as unknown as ReporterSessionService;
  const managerQuery = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
  const manager = { query: managerQuery } as unknown as EntityManager;
  const idempotency = {
    execute: jest.fn(async (_source: DataSource, command: Parameters<IdempotencyService['execute']>[1]) => {
      const outcome = await command.execute(manager);
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  } as unknown as IdempotencyService;
  return { service: new CampaignsService(dataSource, sessions, idempotency), dataSource, dataSourceQuery, sessions, manager, managerQuery, idempotency };
}

describe('CampaignsService', () => {

  it('requires a system grant to create a campaign', async () => {
    for (const grants of [
      [],
      [{ role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', campaign_id: campaignId }] as ReporterSession['grants'],
    ]) {
      const { service, idempotency } = fixture(grants);
      await expect(service.create({ name: 'Cứu trợ' }, idemKey, request))
        .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(idempotency.execute).not.toHaveBeenCalled();
    }
  });

  it('allows only the documented lifecycle edges and keeps CLOSED terminal', () => {
    expect(campaignNextStatus('DRAFT', 'activate')).toBe('ACTIVE');
    expect(campaignNextStatus('DRAFT', 'close')).toBe('CLOSED');
    expect(campaignNextStatus('ACTIVE', 'pause')).toBe('PAUSED');
    expect(campaignNextStatus('PAUSED', 'resume')).toBe('ACTIVE');
    expect(campaignNextStatus('ACTIVE', 'close')).toBe('CLOSED');
    expect(campaignNextStatus('PAUSED', 'close')).toBe('CLOSED');
    for (const action of ['activate', 'pause', 'resume', 'close'] as const) {
      expect(() => campaignNextStatus('CLOSED', action)).toThrow(expect.objectContaining({
        code: 'STATE_TRANSITION_INVALID', status: 409,
      }));
    }
  });

  it('keeps campaign-scoped list predicates bound to the granted campaign', () => {
    const values: unknown[] = [];
    const predicate = campaignScopePredicate([{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN',
      campaign_id: campaignId,
    }], 'CAMPAIGN_READ', values);

    expect(values).toEqual([campaignId]);
    expect(predicate).toBe('(id = $1)');
    expect(campaignScopePredicate([{
      role_code: 'COORDINATOR', scope_type: 'SYSTEM',
    }], 'CAMPAIGN_READ', [])).toBe('(TRUE)');
  });

  it('rejects unknown create-body fields and accepts nullable contract fields', async () => {
    const valid = plainToInstance(CampaignCreateDto, {
      name: 'Cứu trợ', objective: null, starts_at: null, ends_at: null,
    });
    expect(await validate(valid as object, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);

    const invalid = plainToInstance(CampaignCreateDto, { name: 'Cứu trợ', unexpected_field: 'value' });
    expect(await validate(invalid as object, { whitelist: true, forbidNonWhitelisted: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'unexpected_field' })]),
    );
  });

  it('locks the campaign before rejecting close while canonical requests remain open', async () => {
    const { service, managerQuery } = fixture([{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', campaign_id: campaignId,
    }]);
    managerQuery.mockResolvedValueOnce([{
      id: campaignId, name: 'Cứu trợ', objective: null,
      status: 'ACTIVE', starts_at: null, ends_at: null, version: 3, created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]).mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(service.transition(campaignId, 'close', { expected_version: 3, reason: 'Kết thúc' }, idemKey, request))
      .rejects.toMatchObject({ code: 'CAMPAIGN_HAS_OPEN_REQUESTS', status: 409 });

    expect(managerQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(managerQuery.mock.calls[1]?.[0]).toContain("status NOT IN ('REJECTED','DUPLICATE','RESOLVED','CLOSED','CANCELLED')");
    expect(managerQuery).toHaveBeenCalledTimes(2);
  });

  it('reads the returned campaign row from TypeORM UPDATE results when transitioning status', async () => {
    const { service, managerQuery } = fixture([{
      role_code: 'COORDINATOR', scope_type: 'SYSTEM',
    }]);
    const campaign = {
      id: campaignId, name: 'Cứu trợ', objective: null,
      status: 'DRAFT', starts_at: null, ends_at: null, version: 1, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const activated = { ...campaign, status: 'ACTIVE', version: 2 };
    managerQuery.mockResolvedValueOnce([campaign]).mockResolvedValueOnce([[activated], 1]).mockResolvedValueOnce([]);

    const result = await service.transition(campaignId, 'activate', { expected_version: 1 }, idemKey, request);

    expect(result.value).toMatchObject({ id: campaignId, status: 'ACTIVE', version: 2 });
    expect(managerQuery.mock.calls[1]?.[0]).toContain('UPDATE campaign');
  });

  it('reads the returned campaign row from TypeORM UPDATE results when patching a draft', async () => {
    const { service, managerQuery } = fixture([{
      role_code: 'COORDINATOR', scope_type: 'SYSTEM',
    }]);
    const campaign = {
      id: campaignId, name: 'Cứu trợ', objective: null,
      status: 'DRAFT', starts_at: null, ends_at: null, version: 1, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const patched = { ...campaign, objective: 'Hỗ trợ người dân', version: 2 };
    managerQuery.mockResolvedValueOnce([campaign]).mockResolvedValueOnce([[patched], 1]).mockResolvedValueOnce([]);

    const result = await service.patch(campaignId, { expected_version: 1, objective: 'Hỗ trợ người dân' }, idemKey, request);

    expect(result.value).toMatchObject({ id: campaignId, objective: 'Hỗ trợ người dân', version: 2 });
    expect(managerQuery.mock.calls[1]?.[0]).toContain('UPDATE campaign');
  });

  it('returns the exact internal allowlist projection', async () => {
    const { service, dataSourceQuery } = fixture();
    dataSourceQuery.mockResolvedValueOnce([{
      id: campaignId, name: 'Cứu trợ', objective: 'Đồ ăn',
      status: 'ACTIVE', starts_at: null, ends_at: null, version: '7', created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]);

    expect(await service.internal(campaignId)).toEqual({
      id: campaignId, status: 'ACTIVE', version: 7,
    });
  });
});
