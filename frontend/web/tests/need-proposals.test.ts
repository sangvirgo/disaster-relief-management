import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageNeedProposals,
  isStaleProposalError,
  proposalErrorMessage,
  runInSequence,
  sameQuantity,
  summarizeProposalGroup,
  swapOptionsFor,
  type ProposalGroup,
  type ProposalLine,
  type SwapItem,
} from '../src/features/need-proposals/needProposalModel.ts';

const line = (overrides: Partial<ProposalLine> = {}): ProposalLine => ({
  need_id: '00000000-0000-4000-8000-000000000001',
  version: 2,
  category: 'WATER',
  item: { id: 'item-water-1l', name: 'Nước suối 1L', unit: { code: 'L', display_name: 'lít', scale: 0 } },
  quantity: '12',
  available: '4',
  shortfall: true,
  reason_codes: ['NORM_BY_GROUP'],
  reasons: [{ code: 'NORM_BY_GROUP', message: 'Tính theo nhóm người' }],
  ...overrides,
});

const group = (overrides: Partial<ProposalGroup> = {}): ProposalGroup => ({
  cycle_id: '00000000-0000-4000-8000-0000000000c1',
  request_id: '00000000-0000-4000-8000-0000000000a1',
  work_cycle: 1,
  campaign_id: '00000000-0000-4000-8000-0000000000b1',
  sos: { people: 5, children: 1, elderly: 1, adults: 3 },
  warehouse: { id: '00000000-0000-4000-8000-0000000000e1' },
  lines: [line(), line({ need_id: '00000000-0000-4000-8000-000000000002', category: 'FOOD', shortfall: false })],
  extraction: {
    source: 'GEMINI', model: 'gemini', unmatched_terms: ['bánh đa'], reasons: [],
    mentioned_items: [{ item_id: 'item-noodle', item_name: 'Mì tôm', category: 'FOOD' }],
  },
  ...overrides,
});

test('only OPERATIONS_MANAGER may use the proposal queue', () => {
  assert.equal(canManageNeedProposals(new Set(['OPERATIONS_MANAGER'])), true);
  assert.equal(canManageNeedProposals(new Set(['COORDINATOR'])), false);
  assert.equal(canManageNeedProposals(new Set(['REVIEWER'])), false);
  assert.equal(canManageNeedProposals(new Set(['VOLUNTEER', 'CITIZEN'])), false);
});

test('group summary counts shortfall lines, unmatched terms and mentioned items', () => {
  const summary = summarizeProposalGroup(group());
  assert.deepEqual(summary, { lineCount: 2, shortfallCount: 1, hasWarehouse: true, unmatchedCount: 1, mentionedCount: 1 });
  const noWarehouse = summarizeProposalGroup(group({ warehouse: null, extraction: null, lines: [] }));
  assert.deepEqual(noWarehouse, { lineCount: 0, shortfallCount: 0, hasWarehouse: false, unmatchedCount: 0, mentionedCount: 0 });
});

test('quantities compare by value, so "2" and "2.000" are the same', () => {
  assert.equal(sameQuantity('2', '2.000'), true);
  assert.equal(sameQuantity('2.5', '2'), false);
});

test('swap choices are limited to active items of the line item type and keep the current item', () => {
  const active: SwapItem[] = [
    { id: 'item-water-1l', name: 'Nước suối 1L', item_type: { code: 'NUOC_UONG' }, unit: { scale: 0 } },
    { id: 'item-water-500', name: 'Nước suối 500ml', item_type: { code: 'NUOC_UONG' }, unit: { scale: 0 } },
    { id: 'item-noodle', name: 'Mì tôm', item_type: { code: 'LUONG_THUC' }, unit: { scale: 0 } },
  ];
  const options = swapOptionsFor(line(), active);
  assert.deepEqual(options.map((option) => option.value), ['item-water-1l', 'item-water-500']);
  const inactiveCurrent = swapOptionsFor(line({ item: { id: 'gone', name: 'Vật phẩm cũ', unit: { code: 'L', display_name: 'lít', scale: 0 } } }), active);
  assert.deepEqual(inactiveCurrent, [{ value: 'gone', label: 'Vật phẩm cũ' }]);
});

test('confirm-all stops at the first failure and reports the lines done before it', async () => {
  const lines = ['a', 'b', 'c', 'd'];
  const attempted: string[] = [];
  const outcome = await runInSequence(lines, async (name) => {
    attempted.push(name);
    if (name === 'c') throw Object.assign(new Error('Dòng đã thay đổi'), { code: 'VERSION_CONFLICT' });
  });
  assert.deepEqual(attempted, ['a', 'b', 'c']);
  assert.deepEqual(outcome.done, ['a', 'b']);
  assert.equal(outcome.failure?.index, 2);
  assert.equal(outcome.failure?.line, 'c');
  assert.equal(isStaleProposalError(outcome.failure?.error), true);
});

test('confirm-all with no failure confirms every line in order', async () => {
  const outcome = await runInSequence(['x', 'y'], async () => undefined);
  assert.deepEqual(outcome.done, ['x', 'y']);
  assert.equal(outcome.failure, null);
});

test('409 and 403 codes get Vietnamese copy, and other errors keep their own message', () => {
  assert.match(proposalErrorMessage({ code: 'FORBIDDEN' }), /không có quyền/);
  assert.match(proposalErrorMessage({ code: 'VERSION_CONFLICT' }), /tải lại/);
  assert.match(proposalErrorMessage({ code: 'STATE_TRANSITION_INVALID' }), /trạng thái chờ duyệt/);
  assert.match(proposalErrorMessage({ code: 'NEED_ITEM_TYPE_MISMATCH' }), /cùng nhóm/);
  assert.equal(proposalErrorMessage(new Error('Máy chủ đang bận.')), 'Máy chủ đang bận.');
  assert.equal(isStaleProposalError({ code: 'NEED_EXISTS' }), false);
});
