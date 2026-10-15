import { jest } from '@jest/globals';
import type { Request } from 'express';
import type { Grant } from '../../../packages/technical/src/security/permissions';
import { DistributionQueriesService } from '../src/distributions/distribution-queries.service';

const distributionId = '88888888-8888-4888-8888-888888888888';
const handoffId = '99999999-9999-4999-8999-999999999999';
const organizationId = '22222222-2222-4222-8222-222222222222';

const distribution = {
  id: distributionId,
  warehouse_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organization_id: organizationId,
  warehouse_region_code: 'R1',
  warehouse_status: 'ACTIVE',
  relief_point_id: null,
  relief_point_status: null,
  vehicle_id: null,
  vehicle_status: null,
  vehicle_capacity: null,
  vehicle_capacity_unit: null,
  vehicle_capacity_scale: null,
  campaign_id: null,
  purpose: 'REQUEST_AID',
  status: 'DISPATCHED',
  preparer_user_id: '11111111-1111-4111-8111-111111111111',
  approver_user_id: null,
  approved_version: null,
  dispatch_actor_user_id: null,
  dispatched_at: null,
  reconciled_at: null,
  created_at: new Date('2026-10-15T12:00:00.000Z'),
  version: 1,
};

function queriesForHandoff(kind: string | null, grants: Grant[]) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('WHERE d.id=ANY($1::uuid[])')) return [distribution];
    if (sql.includes('SELECT h.handoff_kind FROM handoff_record')) return kind ? [{ handoff_kind: kind }] : [];
    if (sql.includes('SELECT h.id,h.distribution_id')) return [{
      id: handoffId,
      distribution_id: distributionId,
      handoff_kind: kind,
      source_stage: 'IN_TRANSIT',
      receiver_user_id: null,
      receiver_label: null,
      recorder_user_id: '11111111-1111-4111-8111-111111111111',
      confirmation_basis: 'Đã đối chiếu.',
      occurred_at: new Date('2026-10-15T12:00:00.000Z'),
      created_at: new Date('2026-10-15T12:00:00.000Z'),
      decision: null,
      reviewer_user_id: null,
      reason: null,
    }];
    if (sql.includes('SELECT hl.id,hl.distribution_line_id')) return [];
    if (sql.includes('SELECT a.id,a.state,a.size_bytes')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const sessions = {
    require: jest.fn(async () => ({
      userId: distribution.preparer_user_id,
      grants,
      identityHeaders: {},
    })),
  };
  return {
    query,
    service: new DistributionQueriesService({ query } as never, sessions as never),
  };
}

function organizationGrant(role_code: Grant['role_code']): Grant {
  return { role_code, scope_type: 'ORGANIZATION', organization_id: organizationId };
}

describe('DistributionQueriesService handoff detail', () => {
  it('returns only ready attachment metadata for a handoff in the scoped distribution', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('WHERE d.id=ANY($1::uuid[])')) return [distribution];
      if (sql.includes('SELECT h.handoff_kind FROM handoff_record')) return [{ handoff_kind: 'LOSS' }];
      if (sql.includes('SELECT h.id,h.distribution_id')) return [{
        id: handoffId,
        distribution_id: distributionId,
        handoff_kind: 'LOSS',
        source_stage: 'IN_TRANSIT',
        receiver_user_id: null,
        receiver_label: null,
        recorder_user_id: '11111111-1111-4111-8111-111111111111',
        confirmation_basis: 'Đã đối chiếu.',
        occurred_at: new Date('2026-10-15T12:00:00.000Z'),
        created_at: new Date('2026-10-15T12:00:00.000Z'),
        decision: null,
        reviewer_user_id: null,
        reason: null,
      }];
      if (sql.includes('SELECT hl.id,hl.distribution_line_id')) return [];
      if (sql.includes('SELECT a.id,a.state,a.size_bytes')) return [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        state: 'READY',
        size_bytes: '20',
        detected_mime: 'image/png',
        created_at: new Date('2026-10-15T12:01:00.000Z'),
        object_key: 'must-not-be-projected',
      }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const sessions = {
      require: jest.fn(async () => ({
        userId: distribution.preparer_user_id,
        grants: [{ role_code: 'DISTRIBUTION_STAFF', scope_type: 'ORGANIZATION', organization_id: organizationId }],
        identityHeaders: {},
      })),
    };
    const service = new DistributionQueriesService({ query } as never, sessions as never);

    const result = await service.handoffDetail(distributionId, handoffId, {} as Request);

    expect(result.evidence).toEqual([{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      state: 'READY',
      size_bytes: 20,
      detected_mime: 'image/png',
      created_at: '2026-10-15T12:01:00.000Z',
    }]);
    expect(result.evidence).not.toHaveProperty('[0].object_key');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE h.distribution_id=$1 AND h.id=$2'), [distributionId, handoffId]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM logistics_attachment a'), [handoffId, distributionId]);
  });

  it('does not read handoff evidence outside the caller warehouse scope', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('WHERE d.id=ANY($1::uuid[])')) return [distribution];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const sessions = {
      require: jest.fn(async () => ({
        userId: '11111111-1111-4111-8111-111111111111',
        grants: [{ role_code: 'DISTRIBUTION_STAFF', scope_type: 'REGION', organization_id: organizationId, region_code: 'R2' }],
        identityHeaders: {},
      })),
    };
    const service = new DistributionQueriesService({ query } as never, sessions as never);

    await expect(service.handoffDetail(distributionId, handoffId, {} as Request))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps missing handoffs indistinguishable from other not-found records', async () => {
    const { query, service } = queriesForHandoff(null, [organizationGrant('DISTRIBUTION_STAFF')]);

    await expect(service.handoffDetail(distributionId, handoffId, {} as Request))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['DIRECT_HOUSEHOLD', 'OPERATIONS_MANAGER'],
    ['RETURN', 'OPERATIONS_MANAGER'],
    ['LOSS', 'COORDINATOR'],
  ] as const)('denies same-scope users without the handoff-kind permission (%s)', async (kind, role) => {
    const { query, service } = queriesForHandoff(kind, [organizationGrant(role)]);

    await expect(service.handoffDetail(distributionId, handoffId, {} as Request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT h.handoff_kind FROM handoff_record'),
      [distributionId, handoffId],
    );
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('SELECT h.id,h.distribution_id'), expect.anything());
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('SELECT a.id,a.state,a.size_bytes'), expect.anything());
  });

  it.each([
    ['DIRECT_HOUSEHOLD', 'DISTRIBUTION_STAFF'],
    ['POINT_RECEIPT', 'DISTRIBUTION_STAFF'],
    ['HOUSEHOLD_HANDOUT', 'DISTRIBUTION_STAFF'],
    ['RETURN', 'INTAKE_STAFF'],
    ['RETURN', 'DISTRIBUTION_STAFF'],
    ['LOSS', 'DISTRIBUTION_STAFF'],
    ['LOSS', 'OPERATIONS_MANAGER'],
  ] as const)('allows the authorized role for %s (%s)', async (kind, role) => {
    const { query, service } = queriesForHandoff(kind, [organizationGrant(role)]);

    await expect(service.handoffDetail(distributionId, handoffId, {} as Request)).resolves.toMatchObject({
      handoff_kind: kind,
      evidence: [],
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT h.handoff_kind FROM handoff_record'),
      [distributionId, handoffId],
    );
  });
});
