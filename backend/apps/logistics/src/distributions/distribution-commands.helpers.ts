import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import type { DistributionLineDto } from './distributions.dto';

export interface CommitmentContext {
  id: string;
  relief_need_id: string;
  cycle_id: string;
  item_id: string;
  warehouse_id: string;
  organization_id: string;
  cycle_state: string;
  need_status: string;
  delivery_target_kind: 'FINAL_RECIPIENT' | 'RELIEF_POINT';
  designated_point_id: string | null;
  quantity: string;
  released_quantity: string;
  issued_quantity: string;
  unit_scale: number;
}

export function assertExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: actual } });
}

export function assertLinePurpose(purpose: string, lines: readonly DistributionLineDto[]): void {
  const commitmentIds = lines.flatMap((line) => line.commitment_id ? [line.commitment_id] : []);
  if (new Set(commitmentIds).size !== commitmentIds.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
  const linked = purpose === 'REQUEST_AID';
  if (lines.some((line) => Boolean(line.commitment_id) !== linked)) {
    throw new AppError('LINE_ITEM_MISMATCH', { status: 400 });
  }
}

export async function lockCommitmentContexts(
  manager: Pick<EntityManager, 'query'>,
  lines: readonly DistributionLineDto[],
  warehouseId: string,
  organizationId: string,
  purpose: string,
  reliefPointId: string | null,
  mode: 'PREPARATION' | 'DISPATCH' = 'PREPARATION',
): Promise<CommitmentContext[]> {
  assertLinePurpose(purpose, lines);
  if (purpose !== 'REQUEST_AID' || lines.length === 0) return [];
  const commitmentIds = lines.map((line) => line.commitment_id!).sort();
  const candidates = await manager.query(
    `SELECT cm.id,cm.relief_need_id,n.cycle_id
       FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
      WHERE cm.id=ANY($1::uuid[]) ORDER BY n.cycle_id,n.id,cm.id`,
    [commitmentIds],
  ) as Array<{ id: string; relief_need_id: string; cycle_id: string }>;
  if (candidates.length !== commitmentIds.length) throw new AppError('LINE_ITEM_MISMATCH', { status: 400 });

  const cycleIds = [...new Set(candidates.map((row) => row.cycle_id))].sort();
  await manager.query('SELECT id FROM fulfillment_cycle WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [cycleIds]);
  const needIds = [...new Set(candidates.map((row) => row.relief_need_id))].sort();
  await manager.query('SELECT id FROM relief_need WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [needIds]);
  await manager.query('SELECT id FROM commitment WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [commitmentIds]);

  const rows = await manager.query(
    `SELECT cm.id,cm.relief_need_id,n.cycle_id,cm.item_id,cm.warehouse_id,c.organization_id,c.state AS cycle_state,
            n.status AS need_status,
            CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind,
            n.designated_point_id,
            cm.quantity::text,cm.released_quantity::text,cm.issued_quantity::text,u.scale AS unit_scale
       FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
       JOIN fulfillment_cycle c ON c.id=n.cycle_id JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
      WHERE cm.id=ANY($1::uuid[]) ORDER BY cm.id`,
    [commitmentIds],
  ) as CommitmentContext[];
  if (rows.length !== commitmentIds.length) throw new AppError('LINE_ITEM_MISMATCH', { status: 400 });
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const line of lines) {
    const commitment = byId.get(line.commitment_id!);
    if (!commitment || commitment.item_id !== line.item_id || commitment.warehouse_id !== warehouseId || commitment.organization_id !== organizationId) {
      throw new AppError('LINE_ITEM_MISMATCH', { status: 400 });
    }
    if (commitment.cycle_state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
    if (commitment.cycle_state === 'FROZEN') throw new AppError('CYCLE_FROZEN', { status: 409 });
    if (commitment.need_status === 'CANCELLED' || commitment.need_status === 'FULFILLED') {
      throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    }
    if (commitment.delivery_target_kind === 'RELIEF_POINT' && commitment.designated_point_id !== reliefPointId) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const quantity = validateQuantity(line.quantity, Number(commitment.unit_scale));
    const remaining = quantityUnits(commitment.quantity, Number(commitment.unit_scale)) -
      quantityUnits(commitment.released_quantity, Number(commitment.unit_scale)) -
      quantityUnits(commitment.issued_quantity, Number(commitment.unit_scale));
    if (remaining < 0n || quantityUnits(quantity, Number(commitment.unit_scale)) > remaining) {
      const reservedExcessCode = mode === 'DISPATCH' ? 'INSUFFICIENT_STOCK' : 'VALIDATION_FAILED';
      throw new AppError(reservedExcessCode, { status: reservedExcessCode === 'INSUFFICIENT_STOCK' ? 409 : 400 });
    }
  }
  return rows;
}

export async function activeItemScales(
  manager: Pick<EntityManager, 'query'>,
  lines: readonly DistributionLineDto[],
): Promise<Map<string, number>> {
  const itemIds = [...new Set(lines.map((line) => line.item_id))].sort();
  const rows = await manager.query(
    `SELECT i.id,i.status,u.scale AS unit_scale FROM item i JOIN unit u ON u.code=i.unit_code
      WHERE i.id=ANY($1::uuid[]) ORDER BY i.id FOR SHARE OF i`,
    [itemIds],
  ) as Array<{ id: string; status: string; unit_scale: number }>;
  const scales = new Map(rows.map((row) => [row.id, Number(row.unit_scale)]));
  if (rows.length !== itemIds.length || rows.some((row) => row.status !== 'ACTIVE')) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  for (const line of lines) validateQuantity(line.quantity, scales.get(line.item_id)!);
  return scales;
}

export async function insertDistributionLines(
  manager: Pick<EntityManager, 'query'>,
  distributionId: string,
  warehouseId: string,
  lines: readonly DistributionLineDto[],
): Promise<void> {
  for (const line of lines) {
    await manager.query(
      `INSERT INTO distribution_line (distribution_id,warehouse_id,item_id,commitment_id,quantity)
       VALUES ($1,$2,$3,$4,$5::numeric)`,
      [distributionId, warehouseId, line.item_id, line.commitment_id ?? null, line.quantity],
    );
  }
}

export async function writeDistributionAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string,
  action: string,
  distributionId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
     VALUES ($1,$2,'distribution',$3,$4::jsonb,$5::jsonb)`,
    [actorId, action, distributionId, before ? JSON.stringify(before) : null, JSON.stringify(after)],
  );
}

export function commitmentRemaining(row: CommitmentContext, scale: number): string {
  const remaining = quantityUnits(row.quantity, scale) - quantityUnits(row.released_quantity, scale) - quantityUnits(row.issued_quantity, scale);
  if (remaining < 0n) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return decimalFromUnits(remaining, scale);
}
