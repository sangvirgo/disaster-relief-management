import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canPickupAction,
  closeoutSavePayload,
  localDateTimeValue,
  permissionsForRoles,
  rejectNoteError,
  reviewReturnBlock,
  scaledUnits,
  selfActionBlock,
  validateCloseoutDraft,
  validateDelivery,
  type CloseoutDraftLine,
} from '../src/features/pickup/pickupRules.ts';
import { actorLabel, pickupErrorMessage } from '../src/features/pickup/pickupCopy.ts';

const line = (overrides: Partial<CloseoutDraftLine> = {}): CloseoutDraftLine => ({
  item_id: 'item-1',
  item_name: 'Nước uống',
  unit_code: 'chai',
  returnable: true,
  perishable: false,
  held: '10',
  delivered: '6',
  returned: '4',
  retired: '0',
  retire_reason: null,
  note: null,
  ...overrides,
});

test('role gating: coordinator creates and views, operations manager runs the inner steps, reviewer only reviews', () => {
  const coordinator = permissionsForRoles(['COORDINATOR']);
  assert.equal(canPickupAction('create', coordinator), true);
  assert.equal(canPickupAction('cancel', coordinator), true);
  assert.equal(canPickupAction('closeoutSubmit', coordinator), true);
  assert.equal(canPickupAction('reserve', coordinator), false);
  assert.equal(canPickupAction('handover', coordinator), false);
  assert.equal(canPickupAction('delivery', coordinator), false);

  const operations = permissionsForRoles(['OPERATIONS_MANAGER']);
  for (const action of ['create', 'reserve', 'confirm', 'handover', 'delivery', 'closeoutReview'] as const) {
    assert.equal(canPickupAction(action, operations), true, action);
  }

  const reviewer = permissionsForRoles(['REVIEWER']);
  assert.equal(canPickupAction('closeoutReview', reviewer), true);
  assert.equal(canPickupAction('confirm', reviewer), false, 'confirm is gated by PICKUP_TICKET_MANAGE, which reviewer lacks');
  assert.equal(canPickupAction('closeoutView', reviewer), true, 'reviewer reads the ticket so the independent close-out review can run');
  assert.equal(canPickupAction('create', permissionsForRoles(['VOLUNTEER'])), false);
});

test('self-action hints mirror the separation-of-duties rules', () => {
  const ticket = { reserved_by: 'u1', confirmed_by: 'u2', handed_over_by: 'u3' };
  assert.match(selfActionBlock('confirm', 'u1', ticket) ?? '', /Người giữ hàng/);
  assert.equal(selfActionBlock('confirm', 'u9', ticket), null);
  assert.match(selfActionBlock('handover', 'u2', ticket) ?? '', /Người xác nhận/);
  assert.equal(selfActionBlock('handover', 'u1', ticket), null);
  assert.match(selfActionBlock('review', 'u3', ticket) ?? '', /bàn giao/);
});

test('reviewer cannot approve a close-out that returns goods', () => {
  const reviewer = permissionsForRoles(['REVIEWER']);
  const operations = permissionsForRoles(['OPERATIONS_MANAGER']);
  const withReturn = [{ returned_quantity: '2' }];
  const retireOnly = [{ returned_quantity: '0' }];
  assert.match(reviewReturnBlock(reviewer, withReturn) ?? '', /quản lý vận hành duyệt/);
  assert.equal(reviewReturnBlock(reviewer, retireOnly), null);
  assert.equal(reviewReturnBlock(operations, withReturn), null);
});

test('decimal arithmetic uses a common scale and rejects non-plain decimals', () => {
  assert.deepEqual(scaledUnits(['0.5', '2']), [5n, 20n]);
  assert.equal(scaledUnits(['-1', '2']), null);
  assert.equal(scaledUnits(['1e3', '2']), null);
});

test('close-out invariant: delivered + returned + retired must equal held', () => {
  assert.deepEqual(validateCloseoutDraft([line()]), {});

  const mismatch = validateCloseoutDraft([line({ returned: '3' })]);
  assert.match(mismatch['item-1'], /phải bằng số đã giữ 10/);

  const noReason = validateCloseoutDraft([line({ delivered: '5', returned: '0', retired: '5', retire_reason: null })]);
  assert.match(noReason['item-1'], /Cần chọn lý do/);

  const reasoned = validateCloseoutDraft([line({ delivered: '5', returned: '0', retired: '5', retire_reason: 'EXPIRED' })]);
  assert.deepEqual(reasoned, {});
});

