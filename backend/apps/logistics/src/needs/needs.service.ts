import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef,
} from '@c48/technical/idempotency/idempotency';
import { randomUUID } from 'node:crypto';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { validateQuantity } from '../common/quantity';
import { CreateNeedDto, EstimateNeedsDto } from './needs.dto';
import {
  NeedCommandRequest, needCommandKey, NeedEstimateBasis, readNeed, requireNeedEstimateConfirm, requireNeedManage, writeNeedAudit,
} from './needs.helpers';
import { estimateNeeds, NEED_ESTIMATE_DEFAULT_DAYS, NeedEstimateNorm } from './need-estimate';
import { ResponseAdmission, ResponseAdmissionClient } from './response-admission.client';

export type { NeedCommandRequest } from './needs.helpers';

interface CycleRow extends Pick<ResponseAdmission, 'request_id' | 'work_cycle' | 'campaign_id'> {
  id: string;
  state: 'OPEN' | 'FROZEN' | 'SEALED';
}

interface ItemRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  item_type_code: string;
  unit_code: string;
  unit_name: string;
  scale: number;
}

interface ReliefPointRow {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
}

function requestHash(dto: CreateNeedDto): string {
  return canonicalRequestHash({
    request_id: dto.request_id,
    work_cycle: dto.work_cycle,
    item_id: dto.item_id,
    quantity: dto.quantity,
    delivery_target_kind: dto.delivery_target_kind ?? null,
    designated_point_id: dto.designated_point_id ?? null,
    reason: dto.reason ?? null,
  });
}

function sameAttribution(cycle: CycleRow, admission: ResponseAdmission): boolean {
  return cycle.request_id === admission.request_id && cycle.work_cycle === admission.work_cycle &&
    cycle.campaign_id === admission.campaign_id;
}

