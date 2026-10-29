import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import type { DistributionLineDto } from './distributions.dto';
import { commitmentRemaining } from './distribution-commands.helpers';
import type { CommitmentContext } from './distribution-commands.helpers';
import type { DistributionContext } from './distributions.read';

interface BalanceRow {
  id: string;
  item_id: string;
  on_hand: string;
  reserved: string;
}

export interface DispatchLine extends DistributionLineDto {
  id: string;
}

export async function loadDispatchLines(manager: EntityManager, distributionId: string): Promise<DispatchLine[]> {
  const rows = await manager.query(
    `SELECT dl.id,dl.item_id,dl.commitment_id,dl.quantity::text,u.scale AS unit_scale
       FROM distribution_line dl JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
      WHERE dl.distribution_id=$1 ORDER BY dl.id`,
    [distributionId],
  ) as Array<DispatchLine & { unit_scale: number }>;
  return rows.map(({ unit_scale, ...line }) => {
    const scale = Number(unit_scale);
    return { ...line, quantity: decimalFromUnits(quantityUnits(line.quantity, scale), scale) };
  });
}

export async function availableCommitmentLines(
  manager: EntityManager,
  distribution: DistributionContext,
): Promise<DistributionLineDto[]> {
  const rows = await manager.query(
    `SELECT cm.id,cm.item_id,cm.warehouse_id,cm.quantity::text,cm.released_quantity::text,cm.issued_quantity::text,u.scale AS unit_scale
       FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
       JOIN fulfillment_cycle c ON c.id=n.cycle_id JOIN item i ON i.id=cm.item_id JOIN unit u ON u.code=i.unit_code
      WHERE cm.warehouse_id=$1 AND c.organization_id=$2 AND c.state='OPEN' AND n.status NOT IN ('CANCELLED','FULFILLED')
        AND cm.quantity > cm.released_quantity + cm.issued_quantity
      ORDER BY c.id,n.id,cm.id LIMIT 51`,
    [distribution.warehouse_id, distribution.organization_id],
  ) as Array<CommitmentContext & { unit_scale: number }>;
  if (rows.length > 50) throw new AppError('TOO_MANY_LINES', { status: 400 });
  return rows.map((row) => ({
    item_id: row.item_id,
    commitment_id: row.id,
    quantity: commitmentRemaining(row, Number(row.unit_scale)),
  }));
}

export async function issueDistributionLines(
  manager: EntityManager,
  distribution: DistributionContext,
  lines: DispatchLine[],
  scales: Map<string, number>,
  commitmentRows: CommitmentContext[],
  actorId: string,
): Promise<void> {
  const itemIds = [...new Set(lines.map((line) => line.item_id))].sort();
  await manager.query(
    `INSERT INTO stock_balance (warehouse_id,item_id)
     SELECT $1,item_id FROM unnest($2::uuid[]) AS item_id ORDER BY item_id
     ON CONFLICT (warehouse_id,item_id) DO NOTHING`,
    [distribution.warehouse_id, itemIds],
  );
  const balances = await manager.query(
    `SELECT id,item_id,on_hand::text,reserved::text FROM stock_balance
      WHERE warehouse_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY item_id`,
    [distribution.warehouse_id, itemIds],
  ) as BalanceRow[];
  const balancesByItem = new Map(balances.map((row) => [row.item_id, row]));
  const commitmentsById = new Map(commitmentRows.map((row) => [row.id, row]));

  for (const line of [...lines].sort((left, right) => left.item_id.localeCompare(right.item_id) || left.id.localeCompare(right.id))) {
    const scale = scales.get(line.item_id);
    const balance = balancesByItem.get(line.item_id);
    if (scale === undefined || !balance) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const quantity = validateQuantity(line.quantity, scale);
    if (distribution.purpose === 'REQUEST_AID') {
      const commitment = line.commitment_id ? commitmentsById.get(line.commitment_id) : undefined;
      if (!commitment) throw new AppError('LINE_ITEM_MISMATCH', { status: 400 });
      const remaining = quantityUnits(commitmentRemaining(commitment, scale), scale);
      if (quantityUnits(quantity, scale) > remaining) throw new AppError('VALIDATION_FAILED', { status: 400 });
      await manager.query(
        `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
         VALUES ($1,'ISSUE',-$2::numeric,-$2::numeric,$3,$4,$5)`,
        [balance.id, quantity, commitment.id, `DISTRIBUTION_ISSUE:${line.id}`, actorId],
      );
      await manager.query('UPDATE commitment SET issued_quantity=issued_quantity+$2::numeric,version=version+1 WHERE id=$1', [commitment.id, quantity]);
    } else {
      await manager.query(
        `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,distribution_line_id,operation_ref,actor_user_id)
         VALUES ($1,'RESERVE',0,$2::numeric,$3,$4,$5)`,
        [balance.id, quantity, line.id, `DISTRIBUTION_RESERVE:${line.id}`, actorId],
      );
      await manager.query(
        `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,distribution_line_id,operation_ref,actor_user_id)
         VALUES ($1,'ISSUE',-$2::numeric,-$2::numeric,$3,$4,$5)`,
        [balance.id, quantity, line.id, `DISTRIBUTION_ISSUE:${line.id}`, actorId],
      );
    }
  }
}
