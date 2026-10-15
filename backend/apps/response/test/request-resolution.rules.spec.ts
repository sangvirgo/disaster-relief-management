import { AppError } from '../../../packages/technical/src/errors/errors';
import { assertResolutionReady, ResolutionMissionEvidence, ResolutionNeedEvidence } from '../src/resolution/request-resolution.rules';

const emptyNeeds: ResolutionNeedEvidence[] = [];
const noMissions: ResolutionMissionEvidence[] = [];

describe('assertResolutionReady', () => {
  it('allows a completed rescue with current-cycle completion evidence', () => {
    expect(() => assertResolutionReady({
      basis: 'RESCUE_COMPLETED',
      reason: 'Người dân đã được sơ tán an toàn.',
      hasPendingSupplement: false,
      missions: [{ status: 'COMPLETED', hasOutcomeEvidence: true, failureReviewed: false }],
      needs: emptyNeeds,
    })).not.toThrow();
  });

  it('allows delivered supplies with settled needs and only declined or cancelled missions', () => {
    expect(() => assertResolutionReady({
      basis: 'SUPPLY_ONLY',
      reason: 'Đã giao đủ vật tư cần thiết.',
      hasPendingSupplement: false,
      missions: [{ status: 'DECLINED', hasOutcomeEvidence: false, failureReviewed: false }],
      needs: [{ status: 'FULFILLED', delivered: '2.000', reserved: '0.000', unsettledIssued: '0.000' }],
    })).not.toThrow();
  });

  it('allows a reviewed failed mission with delivered, settled supplies', () => {
    expect(() => assertResolutionReady({
      basis: 'SUPPLY_ONLY',
      reason: 'Đã giao vật tư; nhiệm vụ cứu hộ không thể tiếp tục.',
      hasPendingSupplement: false,
      missions: [{ status: 'FAILED', hasOutcomeEvidence: false, failureReviewed: true }],
      needs: [{ status: 'FULFILLED', delivered: '1.000', reserved: '0.000', unsettledIssued: '0.000' }],
    })).not.toThrow();
  });

  it('blocks resolution while any active mission remains', () => {
    try {
      assertResolutionReady({
        basis: 'RESCUE_COMPLETED',
        reason: 'Đã hoàn tất cứu hộ.',
        hasPendingSupplement: false,
        missions: [{ status: 'OFFERED', hasOutcomeEvidence: false, failureReviewed: false }],
        needs: emptyNeeds,
      });
      throw new Error('expected resolution to be blocked');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('RESOLUTION_BLOCKED');
      expect((error as AppError).details).toEqual({ reasons: ['ACTIVE_MISSION'] });
    }
  });

  it('blocks resolution when a failed mission has no current-cycle review', () => {
    expect(() => assertResolutionReady({
      basis: 'SUPPLY_ONLY',
      reason: 'Đã giao vật tư cần thiết.',
      hasPendingSupplement: false,
      missions: [{ status: 'FAILED', hasOutcomeEvidence: false, failureReviewed: false }],
      needs: [{ status: 'FULFILLED', delivered: '1.000', reserved: '0.000', unsettledIssued: '0.000' }],
    })).toThrow(expect.objectContaining({ code: 'RESOLUTION_BLOCKED' }));
  });

  it('requires a completed mission with outcome evidence for RESCUE_COMPLETED', () => {
    expect(() => assertResolutionReady({
      basis: 'RESCUE_COMPLETED',
      reason: 'Đã thực hiện cứu hộ.',
      hasPendingSupplement: false,
      missions: [{ status: 'COMPLETED', hasOutcomeEvidence: false, failureReviewed: false }],
      needs: emptyNeeds,
    })).toThrow(expect.objectContaining({ code: 'RESOLUTION_BLOCKED' }));
  });

  it('rejects SUPPLY_ONLY when there is no delivered quantity or a need is unsettled', () => {
    expect(() => assertResolutionReady({
      basis: 'SUPPLY_ONLY',
      reason: 'Cần xác nhận hoàn tất.',
      hasPendingSupplement: false,
      missions: noMissions,
      needs: [{ status: 'OPEN', delivered: '0.000', reserved: '0.000', unsettledIssued: '0.000' }],
    })).toThrow(expect.objectContaining({ code: 'RESOLUTION_BASIS_INVALID' }));

    expect(() => assertResolutionReady({
      basis: 'SUPPLY_ONLY',
      reason: 'Đã giao một phần.',
      hasPendingSupplement: false,
      missions: noMissions,
      needs: [{ status: 'PARTIALLY_FULFILLED', delivered: '1.000', reserved: '0.000', unsettledIssued: '1.000' }],
    })).toThrow(expect.objectContaining({ code: 'RESOLUTION_BLOCKED' }));
  });

  it('rejects NO_ACTION_REQUIRED when needs have delivered or reserved quantity', () => {
    expect(() => assertResolutionReady({
      basis: 'NO_ACTION_REQUIRED',
      reason: 'Không cần thêm hành động.',
      hasPendingSupplement: false,
      missions: noMissions,
      needs: [{ status: 'FULFILLED', delivered: '0.500', reserved: '0.000', unsettledIssued: '0.000' }],
    })).toThrow(expect.objectContaining({ code: 'RESOLUTION_BASIS_INVALID' }));
  });

  it('requires material supplement review to finish first', () => {
    expect(() => assertResolutionReady({
      basis: 'NO_ACTION_REQUIRED',
      reason: 'Không cần thêm hành động.',
      hasPendingSupplement: true,
      missions: noMissions,
      needs: emptyNeeds,
    })).toThrow(expect.objectContaining({ code: 'PENDING_SUPPLEMENT_REVIEW' }));
  });
});