async function lockCycle(
  manager: Pick<EntityManager, 'query'>,
  admission: ResponseAdmission,
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

async function loadItem(manager: Pick<EntityManager, 'query'>, itemId: string): Promise<ItemRow> {
  const rows = await manager.query(
    `SELECT i.id,i.name,i.status,i.item_type_code,u.code AS unit_code,u.display_name AS unit_name,u.scale
       FROM item i JOIN unit u ON u.code=i.unit_code WHERE i.id=$1 FOR SHARE OF i`,
    [itemId],
  ) as ItemRow[];
  const item = rows[0];
  if (!item) throw new AppError('NOT_FOUND', { status: 404 });
  if (item.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  return item;
}

async function loadReliefPoint(manager: Pick<EntityManager, 'query'>, id: string): Promise<ReliefPointRow> {
  const rows = await manager.query(
    'SELECT id,status FROM relief_point WHERE id=$1 FOR SHARE',
    [id],
  ) as ReliefPointRow[];
  const point = rows[0];
  if (!point) throw new AppError('NOT_FOUND', { status: 404 });
  if (point.status !== 'ACTIVE') throw new AppError('POINT_INACTIVE', { status: 409 });
  return point;
}

@Injectable()
export class NeedsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly response: ResponseAdmissionClient,
  ) {}

  async create(dto: CreateNeedDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const idempotencyKey = needCommandKey(request);
    if (dto.designated_point_id && (!dto.reason || !dto.reason.trim())) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if (dto.designated_point_id && dto.delivery_target_kind === 'FINAL_RECIPIENT') {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }

    const idempotent = {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.needs.create',
      key: idempotencyKey,
      requestHash: requestHash(dto),
    };
    const replay = async (manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> => {
      if (resource?.type !== 'relief_need') throw new AppError('INTERNAL_ERROR', { status: 500 });
      const value = await readNeed(manager, resource.id);
      requireNeedManage(session.grants, value as Pick<ResponseAdmission, 'campaign_id'>);
      return value;
    };

    let admission: ResponseAdmission;
    try {
      admission = await this.response.admit(dto.request_id, dto.work_cycle, session.identityHeaders);
    } catch (error) {
      return this.idempotency.execute(this.dataSource, {
        ...idempotent,
        execute: async () => { throw error; },
        replay,
      });
    }
    requireNeedManage(session.grants, admission);

    return this.idempotency.execute(this.dataSource, {
      ...idempotent,
      databaseErrorMappings: { unique: { need_one_live_per_item_uq: 'NEED_EXISTS' } },
      execute: async (manager) => {
        const cycle = await lockCycle(manager, admission);
        requireNeedManage(session.grants, cycle);
        const item = await loadItem(manager, dto.item_id);
        const quantity = validateQuantity(dto.quantity, Number(item.scale));
        let designatedPointId: string | null = null;
        if (dto.designated_point_id) {
          const point = await loadReliefPoint(manager, dto.designated_point_id);
          requireNeedManage(session.grants, {
            campaign_id: cycle.campaign_id,
          });
          designatedPointId = point.id;
        }

        const inserted = await manager.query(
          `INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity,designated_point_id)
           VALUES ($1,$2,$3,$3,$4) RETURNING id`,
          [cycle.id, item.id, quantity, designatedPointId],
        ) as Array<{ id: string }>;
        const id = inserted[0]?.id;
        if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const value = await readNeed(manager, id);
        await writeNeedAudit(manager, session.userId, 'NEED_CREATED', id, null, value, dto.reason ?? null);
        return { status: 201, value, resource: { type: 'relief_need', id } };
      },
      replay,
    });
  }

  /**
   * Generates ESTIMATED needs for one SOS work cycle from the active norm table. The lines go through the same cycle lock,
   * campaign scope, item validation and one-live-need index as a declared need, so no separate demand path exists.
   */
  async estimate(dto: EstimateNeedsDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const idempotencyKey = needCommandKey(request);
    if (new Set(dto.categories.map((line) => line.category)).size !== dto.categories.length) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const idempotent = {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.needs.estimate',
      key: idempotencyKey,
      requestHash: canonicalRequestHash({
        request_id: dto.request_id,
        work_cycle: dto.work_cycle,
        people_count: dto.people_count,
        days: dto.days ?? null,
        infants: dto.infants ?? null,
        elderly: dto.elderly ?? null,
        categories: dto.categories.map((line) => ({ category: line.category, item_id: line.item_id })),
      }),
    };
    const replay = async (manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> => {
      if (resource?.type !== 'need_estimate_batch') throw new AppError('INTERNAL_ERROR', { status: 500 });
      const rows = await manager.query(
        `SELECT id FROM relief_need WHERE estimate_basis->>'batch_id'=$1 ORDER BY id`,
        [resource.id],
      ) as Array<{ id: string }>;
      const items: Record<string, unknown>[] = [];
      for (const row of rows) items.push(await readNeed(manager, row.id));
      if (items[0]) requireNeedEstimateConfirm(session.grants, items[0] as Pick<ResponseAdmission, 'campaign_id'>);
      return { items };
    };

    let admission: ResponseAdmission;
    try {
      admission = await this.response.admit(dto.request_id, dto.work_cycle, session.identityHeaders);
    } catch (error) {
      return this.idempotency.execute(this.dataSource, {
        ...idempotent,
        execute: async () => { throw error; },
        replay,
      });
    }
    requireNeedEstimateConfirm(session.grants, admission);

    return this.idempotency.execute(this.dataSource, {
      ...idempotent,
      databaseErrorMappings: { unique: { need_one_live_per_item_uq: 'NEED_EXISTS' } },
      execute: async (manager) => {
        const cycle = await lockCycle(manager, admission);
        requireNeedEstimateConfirm(session.grants, cycle);

        const categoryItems = [];
        for (const line of dto.categories) {
          const item = await loadItem(manager, line.item_id);
          const norms = await manager.query(
            `SELECT id,category,item_type_code,quantity_basis,qty_per_person_per_day::text,
                    modifier_infant::text,modifier_elderly::text,active,version
               FROM need_norm WHERE category=$1 AND active`,
            [line.category],
          ) as NeedEstimateNorm[];
          if (norms.length === 0) throw new AppError('NEED_NORM_NOT_FOUND', { status: 400 });
          if (!norms.some((norm) => norm.item_type_code === item.item_type_code)) {
            throw new AppError('NEED_ITEM_TYPE_MISMATCH', { status: 400 });
          }
          categoryItems.push({ line, item, norms });
        }

        const itemIds = categoryItems.map((entry) => entry.item.id);
        const declared = await manager.query(
          `SELECT n.id FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
            WHERE c.request_id=$1 AND n.item_id=ANY($2::uuid[]) AND n.source IN ('DECLARED','CONFIRMED') AND n.status<>'CANCELLED'
            LIMIT 1`,
          [admission.request_id, itemIds],
        ) as Array<{ id: string }>;
        if (declared[0]) throw new AppError('NEED_ALREADY_DECLARED', { status: 409 });

        const allNorms = categoryItems.flatMap((entry) => entry.norms);
        const result = estimateNeeds({
          people_count: dto.people_count,
          ...(dto.days !== undefined ? { days: dto.days } : {}),
          infants: dto.infants ?? 0,
          elderly: dto.elderly ?? 0,
          categories: categoryItems.map((entry) => ({
            category: entry.line.category,
            item_type_code: entry.item.item_type_code,
            unit_scale: Number(entry.item.scale),
          })),
        }, allNorms);
        if (result.skipped.length > 0) throw new AppError('NEED_NORM_NOT_FOUND', { status: 400 });

        const batchId = randomUUID();
        const estimatedAt = new Date().toISOString();
        const ids: string[] = [];
        for (const line of result.lines) {
          const item = categoryItems.find((entry) => entry.line.category === line.category)!.item;
          const basis: NeedEstimateBasis = {
            batch_id: batchId,
            category: line.category,
            item_type_code: line.item_type_code,
            norm_id: line.norm_id,
            norm_version: line.norm_version,
            people_count: dto.people_count,
            days: dto.days ?? NEED_ESTIMATE_DEFAULT_DAYS,
            infants: dto.infants ?? 0,
            elderly: dto.elderly ?? 0,
            effective_persons: line.effective_persons,
            raw_quantity: line.raw_quantity,
            estimated_quantity: line.quantity,
            reason_codes: line.reason_codes,
            estimated_at: estimatedAt,
          };
          const inserted = await manager.query(
            `INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity,source,estimate_basis)
             VALUES ($1,$2,$3,$3,'ESTIMATED',$4::jsonb) RETURNING id`,
            [cycle.id, item.id, line.quantity, JSON.stringify(basis)],
          ) as Array<{ id: string }>;
          const id = inserted[0]?.id;
          if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
          const value = await readNeed(manager, id);
          await writeNeedAudit(manager, session.userId, 'NEED_ESTIMATED', id, null, value, null);
          ids.push(id);
        }
        const items: Record<string, unknown>[] = [];
        for (const id of ids) items.push(await readNeed(manager, id));
        return { status: 201, value: { items }, resource: { type: 'need_estimate_batch', id: batchId } };
      },
      replay,
    });
  }
}
