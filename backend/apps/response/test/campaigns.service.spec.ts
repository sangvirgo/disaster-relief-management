import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppError } from '../../../packages/technical/src/errors/errors';
import type { IdempotencyService } from '../../../packages/technical/src/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import { CampaignCreateDto } from '../src/campaigns/campaigns.dto';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { campaignNextStatus, campaignScopePredicate } from '../src/campaigns/campaigns.helpers';

const organizationA = '00000000-0000-4000-8000-000000000001';
const organizationB = '00000000-0000-4000-8000-000000000002';
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
    lookupRegionNames: jest.fn<(codes: string[]) => Promise<Map<string, string>>>().mockResolvedValue(new Map<string, string>()),
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
  it('derives organization from the single grant matching the requested region', async () => {
    const { service, dataSourceQuery, managerQuery } = fixture([{
      role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationA,
      region_code: 'NORTH', campaign_id: null,
    }]);
    const row = {
      id: campaignId, organization_id: organizationA, region_code: 'NORTH', name: 'Cứu trợ', objective: null,
      status: 'DRAFT', starts_at: null, ends_at: null, version: 1, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    dataSourceQuery.mockResolvedValueOnce([{ '?column?': 1 }]);
    managerQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);

    const result = await service.create({ name: 'Cứu trợ', region_code: 'NORTH' }, idemKey, request);

    expect(result.value).toMatchObject({ organization_id: organizationA, region_code: 'NORTH' });
    expect(managerQuery.mock.calls[0]?.[1]).toEqual([
      organizationA, 'NORTH', 'Cứu trợ', null, null, null, userId,
    ]);
  });

  it('rejects campaign creation when zero or multiple organizations match', async () => {
    for (const grants of [
      [],
      [
        { role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationA, region_code: 'NORTH', campaign_id: null },
        { role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationB, region_code: 'NORTH', campaign_id: null },
      ] as ReporterSession['grants'],
    ]) {
      const { service, idempotency } = fixture(grants);
      await expect(service.create({ name: 'Cứu trợ', region_code: 'NORTH' }, idemKey, request))
        .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(idempotency.execute).not.toHaveBeenCalled();
    }
  });

  it('does not treat a region-scoped grant as organization-wide when region is omitted', async () => {
    const { service, idempotency } = fixture([{
      role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationA,
      region_code: 'NORTH', campaign_id: null,
    }]);

    await expect(service.create({ name: 'Cứu trợ' }, idemKey, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('allows only the documented lifecycle edges and keeps CLOSED terminal', () => {
    expect(campaignNextStatus('DRAFT', 'activate')).toBe('ACTIVE');
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

  it('keeps campaign-scoped list predicates bound to the grant organization', () => {
    const values: unknown[] = [];
    const predicate = campaignScopePredicate([{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: organizationA,
      region_code: null, campaign_id: campaignId,
    }], 'CAMPAIGN_READ', values);

    expect(values).toEqual([organizationA, campaignId]);
    expect(predicate).toBe('((organization_id = $1 AND id = $2))');
  });

  it('rejects organization_id as an extra create-body field and accepts nullable contract fields', async () => {
    const valid = plainToInstance(CampaignCreateDto, {
      name: 'Cứu trợ', objective: null, region_code: null, starts_at: null, ends_at: null,
    });
    expect(await validate(valid as object, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);

    const invalid = plainToInstance(CampaignCreateDto, { name: 'Cứu trợ', organization_id: organizationA });
    expect(await validate(invalid as object, { whitelist: true, forbidNonWhitelisted: true })).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'organization_id' })]),
    );
  });

  it('returns only the public allowlist and uses null when Identity has no region name', async () => {
    const { service, dataSourceQuery, sessions } = fixture();
    dataSourceQuery.mockResolvedValueOnce([{
      id: campaignId, name: 'Cứu trợ', objective: null, region_code: 'NORTH', status: 'ACTIVE',
      starts_at: null, ends_at: null, cursor_created_at: '2026-01-01T00:00:00.000000Z',
    }]);

    const page = await service.publicList({});

    expect(sessions.lookupRegionNames).toHaveBeenCalledWith(['NORTH']);
    expect(page.items[0]).toEqual({
      id: campaignId, title: 'Cứu trợ', objective: null, region_name: null,
      starts_at: null, ends_at: null, status: 'ACTIVE',
    });
  });

  it('fails closed when Identity cannot resolve public campaign region names', async () => {
    const { service, dataSourceQuery, sessions } = fixture();
    dataSourceQuery.mockResolvedValueOnce([{
      id: campaignId, name: 'Cứu trợ', objective: null, region_code: 'NORTH', status: 'ACTIVE',
      starts_at: null, ends_at: null, cursor_created_at: '2026-01-01T00:00:00.000000Z',
    }]);
    (sessions.lookupRegionNames as jest.MockedFunction<(codes: string[]) => Promise<Map<string, string>>>)
      .mockRejectedValueOnce(new AppError('IDENTITY_UNAVAILABLE', { status: 503 }));

    await expect(service.publicList({})).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE', status: 503 });
  });

  it('locks the campaign before rejecting close while canonical requests remain open', async () => {
    const { service, managerQuery } = fixture([{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationA,
      region_code: null, campaign_id: null,
    }]);
    managerQuery.mockResolvedValueOnce([{
      id: campaignId, organization_id: organizationA, region_code: null, name: 'Cứu trợ', objective: null,
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
      role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationA,
      region_code: null, campaign_id: null,
    }]);
    const campaign = {
      id: campaignId, organization_id: organizationA, region_code: null, name: 'Cứu trợ', objective: null,
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
      role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationA,
      region_code: null, campaign_id: null,
    }]);
    const campaign = {
      id: campaignId, organization_id: organizationA, region_code: null, name: 'Cứu trợ', objective: null,
      status: 'DRAFT', starts_at: null, ends_at: null, version: 1, created_at: new Date('2026-01-01T00:00:00.000Z'),
    };
    const patched = { ...campaign, objective: 'Hỗ trợ người dân', version: 2 };
    managerQuery.mockResolvedValueOnce([campaign]).mockResolvedValueOnce([[patched], 1]).mockResolvedValueOnce([]);

    const result = await service.patch(campaignId, { expected_version: 1, objective: 'Hỗ trợ người dân' }, idemKey, request);

    expect(result.value).toMatchObject({ id: campaignId, objective: 'Hỗ trợ người dân', version: 2 });
    expect(managerQuery.mock.calls[1]?.[0]).toContain('UPDATE campaign');
  });

  it('does not allow a region-scoped manager to move a draft campaign outside that region', async () => {
    const { service, managerQuery } = fixture([{
      role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationA,
      region_code: 'NORTH', campaign_id: null,
    }]);
    managerQuery.mockResolvedValueOnce([{
      id: campaignId, organization_id: organizationA, region_code: 'NORTH', name: 'Cứu trợ', objective: null,
      status: 'DRAFT', starts_at: null, ends_at: null, version: 1, created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]).mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([{
      id: campaignId, organization_id: organizationA, region_code: 'SOUTH', name: 'Cứu trợ', objective: null,
      status: 'DRAFT', starts_at: null, ends_at: null, version: 2, created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]).mockResolvedValueOnce([]);

    await expect(service.patch(campaignId, { expected_version: 1, region_code: 'SOUTH' }, idemKey, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('returns the exact internal allowlist projection', async () => {
    const { service, dataSourceQuery } = fixture();
    dataSourceQuery.mockResolvedValueOnce([{
      id: campaignId, organization_id: organizationA, region_code: 'NORTH', name: 'Cứu trợ', objective: 'Đồ ăn',
      status: 'ACTIVE', starts_at: null, ends_at: null, version: '7', created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]);

    expect(await service.internal(campaignId)).toEqual({
      id: campaignId, status: 'ACTIVE', organization_id: organizationA, region_code: 'NORTH', version: 7,
    });
  });
});
