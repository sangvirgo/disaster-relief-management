import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { jest } from '@jest/globals';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { StockReportService } from '../src/reports/stock-report.service';

describe('StockReportService', () => {
  it('returns warehouse/item quantities with held and in-transit kept separate', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>().mockResolvedValue([
      {
        balance_id: '00000000-0000-4000-8000-000000000001', warehouse_id: 'warehouse-1', item_id: 'item-1',
        item_name: 'Nước uống', unit_code: 'BOTTLE', unit_name: 'Chai', unit_scale: 0,
        on_hand: '12', reserved: '3', available: '9', held: '2', in_transit: '4',
      },
      {
        balance_id: '00000000-0000-4000-8000-000000000002', warehouse_id: 'warehouse-1', item_id: 'item-2',
        item_name: 'Gạo', unit_code: 'KG', unit_name: 'Kilôgam', unit_scale: 3,
        on_hand: '5.500', reserved: '0.500', available: '5.000', held: '0', in_transit: '0',
      },
    ]);
    const dataSource = { query } as unknown as DataSource;
    const requireSession = jest.fn<() => Promise<{ userId: string; grants: Array<Record<string, unknown>> }>>().mockResolvedValue({
        userId: 'user-1', grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: 'org-1' }],
      });
    const sessions = { require: requireSession } as unknown as LogisticsSessionService;
    const reports = new StockReportService(dataSource, sessions);

    const result = await reports.summary({ limit: 1, warehouse_id: 'warehouse-1' }, {} as Request);

    expect(result.items).toEqual([{
      warehouse_id: 'warehouse-1',
      item: { id: 'item-1', name: 'Nước uống' },
      unit: { code: 'BOTTLE', display_name: 'Chai', scale: 0 },
      on_hand: '12', reserved: '3', available: '9', held: '2', in_transit: '4',
    }]);
    expect(result.more).toBe(true);
    expect(typeof result.cursor).toBe('string');
    expect(typeof result.generated_at).toBe('string');
  });

  it('includes an item with held quantity even when it has no stock balance', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([{
      warehouse_id: '00000000-0000-4000-8000-000000000001',
      item_id: '00000000-0000-4000-8000-000000000002',
      item_name: 'Gạo', unit_code: 'KG', unit_name: 'Kilôgam', unit_scale: 3,
      on_hand: '0', reserved: '0', available: '0', held: '2.000', in_transit: '0',
      }, {
        warehouse_id: '00000000-0000-4000-8000-000000000001',
        item_id: '00000000-0000-4000-8000-000000000003',
        item_name: 'Nước', unit_code: 'BOTTLE', unit_name: 'Chai', unit_scale: 0,
        on_hand: '1', reserved: '0', available: '1', held: '0', in_transit: '0',
      }])
      .mockResolvedValueOnce([]);
    const dataSource = { query } as unknown as DataSource;
    const requireSession = jest.fn<() => Promise<{ userId: string; grants: Array<Record<string, unknown>> }>>().mockResolvedValue({
        userId: 'user-1', grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: 'org-1' }],
      });
    const sessions = { require: requireSession } as unknown as LogisticsSessionService;
    const reports = new StockReportService(dataSource, sessions);

    const result = await reports.summary({ limit: 1 }, {} as Request);

    expect(result.items).toEqual([{
      warehouse_id: '00000000-0000-4000-8000-000000000001',
      item: { id: '00000000-0000-4000-8000-000000000002', name: 'Gạo' },
      unit: { code: 'KG', display_name: 'Kilôgam', scale: 3 },
      on_hand: '0', reserved: '0', available: '0', held: '2.000', in_transit: '0',
    }]);
    expect(result.more).toBe(true);
    await reports.summary({ limit: 1, cursor: String(result.cursor) }, {} as Request);

    const firstPageSql = String(query.mock.calls[0]?.[0]);
    const nextPageSql = String(query.mock.calls[1]?.[0]);
    expect(firstPageSql).toContain('UNION ALL');
    expect(firstPageSql).toContain('NOT EXISTS');
    expect(nextPageSql).toContain('(inventory.warehouse_id,inventory.item_id)>');
  });
});
