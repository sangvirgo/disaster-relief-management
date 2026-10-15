import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { LogisticsResponseCampaignClient, ResponseCampaign } from '../integrations/response/response-campaign.client';
import { hasWarehouseScope, requireWarehousePermission } from '../stock/stock.scope';
import {
  assertExpectedVersion, activeItemScales, assertLinePurpose, CommitmentContext,
  insertDistributionLines, lockCommitmentContexts, writeDistributionAudit,
} from './distribution-commands.helpers';
import { lockDistributionAssets } from './distribution-assets.helpers';
import { availableCommitmentLines, issueDistributionLines, loadDispatchLines } from './distribution-stock.helpers';
import { CreateDistributionDto, DistributionLineDto, ExpectedDistributionVersionDto, ReplaceDistributionLinesDto } from './distributions.dto';
import { DistributionContext, loadDistribution, readDistributionView } from './distributions.read';

type DistributionRequest = Request & { idempotencyKey?: string };

interface WarehouseContext {
  id: string;
  organization_id: string;
  region_code: string;
}

function idempotencyKey(request: DistributionRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function requireScope(
  grants: Parameters<typeof hasWarehouseScope>[0],
  permission: 'DISTRIBUTION_PREPARE' | 'DISTRIBUTION_REVIEW' | 'DISTRIBUTION_DISPATCH',
  distribution: Pick<DistributionContext, 'organization_id' | 'warehouse_region_code'>,
): void {
  if (!hasWarehouseScope(grants, distribution.organization_id, distribution.warehouse_region_code)) {
    throw new AppError('NOT_FOUND', { status: 404 });
  }
  requireWarehousePermission(grants, permission, distribution.organization_id, distribution.warehouse_region_code);
}

function requestLines(dto: CreateDistributionDto | ReplaceDistributionLinesDto): DistributionLineDto[] {
  return dto.lines.map((line) => ({ ...line }));
}

function distributionState(row: DistributionContext): Record<string, unknown> {
  return { status: row.status, version: row.version, approved_version: row.approved_version };
}

@Injectable()
export class DistributionCommandsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly campaigns: LogisticsResponseCampaignClient,
  ) {}

  async create(dto: CreateDistributionDto, request: DistributionRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const warehouse = await this.loadWarehouse(this.dataSource, dto.warehouse_id);
    requireScope(session.grants, 'DISTRIBUTION_PREPARE', {
      organization_id: warehouse.organization_id, warehouse_region_code: warehouse.region_code,
    });
    this.assertPurpose(dto.purpose, dto.campaign_id, dto.relief_point_id);
    assertLinePurpose(dto.purpose, dto.lines);
    let campaignError: AppError | undefined;
    try {
      await this.assertCampaign(dto, warehouse.organization_id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      campaignError = error;
    }

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.create',
      key,
      requestHash: canonicalRequestHash(dto),
      databaseErrorMappings: { check: { stock_balance_check: 'INSUFFICIENT_STOCK' } },
      execute: async (manager) => {
        const lockedWarehouse = await lockDistributionAssets(manager, {
          warehouse_id: dto.warehouse_id,
          relief_point_id: dto.relief_point_id ?? null,
          vehicle_id: dto.vehicle_id ?? null,
        });
        requireScope(session.grants, 'DISTRIBUTION_PREPARE', {
          organization_id: lockedWarehouse.organization_id, warehouse_region_code: lockedWarehouse.region_code,
        });
        if (campaignError) throw campaignError;
        const inserted = await manager.query(
          `INSERT INTO distribution (warehouse_id,organization_id,relief_point_id,vehicle_id,campaign_id,purpose,preparer_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [dto.warehouse_id, lockedWarehouse.organization_id, dto.relief_point_id ?? null, dto.vehicle_id ?? null,
            dto.campaign_id ?? null, dto.purpose, session.userId],
        ) as Array<{ id: string }>;
        const id = inserted[0]?.id;
        if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const distribution = await loadDistribution(manager, id, true);
        await this.validateLines(manager, distribution, dto.lines);
        await insertDistributionLines(manager, id, distribution.warehouse_id, dto.lines);
        const value = await readDistributionView(manager, id);
        await writeDistributionAudit(manager, session.userId, 'DISTRIBUTION_CREATED', id, null, value);
        return { status: 201, value, resource: { type: 'distribution', id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'distribution') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const current = await loadDistribution(manager, resource.id);
        requireScope(session.grants, 'DISTRIBUTION_PREPARE', current);
        return readDistributionView(manager, current.id);
      },
    });
  }

  async replaceLines(id: string, dto: ReplaceDistributionLinesDto, request: DistributionRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, id);
    requireScope(session.grants, 'DISTRIBUTION_PREPARE', current);
    if (current.preparer_user_id !== session.userId) throw new AppError('FORBIDDEN', { status: 403 });
    assertLinePurpose(current.purpose, dto.lines);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.replace-lines',
      key,
      requestHash: canonicalRequestHash({ distribution_id: id, dto }),
      execute: async (manager) => {
        const locked = await loadDistribution(manager, id, true);
        requireScope(session.grants, 'DISTRIBUTION_PREPARE', locked);
        if (locked.preparer_user_id !== session.userId) throw new AppError('FORBIDDEN', { status: 403 });
        assertExpectedVersion(locked.version, dto.expected_version);
        if (locked.status === 'DISPATCHED' || locked.status === 'RECONCILED') throw new AppError('ALREADY_DISPATCHED', { status: 409 });
        if (locked.status !== 'DRAFT' && locked.status !== 'APPROVED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const before = distributionState(locked);
        await this.validateLines(manager, locked, dto.lines);
        await manager.query(
          `UPDATE distribution SET status='DRAFT',approver_user_id=NULL,approved_version=NULL,approved_at=NULL,version=version+1
            WHERE id=$1 AND version=$2`,
          [id, dto.expected_version],
        );
        await manager.query('DELETE FROM distribution_line WHERE distribution_id=$1', [id]);
        await insertDistributionLines(manager, id, locked.warehouse_id, dto.lines);
        const value = await readDistributionView(manager, id);
        await writeDistributionAudit(manager, session.userId, 'DISTRIBUTION_LINES_REPLACED', id, before, value);
        return { status: 200, value, resource: { type: 'distribution', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.userId, session.grants, 'DISTRIBUTION_PREPARE'),
    });
  }

  async prepareFromCommitments(id: string, dto: ExpectedDistributionVersionDto, request: DistributionRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, id);
    requireScope(session.grants, 'DISTRIBUTION_PREPARE', current);
    if (current.preparer_user_id !== session.userId) throw new AppError('FORBIDDEN', { status: 403 });
    if (current.purpose !== 'REQUEST_AID') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.prepare-from-commitments',
      key,
      requestHash: canonicalRequestHash({ distribution_id: id, dto }),
      execute: async (manager) => {
        const locked = await loadDistribution(manager, id, true);
        requireScope(session.grants, 'DISTRIBUTION_PREPARE', locked);
        if (locked.preparer_user_id !== session.userId || locked.purpose !== 'REQUEST_AID') throw new AppError('FORBIDDEN', { status: 403 });
        assertExpectedVersion(locked.version, dto.expected_version);
        if (locked.status === 'DISPATCHED' || locked.status === 'RECONCILED') throw new AppError('ALREADY_DISPATCHED', { status: 409 });
        if (locked.status !== 'DRAFT' && locked.status !== 'APPROVED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const before = distributionState(locked);
        const lines = await availableCommitmentLines(manager, locked);
        if (lines.length === 0) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        await this.validateLines(manager, locked, lines);
        await manager.query(
          `UPDATE distribution SET status='DRAFT',approver_user_id=NULL,approved_version=NULL,approved_at=NULL,version=version+1
            WHERE id=$1 AND version=$2`,
          [id, dto.expected_version],
        );
        await manager.query('DELETE FROM distribution_line WHERE distribution_id=$1', [id]);
        await insertDistributionLines(manager, id, locked.warehouse_id, lines);
        const value = await readDistributionView(manager, id);
        await writeDistributionAudit(manager, session.userId, 'DISTRIBUTION_PREPARED_FROM_COMMITMENTS', id, before, value);
        return { status: 200, value, resource: { type: 'distribution', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.userId, session.grants, 'DISTRIBUTION_PREPARE'),
    });
  }

  async approve(id: string, dto: ExpectedDistributionVersionDto, request: DistributionRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, id);
    requireScope(session.grants, 'DISTRIBUTION_REVIEW', current);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.approve',
      key,
      requestHash: canonicalRequestHash({ distribution_id: id, dto }),
      execute: async (manager) => {
        const locked = await loadDistribution(manager, id, true);
        requireScope(session.grants, 'DISTRIBUTION_REVIEW', locked);
        assertExpectedVersion(locked.version, dto.expected_version);
        if (locked.status !== 'DRAFT') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (locked.preparer_user_id === session.userId) throw new AppError('SELF_APPROVAL_FORBIDDEN', { status: 403 });
        const before = distributionState(locked);
        const updated = await manager.query(
          `UPDATE distribution SET status='APPROVED',approver_user_id=$2,approved_version=version,approved_at=clock_timestamp()
            WHERE id=$1 AND version=$3 RETURNING id`,
          [id, session.userId, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const value = await readDistributionView(manager, id);
        await writeDistributionAudit(manager, session.userId, 'DISTRIBUTION_APPROVED', id, before, value);
        return { status: 200, value, resource: { type: 'distribution', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.userId, session.grants, 'DISTRIBUTION_REVIEW'),
    });
  }

  async dispatch(id: string, dto: ExpectedDistributionVersionDto, request: DistributionRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, id);
    requireScope(session.grants, 'DISTRIBUTION_DISPATCH', current);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.dispatch',
      key,
      requestHash: canonicalRequestHash({ distribution_id: id, dto }),
      databaseErrorMappings: { check: { stock_balance_check: 'INSUFFICIENT_STOCK' } },
      execute: async (manager) => {
        const locked = await loadDistribution(manager, id, true);
        requireScope(session.grants, 'DISTRIBUTION_DISPATCH', locked);
        assertExpectedVersion(locked.version, dto.expected_version);
        if (locked.status !== 'APPROVED' || locked.approved_version !== locked.version) {
          throw new AppError('APPROVAL_STALE', { status: 409 });
        }
        if (locked.approver_user_id === session.userId) throw new AppError('FORBIDDEN', { status: 403 });
        const lines = await loadDispatchLines(manager, id);
        if (lines.length === 0) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const { commitments, scales } = await this.validateLines(manager, locked, lines, 'DISPATCH');
        await lockDistributionAssets(manager, locked);
        const before = distributionState(locked);
        await issueDistributionLines(manager, locked, lines, scales, commitments, session.userId);
        await manager.query(
          'UPDATE distribution_line SET in_transit_quantity=quantity WHERE distribution_id=$1',
          [id],
        );
        const updated = await manager.query(
          `UPDATE distribution SET status='DISPATCHED',dispatch_actor_user_id=$2,dispatched_at=clock_timestamp(),version=version+1
            WHERE id=$1 AND version=$3 RETURNING id`,
          [id, session.userId, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const value = await readDistributionView(manager, id);
        await writeDistributionAudit(manager, session.userId, 'DISTRIBUTION_DISPATCHED', id, before, value);
        return { status: 200, value, resource: { type: 'distribution', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.userId, session.grants, 'DISTRIBUTION_DISPATCH'),
    });
  }

  async cancel(id: string, dto: ExpectedDistributionVersionDto, request: DistributionRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = idempotencyKey(request);
    const current = await loadDistribution(this.dataSource, id);
    if (!hasWarehouseScope(session.grants, current.organization_id, current.warehouse_region_code)) throw new AppError('NOT_FOUND', { status: 404 });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.distributions.cancel',
      key,
      requestHash: canonicalRequestHash({ distribution_id: id, dto }),
      execute: async (manager) => {
        const locked = await loadDistribution(manager, id, true);
        if (!hasWarehouseScope(session.grants, locked.organization_id, locked.warehouse_region_code)) throw new AppError('NOT_FOUND', { status: 404 });
        assertExpectedVersion(locked.version, dto.expected_version);
        if (locked.status === 'DISPATCHED' || locked.status === 'RECONCILED') throw new AppError('ALREADY_DISPATCHED', { status: 409 });
        if (locked.status !== 'DRAFT' && locked.status !== 'APPROVED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (session.userId !== locked.preparer_user_id && session.userId !== locked.approver_user_id) throw new AppError('FORBIDDEN', { status: 403 });
        if (session.userId === locked.preparer_user_id) requireWarehousePermission(session.grants, 'DISTRIBUTION_PREPARE', locked.organization_id, locked.warehouse_region_code);
        else requireWarehousePermission(session.grants, 'DISTRIBUTION_REVIEW', locked.organization_id, locked.warehouse_region_code);
        const before = distributionState(locked);
        await manager.query(
          'UPDATE distribution SET status=\'CANCELLED\',version=version+1 WHERE id=$1 AND version=$2',
          [id, dto.expected_version],
        );
        const value = await readDistributionView(manager, id);
        await writeDistributionAudit(manager, session.userId, 'DISTRIBUTION_CANCELLED', id, before, value);
        return { status: 200, value, resource: { type: 'distribution', id } };
      },
      replay: (manager, resource) => this.replayCancellation(manager, resource, session.userId, session.grants),
    });
  }

  private async validateLines(
    manager: EntityManager,
    distribution: DistributionContext,
    lines: readonly DistributionLineDto[],
    mode: 'PREPARATION' | 'DISPATCH' = 'PREPARATION',
  ): Promise<{ commitments: CommitmentContext[]; scales: Map<string, number> }> {
    assertLinePurpose(distribution.purpose, lines);
    const commitments = await lockCommitmentContexts(
      manager, lines, distribution.warehouse_id, distribution.organization_id, distribution.purpose,
      distribution.relief_point_id, mode,
    );
    const scales = await activeItemScales(manager, lines);
    return { commitments, scales };
  }

  private async loadWarehouse(source: Pick<DataSource | EntityManager, 'query'>, id: string): Promise<WarehouseContext> {
    const rows = await source.query(
      'SELECT id,organization_id,region_code FROM warehouse WHERE id=$1',
      [id],
    ) as WarehouseContext[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private assertPurpose(purpose: string, campaignId: string | undefined, pointId: string | undefined): void {
    if ((purpose === 'CAMPAIGN_DISTRIBUTION') !== Boolean(campaignId) ||
        (purpose === 'POINT_REPLENISHMENT' && !pointId)) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
  }

  private async assertCampaign(dto: CreateDistributionDto, organizationId: string): Promise<void> {
    if (!dto.campaign_id) return;
    let campaign: ResponseCampaign;
    try {
      campaign = await this.campaigns.getCampaign(dto.campaign_id);
    } catch {
      throw new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
    }
    if (campaign.organization_id !== organizationId) throw new AppError('VALIDATION_FAILED', { status: 400 });
    if (campaign.status === 'PAUSED') throw new AppError('CAMPAIGN_PAUSED', { status: 409 });
    if (campaign.status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
  }

  private async replay(
    manager: EntityManager,
    resource: { type: string; id: string } | null,
    userId: string,
    grants: Parameters<typeof hasWarehouseScope>[0],
    permission: 'DISTRIBUTION_PREPARE' | 'DISTRIBUTION_REVIEW' | 'DISTRIBUTION_DISPATCH',
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'distribution') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const current = await loadDistribution(manager, resource.id);
    requireScope(grants, permission, current);
    if (!userId) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return readDistributionView(manager, current.id);
  }

  private async replayCancellation(
    manager: EntityManager,
    resource: { type: string; id: string } | null,
    userId: string,
    grants: Parameters<typeof hasWarehouseScope>[0],
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'distribution') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const current = await loadDistribution(manager, resource.id);
    if (!hasWarehouseScope(grants, current.organization_id, current.warehouse_region_code)) {
      throw new AppError('NOT_FOUND', { status: 404 });
    }
    if (userId === current.preparer_user_id) {
      requireWarehousePermission(grants, 'DISTRIBUTION_PREPARE', current.organization_id, current.warehouse_region_code);
    } else if (userId === current.approver_user_id) {
      requireWarehousePermission(grants, 'DISTRIBUTION_REVIEW', current.organization_id, current.warehouse_region_code);
    } else {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    return readDistributionView(manager, current.id);
  }
}
