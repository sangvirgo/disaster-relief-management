import { EntityManager } from 'typeorm';
import { AppError } from './errors';

export interface VersionedUpdate {
  table: string;
  idColumn: string;
  id: string | number;
  expectedVersion: number;
  changes: Record<string, unknown>;
}

const identifier = /^[a-z_][a-z0-9_]*$/i;

export async function updateWhereVersion<T extends object>(
  manager: Pick<EntityManager, 'query' | 'queryRunner'>,
  update: VersionedUpdate,
): Promise<T> {
  const table = update.table.split('.');
  if (!table.every((part) => identifier.test(part)) || !identifier.test(update.idColumn) || update.idColumn === 'version' ||
      !Number.isSafeInteger(update.expectedVersion) || update.expectedVersion < 1 ||
      (typeof update.id !== 'string' && typeof update.id !== 'number') || update.id === '' ||
      (typeof update.id === 'number' && !Number.isSafeInteger(update.id))) {
    throw new TypeError('Invalid versioned update target');
  }
  if (!manager.queryRunner?.isTransactionActive) throw new TypeError('Versioned updates require an active transaction');
  const entries = Object.entries(update.changes);
  if (!entries.length || entries.some(([key]) => !identifier.test(key) || key === 'version' || key === update.idColumn)) {
    throw new TypeError('Invalid versioned update changes');
  }

  const quote = (value: string) => `"${value}"`;
  const values = entries.map(([, value]) => value);
  const set = entries.map(([key], index) => `${quote(key)} = $${index + 1}`);
  set.push('"version" = "version" + 1');
  values.push(update.id, update.expectedVersion);
  const rows = await manager.query(
    `UPDATE ${table.map(quote).join('.')} SET ${set.join(', ')} WHERE ${quote(update.idColumn)} = $${values.length - 1} AND "version" = $${values.length} RETURNING *`,
    values,
  ) as T[];
  if (rows.length !== 1) throw new AppError('VERSION_CONFLICT', { status: 409 });
  return rows[0]!;
}
