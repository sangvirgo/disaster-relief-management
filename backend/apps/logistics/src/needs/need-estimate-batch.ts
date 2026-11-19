import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { randomUUID } from 'node:crypto';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { ExtractionBasis } from '../need-extraction/need-extraction.types';
import { estimateNeeds, NeedEstimateLineInput, NeedEstimateNorm } from './need-estimate';
import {
  NeedEstimateBasis, readNeed, requireNeedEstimateConfirm, writeNeedAudit,
} from './needs.helpers';
import { ResponseAdmission } from './response-admission.client';

// The one persistence path for ESTIMATED lines. The manual endpoint (POST /needs/estimate) and the need-extraction sweep
// both call persistEstimateBatch, so the cycle lock, norm and item checks, the declared-need guard and the one-live-need
// index apply identically. The caller supplies the SOS facts through `admission`; this function never calls Response.

/** SOS facts the estimate reads. Both the endpoint (from admission) and the sweep (from the candidate scan) supply them. */
export type EstimateFacts = Pick<ResponseAdmission, 'request_id' | 'work_cycle' | 'campaign_id' | 'people_affected' | 'children_count' | 'elderly_count'>;

export interface CycleRow extends Pick<ResponseAdmission, 'request_id' | 'work_cycle' | 'campaign_id'> {
  id: string;
  state: 'OPEN' | 'FROZEN' | 'SEALED';
}

/** Actor for an estimate batch. `grants: null` is the SYSTEM job actor: no permission check, audit row with a null actor. */
export interface EstimateBatchActor {
  userId: string | null;
  grants: readonly Grant[] | null;
}

export interface EstimateBatchInput {
  admission: EstimateFacts;
  /** Explicit lines, or 'DEFAULT_BUNDLE' for every active norm with in_default_bundle (manual estimates only). */
  lines: readonly NeedEstimateLineInput[] | 'DEFAULT_BUNDLE';
  actor: EstimateBatchActor;
  extraction?: ExtractionBasis | null;
}

export interface EstimateBatchResult {
  batchId: string;
  ids: string[];
  items: Record<string, unknown>[];
}

export function sameAttribution(cycle: CycleRow, admission: EstimateFacts): boolean {
  return cycle.request_id === admission.request_id && cycle.work_cycle === admission.work_cycle &&
    cycle.campaign_id === admission.campaign_id;
}

