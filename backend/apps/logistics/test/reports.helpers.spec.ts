import { AppError } from '../../../packages/technical/src/errors/errors';
import { encodeKeysetCursor } from '../../../packages/technical/src/pagination/keyset';
import { decodeReportIdCursor, decodeReportPairCursor, reportWindow } from '../src/reports/reports.helpers';

describe('Logistics report helpers', () => {
  it('accepts a valid UTC report window of at most 366 days', () => {
    expect(reportWindow('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toEqual({
      from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z',
    });
  });

  it.each([
    ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z'],
    ['2026-01-01T00:00:00+07:00', '2026-01-02T00:00:00Z'],
    ['2025-01-01T00:00:00Z', '2026-01-03T00:00:00Z'],
  ])('rejects invalid or overlong UTC windows (%s to %s)', (from, to) => {
    expect(() => reportWindow(from, to)).toThrow(AppError);
  });

  it('rejects cursors with a different filter or non-UUID ordering key', () => {
    const filters = { route: 'report', warehouse_id: 'warehouse-1' };
    const cursor = encodeKeysetCursor(['00000000-0000-4000-8000-000000000001'], '00000000-0000-4000-8000-000000000001', filters);
    expect(decodeReportIdCursor(cursor, filters)?.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(() => decodeReportIdCursor(cursor, { ...filters, warehouse_id: 'warehouse-2' })).toThrow(AppError);

    const malformed = encodeKeysetCursor(['not-a-uuid'], 'not-a-uuid', filters);
    expect(() => decodeReportIdCursor(malformed, filters)).toThrow(AppError);
  });

  it('validates a warehouse/item cursor for inventory keys without balance rows', () => {
    const filters = { route: 'report', organization_id: 'org-1' };
    const cursor = encodeKeysetCursor(
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
      '00000000-0000-4000-8000-000000000002',
      filters,
    );
    expect(decodeReportPairCursor(cursor, filters)?.sort).toEqual([
      '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
    ]);

    const invalid = encodeKeysetCursor(['warehouse-1', 'item-1'], 'item-1', filters);
    expect(() => decodeReportPairCursor(invalid, filters)).toThrow(AppError);
  });
});
