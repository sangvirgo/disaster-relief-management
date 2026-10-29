import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import { hasWarehouseScope, requireWarehousePermission } from '../stock/stock.scope';
import { assertExpectedVersion, writeDistributionAudit } from './distribution-commands.helpers';
import { CreateHandoffDto, ExpectedDistributionVersionDto, ReviewLossDto } from './distributions.dto';
import {
  DistributionHandoffLineContext, applyHandoffSettlement, eligibleSettlement,
  lockSettlementCommitments, orderHandoffLines, readDistributionHandoffLines, updateNeedFulfillment,
} from './handoff-settlement.helpers';
import { DistributionHandoffKind, HandoffSourceStage, nextCustodyBalance } from './distributions.helpers';
import { readHandoffView } from './handoffs.read';
import { DistributionContext, loadDistribution, readDistributionView } from './distributions.read';
import { requireHandoffPermission } from './handoff-permissions.helpers';
import { requireIdempotencyKey as idempotencyKey } from '@c48/technical/http/response-headers';

type HandoffRequest = Request & { idempotencyKey?: string };

interface HandoffRecordRow {
  id: string;
  handoff_kind: DistributionHandoffKind;
  source_stage: HandoffSourceStage;
  recorder_user_id: string;
  decision: 'APPROVE' | 'REJECT' | null;
}

interface HandoffLineRow extends DistributionHandoffLineContext {
  handoff_line_id: string;
}

function requireScope(
  grants: Parameters<typeof hasWarehouseScope>[0],
  permission: 'DISTRIBUTION_REVIEW' | 'DISTRIBUTION_DISPATCH' | 'HANDOFF_RECORD' | 'LOSS_APPROVE',
  distribution: Pick<DistributionContext, 'organization_id' | 'warehouse_region_code'>,
): void {
  if (!hasWarehouseScope(grants, distribution.organization_id, distribution.warehouse_region_code)) {
    throw new AppError('NOT_FOUND', { status: 404 });
  }
  requireWarehousePermission(grants, permission, distribution.organization_id, distribution.warehouse_region_code);
}

function auditState(distribution: DistributionContext): Record<string, unknown> {
  return { status: distribution.status, version: distribution.version };
}

