import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { hasPermission, Grant } from '@c48/identity-contracts/permissions';
import { quantityUnits } from '../common/quantity';
import { ResponseAdmission } from './response-admission.client';
import type { NeedReasonCode } from './need-reasons';
import type { NeedEstimateBasisInputs, NeedQuantityBasis } from './need-estimate';
import type { ExtractionBasis } from '../need-extraction/need-extraction.types';

export type NeedCommandRequest = Request & { idempotencyKey?: string };
export type NeedScope = Pick<ResponseAdmission, 'campaign_id'>;
export type NeedSource = 'DECLARED' | 'ESTIMATED' | 'CONFIRMED';

/** Snapshot written when an ESTIMATED need is generated; kept on the row after confirmation as history. */
/** Snapshot written when an ESTIMATED need is generated: the norm used, the SOS facts it read and the rounded result. */
export interface NeedEstimateBasis {
  batch_id: string;
  category: string;
  item_type_code: string;
  item_id: string;
  norm_id: string;
  norm_version: number;
  basis: NeedQuantityBasis;
  inputs: NeedEstimateBasisInputs;
  estimated_quantity: string;
  reason_codes: NeedReasonCode[];
  estimated_at: string;
  /** How the lines were chosen from the SOS text (sweep only). Absent on manually requested estimates. */
  extraction?: ExtractionBasis;
}

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
  status: 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';
  source: NeedSource;
  estimate_basis: NeedEstimateBasis | null;
  reference_estimate_quantity: string | null;
  version: number | string;
  created_at: Date | string;
}

/** Quantity above which a DECLARED need is flagged against its estimate (strictly greater than this multiple). */
export const FAR_ABOVE_ESTIMATE_MULTIPLE = 3n;

const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function needCommandKey(request: NeedCommandRequest): string {
  const value = request.idempotencyKey;
  if (!value || !idempotencyKeyPattern.test(value)) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return value;
}

export function requireNeedManage(grants: readonly Grant[], scope: NeedScope): void {
  if (!hasPermission(grants, 'NEED_MANAGE', {
    campaignId: scope.campaign_id,
  })) throw new AppError('FORBIDDEN', { status: 403 });
}

/**
 * Read-model fields that describe where a need came from. The QUANTITY_FAR_ABOVE_ESTIMATE flag is computed here on
 * read; it is never stored. It applies to DECLARED lines whose item already has an estimate in the same cycle.
 */
export interface NeedSourceFields {
  source: string;
  estimate_basis: NeedEstimateBasis | null;
  reference_estimate_quantity: string | null;
  requested_quantity: string;
  unit_scale: number | string;
  status: string;
}

export function needSourceView(row: NeedSourceFields): Record<string, unknown> {
  const scale = Number(row.unit_scale);
  const reasons: NeedReasonCode[] = [];
  if (row.source === 'DECLARED' && row.status !== 'CANCELLED' && row.reference_estimate_quantity) {
    const requested = quantityUnits(row.requested_quantity, scale);
    const estimated = quantityUnits(row.reference_estimate_quantity, scale);
    if (requested > estimated * FAR_ABOVE_ESTIMATE_MULTIPLE) reasons.push('QUANTITY_FAR_ABOVE_ESTIMATE');
  }
  return {
    source: row.source,
    estimate: row.estimate_basis,
    estimate_reference_quantity: row.source === 'DECLARED' ? row.reference_estimate_quantity : null,
    reason_codes: reasons,
  };
}

/** NEED_ESTIMATE_CONFIRM is held by OPERATIONS_MANAGER only: estimate generation and confirmation are manager decisions. */
export function requireNeedEstimateConfirm(grants: readonly Grant[], scope: NeedScope): void {
  if (!hasPermission(grants, 'NEED_ESTIMATE_CONFIRM', { campaignId: scope.campaign_id })) throw new AppError('FORBIDDEN', { status: 403 });
}

export function requireNeedNormManage(grants: readonly Grant[]): void {
  if (!hasPermission(grants, 'NEED_NORM_MANAGE', { systemAction: 'NEED_NORM_MANAGE' })) throw new AppError('FORBIDDEN', { status: 403 });
}

export function needValue(row: NeedRow): Record<string, unknown> {
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
  return {
    ...needSourceView(row),
    id: row.id,
    cycle_id: row.cycle_id,
    request_id: row.request_id,
    work_cycle: Number(row.work_cycle),
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
    status: row.status,
    version: Number(row.version),
    created_at: createdAt.toISOString(),
  };
}

/** Latest estimate for the same item in the same cycle, used only as the reference for DECLARED lines. */
export const referenceEstimateSql = `(SELECT e.estimate_basis->>'estimated_quantity' FROM relief_need e
   WHERE e.cycle_id=n.cycle_id AND e.item_id=n.item_id AND e.id<>n.id AND e.estimate_basis IS NOT NULL
   ORDER BY e.created_at DESC,e.id DESC LIMIT 1)`;

export async function readNeed(manager: Pick<EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT n.id,n.cycle_id,c.request_id,c.work_cycle,c.campaign_id,
            n.item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
            n.original_quantity::text,n.requested_quantity::text,n.cancelled_remaining::text,
            n.status,n.source,n.estimate_basis,n.version,n.created_at,
            ${referenceEstimateSql} AS reference_estimate_quantity
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
  actorId: string | null,
  action: 'NEED_CREATED' | 'NEED_INCREASED' | 'NEED_REDUCED' | 'NEED_CANCELLED' | 'NEED_ESTIMATED' | 'NEED_CONFIRMED' | 'NEED_REQUESTED_BY_TEAM',
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
