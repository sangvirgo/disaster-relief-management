import type { Request } from 'express';
import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import { RequestCampaignAssociationService } from '../src/operations/request-campaign-association.service';
import { RequestOperationsCommandRunner } from '../src/operations/request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from '../src/operations/request-operations.persistence.service';
import { AttachCampaignDto } from '../src/operations/request-operations.dto';

const organizationId = '00000000-0000-4000-8000-000000000001';
const campaignId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const eventId = '00000000-0000-4000-8000-000000000004';
const userId = '00000000-0000-4000-8000-000000000005';
const sourceCampaignId = '00000000-0000-4000-8000-000000000007';
const currentCampaignId = '00000000-0000-4000-8000-000000000008';
const request = {} as Request;
const key = '00000000-0000-4000-8000-000000000006';

function fixture(grants: ReporterSession['grants'] = [{
  role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationId,
  region_code: 'NORTH', campaign_id: null,
}], replayResource?: { type: string; id: string }) {
  const managerQuery = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
  const manager = { query: managerQuery } as unknown as EntityManager;
  const dataSource = { query: jest.fn<(...args: unknown[]) => Promise<unknown[]>>() } as unknown as DataSource;
  const sessions = {
    require: jest.fn<(...args: unknown[]) => Promise<ReporterSession>>().mockResolvedValue({ userId, grants }),
  } as unknown as ReporterSessionService;
  const idempotency = {
    execute: jest.fn(async (_source: DataSource, command: Parameters<IdempotencyService['execute']>[1]) => {
      if (replayResource) {
        const value = await command.replay(manager, replayResource, 200);
        return { status: 200, value, replay: true };
      }
      const outcome = await command.execute(manager);
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  } as unknown as IdempotencyService;
  const runner = new RequestOperationsCommandRunner(dataSource, idempotency);
  const service = new RequestCampaignAssociationService(sessions, runner, new RequestOperationsPersistenceService());
  return { service, managerQuery, sessions, idempotency };
}

function activeCampaign(overrides: Record<string, unknown> = {}) {
  return { id: campaignId, status: 'ACTIVE', organization_id: organizationId, region_code: 'NORTH', ...overrides };
}

function unlockedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId, status: 'VERIFIED', version: 4, organization_id: organizationId,
    region_code: 'NORTH', campaign_id: null, attribution_locked_at: null, ...overrides,
  };
}

