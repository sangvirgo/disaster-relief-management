import { orderHandoffLines } from '../src/distributions/handoff-settlement.helpers';

const line = (id: string, item_id: string) => ({
  id,
  distribution_id: 'distribution-1',
  item_id,
  unit_scale: 2,
  quantity: '1.00',
  in_transit_quantity: '1.00',
  at_point_quantity: '0.00',
  warehouse_id: 'warehouse-1',
  commitment_id: null,
  relief_need_id: null,
  cycle_id: null,
  delivery_target_kind: null,
});

describe('orderHandoffLines', () => {
  it('orders returns by item before acquiring stock balance locks', () => {
    const lines = [line('a-line', 'b-item'), line('z-line', 'a-item')];

    expect(orderHandoffLines(lines, 'RETURN').map(({ item_id }) => item_id)).toEqual(['a-item', 'b-item']);
  });

  it('keeps the existing line id order for non-return handoffs', () => {
    const lines = [line('z-line', 'a-item'), line('a-line', 'b-item')];

    expect(orderHandoffLines(lines, 'DIRECT_HOUSEHOLD').map(({ id }) => id)).toEqual(['a-line', 'z-line']);
  });
});
