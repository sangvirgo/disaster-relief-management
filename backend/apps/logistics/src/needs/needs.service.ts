import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef,
} from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { validateQuantity } from '../common/quantity';
import { CreateNeedDto } from './needs.dto';
import { NeedCommandRequest, needCommandKey, NeedRow, readNeed, requireNeedManage, writeNeedAudit } from './needs.helpers';
import { ResponseAdmission, ResponseAdmissionClient } from './response-admission.client';

export type { NeedCommandRequest } from './needs.helpers';

interface CycleRow extends Pick<ResponseAdmission, 'request_id' | 'work_cycle' | 'organization_id' | 'region_code' | 'campaign_id'> {
  id: string;
  state: 'OPEN' | 'FROZEN' | 'SEALED';
}

interface ItemRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  unit_code: string;
  unit_name: string;
  scale: number;
}

interface ReliefPointRow {
  id: string;
  organization_id: string;
  region_code: string;
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
    cycle.organization_id === admission.organization_id && cycle.region_code === admission.region_code &&
    cycle.campaign_id === admission.campaign_id;
}

async function lockCycle(
  manager: Pick<EntityManager, 'query'>,
  admission: ResponseAdmission,
): Promise<CycleRow> {
  await manager.query(
    `INSERT INTO fulfillment_cycle (request_id,work_cycle,organization_id,campaign_id,region_code)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (request_id,work_cycle) DO NOTHING`,
    [admission.request_id, admission.work_cycle, admission.organization_id, admission.campaign_id, admission.region_code],
  );
  const rows = await manager.query(
    `SELECT id,request_id,work_cycle,organization_id,region_code,campaign_id,state
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
    `SELECT i.id,i.name,i.status,u.code AS unit_code,u.display_name AS unit_name,u.scale
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
    'SELECT id,organization_id,region_code,status FROM relief_point WHERE id=$1 FOR SHARE',
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
      requireNeedManage(session.grants, value as Pick<ResponseAdmission, 'organization_id' | 'region_code' | 'campaign_id'>);
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
          if (point.organization_id !== cycle.organization_id) throw new AppError('VALIDATION_FAILED', { status: 400 });
          requireNeedManage(session.grants, {
            organization_id: point.organization_id,
            region_code: point.region_code,
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
}
