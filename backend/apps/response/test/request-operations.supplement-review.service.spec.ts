import { jest } from '@jest/globals';
import type { IdempotentCommand } from '../../../packages/technical/src/idempotency/idempotency';
import { RequestOperationsCommandRunner } from '../src/operations/request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from '../src/operations/request-operations.persistence.service';
import { RequestOperationsSupplementReviewService } from '../src/operations/request-operations.supplement-review.service';
import type { OperationRequestRow } from '../src/operations/request-operations.types';

const requestId = '40000000-0000-4000-8000-000000000001';
const eventId = '50000000-0000-4000-8000-000000000001';
const reviewId = '50000000-0000-4000-8000-000000000002';
const userId = '60000000-0000-4000-8000-000000000001';
const organizationId = '70000000-0000-4000-8000-000000000001';

function fixture(options: { locked?: boolean; nextRegion?: string | null; regionScoped?: boolean } = {}) {
  const row: OperationRequestRow = {
    id: requestId, tracking_code: '01HJKMNPQR', tracking_secret_hash: null, reporter_user_id: userId,
    reporter_name: null, reporter_contact_phone: null, source_ip_hash: null, report_mode: 'SELF',
    status: 'IN_PROGRESS', version: 4, review_lane: 'NORMAL', received_at: '2026-10-26T00:00:00Z',
    verifying_since: null, organization_id: organizationId, region_code: 'DEMO_A', campaign_id: null,
    description: 'Nước ngập.', incident_category_code: 'FLOOD', reporter_declared_danger: false,
    needs_rescue: true, needs_relief_supplies: false, priority: 'P1', priority_basis: 'LIFE_THREATENING',
    work_cycle: 1, canonical_request_id: null,
    attribution_locked_at: options.locked ? '2026-10-26T01:00:00Z' : null,
  };
  const reported = { location: { type: 'Point', coordinates: [106.7, 10.77], source: 'MANUAL_PIN' }, reporter_declared_danger: true };
  const manager = {
    query: jest.fn(async (sql: string, _parameters: unknown[] = []): Promise<unknown[]> => {
      if (sql.includes('FROM assistance_request WHERE id=$1')) return [row];
      if (sql.includes("event_type='REPORTER_SUPPLEMENT'")) return [{ id: eventId, payload: { pending_review: true, reported_facts: reported } }];
      if (sql.includes("event_type='SUPPLEMENT_REVIEW'")) return [];
      if (sql.includes('FROM region_boundary')) return options.nextRegion === null ? [] : [{ region_code: options.nextRegion ?? 'DEMO_A' }];
      if (sql.includes('FROM assistance_request r JOIN request_subject')) return [{ ...row, longitude: 106.6, latitude: 10.76 }];
      if (sql.includes('INSERT INTO request_event')) return [{ id: reviewId }];
      if (sql.includes('UPDATE assistance_request')) return [[{ status: row.status, version: 5, verification_revision: reviewId }], 1];
      return [];
    }),
  };
  const sessions = { require: async () => ({ userId, grants: [{
    role_code: 'COORDINATOR', scope_type: options.regionScoped ? 'REGION' : 'ORGANIZATION',
    organization_id: organizationId, ...(options.regionScoped ? { region_code: 'DEMO_A' } : {}),
  }] }) };
  const idempotency = { execute: async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
    const outcome = await command.execute(manager as never);
    return { status: outcome.status, value: outcome.value, replay: false };
  } };
  const runner = new RequestOperationsCommandRunner({} as never, idempotency as never);
  const service = new RequestOperationsSupplementReviewService(sessions as never, new RequestOperationsPersistenceService(), runner);
  const review = (decision: 'ACCEPT' | 'REJECT' = 'ACCEPT') => service.reviewSupplement(requestId, eventId, {
    expected_version: 4, decision, reason: 'Đã xác minh vị trí cập nhật.',
  }, '80000000-0000-4000-8000-000000000001', {} as never);
  return { manager, review };
}

function expectNoWrites(manager: ReturnType<typeof fixture>['manager']) {
  expect(manager.query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/u.test(sql))).toEqual([]);
}

describe('supplement review attribution', () => {
  it.each(['DEMO_B', null])('rejects a locked cycle region change to %s before writing approved facts or history', async (nextRegion) => {
    const { manager, review } = fixture({ locked: true, nextRegion });
    await expect(review()).rejects.toMatchObject({ code: 'ATTRIBUTION_LOCKED', status: 409 });
    expectNoWrites(manager);
  });

  it('accepts same-region location and danger updates in a locked cycle', async () => {
    const { manager, review } = fixture({ locked: true });
    await expect(review()).resolves.toMatchObject({ status: 200, value: { version: 5, verification_revision: reviewId } });
    expect(manager.query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    const subjectUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE request_subject'));
    expect(subjectUpdate?.[1]?.slice(5, 9)).toEqual([true, 106.7, 10.77, 'MANUAL_PIN']);
    const requestUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE assistance_request'));
    expect(requestUpdate?.[1]?.slice(4, 10)).toEqual([true, true, true, 'DEMO_A', true, reviewId]);
  });

  it('accepts a permitted region change before attribution is locked', async () => {
    const { manager, review } = fixture({ nextRegion: 'DEMO_B' });
    await expect(review()).resolves.toMatchObject({ status: 200 });
    const requestUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE assistance_request'));
    expect(requestUpdate?.[1]?.slice(6, 8)).toEqual([true, 'DEMO_B']);
  });

  it('retains target-region permission checks before attribution is locked', async () => {
    const { manager, review } = fixture({ nextRegion: 'DEMO_B', regionScoped: true });
    await expect(review()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expectNoWrites(manager);
  });

  it('can reject a cross-region supplement without changing locked approved facts', async () => {
    const { manager, review } = fixture({ locked: true, nextRegion: 'DEMO_B' });
    await expect(review('REJECT')).resolves.toMatchObject({ status: 200, value: { decision: 'REJECT' } });
    expect(manager.query.mock.calls.some(([sql]) => sql.includes('FROM region_boundary') || sql.includes('UPDATE request_subject'))).toBe(false);
    const requestUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE assistance_request'));
    expect(requestUpdate?.[1]?.slice(4, 10)).toEqual([false, true, false, 'DEMO_A', false, reviewId]);
  });
});
