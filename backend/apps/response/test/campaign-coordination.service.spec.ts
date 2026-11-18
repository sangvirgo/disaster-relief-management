import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import { CampaignCoordinationService } from '../src/campaigns/campaign-coordination.service';

const campaignA = '00000000-0000-4000-8000-0000000000a1';
const campaignB = '00000000-0000-4000-8000-0000000000b2';
const userId = '00000000-0000-4000-8000-0000000000c3';
const request = {} as never;

function fixture(grants: ReporterSession['grants'], managerHandler?: (sql: string, values?: unknown[]) => unknown[]) {
  const managerQuery = jest.fn(async (sql: string, values?: unknown[]) => managerHandler?.(sql, values) ?? []);
  const manager = { query: managerQuery } as unknown as EntityManager;
  const dataSourceQuery = jest.fn(async (sql: string, values?: unknown[]) => managerHandler?.(sql, values) ?? []);
  const dataSource = { query: dataSourceQuery } as unknown as DataSource;
  const sessions = { require: jest.fn(async () => ({ userId, grants })) } as unknown as ReporterSessionService;
  const idempotency = {
    execute: jest.fn(async (_source: DataSource, command: Parameters<IdempotencyService['execute']>[1]) => {
      const outcome = await command.execute(manager);
      return { status: outcome.status, value: outcome.value, replay: false };
    }),
  } as unknown as IdempotencyService;
  return { service: new CampaignCoordinationService(dataSource, sessions, idempotency), managerQuery, dataSourceQuery, idempotency };
}

describe('CampaignCoordinationService triage', () => {
  it('sorts deterministically by P1, P2, overdue, wait, fewer coordinators, then id', async () => {
    const rows = [
      { id: campaignB, name: 'B', status: 'ACTIVE', highest_priority: null, highest_priority_unhandled_count: 0,
        p1_count: 0, p2_count: 8, p3_count: 0, p4_count: 0, overdue_count: 99, longest_wait_seconds: 99_000, active_coordinator_count: 0 },
      { id: campaignA, name: 'A', status: 'ACTIVE', highest_priority: 'P1', highest_priority_unhandled_count: 1,
        p1_count: 1, p2_count: 0, p3_count: 0, p4_count: 0, overdue_count: 0, longest_wait_seconds: 0, active_coordinator_count: 0 },
      { id: '00000000-0000-4000-8000-0000000000c4', name: 'C', status: 'ACTIVE', highest_priority: 'P2', highest_priority_unhandled_count: 2,
        p1_count: 0, p2_count: 2, p3_count: 0, p4_count: 0, overdue_count: 1, longest_wait_seconds: 5_000, active_coordinator_count: 0 },
      { id: '00000000-0000-4000-8000-0000000000c5', name: 'D', status: 'ACTIVE', highest_priority: 'P2', highest_priority_unhandled_count: 2,
        p1_count: 0, p2_count: 2, p3_count: 0, p4_count: 0, overdue_count: 1, longest_wait_seconds: 5_000, active_coordinator_count: 1 },
    ];
    const { service, dataSourceQuery } = fixture([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], () => rows);

    const result = await service.triage(request) as { items: Array<{ id: string; urgency: { reason_codes: string[] }; urgency_reasons_vi: string[] }> };

    expect(result.items.map((item) => item.id)).toEqual([
      campaignA, campaignB, '00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000c5',
    ]);
    expect(result.items[0]?.urgency.reason_codes).toEqual(['P1_UNHANDLED', 'NO_COORDINATOR']);
    expect(result.items[0]?.urgency_reasons_vi.every((label) => /[\u00C0-\u024F]/u.test(label))).toBe(true);
    expect(dataSourceQuery.mock.calls[0]?.[0]).toContain("WHERE c.status='ACTIVE'");
  });

  it('refuses overview without a system coordinator grant', async () => {
    const { service, dataSourceQuery } = fixture([{ role_code: 'VOLUNTEER', scope_type: 'SYSTEM' }]);
    await expect(service.overview(request)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(dataSourceQuery).not.toHaveBeenCalled();
  });
});

describe('CampaignCoordinationService engagements', () => {
  it('requires an ACTIVE campaign and inserts one open engagement through the unique-index upsert', async () => {
    const now = new Date();
    const engagement = { id: '00000000-0000-4000-8000-0000000000e1', campaign_id: campaignA, user_id: userId,
      started_at: now, last_active_at: now, ended_at: null, ended_reason: null };
    const { service, managerQuery } = fixture([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], (sql) => {
      if (sql.includes('FROM campaign WHERE')) return [{ id: campaignA, status: 'ACTIVE' }];
      if (sql.includes('FROM campaign_engagement WHERE campaign_id')) return [];
      if (sql.includes('count(*)::int AS count')) return [{ count: 0 }];
      if (sql.includes('INSERT INTO campaign_engagement')) return [engagement];
      return [];
    });

    const result = await service.engage(campaignA, 'idempotency-key', request);

    expect(result.value).toMatchObject({ campaign_id: campaignA, user_id: userId, active: true });
    expect(managerQuery.mock.calls.some(([sql]) => String(sql).includes('ON CONFLICT (campaign_id,user_id) WHERE ended_at IS NULL'))).toBe(true);
  });

  it('rejects PAUSED campaigns and enforces the three-session cap with Vietnamese copy', async () => {
    const paused = fixture([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], (sql) =>
      sql.includes('FROM campaign WHERE') ? [{ id: campaignA, status: 'PAUSED' }] : []);
    await expect(paused.service.engage(campaignA, 'key-paused', request)).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_ACTIVE', status: 409 });

    const limited = fixture([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], (sql) => {
      if (sql.includes('FROM campaign WHERE')) return [{ id: campaignA, status: 'ACTIVE' }];
      if (sql.includes('FROM campaign_engagement WHERE campaign_id')) return [];
      if (sql.includes('count(*)::int AS count')) return [{ count: 3 }];
      return [];
    });
    await expect(limited.service.engage(campaignA, 'key-limited', request)).rejects.toMatchObject({
      code: 'ENGAGEMENT_LIMIT_REACHED', status: 409, userMessage: 'Bạn chỉ có thể điều phối tối đa 3 chiến dịch cùng lúc.',
    });
  });

  it('lets the primary coordinator engage a campaign like other coordinators', async () => {
    const { service, idempotency } = fixture([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }], (sql) => {
      if (sql.includes('FROM campaign WHERE id')) return [{ id: campaignA, status: 'ACTIVE' }];
      if (sql.includes('count(*)')) return [{ count: 0 }];
      if (sql.includes('INSERT INTO campaign_engagement')) {
        return [{ id: '00000000-0000-4000-8000-0000000000e1', campaign_id: campaignA, user_id: userId,
          started_at: new Date(), last_active_at: new Date(), ended_at: null, ended_reason: null }];
      }
      return [];
    });
    const result = await service.engage(campaignA, 'key-main', request);
    expect(idempotency.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(201);
  });
});
