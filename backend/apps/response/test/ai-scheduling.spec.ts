import { jest } from '@jest/globals';
import { aiAssessmentHash, enqueueAiAdvisory } from '../src/ai/ai-advisory-input';
import { currentAiAdvisory } from '../src/ai/ai-priority-advisory';
import { TrackingService } from '../src/tracking/tracking.service';
import { RequestResolutionStateService } from '../src/resolution/request-resolution-state.service';

function fixture() {
  const row = { id: 'request', status: 'SUBMITTED', version: 1, review_lane: 'NORMAL', incident_category_code: 'FLOOD',
    description: 'Nước dâng cao.', reporter_declared_danger: true, needs_rescue: true, needs_relief_supplies: false, work_cycle: 1 };
  const subject = { people_affected: 1, children_count: null, elderly_count: null };
  const storedFacts = () => ({ version: row.version, workCycle: row.work_cycle, incidentCategoryCode: row.incident_category_code,
    description: row.description, reporterDeclaredDanger: row.reporter_declared_danger, needsRescue: row.needs_rescue,
    needsReliefSupplies: row.needs_relief_supplies, peopleAffected: subject.people_affected, childrenCount: null, elderlyCount: null });
  const inserted: Array<{ request_version: number; input_hash: string }> = [];
  const query = jest.fn(async (sql: string, parameters: unknown[] = []): Promise<unknown[]> => {
    if (sql.includes('SELECT r.version')) return [storedFacts()];
    if (sql.includes('SELECT people_affected')) return [{ ...subject }];
    if (sql.includes('UPDATE assistance_request')) {
      row.version++;
      return [[{ status: row.status, version: row.version, tracking_code: '01HJKMNPQR' }], 1];
    }
    if (sql.includes('UPDATE request_subject')) { subject.people_affected = Number(parameters[1]); return []; }
    if (sql.includes('INSERT INTO ai_advisory')) {
      inserted.push({ request_version: Number(parameters[1]), input_hash: String(parameters[2]) });
      return [];
    }
    if (sql.includes('INSERT INTO request_event')) return [{ id: 'event' }];
    return [];
  });
  const manager = { query };
  const service = new TrackingService({} as never,
    { execute: async (_source: unknown, command: { execute: (manager: unknown) => Promise<unknown> }) => command.execute(manager) } as never,
    { validTrackingSecret: () => true, trackingSecretHash: () => 'hash', forRequest: async () => ({ ...row }) } as never,
    { optional: async () => null } as never, {} as never, {} as never);
  const update = (fields: Record<string, unknown>) => service.supplement('request', { expected_version: row.version, ...fields } as never, 'key', '01HJKMNPQR', 'secret', {} as never);
  return { manager, row, storedFacts, inserted, update };
}

describe('reporter advisory scheduling', () => {
  it('uses the sticky persisted danger value when a supplement submits false', async () => {
    const { row, storedFacts, inserted, update } = fixture();
    await update({ reporter_declared_danger: false });
    expect(row.reporter_declared_danger).toBe(true);
    expect(inserted[0]).toEqual({ request_version: 2, input_hash: aiAssessmentHash(storedFacts(), 2, 1) });
  });

  it('creates distinct current revisions for headcount A → B → A', async () => {
    const { manager, storedFacts, inserted, update } = fixture();
    await enqueueAiAdvisory(manager as never, 'request');
    await update({ people_affected: 20 });
    await update({ people_affected: 1 });
    expect(inserted.map((item) => item.request_version)).toEqual([1, 2, 3]);
    expect(new Set(inserted.map((item) => item.input_hash)).size).toBe(3);
    expect(inserted[2]?.input_hash).toBe(aiAssessmentHash(storedFacts(), 3, 1));
    expect(currentAiAdvisory({ ...inserted[1], status: 'COMPLETED', extracted_json: { priority_score: 90 } }, storedFacts(), 1))
      .toMatchObject({ status: 'STALE', extracted_json: null, risk_score: null });
  });

  it('does not enqueue changes that only affect household reference notes', async () => {
    const { inserted, update } = fixture();
    await update({ household_reference_note: 'Gần trường học.' });
    expect(inserted).toEqual([]);
  });

  it('enqueues a new input revision when the coordinator reopens a work cycle', async () => {
    const requestId = 'request';
    const row = { id: requestId, status: 'CLOSED', version: 4, work_cycle: 1, organization_id: 'organization', region_code: null, campaign_id: null, reporter_user_id: null };
    const facts = { version: 5, workCycle: 2, incidentCategoryCode: 'FLOOD', description: 'Nước dâng cao.', needsRescue: true };
    const query = jest.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('SELECT r.version')) return [facts];
      if (sql.includes('SELECT id,status,version')) return [row];
      if (sql.includes('UPDATE assistance_request')) return [[{ ...row, status: 'TRIAGED', version: 5, work_cycle: 2 }], 1];
      return [];
    });
    const session = { userId: 'coordinator', grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: 'organization' }] };
    const service = new RequestResolutionStateService({ query } as never,
      { execute: async (_source: unknown, command: { execute: (manager: unknown) => Promise<unknown> }) => command.execute({ query }) } as never,
      { require: async () => session } as never);
    await service.reopen(requestId, { expected_version: 4, reason: 'Nước tiếp tục dâng.' }, 'key', {} as never);
    const call = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO ai_advisory')) as unknown as [string, unknown[]];
    expect(call?.[1]?.slice(0, 3)).toEqual([requestId, 5, aiAssessmentHash(facts, 5, 2)]);
  });
});