export async function lockCycle(
  manager: Pick<EntityManager, 'query'>,
  admission: EstimateFacts,
): Promise<CycleRow> {
  await manager.query(
    `INSERT INTO fulfillment_cycle (request_id,work_cycle,campaign_id)
     VALUES ($1,$2,$3) ON CONFLICT (request_id,work_cycle) DO NOTHING`,
    [admission.request_id, admission.work_cycle, admission.campaign_id],
  );
  const rows = await manager.query(
    `SELECT id,request_id,work_cycle,campaign_id,state
       FROM fulfillment_cycle WHERE request_id=$1 AND work_cycle=$2 FOR UPDATE`,
    [admission.request_id, admission.work_cycle],
  ) as CycleRow[];
  const cycle = rows[0];
  if (!cycle || !sameAttribution(cycle, admission)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  if (cycle.state === 'FROZEN') throw new AppError('CYCLE_FROZEN', { status: 409 });
  if (cycle.state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
  if (cycle.state !== 'OPEN') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  return cycle;
}

export async function loadActiveNorms(manager: Pick<EntityManager, 'query'>): Promise<Array<NeedEstimateNorm & { in_default_bundle: boolean }>> {
  return manager.query(
    `SELECT id,category,item_type_code,quantity_basis,qty_adult::text,qty_child::text,qty_elderly::text,
            people_per_unit,fixed_quantity::text,default_item_id,in_default_bundle,active,version
       FROM need_norm WHERE active`,
    [],
  ) as Promise<Array<NeedEstimateNorm & { in_default_bundle: boolean }>>;
}

/**
 * Creates ESTIMATED lines for one cycle. Returns no ids (and writes nothing) when the rule yields no line; the caller
 * decides whether that is an error (the endpoint) or a recorded outcome (the sweep).
 */
export async function persistEstimateBatch(
  manager: EntityManager,
  input: EstimateBatchInput,
): Promise<EstimateBatchResult> {
  const { admission, actor } = input;
  const people = admission.people_affected;
  if (people === null) throw new AppError('NEED_PEOPLE_MISSING', { status: 409 });

  const cycle = await lockCycle(manager, admission);
  if (actor.grants) requireNeedEstimateConfirm(actor.grants, cycle);

  const norms = await loadActiveNorms(manager);
  const lines: readonly NeedEstimateLineInput[] = input.lines === 'DEFAULT_BUNDLE'
    ? norms.filter((norm) => norm.in_default_bundle).map((norm) => ({ category: norm.category, item_id: null }))
    : input.lines;
  if (lines.length === 0) return { batchId: '', ids: [], items: [] };
  for (const line of lines) {
    if (!norms.some((norm) => norm.category === line.category)) throw new AppError('NEED_NORM_NOT_FOUND', { status: 400 });
  }

  const referencedItemIds = lines.map((line) => line.item_id ?? norms.find((norm) => norm.category === line.category)?.default_item_id)
    .filter((id): id is string => typeof id === 'string');
  const items = referencedItemIds.length === 0 ? [] : await manager.query(
    `SELECT i.id,i.item_type_code,i.status,u.scale FROM item i JOIN unit u ON u.code=i.unit_code
      WHERE i.id=ANY($1::uuid[]) FOR SHARE OF i`,
    [referencedItemIds],
  ) as Array<{ id: string; item_type_code: string; status: 'ACTIVE' | 'INACTIVE'; scale: number | string }>;

  const result = estimateNeeds({
    people,
    children: admission.children_count ?? 0,
    elderly: admission.elderly_count ?? 0,
    lines: [...lines],
  }, norms, items.map((item) => ({
    id: item.id, item_type_code: item.item_type_code, status: item.status, unit_scale: Number(item.scale),
  })));
  if (result.skipped.some((line) => line.reason_codes.includes('NORM_NOT_FOUND'))) {
    throw new AppError('NEED_NORM_NOT_FOUND', { status: 400 });
  }
  if (result.lines.length === 0) return { batchId: '', ids: [], items: [] };

  const declared = await manager.query(
    `SELECT n.id FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
      WHERE c.request_id=$1 AND n.item_id=ANY($2::uuid[]) AND n.source IN ('DECLARED','CONFIRMED') AND n.status<>'CANCELLED'
      LIMIT 1`,
    [admission.request_id, result.lines.map((line) => line.item_id)],
  ) as Array<{ id: string }>;
  if (declared[0]) throw new AppError('NEED_ALREADY_DECLARED', { status: 409 });

  const batchId = randomUUID();
  const estimatedAt = new Date().toISOString();
  const ids: string[] = [];
  for (const line of result.lines) {
    const basis: NeedEstimateBasis = {
      batch_id: batchId,
      category: line.category,
      item_type_code: line.item_type_code,
      item_id: line.item_id,
      norm_id: line.norm_id,
      norm_version: line.norm_version,
      basis: line.estimate_basis.basis,
      inputs: line.estimate_basis.inputs,
      estimated_quantity: line.quantity,
      reason_codes: line.reason_codes,
      estimated_at: estimatedAt,
      ...(input.extraction ? { extraction: input.extraction } : {}),
    };
    const inserted = await manager.query(
      `INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity,source,estimate_basis)
       VALUES ($1,$2,$3,$3,'ESTIMATED',$4::jsonb) RETURNING id`,
      [cycle.id, line.item_id, line.quantity, JSON.stringify(basis)],
    ) as Array<{ id: string }>;
    const id = inserted[0]?.id;
    if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const value = await readNeed(manager, id);
    await writeNeedAudit(manager, actor.userId, 'NEED_ESTIMATED', id, null, value, null);
    ids.push(id);
  }
  const values: Record<string, unknown>[] = [];
  for (const id of ids) values.push(await readNeed(manager, id));
  return { batchId, ids, items: values };
}
