import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { RegionsService } from '../src/regions/regions.service';

function build(rows: unknown[]) {
  const query = jest.fn(async () => rows);
  const service = new RegionsService({ query } as unknown as DataSource, {} as never, {} as never);
  return { service, query };
}

describe('RegionsService.list', () => {
  it('returns the optimistic-lock version as a number and selects it', async () => {
    const { service, query } = build([
      { code: 'AAA', name: 'Khu A', status: 'ACTIVE', version: '4' },
      { code: 'BBB', name: 'Khu B', status: 'INACTIVE', version: 2 },
    ]);

    const page = await service.list({}) as { items: Array<Record<string, unknown>>; next_cursor: string | null };

    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT code, name, status, version FROM region'), expect.anything());
    expect(page.items).toEqual([
      { code: 'AAA', name: 'Khu A', status: 'ACTIVE', version: 4 },
      { code: 'BBB', name: 'Khu B', status: 'INACTIVE', version: 2 },
    ]);
    expect(page.next_cursor).toBeNull();
  });

  it('still returns next_cursor and trims the extra row when more pages exist', async () => {
    const { service } = build([
      { code: 'AAA', name: 'A', status: 'ACTIVE', version: 1 },
      { code: 'BBB', name: 'B', status: 'ACTIVE', version: 1 },
    ]);

    const page = await service.list({ limit: 1 }) as { items: unknown[]; next_cursor: string | null };

    expect(page.items).toHaveLength(1);
    expect(typeof page.next_cursor).toBe('string');
  });
});
