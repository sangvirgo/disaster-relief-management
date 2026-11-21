import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef,
} from '@c48/technical/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { validateQuantity } from '../common/quantity';
import { CreateNeedDto, EstimateNeedsDto } from './needs.dto';
import {
  NeedCommandRequest, needCommandKey, readNeed, requireNeedEstimateConfirm, requireNeedManage, writeNeedAudit,
} from './needs.helpers';
import { NeedEstimateLineInput } from './need-estimate';
import { lockCycle, persistEstimateBatch } from './need-estimate-batch';
import { ResponseAdmission, ResponseAdmissionClient } from './response-admission.client';

export type { NeedCommandRequest } from './needs.helpers';

interface ItemRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  item_type_code: string;
  unit_code: string;
  unit_name: string;
  scale: number;
}

function requestHash(dto: CreateNeedDto): string {
  return canonicalRequestHash({
    request_id: dto.request_id,
    work_cycle: dto.work_cycle,
    item_id: dto.item_id,
    quantity: dto.quantity,
    reason: dto.reason ?? null,
  });
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
        const inserted = await manager.query(
          `INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity)
           VALUES ($1,$2,$3,$3) RETURNING id`,
          [cycle.id, item.id, quantity],
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
   * Generates ESTIMATED needs for one SOS work cycle from the active norm table. The SOS facts come from the Response
   * admission read, never from the caller. Each category yields one line. The lines go through the same cycle lock,
   * campaign scope, item validation and one-live-need index as a declared need, so no separate demand path exists.
   */
  async estimate(dto: EstimateNeedsDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const idempotencyKey = needCommandKey(request);
    const categories = dto.categories;
    if (categories && new Set(categories.map((line) => line.category)).size !== categories.length) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const idempotent = {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.needs.estimate',
      key: idempotencyKey,
      requestHash: canonicalRequestHash({
        request_id: dto.request_id,
        work_cycle: dto.work_cycle,
        categories: categories ? categories.map((line) => ({ category: line.category, item_id: line.item_id ?? null })) : null,
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
    // Admission already refuses requests that are not VERIFIED or later; this guard covers the relief-supply flag.
    if (!admission.needs_relief_supplies) throw new AppError('NEED_RELIEF_NOT_REQUESTED', { status: 409 });
    if (admission.people_affected === null) throw new AppError('NEED_PEOPLE_MISSING', { status: 409 });

    return this.idempotency.execute(this.dataSource, {
      ...idempotent,
      databaseErrorMappings: { unique: { need_one_live_per_item_uq: 'NEED_EXISTS' } },
      execute: async (manager) => {
        const lines: NeedEstimateLineInput[] | 'DEFAULT_BUNDLE' = categories
          ? categories.map((line) => ({ category: line.category, item_id: line.item_id ?? null }))
          : 'DEFAULT_BUNDLE';
        const batch = await persistEstimateBatch(manager, {
          admission,
          lines,
          actor: { userId: session.userId, grants: session.grants },
        });
        // Nothing to create (no active norm in the bundle, or every quantity rounds to zero) is a validation failure here.
        if (batch.ids.length === 0) throw new AppError('VALIDATION_FAILED', { status: 400 });
        return { status: 201, value: { items: batch.items }, resource: { type: 'need_estimate_batch', id: batch.batchId } };
      },
      replay,
    });
  }
}