describe('RequestCampaignAssociationService', () => {
  it('requires a UUID campaign and expected version in the attach contract', async () => {
    const valid = plainToInstance(AttachCampaignDto, { campaign_id: campaignId, expected_version: '4' });
    expect(await validate(valid)).toHaveLength(0);

    const invalid = plainToInstance(AttachCampaignDto, { campaign_id: 'campaign', expected_version: 0 });
    expect(await validate(invalid)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'campaign_id' }),
      expect.objectContaining({ property: 'expected_version' }),
    ]));
  });

  it('attaches only a compatible active campaign and records a versioned staff event', async () => {
    const { service, managerQuery, idempotency } = fixture();
    managerQuery.mockResolvedValueOnce([{ campaign_id: null }])
      .mockResolvedValueOnce([activeCampaign()])
      .mockResolvedValueOnce([unlockedRequest()])
      .mockResolvedValueOnce([[{ id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: campaignId }], 1])
      .mockResolvedValueOnce([{ id: eventId }]);

    const result = await service.attach(requestId, { campaign_id: campaignId, expected_version: 4 }, key, request);

    expect(result.value).toEqual({ id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: campaignId });
    expect(idempotency.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      command: 'response.requests.attach-campaign',
    }));
    expect(managerQuery.mock.calls[0]?.[0]).toContain('SELECT campaign_id FROM assistance_request');
    expect(managerQuery.mock.calls[1]?.[0]).toContain('FROM campaign WHERE id=$1 FOR SHARE');
    expect(managerQuery.mock.calls[2]?.[0]).toContain('FROM assistance_request WHERE id=$1 FOR UPDATE');
    expect(managerQuery.mock.calls[3]?.[0]).toContain('SET campaign_id=$3,version=version+1');
    expect(managerQuery.mock.calls[4]?.[0]).toContain('INSERT INTO request_event');
    expect(managerQuery.mock.calls[4]?.[1]).toEqual([
      requestId, userId, 'CAMPAIGN_ATTACHED', 'STAFF', 'VERIFIED', 'VERIFIED', null,
      JSON.stringify({ previous_campaign_id: null, campaign_id: campaignId }),
    ]);
  });

  it('requires permission for both the current and target campaign when moving attribution', async () => {
    const { service, managerQuery } = fixture([{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: organizationId,
      region_code: 'NORTH', campaign_id: campaignId,
    }]);
    managerQuery.mockResolvedValueOnce([{ campaign_id: sourceCampaignId }])
      .mockResolvedValueOnce([activeCampaign()])
      .mockResolvedValueOnce([activeCampaign({ id: sourceCampaignId })])
      .mockResolvedValueOnce([unlockedRequest({ campaign_id: sourceCampaignId })]);

    await expect(service.attach(requestId, { campaign_id: campaignId, expected_version: 4 }, key, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(managerQuery).toHaveBeenCalledTimes(4);
  });

  it('rejects attaching to a campaign that is not active', async () => {
    const { service, managerQuery } = fixture();
    managerQuery.mockResolvedValueOnce([{ campaign_id: null }])
      .mockResolvedValueOnce([activeCampaign({ status: 'PAUSED' })]);
    managerQuery.mockResolvedValueOnce([unlockedRequest()]);

    await expect(service.attach(requestId, { campaign_id: campaignId, expected_version: 4 }, key, request))
      .rejects.toMatchObject({ code: 'CAMPAIGN_NOT_ACTIVE', status: 409 });
    expect(managerQuery).toHaveBeenCalledTimes(3);
  });

  it('rejects cross-organization or cross-region campaign association', async () => {
    const { service, managerQuery } = fixture();
    managerQuery.mockResolvedValueOnce([{ campaign_id: null }])
      .mockResolvedValueOnce([activeCampaign({ region_code: 'SOUTH' })])
      .mockResolvedValueOnce([unlockedRequest()]);

    await expect(service.attach(requestId, { campaign_id: campaignId, expected_version: 4 }, key, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(managerQuery).toHaveBeenCalledTimes(3);
  });

  it('rejects changing campaign attribution after it is locked', async () => {
    const { service, managerQuery } = fixture();
    managerQuery.mockResolvedValueOnce([{ campaign_id: null }])
      .mockResolvedValueOnce([activeCampaign()])
      .mockResolvedValueOnce([unlockedRequest({ attribution_locked_at: new Date() })]);

    await expect(service.attach(requestId, { campaign_id: campaignId, expected_version: 4 }, key, request))
      .rejects.toMatchObject({ code: 'ATTRIBUTION_LOCKED', status: 409 });
    expect(managerQuery).toHaveBeenCalledTimes(3);
  });

  it('detaches an unlocked request with a version check and event', async () => {
    const { service, managerQuery } = fixture();
    managerQuery.mockResolvedValueOnce([{ campaign_id: campaignId }])
      .mockResolvedValueOnce([activeCampaign()])
      .mockResolvedValueOnce([unlockedRequest({ campaign_id: campaignId })])
      .mockResolvedValueOnce([[{ id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: null }], 1])
      .mockResolvedValueOnce([{ id: eventId }]);

    const result = await service.detach(requestId, { expected_version: 4 }, key, request);

    expect(result.value).toEqual({ id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: null });
    expect(managerQuery.mock.calls[0]?.[0]).toContain('SELECT campaign_id FROM assistance_request');
    expect(managerQuery.mock.calls[1]?.[0]).toContain('FROM campaign WHERE id=$1 FOR SHARE');
    expect(managerQuery.mock.calls[2]?.[0]).toContain('FROM assistance_request WHERE id=$1 FOR UPDATE');
    expect(managerQuery.mock.calls[3]?.[0]).toContain('SET campaign_id=NULL,version=version+1');
    expect(managerQuery.mock.calls[4]?.[1]).toEqual([
      requestId, userId, 'CAMPAIGN_DETACHED', 'STAFF', 'VERIFIED', 'VERIFIED', null,
      JSON.stringify({ previous_campaign_id: campaignId, campaign_id: null }),
    ]);
  });

  it('rejects a stale expected version before writing detach state', async () => {
    const { service, managerQuery } = fixture();
    managerQuery.mockResolvedValueOnce([{ campaign_id: campaignId }])
      .mockResolvedValueOnce([activeCampaign()])
      .mockResolvedValueOnce([unlockedRequest({ campaign_id: campaignId, version: 5 })]);

    await expect(service.detach(requestId, { expected_version: 4 }, key, request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(managerQuery).toHaveBeenCalledTimes(3);
  });

  it('does not expose a reassigned campaign when replaying an event scoped to the original campaign', async () => {
    const grants: ReporterSession['grants'] = [{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: organizationId,
      campaign_id: campaignId,
    }];
    const { service, managerQuery } = fixture(grants, { type: 'request_event', id: eventId });
    managerQuery.mockResolvedValueOnce([unlockedRequest({ campaign_id: currentCampaignId })])
      .mockResolvedValueOnce([{
        event_type: 'CAMPAIGN_ATTACHED', payload: { campaign_id: campaignId },
      }])
      .mockResolvedValueOnce([{
        id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: currentCampaignId,
        priority: 'P2', priority_basis: 'COMPLETE', verification_revision: 1, canonical_request_id: null,
      }]);

    const failure: unknown = await service.attach(
      requestId, { campaign_id: campaignId, expected_version: 4 }, key, request,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect((failure as { details?: unknown }).details).toBeUndefined();
    expect((failure as { fieldErrors?: unknown }).fieldErrors).toBeUndefined();
    expect((failure as Error).message).not.toContain(campaignId);
    expect((failure as Error).message).not.toContain(currentCampaignId);
    expect(managerQuery).toHaveBeenCalledTimes(2);
  });

  it('keeps the original event campaign permission check on replay', async () => {
    const grants: ReporterSession['grants'] = [{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: organizationId,
      campaign_id: currentCampaignId,
    }];
    const { service, managerQuery } = fixture(grants, { type: 'request_event', id: eventId });
    managerQuery.mockResolvedValueOnce([unlockedRequest({ campaign_id: currentCampaignId })])
      .mockResolvedValueOnce([{
        event_type: 'CAMPAIGN_ATTACHED', payload: { campaign_id: campaignId },
      }]);

    const failure: unknown = await service.attach(
      requestId, { campaign_id: campaignId, expected_version: 4 }, key, request,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect((failure as { details?: unknown }).details).toBeUndefined();
    expect((failure as Error).message).not.toContain(campaignId);
    expect((failure as Error).message).not.toContain(currentCampaignId);
    expect(managerQuery).toHaveBeenCalledTimes(2);
  });

  it('locks the request before reading its replay event and current projection', async () => {
    const { service, managerQuery } = fixture(undefined, { type: 'request_event', id: eventId });
    managerQuery.mockResolvedValueOnce([unlockedRequest({ campaign_id: currentCampaignId })])
      .mockResolvedValueOnce([{
        event_type: 'CAMPAIGN_ATTACHED', payload: { campaign_id: campaignId },
      }])
      .mockResolvedValueOnce([{
        id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: currentCampaignId,
        priority: 'P2', priority_basis: 'COMPLETE', verification_revision: 1, canonical_request_id: null,
      }]);

    const result = await service.attach(
      requestId, { campaign_id: campaignId, expected_version: 4 }, key, request,
    );

    expect(result.value.campaign_id).toBe(currentCampaignId);
    expect(managerQuery).toHaveBeenCalledTimes(3);
    expect(managerQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(managerQuery.mock.calls[1]?.[0]).toContain('FROM request_event');
    expect(managerQuery.mock.calls[2]?.[0]).toContain('verification_revision');
  });

  it('allows a campaign-scoped user to replay a detach after the current association is null', async () => {
    const grants: ReporterSession['grants'] = [{
      role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: organizationId,
      campaign_id: campaignId,
    }];
    const { service, managerQuery } = fixture(grants, { type: 'request_event', id: eventId });
    managerQuery.mockResolvedValueOnce([unlockedRequest()])
      .mockResolvedValueOnce([{
        event_type: 'CAMPAIGN_DETACHED', payload: { previous_campaign_id: campaignId, campaign_id: null },
      }])
      .mockResolvedValueOnce([{
        id: requestId, status: 'VERIFIED', version: 5, region_code: 'NORTH', campaign_id: null,
        priority: 'P2', priority_basis: 'COMPLETE', verification_revision: 1, canonical_request_id: null,
      }]);

    const result = await service.detach(requestId, { expected_version: 4 }, key, request);

    expect(result).toMatchObject({
      status: 200,
      replay: true,
      value: { id: requestId, campaign_id: null },
    });
    expect(managerQuery).toHaveBeenCalledTimes(3);
    expect(managerQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(managerQuery.mock.calls[1]?.[0]).toContain('FROM request_event');
    expect(managerQuery.mock.calls[2]?.[0]).toContain('verification_revision');
  });
});
