import { jest } from '@jest/globals';
import type { IdempotentCommand } from '@c48/technical/idempotency/idempotency';
import { RequestOperationsCommandRunner } from '../src/operations/request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from '../src/operations/request-operations.persistence.service';
import { RequestOperationsVerificationService } from '../src/operations/request-operations.verification.service';
import type { OperationRequestRow } from '../src/operations/request-operations.types';

const requestId = '40000000-0000-4000-8000-000000000001';
const userId = '60000000-0000-4000-8000-000000000001';
const organizationId = '70000000-0000-4000-8000-000000000001';
const evidenceId = '90000000-0000-4000-8000-000000000001';

function fixture(options: { reportMode?: 'SELF' | 'PROXY'; evidenceReady?: boolean } = {}) {
  const row: OperationRequestRow = {
    id: requestId, tracking_code: '01HJKMNPQR', tracking_secret_hash: null, reporter_user_id: null,
    reporter_name: null, reporter_contact_phone: null, source_ip_hash: null, report_mode: options.reportMode ?? 'SELF',
    status: 'VERIFYING', version: 2, review_lane: 'NORMAL', received_at: '2026-10-26T00:00:00Z',
    verifying_since: '2026-10-26T00:01:00Z', organization_id: organizationId, region_code: 'DEMO_A', campaign_id: null,
    description: 'Nước ngập.', incident_category_code: 'FLOOD', reporter_declared_danger: false,
    needs_rescue: true, needs_relief_supplies: false, priority: null, priority_basis: null,
    work_cycle: 1, canonical_request_id: null, attribution_locked_at: null,
  };
  const manager = {
    query: jest.fn(async (sql: string, _parameters: unknown[] = []): Promise<unknown[]> => {
      if (sql.includes('FROM assistance_request WHERE id=$1')) return [row];
      if (sql.includes('FROM contact_attempt')) return [];
      if (sql.includes('FROM evidence_metadata')) return options.evidenceReady ? [{ id: evidenceId, uploader_user_id: null, upload_source_ip_hash: null }] : [];
      if (sql.includes('FROM assistance_request r JOIN request_subject')) {
        return [{ ...row, longitude: 106.7, latitude: 10.77, people_affected: 2, location_source: 'GPS' }];
      }
      if (sql.includes('INSERT INTO verification_decision')) return [{ id: 'a0000000-0000-4000-8000-000000000001' }];
      if (sql.includes('INSERT INTO request_event')) return [{ id: 'b0000000-0000-4000-8000-000000000001' }];
      if (sql.includes('UPDATE assistance_request')) return [[{ id: requestId, status: 'VERIFIED', version: 3, verification_revision: 'b0000000-0000-4000-8000-000000000001' }], 1];
      return [];
    }),
  };
  const sessions = { require: async () => ({ userId, grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }] }) };
  const idempotency = { execute: async (_source: unknown, command: IdempotentCommand<Record<string, unknown>>) => {
    const outcome = await command.execute(manager as never);
    return { status: outcome.status, value: outcome.value, replay: false };
  } };
  const runner = new RequestOperationsCommandRunner({} as never, idempotency as never);
  const service = new RequestOperationsVerificationService({} as never, sessions as never, new RequestOperationsPersistenceService(), runner);
  const verify = (body: Record<string, unknown>) => service.verify(requestId, { expected_version: 2, ...body } as never, '80000000-0000-4000-8000-000000000001', {} as never);
  return { manager, verify };
}

describe('request verification without a phone-contact step', () => {
  it('verifies a SELF request from a stated review of the flagged location, information and images with no contact attempt', async () => {
    const { manager, verify } = fixture();
    const result = await verify({ basis: 'EVIDENCE_REVIEWED', reason: 'Đã đối chiếu vị trí, thông tin và hình ảnh.' });
    expect(result.value.status).toBe('VERIFIED');
    expect(manager.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO verification_decision'))).toBe(true);
  });

  it('verifies from ready evidence alone', async () => {
    const { verify } = fixture({ evidenceReady: true });
    const result = await verify({ basis: 'EVIDENCE_REVIEWED', source_refs: { evidence_ids: [evidenceId] } });
    expect(result.value.status).toBe('VERIFIED');
  });

  it('rejects an empty review: no evidence and no stated reason', async () => {
    const { manager, verify } = fixture();
    await expect(verify({ basis: 'EVIDENCE_REVIEWED' })).rejects.toMatchObject({ code: 'VERIFICATION_BASIS_REQUIRED' });
    expect(manager.query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/u.test(sql))).toEqual([]);
  });

  it('never reports NO_CONTACT_ATTEMPT for verification', async () => {
    const { verify } = fixture();
    await expect(verify({ basis: 'EVIDENCE_REVIEWED' })).rejects.not.toMatchObject({ code: 'NO_CONTACT_ATTEMPT' });
  });

  it('still requires independent corroboration or two coordinators for PROXY reports', async () => {
    const { verify } = fixture({ reportMode: 'PROXY' });
    await expect(verify({ basis: 'EVIDENCE_REVIEWED', reason: 'Đã đối chiếu.' })).rejects.toMatchObject({ code: 'SECOND_COORDINATOR_REQUIRED' });
  });
});
