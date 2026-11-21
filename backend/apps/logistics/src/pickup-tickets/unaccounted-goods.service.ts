import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';

export interface UnaccountedGoodsRow {
  ticket_id: string;
  request_id: string | null;
  status: string;
  item_id: string;
  item_name: string;
  unaccounted_quantity: string;
}

/**
 * Goods that a pickup ticket still holds on the team side (in transit) and that no delivery, return or retire has
 * accounted for yet. Filter by ticket IDs or by Response request ID. Only tickets with a positive balance are returned.
 */
export async function unaccountedGoods(
  manager: Pick<EntityManager | DataSource, 'query'>,
  filter: { ticketIds?: readonly string[]; requestId?: string },
): Promise<UnaccountedGoodsRow[]> {
  if (filter.ticketIds !== undefined && filter.ticketIds.length === 0) return [];
  const values: unknown[] = [];
  const where: string[] = [];
  if (filter.ticketIds) {
    values.push([...filter.ticketIds]);
    where.push(`t.id = ANY($${values.length}::uuid[])`);
  }
  if (filter.requestId) {
    values.push(filter.requestId);
    where.push(`t.request_id = $${values.length}`);
  }
  if (where.length === 0) throw new AppError('VALIDATION_FAILED', { status: 400 });
  return manager.query(
    `SELECT t.id AS ticket_id,t.request_id,t.status,dl.item_id,i.name AS item_name,
            SUM(dl.in_transit_quantity)::text AS unaccounted_quantity
       FROM pickup_ticket t JOIN distribution_line dl ON dl.distribution_id=t.distribution_id
       JOIN item i ON i.id=dl.item_id
      WHERE ${where.join(' AND ')}
      GROUP BY t.id,t.request_id,t.status,dl.item_id,i.name
     HAVING SUM(dl.in_transit_quantity) > 0
      ORDER BY t.id,i.name`,
    values,
  ) as Promise<UnaccountedGoodsRow[]>;
}

/**
 * Resolution guard for Response (internal fulfillment read, called before a resolution intent is created). A request cannot
 * be resolved while one of its pickup tickets is still HANDED_OVER with goods that are not accounted for.
 */
@Injectable()
export class UnaccountedGoodsGuard {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async assertRequestResolvable(requestId: string): Promise<void> {
    const rows = await unaccountedGoods(this.dataSource, { requestId });
    const blocking = rows.filter((row) => row.status === 'HANDED_OVER');
    if (blocking.length > 0) {
      throw new AppError('PICKUP_UNACCOUNTED_GOODS', {
        status: 409,
        details: { ticket_ids: [...new Set(blocking.map((row) => row.ticket_id))] },
      });
    }
  }
}
