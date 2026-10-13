import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decimalFromUnits, quantityUnits } from '../common/quantity';

export interface DistributionContext {
  id: string;
  warehouse_id: string;
  organization_id: string;
  warehouse_region_code: string;
  warehouse_status: 'ACTIVE' | 'INACTIVE';
  relief_point_id: string | null;
  relief_point_status: 'ACTIVE' | 'INACTIVE' | null;
  vehicle_id: string | null;
  vehicle_status: 'ACTIVE' | 'INACTIVE' | null;
  vehicle_capacity: string | null;
  vehicle_capacity_unit: string | null;
  vehicle_capacity_scale: number | null;
  campaign_id: string | null;
  purpose: 'REQUEST_AID' | 'CAMPAIGN_DISTRIBUTION' | 'POINT_REPLENISHMENT';
  status: 'DRAFT' | 'APPROVED' | 'DISPATCHED' | 'RECONCILED' | 'CANCELLED';
  preparer_user_id: string;
  approver_user_id: string | null;
  approved_version: number | null;
  dispatch_actor_user_id: string | null;
  dispatched_at: string | null;
  reconciled_at: string | null;
  created_at: string;
  version: number;
}

type Queryable = Pick<DataSource | EntityManager, 'query'>;

export async function loadDistribution(source: Queryable, id: string, lock = false): Promise<DistributionContext> {
  const rows = await loadDistributions(source, [id], lock);
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

export async function loadDistributions(source: Queryable, ids: readonly string[], lock = false): Promise<DistributionContext[]> {
  if (ids.length === 0) return [];
  const rows = await source.query(
    `SELECT d.id,d.warehouse_id,d.organization_id,w.region_code AS warehouse_region_code,w.status AS warehouse_status,
            d.relief_point_id,rp.status AS relief_point_status,d.vehicle_id,v.status AS vehicle_status,
            v.capacity::text AS vehicle_capacity,v.capacity_unit AS vehicle_capacity_unit,vcu.scale AS vehicle_capacity_scale,
            d.campaign_id,d.purpose,d.status,
            d.preparer_user_id,d.approver_user_id,d.approved_version,d.dispatch_actor_user_id,d.dispatched_at,
            d.reconciled_at,d.created_at,d.version
       FROM distribution d JOIN warehouse w ON w.id=d.warehouse_id
       LEFT JOIN relief_point rp ON rp.id=d.relief_point_id
       LEFT JOIN vehicle v ON v.id=d.vehicle_id
       LEFT JOIN unit vcu ON vcu.code=v.capacity_unit
      WHERE d.id=ANY($1::uuid[]) ORDER BY d.created_at DESC,d.id DESC${lock ? ' FOR UPDATE OF d' : ''}`,
    [ids],
  ) as DistributionContext[];
  return rows.map((row) => ({
    ...row,
    version: Number(row.version),
    approved_version: row.approved_version === null ? null : Number(row.approved_version),
    vehicle_capacity_scale: row.vehicle_capacity_scale === null ? null : Number(row.vehicle_capacity_scale),
  }));
}

interface DistributionLineRow {
  distribution_id: string;
  id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_scale: number;
  commitment_id: string | null;
  delivery_target_kind: 'FINAL_RECIPIENT' | 'RELIEF_POINT' | null;
  quantity: string;
  in_transit_quantity: string;
  at_point_quantity: string;
  received_quantity: string | null;
  handed_out_quantity: string | null;
  returned_quantity: string | null;
  lost_quantity: string | null;
  pending_loss_count: string;
}

function amount(value: string | null, scale: number): string {
  return decimalFromUnits(quantityUnits(value ?? '0', scale), scale);
}

export async function readDistributionLines(source: Queryable, distributionIds: readonly string[]): Promise<Map<string, DistributionLineRow[]>> {
  if (distributionIds.length === 0) return new Map();
  const lines = await source.query(
    `SELECT dl.distribution_id,dl.id,dl.item_id,i.name AS item_name,i.unit_code,u.scale AS unit_scale,
            dl.commitment_id,
            CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind,
            dl.quantity::text,dl.in_transit_quantity::text,dl.at_point_quantity::text,
            sum(hl.quantity) FILTER (WHERE hr.handoff_kind='POINT_RECEIPT')::text AS received_quantity,
            sum(hl.quantity) FILTER (WHERE hr.handoff_kind IN ('DIRECT_HOUSEHOLD','HOUSEHOLD_HANDOUT'))::text AS handed_out_quantity,
            sum(hl.quantity) FILTER (WHERE hr.handoff_kind='RETURN')::text AS returned_quantity,
            sum(hl.quantity) FILTER (WHERE hr.handoff_kind='LOSS' AND lr.decision='APPROVE')::text AS lost_quantity,
            count(*) FILTER (WHERE hr.handoff_kind='LOSS' AND lr.handoff_id IS NULL)::text AS pending_loss_count
       FROM distribution_line dl JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
       LEFT JOIN commitment cm ON cm.id=dl.commitment_id
       LEFT JOIN relief_need n ON n.id=cm.relief_need_id
       LEFT JOIN handoff_line hl ON hl.distribution_line_id=dl.id
       LEFT JOIN handoff_record hr ON hr.id=hl.handoff_id
       LEFT JOIN handoff_loss_review lr ON lr.handoff_id=hr.id
      WHERE dl.distribution_id=ANY($1::uuid[])
      GROUP BY dl.distribution_id,dl.id,i.name,i.unit_code,u.scale,n.designated_point_id
      ORDER BY dl.distribution_id,dl.id`,
    [distributionIds],
  ) as DistributionLineRow[];
  const grouped = new Map<string, DistributionLineRow[]>();
  for (const line of lines) grouped.set(line.distribution_id, [...(grouped.get(line.distribution_id) ?? []), line]);
  return grouped;
}

export function distributionView(distribution: DistributionContext, lines: readonly DistributionLineRow[]): Record<string, unknown> {
  const compatibleQuantity = lines
    .filter((line) => line.unit_code === distribution.vehicle_capacity_unit)
    .reduce((total, line) => total + quantityUnits(line.quantity, Number(line.unit_scale)), 0n);
  const capacityExceeded = distribution.vehicle_capacity !== null && distribution.vehicle_capacity_scale !== null &&
    compatibleQuantity > quantityUnits(distribution.vehicle_capacity, distribution.vehicle_capacity_scale);

  return {
    id: distribution.id,
    warehouse_id: distribution.warehouse_id,
    organization_id: distribution.organization_id,
    relief_point_id: distribution.relief_point_id,
    vehicle_id: distribution.vehicle_id,
    campaign_id: distribution.campaign_id,
    purpose: distribution.purpose,
    status: distribution.status,
    preparer_user_id: distribution.preparer_user_id,
    approver_user_id: distribution.approver_user_id,
    approved_version: distribution.approved_version,
    dispatch_actor_user_id: distribution.dispatch_actor_user_id,
    dispatched_at: distribution.dispatched_at,
    reconciled_at: distribution.reconciled_at,
    created_at: distribution.created_at,
    version: distribution.version,
    vehicle_capacity_exceeded: capacityExceeded,
    lines: lines.map((line) => ({
      id: line.id,
      item_id: line.item_id,
      item_name: line.item_name,
      unit: { code: line.unit_code, scale: Number(line.unit_scale) },
      commitment_id: line.commitment_id,
      delivery_target_kind: line.delivery_target_kind,
      quantity: amount(line.quantity, Number(line.unit_scale)),
      dispatched: distribution.dispatch_actor_user_id ? amount(line.quantity, Number(line.unit_scale)) : '0',
      received: amount(line.received_quantity, Number(line.unit_scale)),
      handed_out: amount(line.handed_out_quantity, Number(line.unit_scale)),
      returned: amount(line.returned_quantity, Number(line.unit_scale)),
      lost: amount(line.lost_quantity, Number(line.unit_scale)),
      pending_loss_count: Number(line.pending_loss_count),
      in_transit: amount(line.in_transit_quantity, Number(line.unit_scale)),
      at_point: amount(line.at_point_quantity, Number(line.unit_scale)),
    })),
  };
}

export async function readDistributionView(source: Queryable, id: string): Promise<Record<string, unknown>> {
  const distribution = await loadDistribution(source, id);
  const groupedLines = await readDistributionLines(source, [id]);
  return distributionView(distribution, groupedLines.get(id) ?? []);
}