@Injectable()
export class HandoffCommandsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async create(distributionId: string, dto: CreateHandoffDto, request: HandoffRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, distributionId);
    this.requireRecorderPermission(session.grants, current, dto.handoff_kind);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.handoffs.create',
      key,
      requestHash: canonicalRequestHash({ distribution_id: distributionId, dto }),
      execute: async (manager) => {
        const distribution = await loadDistribution(manager, distributionId, true);
        this.requireRecorderPermission(session.grants, distribution, dto.handoff_kind);
        if (distribution.status !== 'DISPATCHED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (!distribution.dispatch_actor_user_id || distribution.dispatch_actor_user_id === session.userId) {
          throw new AppError('FORBIDDEN', { status: 403 });
        }
        this.assertReceiver(dto, session.userId);

        const lineIds = dto.lines.map((line) => line.distribution_line_id);
        if (new Set(lineIds).size !== lineIds.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
        const lines = await readDistributionHandoffLines(manager, distributionId, lineIds);
        const sourceStage = dto.source_stage ?? null;
        const kind = dto.handoff_kind as DistributionHandoffKind;
        const quantityByLine = new Map(dto.lines.map((line) => [line.distribution_line_id, line.quantity]));
        const balances = new Map<string, ReturnType<typeof nextCustodyBalance>>();
        for (const line of lines) {
          const quantity = validateQuantity(quantityByLine.get(line.id)!, Number(line.unit_scale));
          balances.set(line.id, nextCustodyBalance({
            handoffKind: kind,
            sourceStage,
            quantity: quantityUnits(quantity, Number(line.unit_scale)),
            inTransit: quantityUnits(line.in_transit_quantity, Number(line.unit_scale)),
            atPoint: quantityUnits(line.at_point_quantity, Number(line.unit_scale)),
            hasReliefPoint: distribution.relief_point_id !== null,
          }));
        }

        const settlementRows = kind === 'LOSS' ? [] : await lockSettlementCommitments(manager, lines, kind, sourceStage);
        const settlementById = new Map(settlementRows.map((row) => [row.id, row]));
        const before = auditState(distribution);
        const inserted = await manager.query(
          `INSERT INTO handoff_record (distribution_id,handoff_kind,source_stage,receiver_user_id,receiver_label,recorder_user_id,confirmation_basis,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) RETURNING id`,
          [distributionId, kind, sourceStage, dto.receiver_user_id ?? null, dto.receiver_label?.trim() || null,
            session.userId, dto.confirmation_basis.trim(), new Date(dto.occurred_at).toISOString()],
        ) as Array<{ id: string }>;
        const handoffId = inserted[0]?.id;
        if (!handoffId) throw new AppError('INTERNAL_ERROR', { status: 500 });

        const affectedNeeds = new Set<string>();
        const handoffLines = new Map<string, string>();
        for (const line of orderHandoffLines(lines, kind)) {
          const quantity = validateQuantity(quantityByLine.get(line.id)!, Number(line.unit_scale));
          const added = await manager.query(
            `INSERT INTO handoff_line (handoff_id,distribution_id,distribution_line_id,commitment_id,quantity)
             VALUES ($1,$2,$3,$4,$5::numeric) RETURNING id`,
            [handoffId, distributionId, line.id, line.commitment_id, quantity],
          ) as Array<{ id: string }>;
          const handoffLineId = added[0]?.id;
          if (!handoffLineId) throw new AppError('INTERNAL_ERROR', { status: 500 });
          handoffLines.set(line.id, handoffLineId);

          if (kind !== 'LOSS') {
            const balance = balances.get(line.id);
            if (!balance) throw new AppError('INTERNAL_ERROR', { status: 500 });
            await this.writeCustodyBalance(manager, line, balance);
          }
          if (kind === 'RETURN') await this.returnToWarehouse(manager, distribution, line, handoffLineId, quantity, session.userId);

          const settlementType = eligibleSettlement(line, kind, sourceStage);
          if (settlementType) {
            const commitment = line.commitment_id ? settlementById.get(line.commitment_id) : undefined;
            if (!commitment) throw new AppError('INTERNAL_ERROR', { status: 500 });
            await applyHandoffSettlement(manager, { ...line, id: handoffLineId }, commitment, settlementType, quantity);
            if (line.relief_need_id) affectedNeeds.add(line.relief_need_id);
          }
        }
        await updateNeedFulfillment(manager, [...affectedNeeds]);
        await this.autoReconcile(manager, distributionId);
        const value = await readHandoffView(manager, distributionId, handoffId);
        const afterDistribution = await loadDistribution(manager, distributionId);
        await writeDistributionAudit(manager, session.userId, 'HANDOFF_RECORDED', distributionId, before, {
          ...auditState(afterDistribution), handoff_id: handoffId, handoff_kind: kind,
        });
        return { status: 201, value, resource: { type: 'handoff', id: handoffId } };
      },
      replay: (manager, resource) => this.replayHandoff(manager, resource, session.grants, 'HANDOFF_CREATE'),
    });
  }

  async reviewLoss(
    distributionId: string,
    handoffId: string,
    dto: ReviewLossDto,
    request: HandoffRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, distributionId);
    requireScope(session.grants, 'LOSS_APPROVE', current);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.handoffs.review-loss',
      key,
      requestHash: canonicalRequestHash({ distribution_id: distributionId, handoff_id: handoffId, dto }),
      execute: async (manager) => {
        const distribution = await loadDistribution(manager, distributionId, true);
        requireScope(session.grants, 'LOSS_APPROVE', distribution);
        if (dto.expected_version !== 1) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: 1 } });
        if (distribution.status !== 'DISPATCHED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const handoffs = await manager.query(
          `SELECT h.id,h.handoff_kind,h.source_stage,h.recorder_user_id,r.decision
             FROM handoff_record h LEFT JOIN handoff_loss_review r ON r.handoff_id=h.id
            WHERE h.id=$1 AND h.distribution_id=$2`,
          [handoffId, distributionId],
        ) as HandoffRecordRow[];
        const handoff = handoffs[0];
        if (!handoff) throw new AppError('NOT_FOUND', { status: 404 });
        if (handoff.handoff_kind !== 'LOSS') throw new AppError('HANDOFF_KIND_INVALID', { status: 409 });
        if (handoff.decision) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (handoff.recorder_user_id === session.userId) throw new AppError('FORBIDDEN', { status: 403 });

        const lineRows = await this.lossLines(manager, handoffId);
        const lines = await readDistributionHandoffLines(manager, distributionId, lineRows.map((line) => line.id));
        const quantityByLine = new Map(lineRows.map((line) => [line.id, line.quantity]));
        const balances = new Map<string, ReturnType<typeof nextCustodyBalance>>();
        if (dto.decision === 'APPROVE') {
          for (const line of lines) {
            const quantity = validateQuantity(quantityByLine.get(line.id)!, Number(line.unit_scale));
            balances.set(line.id, nextCustodyBalance({
              handoffKind: 'LOSS', sourceStage: handoff.source_stage,
              quantity: quantityUnits(quantity, Number(line.unit_scale)),
              inTransit: quantityUnits(line.in_transit_quantity, Number(line.unit_scale)),
              atPoint: quantityUnits(line.at_point_quantity, Number(line.unit_scale)),
              hasReliefPoint: distribution.relief_point_id !== null,
            }));
          }
        }
        const settlementRows = dto.decision === 'APPROVE'
          ? await lockSettlementCommitments(manager, lines, 'LOSS', handoff.source_stage)
          : [];
        const settlementById = new Map(settlementRows.map((row) => [row.id, row]));
        const before = auditState(distribution);
        await manager.query(
          `INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason)
           VALUES ($1,$2,$3,$4)`,
          [handoffId, session.userId, dto.decision, dto.reason.trim()],
        );
        const affectedNeeds = new Set<string>();
        if (dto.decision === 'APPROVE') {
          for (const line of lines) {
            const balance = balances.get(line.id);
            const handoffLineId = lineRows.find((row) => row.id === line.id)?.handoff_line_id;
            const quantity = quantityByLine.get(line.id);
            if (!balance || !handoffLineId || !quantity) throw new AppError('INTERNAL_ERROR', { status: 500 });
            await this.writeCustodyBalance(manager, line, balance);
            const settlementType = eligibleSettlement(line, 'LOSS', handoff.source_stage);
            if (settlementType) {
              const commitment = line.commitment_id ? settlementById.get(line.commitment_id) : undefined;
              if (!commitment) throw new AppError('INTERNAL_ERROR', { status: 500 });
              await applyHandoffSettlement(manager, { ...line, id: handoffLineId }, commitment, settlementType, quantity);
              if (line.relief_need_id) affectedNeeds.add(line.relief_need_id);
            }
          }
        }
        await updateNeedFulfillment(manager, [...affectedNeeds]);
        await this.autoReconcile(manager, distributionId);
        const value = await readHandoffView(manager, distributionId, handoffId);
        const afterDistribution = await loadDistribution(manager, distributionId);
        await writeDistributionAudit(manager, session.userId, 'HANDOFF_LOSS_REVIEWED', distributionId, before, {
          ...auditState(afterDistribution), handoff_id: handoffId, decision: dto.decision,
        });
        return { status: 200, value, resource: { type: 'handoff', id: handoffId } };
      },
      replay: (manager, resource) => this.replayHandoff(manager, resource, session.grants, 'LOSS_APPROVE'),
    });
  }

  async reconcile(
    distributionId: string,
    dto: ExpectedDistributionVersionDto,
    request: HandoffRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, distributionId);
    requireScope(session.grants, 'DISTRIBUTION_REVIEW', current);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.reconcile',
      key,
      requestHash: canonicalRequestHash({ distribution_id: distributionId, dto }),
      execute: async (manager) => {
        const distribution = await loadDistribution(manager, distributionId, true);
        requireScope(session.grants, 'DISTRIBUTION_REVIEW', distribution);
        assertExpectedVersion(distribution.version, dto.expected_version);
        if (distribution.status === 'RECONCILED') {
          return { status: 200, value: await readDistributionView(manager, distributionId), resource: { type: 'distribution', id: distributionId } };
        }
        if (distribution.status !== 'DISPATCHED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (await this.hasPendingLoss(manager, distributionId)) throw new AppError('LOSS_REVIEW_REQUIRED', { status: 409 });
        const reconciled = await this.reconcileIfReady(manager, distributionId);
        if (reconciled) {
          const value = await readDistributionView(manager, distributionId);
          return { status: 200, value, resource: { type: 'distribution', id: distributionId } };
        }
        return { status: 200, value: await readDistributionView(manager, distributionId), resource: { type: 'distribution', id: distributionId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'distribution') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const currentDistribution = await loadDistribution(manager, resource.id);
        requireScope(session.grants, 'DISTRIBUTION_REVIEW', currentDistribution);
        return readDistributionView(manager, resource.id);
      },
    });
  }

  private requireRecorderPermission(
    grants: Parameters<typeof hasWarehouseScope>[0],
    distribution: DistributionContext,
    kind: string,
  ): void {
    requireHandoffPermission(grants, kind === 'RETURN' ? 'RETURN' : 'HANDOFF_RECORD', distribution);
  }

  private assertReceiver(dto: CreateHandoffDto, recorderId: string): void {
    if (dto.handoff_kind === 'LOSS') {
      if (dto.receiver_user_id || dto.receiver_label) throw new AppError('HANDOFF_KIND_INVALID', { status: 409 });
      return;
    }
    if (dto.receiver_user_id === recorderId) throw new AppError('FORBIDDEN', { status: 403 });
    if (!dto.receiver_user_id && !dto.receiver_label?.trim()) throw new AppError('VALIDATION_FAILED', { status: 400 });
  }

  private async writeCustodyBalance(
    manager: EntityManager,
    line: DistributionHandoffLineContext,
    next: { inTransit: bigint; atPoint: bigint },
  ): Promise<void> {
    const scale = Number(line.unit_scale);
    await manager.query(
      `UPDATE distribution_line SET in_transit_quantity=$2::numeric,at_point_quantity=$3::numeric WHERE id=$1`,
      [line.id, decimalFromUnits(next.inTransit, scale), decimalFromUnits(next.atPoint, scale)],
    );
  }

  private async returnToWarehouse(
    manager: EntityManager,
    distribution: DistributionContext,
    line: DistributionHandoffLineContext,
    handoffLineId: string,
    quantity: string,
    actorId: string,
  ): Promise<void> {
    const balances = await manager.query(
      'SELECT id FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
      [distribution.warehouse_id, line.item_id],
    ) as Array<{ id: string }>;
    if (!balances[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await manager.query(
      `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,handoff_line_id,operation_ref,actor_user_id)
       VALUES ($1,'RETURN',$2::numeric,0,$3,$4,$5)`,
      [balances[0].id, quantity, handoffLineId, `HANDOFF_RETURN:${handoffLineId}`, actorId],
    );
  }

  private async lossLines(manager: EntityManager, handoffId: string): Promise<HandoffLineRow[]> {
    const rows = await manager.query(
      `SELECT dl.id,dl.distribution_id,dl.item_id,u.scale AS unit_scale,hl.quantity::text,
              dl.in_transit_quantity::text,dl.at_point_quantity::text,d.warehouse_id,cm.id AS commitment_id,
              cm.relief_need_id,n.cycle_id,
              CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind,
              hl.id AS handoff_line_id
         FROM handoff_line hl JOIN distribution_line dl ON dl.id=hl.distribution_line_id
         JOIN distribution d ON d.id=hl.distribution_id JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
         LEFT JOIN commitment cm ON cm.id=dl.commitment_id LEFT JOIN relief_need n ON n.id=cm.relief_need_id
        WHERE hl.handoff_id=$1 ORDER BY dl.id`,
      [handoffId],
    ) as HandoffLineRow[];
    return rows.map((line) => {
      const scale = Number(line.unit_scale);
      return { ...line, quantity: decimalFromUnits(quantityUnits(line.quantity, scale), scale) };
    });
  }

  private async hasPendingLoss(manager: EntityManager, distributionId: string): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1 FROM handoff_record h LEFT JOIN handoff_loss_review r ON r.handoff_id=h.id
        WHERE h.distribution_id=$1 AND h.handoff_kind='LOSS' AND r.handoff_id IS NULL LIMIT 1`,
      [distributionId],
    ) as unknown[];
    return rows.length > 0;
  }

  private async reconcileIfReady(manager: EntityManager, distributionId: string): Promise<boolean> {
    const pending = await this.hasPendingLoss(manager, distributionId);
    if (pending) return false;
    const outstanding = await manager.query(
      'SELECT 1 FROM distribution_line WHERE distribution_id=$1 AND (in_transit_quantity<>0 OR at_point_quantity<>0) LIMIT 1',
      [distributionId],
    ) as unknown[];
    if (outstanding.length) return false;
    const updated = await manager.query(
      `UPDATE distribution SET status='RECONCILED',reconciled_at=clock_timestamp(),version=version+1
        WHERE id=$1 AND status='DISPATCHED' RETURNING id`,
      [distributionId],
    ) as Array<{ id: string }>;
    if (updated[0]) {
      await manager.query(
        `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
         VALUES (NULL,'DISTRIBUTION_AUTO_RECONCILED','distribution',$1,'{"status":"DISPATCHED"}'::jsonb,
                 '{"status":"RECONCILED"}'::jsonb,'AUTO_NO_CUSTODY_REMAINS')`,
        [distributionId],
      );
    }
    return updated.length > 0;
  }

  private async autoReconcile(manager: EntityManager, distributionId: string): Promise<void> {
    await this.reconcileIfReady(manager, distributionId);
  }

  private async replayHandoff(
    manager: EntityManager,
    resource: { type: string; id: string } | null,
    grants: Parameters<typeof hasWarehouseScope>[0],
    command: 'HANDOFF_CREATE' | 'LOSS_APPROVE',
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'handoff') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query('SELECT distribution_id,handoff_kind FROM handoff_record WHERE id=$1', [resource.id]) as Array<{
      distribution_id: string;
      handoff_kind: DistributionHandoffKind;
    }>;
    const handoff = rows[0];
    if (!handoff) throw new AppError('NOT_FOUND', { status: 404 });
    const distribution = await loadDistribution(manager, handoff.distribution_id);
    if (command === 'LOSS_APPROVE') requireScope(grants, 'LOSS_APPROVE', distribution);
    else this.requireRecorderPermission(grants, distribution, handoff.handoff_kind);
    return readHandoffView(manager, distribution.id, resource.id);
  }
}
