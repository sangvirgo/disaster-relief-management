import { jest } from '@jest/globals';
import { hasPermission, type Grant } from '@c48/identity-contracts/permissions';
import { ReporterSessionService } from '../src/requests/reporter-session';
import { ENGAGEMENT_TTL_MINUTES, engagementActiveSql } from '../src/requests/engagement-ttl';
import { validConcurrence } from '../src/operations/request-operations.verification.helpers';
import { grantCovers, restrictEventPayload } from '../src/operations/request-operations.helpers';
import { requestScopeFilter } from '../src/requests/request-scope';
import type { OperationRequestRow } from '../src/operations/request-operations.types';
import type { RequestCoordinatorGrant } from '../src/requests/reporter-session';

const campaignA = '00000000-0000-4000-8000-0000000000a1';
const campaignB = '00000000-0000-4000-8000-0000000000b1';
const primary = '00000000-0000-4000-8000-000000000011';
const engaged = '00000000-0000-4000-8000-000000000022';
const idle = '00000000-0000-4000-8000-000000000033';
const reviewer = '00000000-0000-4000-8000-000000000044';

function service(items: unknown[], engagedUsers: string[]) {
  const post = jest.fn(async (path: string) => path.endsWith('/internal/request-coordinators')
    ? { status: 200, body: { items } }
    : { status: 200, body: { access_token: 'token', expires_in: 300 } });
  const query = jest.fn(async (..._args: unknown[]) => engagedUsers.map((user_id) => ({ user_id })));
  const instance = new ReporterSessionService({
    identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
    clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
  }, {} as never, { post, close: jest.fn() } as never, { query } as never);
  return { instance, query };
}