test('non-returnable and perishable items cannot be returned to stock', () => {
  const nonReturnable = validateCloseoutDraft([line({ returnable: false, delivered: '6', returned: '4', retired: '0' })]);
  assert.match(nonReturnable['item-1'], /không được nhập lại kho/);
  const perishable = validateCloseoutDraft([line({ perishable: true, delivered: '6', returned: '4', retired: '0' })]);
  assert.match(perishable['item-1'], /không được nhập lại kho/);
});

test('close-out save payload omits the reason when nothing is retired', () => {
  const [kept] = closeoutSavePayload([line({ retire_reason: 'LOST' })]);
  assert.equal('retire_reason' in kept, false);
  const [retired] = closeoutSavePayload([line({ delivered: '5', returned: '0', retired: '5', retire_reason: 'LOST' })]);
  assert.equal(retired.retire_reason, 'LOST');
  assert.equal(retired.returned_quantity, '0');
});

test('reject note is required and bounded', () => {
  assert.match(rejectNoteError('   ') ?? '', /Cần ghi lý do/);
  assert.equal(rejectNoteError('Thiếu chứng từ'), null);
  assert.match(rejectNoteError('x'.repeat(2001)) ?? '', /2.000/);
});

test('delivery validation caps quantities at remaining custody and checks the time', () => {
  const now = new Date('2026-11-18T10:00:00Z');
  const lines = [
    { item_id: 'a', item_name: 'Gạo', unit_code: 'kg', remaining: '5', quantity: '' },
    { item_id: 'b', item_name: 'Mì', unit_code: 'gói', remaining: '3', quantity: '' },
  ];
  const empty = validateDelivery(lines, '2026-11-18T09:00Z', now);
  assert.equal(empty.valid, false);
  assert.match(empty.formError ?? '', /ít nhất một mặt hàng/);

  const over = validateDelivery([{ ...lines[0], quantity: '5.5' }], '2026-11-18T09:00Z', now);
  assert.match(over.fieldErrors['quantity:a'], /không được vượt quá số đang giữ/i);

  const future = validateDelivery([{ ...lines[0], quantity: '1' }], '2026-11-18T12:00Z', now);
  assert.match(future.fieldErrors.occurred_at, /tương lai/);

  const ok = validateDelivery([{ ...lines[0], quantity: '2' }, { ...lines[1], quantity: '' }], '2026-11-18T09:00Z', now);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.lines, [{ item_id: 'a', quantity: '2' }]);
});

test('datetime-local value is local time without seconds', () => {
  assert.match(localDateTimeValue(new Date()), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('error copy: context copy for 403, code copy next, API message as fallback', () => {
  const forbidden = { code: 'FORBIDDEN', message: 'Bạn không có quyền xem hoặc thực hiện thao tác này.' };
  assert.match(pickupErrorMessage(forbidden, 'handover'), /quản lý vận hành có quyền xuất kho/);
  assert.match(pickupErrorMessage({ code: 'SELF_APPROVAL_FORBIDDEN', message: 'x' }), /tự xác nhận/);
  assert.match(pickupErrorMessage({ code: 'PICKUP_TICKET_EXISTS', message: 'x' }), /đã có phiếu/);
  assert.equal(pickupErrorMessage({ code: 'SOMETHING_NEW', message: 'Thông báo từ máy chủ.' }), 'Thông báo từ máy chủ.');
  assert.equal(pickupErrorMessage(new Error('boom')), 'boom');
  assert.equal(pickupErrorMessage(undefined), 'Chưa thể hoàn tất thao tác. Vui lòng thử lại.');
});

test('actor label hides identifiers for the current user', () => {
  assert.equal(actorLabel('abc', 'abc'), 'Bạn');
  assert.equal(actorLabel('0123456789-abcdef', 'other'), 'Người dùng …abcdef');
  assert.equal(actorLabel(null, 'other'), 'Chưa có thông tin');
});
