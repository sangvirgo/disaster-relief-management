import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hasPermission, Grant } from '../../../../packages/technical/src/security/permissions';
import { ResponseAdmission } from './response-admission.client';

export type NeedCommandRequest = Request & { idempotencyKey?: string };
export type NeedScope = Pick<ResponseAdmission, 'organization_id' | 'region_code' | 'campaign_id'>;

export interface NeedRow extends Record<string, unknown>, NeedScope {
  id: string;
  cycle_id: string;
  request_id: string;
  work_cycle: number;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number;
  original_quantity: string;
  requested_quantity: string;
  cancelled_remaining: string | null;
  designated_point_id: string | null;
  status: 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';
  version: number | string;
  created_at: Date | string;
}

const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function needCommandKey(request: NeedCommandRequest): string {
  const value = request.idempotencyKey;
  if (!value || !idempotencyKeyPattern.test(value)) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return value;
}

export function requireNeedManage(grants: readonly Grant[], scope: NeedScope): void {
  if (!hasPermission(grants, 'NEED_MANAGE', {
    organizationId: scope.organization_id,
    regionCode: scope.region_code,
    campaignId: scope.campaign_id,
  })) throw new AppError('FORBIDDEN', { status: 403 });
}

export function needValue(row: NeedRow): Record<string, unknown> {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    id: row.id,
    cycle_id: row.cycle_id,
    request_id: row.request_id,
    work_cycle: Number(row.work_cycle),
    organization_id: row.organization_id,
    region_code: row.region_code,
    campaign_id: row.campaign_id,
    item_id: row.item_id,
    item: {
      id: row.item_id,
      name: row.item_name,
      unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
    },
    original_quantity: row.original_quantity,
    requested_quantity: row.requested_quantity,
    cancelled_remaining: row.cancelled_remaining,
    delivery_target_kind: row.designated_point_id === null ? 'FINAL_RECIPIENT' : 'RELIEF_POINT',
    designated_point_id: row.designated_point_id,
    status: row.status,
    version: Number(row.version),
    created_at: createdAt.toISOString(),
  };
}

export async function readNeed(manager: Pick<EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT n.id,n.cycle_id,c.request_id,c.work_cycle,c.organization_id,c.region_code,c.campaign_id,
            n.item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
            n.original_quantity::text,n.requested_quantity::text,n.cancelled_remaining::text,
            n.designated_point_id,n.status,n.version,n.created_at
       FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
       JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
      WHERE n.id=$1`,
    [id],
  ) as NeedRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return needValue(rows[0]);
}

export async function writeNeedAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string,
  action: 'NEED_CREATED' | 'NEED_INCREASED' | 'NEED_REDUCED' | 'NEED_CANCELLED',
  needId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string | null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'relief_need',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, needId, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
  );
}
