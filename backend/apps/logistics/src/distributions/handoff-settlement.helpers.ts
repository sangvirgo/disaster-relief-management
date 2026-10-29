import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { DistributionHandoffKind, HandoffSourceStage, SettlementType, handoffSettlementType } from './distributions.helpers';

export interface DistributionHandoffLineContext {
  id: string;
  distribution_id: string;
  item_id: string;
  unit_scale: number;
  quantity: string;
  in_transit_quantity: string;
  at_point_quantity: string;
  warehouse_id: string;
  commitment_id: string | null;
  relief_need_id: string | null;
  cycle_id: string | null;
  delivery_target_kind: 'FINAL_RECIPIENT' | 'RELIEF_POINT' | null;
}

export function orderHandoffLines(
  lines: readonly DistributionHandoffLineContext[],
  handoffKind: DistributionHandoffKind,
): DistributionHandoffLineContext[] {
  return [...lines].sort((left, right) => {
    if (handoffKind === 'RETURN') {
      return left.item_id.localeCompare(right.item_id) || left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  });
}

interface SettlementCommitment {
  id: string;
  relief_need_id: string;
  issued_quantity: string;
  delivered_quantity: string;
  returned_quantity: string;
  lost_quantity: string;
  unit_scale: number;
}

interface NeedFulfillmentRow {
  id: string;
  status: string;
  requested_quantity: string;
  delivered_quantity: string;
  unit_scale: number;
}

export async function readDistributionHandoffLines(
  manager: Pick<EntityManager, 'query'>,
  distributionId: string,
  lineIds: readonly string[],
): Promise<DistributionHandoffLineContext[]> {
  const rows = await manager.query(
    `SELECT dl.id,dl.distribution_id,dl.item_id,u.scale AS unit_scale,dl.quantity::text,
            dl.in_transit_quantity::text,dl.at_point_quantity::text,d.warehouse_id,
            cm.id AS commitment_id,cm.relief_need_id,n.cycle_id,
            CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind
       FROM distribution_line dl JOIN distribution d ON d.id=dl.distribution_id
       JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
       LEFT JOIN commitment cm ON cm.id=dl.commitment_id
       LEFT JOIN relief_need n ON n.id=cm.relief_need_id
      WHERE dl.distribution_id=$1 AND dl.id=ANY($2::uuid[]) ORDER BY dl.id`,
    [distributionId, lineIds],
  ) as DistributionHandoffLineContext[];
  if (rows.length !== lineIds.length) throw new AppError('HANDOFF_KIND_INVALID', { status: 409 });
  return rows;
}

export function eligibleSettlement(
  line: DistributionHandoffLineContext,
  handoffKind: DistributionHandoffKind,
  sourceStage: HandoffSourceStage,
): SettlementType | null {
  if (!line.commitment_id || !line.delivery_target_kind) return null;
  return handoffSettlementType(line.delivery_target_kind, handoffKind, sourceStage);
}

export async function lockSettlementCommitments(
  manager: Pick<EntityManager, 'query'>,
  lines: readonly DistributionHandoffLineContext[],
  handoffKind: DistributionHandoffKind,
  sourceStage: HandoffSourceStage,
): Promise<SettlementCommitment[]> {
  const eligibleLines = lines.filter((line) => eligibleSettlement(line, handoffKind, sourceStage) !== null);
  const commitmentIds = [...new Set(eligibleLines.flatMap((line) => line.commitment_id ? [line.commitment_id] : []))].sort();
  if (commitmentIds.length === 0) return [];
  const contexts = await manager.query(
    'SELECT cm.id,cm.relief_need_id,n.cycle_id FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id WHERE cm.id=ANY($1::uuid[]) ORDER BY n.cycle_id,n.id,cm.id',
    [commitmentIds],
  ) as Array<{ id: string; relief_need_id: string; cycle_id: string }>;
  if (contexts.length !== commitmentIds.length) throw new AppError('LINE_ITEM_MISMATCH', { status: 400 });
  const cycleIds = [...new Set(contexts.map((row) => row.cycle_id))].sort();
  await manager.query('SELECT id FROM fulfillment_cycle WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [cycleIds]);
  const needIds = [...new Set(contexts.map((row) => row.relief_need_id))].sort();
  await manager.query('SELECT id FROM relief_need WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [needIds]);
  await manager.query('SELECT id FROM commitment WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [commitmentIds]);
  return manager.query(
    `SELECT cm.id,cm.relief_need_id,cm.issued_quantity::text,cm.delivered_quantity::text,
            cm.returned_quantity::text,cm.lost_quantity::text,u.scale AS unit_scale
       FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
       JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
      WHERE cm.id=ANY($1::uuid[]) ORDER BY cm.id`,
    [commitmentIds],
  ) as Promise<SettlementCommitment[]>;
}

export async function applyHandoffSettlement(
  manager: Pick<EntityManager, 'query'>,
  line: DistributionHandoffLineContext,
  commitment: SettlementCommitment,
  settlementType: SettlementType,
  quantity: string,
): Promise<void> {
  const scale = Number(commitment.unit_scale);
  const amount = quantityUnits(quantity, scale);
  const issued = quantityUnits(commitment.issued_quantity, scale);
  const delivered = quantityUnits(commitment.delivered_quantity, scale);
  const returned = quantityUnits(commitment.returned_quantity, scale);
  const lost = quantityUnits(commitment.lost_quantity, scale);
  if (amount <= 0n || delivered + returned + lost + amount > issued) {
    throw new AppError('SETTLEMENT_EXCEEDS_ISSUED', { status: 409 });
  }
  const counter = settlementType === 'DELIVERED' ? 'delivered_quantity'
    : settlementType === 'RETURNED' ? 'returned_quantity' : 'lost_quantity';
  await manager.query(
    `INSERT INTO issued_line_settlement (handoff_line_id,commitment_id,settlement_type) VALUES ($1,$2,$3)`,
    [line.id, commitment.id, settlementType],
  );
  await manager.query(
    `UPDATE commitment SET ${counter}=${counter}+$2::numeric,version=version+1 WHERE id=$1`,
    [commitment.id, decimalFromUnits(amount, scale)],
  );
  if (settlementType === 'DELIVERED') commitment.delivered_quantity = decimalFromUnits(delivered + amount, scale);
  if (settlementType === 'RETURNED') commitment.returned_quantity = decimalFromUnits(returned + amount, scale);
  if (settlementType === 'LOST') commitment.lost_quantity = decimalFromUnits(lost + amount, scale);
}

export async function updateNeedFulfillment(
  manager: Pick<EntityManager, 'query'>,
  needIds: readonly string[],
): Promise<void> {
  for (const needId of [...new Set(needIds)].sort()) {
    const rows = await manager.query(
      `SELECT n.id,n.status,n.requested_quantity::text,u.scale AS unit_scale,
              COALESCE(sum(cm.delivered_quantity),0)::text AS delivered_quantity
         FROM relief_need n JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
         LEFT JOIN commitment cm ON cm.relief_need_id=n.id WHERE n.id=$1
        GROUP BY n.id,n.status,n.requested_quantity,u.scale`,
      [needId],
    ) as NeedFulfillmentRow[];
    const need = rows[0];
    if (!need || need.status === 'CANCELLED') continue;
    const scale = Number(need.unit_scale);
    const delivered = quantityUnits(need.delivered_quantity, scale);
    const requested = quantityUnits(need.requested_quantity, scale);
    if (delivered > requested) throw new AppError('NEED_OVER_COMMITTED', { status: 409 });
    const status = delivered === requested ? 'FULFILLED' : delivered > 0n ? 'PARTIALLY_FULFILLED' : 'OPEN';
    if (status === need.status) continue;
    if (need.status === 'FULFILLED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    await manager.query('UPDATE relief_need SET status=$2,version=version+1 WHERE id=$1', [needId, status]);
    if (status === 'FULFILLED') {
      await manager.query(
        `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
         VALUES (NULL,'NEED_AUTO_FULFILLED','relief_need',$1,$2::jsonb,$3::jsonb,'AUTO_DELIVERED_EQUALS_REQUESTED')`,
        [needId, JSON.stringify({ status: need.status }), JSON.stringify({ status: 'FULFILLED', delivered_quantity: need.delivered_quantity, requested_quantity: need.requested_quantity })],
      );
    }
  }
}