const identityItems = [
  { user_id: primary, role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null },
  { user_id: engaged, role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM', campaign_id: null },
  { user_id: idle, role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM', campaign_id: null },
];

describe('Response coordinator grants for campaign coordinators', () => {
  it('keeps the primary coordinator and only campaign coordinators engaged in the campaign', async () => {
    const { instance, query } = service(identityItems, [engaged]);
    const grants = await instance.requestCoordinatorGrants(campaignA);
    expect(grants).toEqual([
      { user_id: primary, role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null },
      { user_id: engaged, role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignA },
    ]);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM campaign_engagement');
    expect(sql).toContain(engagementActiveSql('ce'));
    expect(values).toEqual([campaignA, [engaged, idle]]);
    instance.onModuleDestroy();
  });

  it('never returns campaign coordinators when no campaign is given (conflict notices stay with the primary coordinator)', async () => {
    const { instance, query } = service(identityItems, [engaged]);
    const grants = await instance.requestCoordinatorGrants(null);
    expect(grants.map((grant) => grant.user_id)).toEqual([primary]);
    expect(query).not.toHaveBeenCalled();
    instance.onModuleDestroy();
  });

  it('drops campaign coordinators whose engagement lapsed', async () => {
    const { instance } = service(identityItems, []);
    expect((await instance.requestCoordinatorGrants(campaignA)).map((grant) => grant.user_id)).toEqual([primary]);
    instance.onModuleDestroy();
  });

  it('rejects an Identity item that gives a campaign coordinator a campaign scope', async () => {
    const { instance } = service([{ user_id: engaged, role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignA }], [engaged]);
    await expect(instance.requestCoordinatorGrants(campaignA)).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
    instance.onModuleDestroy();
  });
});

describe('Two-coordinator verification with a campaign coordinator', () => {
  const row = { id: 'r1', campaign_id: campaignA } as unknown as OperationRequestRow;
  function manager(actor: string) {
    return {
      query: jest.fn(async (sql: string) => String(sql).includes("event_type='CONCURRENCE'")
        ? [{ actor_user_id: actor, payload: { material_fact_event_id: null } }]
        : [{ id: null }]),
    } as never;
  }
  const engagedGrant: RequestCoordinatorGrant = { user_id: engaged, role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignA };
  const primaryGrant: RequestCoordinatorGrant = { user_id: primary, role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null };

  it('accepts a concurrence from a campaign coordinator who is still engaged in the request campaign', async () => {
    await expect(validConcurrence(manager(engaged), row, 'e1', reviewer, [primaryGrant, engagedGrant]))
      .resolves.toEqual({ actor_user_id: engaged });
  });
  it('still accepts a concurrence from the primary coordinator', async () => {
    await expect(validConcurrence(manager(primary), row, 'e1', reviewer, [primaryGrant])).resolves.toEqual({ actor_user_id: primary });
  });
  it('rejects a campaign coordinator whose engagement lapsed or who works another campaign', async () => {
    await expect(validConcurrence(manager(engaged), row, 'e1', reviewer, [primaryGrant]))
      .rejects.toMatchObject({ code: 'SECOND_COORDINATOR_REQUIRED' });
    await expect(validConcurrence(manager(engaged), { ...row, campaign_id: campaignB } as OperationRequestRow, 'e1', reviewer, [{ ...engagedGrant }]))
      .rejects.toMatchObject({ code: 'SECOND_COORDINATOR_REQUIRED' });
  });
  it('rejects the same person concurring and verifying', async () => {
    await expect(validConcurrence(manager(engaged), row, 'e1', engaged, [engagedGrant]))
      .rejects.toMatchObject({ code: 'SECOND_COORDINATOR_REQUIRED' });
  });
  it('scopes an engaged campaign coordinator to its own campaign only', () => {
    expect(grantCovers(engagedGrant, { campaign_id: campaignA })).toBe(true);
    expect(grantCovers(engagedGrant, { campaign_id: campaignB })).toBe(false);
    expect(grantCovers(engagedGrant, { campaign_id: null })).toBe(false);
  });
});

describe('Engagement TTL has a single definition', () => {
  it('builds every SQL predicate from the shared constant', () => {
    expect(engagementActiveSql('ce')).toBe(`ce.ended_at IS NULL AND ce.last_active_at > now() - interval '${ENGAGEMENT_TTL_MINUTES} minutes'`);
    expect(() => engagementActiveSql('ce; DROP TABLE x')).toThrow(TypeError);
  });
  it('uses the same predicate for request visibility', () => {
    const values: unknown[] = [];
    const filter = requestScopeFilter([{ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM' }], 'REQUEST_QUEUE_READ', values, 'r', engaged);
    expect(filter).toContain(engagementActiveSql('ce'));
    expect(values).toEqual([engaged]);
  });
});

describe('Who may create or manage campaigns', () => {
  const system = (role_code: Grant['role_code']): Grant[] => [{ role_code, scope_type: 'SYSTEM' }];
  it('lets the primary coordinator and the existing managers create campaigns', () => {
    for (const role of ['COORDINATOR', 'OPERATIONS_MANAGER'] as const) {
      expect(hasPermission(system(role), 'CAMPAIGN_MANAGE', { campaignId: null })).toBe(true);
    }
  });
  it('never lets a campaign coordinator create or manage campaigns, and keeps the shared queue and logistics closed', () => {
    const grants = system('CAMPAIGN_COORDINATOR');
    for (const permission of ['CAMPAIGN_MANAGE', 'REQUEST_UNASSIGNED_QUEUE', 'NEED_MANAGE', 'DISTRIBUTION_PREPARE', 'DISTRIBUTION_REVIEW'] as const) {
      expect(hasPermission(grants, permission, { campaignId: null })).toBe(false);
    }
  });
  it('lets an engaged campaign coordinator resolve or cancel in its own campaign only (asynchronous finalizer check)', () => {
    const engagedGrant: Grant[] = [{ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignA }];
    expect(hasPermission(engagedGrant, 'REQUEST_RESOLVE', { campaignId: campaignA })).toBe(true);
    expect(hasPermission(engagedGrant, 'REQUEST_CANCEL', { campaignId: campaignA })).toBe(true);
    expect(hasPermission(engagedGrant, 'REQUEST_RESOLVE', { campaignId: campaignB })).toBe(false);
  });
});

describe('Event payload references outside the reader scope', () => {
  it('drops references to requests the reader may not see and keeps the visible ones', () => {
    const visible = '00000000-0000-4000-8000-0000000000e1';
    const hidden = '00000000-0000-4000-8000-0000000000e2';
    const payload = restrictEventPayload({
      payload: { canonical_request_id: hidden, recent_request_ids: [visible, hidden], source_refs: { request_ids: [hidden, visible] } },
    } as never, new Set([visible]));
    expect(payload.canonical_request_id).toBeUndefined();
    expect(payload.recent_request_ids).toEqual([visible]);
    expect((payload.source_refs as { request_ids: string[] }).request_ids).toEqual([visible]);
    expect(restrictEventPayload({ payload: { canonical_request_id: visible } } as never, new Set([visible])).canonical_request_id).toBe(visible);
  });
});
