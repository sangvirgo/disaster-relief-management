import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef } from '@c48/technical/idempotency/idempotency';
import { validateQuantity } from '../common/quantity';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { DriveItemDto, CreateDriveDto, PatchDriveDto, DriveReasonActionDto, DriveVersionActionDto } from './drives.dto';
import { ResponseCampaign, LogisticsResponseCampaignClient } from '../integrations/response/response-campaign.client';
import { assertExpectedVersion, cleanDriveText, requireDrivePermission } from './drives.helpers';
import { requireIdempotencyKey as idempotencyKey } from '@c48/technical/http/response-headers';

export type DriveCommandRequest = Request & { idempotencyKey?: string };

interface DriveRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  intake_warehouse_id: string;
  region_code: string;
  campaign_id: string | null;
  campaign_status: string | null;
  campaign_status_at?: Date | string | null;
  status: 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED';
  title: string;
  description: string | null;
  opens_at: Date | string | null;
  closes_at: Date | string | null;
  version: number | string;
  created_at: Date | string;
}

interface WarehouseRow {
  id: string;
  organization_id: string;
  region_code: string;
  status: string;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function driveValue(row: DriveRow, items: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: row.id,
    organization_id: row.organization_id,
    intake_warehouse_id: row.intake_warehouse_id,
    campaign_id: row.campaign_id,
    campaign_status: row.campaign_status,
    campaign_status_at: iso(row.campaign_status_at ?? null),
    status: row.status,
    title: row.title,
    description: row.description,
    opens_at: iso(row.opens_at),
    closes_at: iso(row.closes_at),
    version: Number(row.version),
    created_at: new Date(row.created_at).toISOString(),
    items,
  };
}

async function readDrive(manager: Pick<EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT d.id,d.organization_id,d.intake_warehouse_id,w.region_code,d.campaign_id,d.campaign_status,d.campaign_status_at,d.status,
            d.title,d.description,d.opens_at,d.closes_at,d.version,d.created_at
       FROM donation_drive d JOIN warehouse w ON w.id=d.intake_warehouse_id WHERE d.id=$1`,
    [id],
  ) as DriveRow[];
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { status: 404 });
  const items = await manager.query(
    `SELECT di.item_id,i.name AS item_name,di.target_quantity::text AS target_quantity,di.acceptance_note,
            t.display_name AS item_type_name,u.code AS unit_code,u.display_name AS unit_name,u.scale
       FROM drive_item di JOIN item i ON i.id=di.item_id JOIN item_type t ON t.code=i.item_type_code
       JOIN unit u ON u.code=i.unit_code WHERE di.drive_id=$1 ORDER BY i.name,di.item_id`,
    [id],
  ) as Array<Record<string, unknown>>;
  return driveValue(row, items);
}

async function writeAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string,
  action: string,
  id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string | null = null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'donation_drive',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
  );
}

@Injectable()
export class DrivesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly campaigns: LogisticsResponseCampaignClient,
  ) {}

  async create(dto: CreateDriveDto, request: DriveCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const warehouse = await this.findWarehouse(this.dataSource, dto.intake_warehouse_id);
    requireDrivePermission(session, 'DONATION_DRIVE_MANAGE', warehouse);
    const campaign = dto.campaign_id ? await this.activeCampaign(dto.campaign_id, warehouse.organization_id) : null;
    const title = cleanDriveText(dto.title, true)!;
    const description = cleanDriveText(dto.description);
    this.validateWindow(dto.opens_at ?? null, dto.closes_at ?? null);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-drives.create',
      key: idempotencyKey(request),
      requestHash: canonicalRequestHash(dto),
      execute: async (manager) => {
        const currentWarehouse = await this.findWarehouse(manager, dto.intake_warehouse_id, true);
        requireDrivePermission(session, 'DONATION_DRIVE_MANAGE', currentWarehouse);
        const items = await this.validateDriveItems(manager, dto.items);
        const rows = await manager.query(
          `INSERT INTO donation_drive
             (organization_id,intake_warehouse_id,campaign_id,campaign_status,campaign_status_at,title,description,opens_at,closes_at)
           VALUES ($1,$2,$3,$4,CASE WHEN $3::uuid IS NULL THEN NULL ELSE clock_timestamp() END,$5,$6,$7,$8)
           RETURNING id`,
          [currentWarehouse.organization_id, dto.intake_warehouse_id, campaign?.id ?? null, campaign?.status ?? null,
            title, description, dto.opens_at ?? null, dto.closes_at ?? null],
        ) as Array<{ id: string }>;
        const id = rows[0]!.id;
        await this.insertDriveItems(manager, id, items);
        const value = await readDrive(manager, id);
        await writeAudit(manager, session.userId, 'DRIVE_CREATED', id, null, value);
        return { status: 201, value, resource: { type: 'donation_drive', id } };
      },
      replay: (manager, resource) => this.replayDrive(manager, resource),
    });
  }

  async patch(id: string, dto: PatchDriveDto, request: DriveCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const before = await this.findDrive(this.dataSource, id);
    requireDrivePermission(session, 'DONATION_DRIVE_MANAGE', before);
    if (before.status !== 'DRAFT') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    const campaign = dto.campaign_id ? await this.activeCampaign(dto.campaign_id, before.organization_id) : null;
    this.validateWindow(dto.opens_at === undefined ? before.opens_at : dto.opens_at, dto.closes_at === undefined ? before.closes_at : dto.closes_at);
    const title = dto.title === undefined ? undefined : cleanDriveText(dto.title, true);
    const description = dto.description === undefined ? undefined : cleanDriveText(dto.description);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-drives.patch',
      key: idempotencyKey(request),
      requestHash: canonicalRequestHash({ id, ...dto }),
      execute: async (manager) => {
        const current = await this.findDrive(manager, id, true);
        requireDrivePermission(session, 'DONATION_DRIVE_MANAGE', current);
        assertExpectedVersion(current.version, dto.expected_version);
        if (current.status !== 'DRAFT') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const items = dto.items ? await this.validateDriveItems(manager, dto.items) : null;
        const hasCampaign = dto.campaign_id !== undefined;
        const [updated] = await manager.query(
          `UPDATE donation_drive SET
             title=CASE WHEN $3::boolean THEN $4::text ELSE title END,
             description=CASE WHEN $5::boolean THEN $6::text ELSE description END,
             campaign_id=CASE WHEN $7::boolean THEN $8::uuid ELSE campaign_id END,
             campaign_status=CASE WHEN $7::boolean THEN $9::text ELSE campaign_status END,
             campaign_status_at=CASE WHEN $7::boolean THEN CASE WHEN $8::uuid IS NULL THEN NULL ELSE clock_timestamp() END ELSE campaign_status_at END,
             opens_at=CASE WHEN $10::boolean THEN $11::timestamptz ELSE opens_at END,
             closes_at=CASE WHEN $12::boolean THEN $13::timestamptz ELSE closes_at END,
             version=version+1
           WHERE id=$1 AND version=$2 RETURNING id`,
          [id, dto.expected_version, title !== undefined, title ?? null, dto.description !== undefined, description,
            hasCampaign, dto.campaign_id ?? null, campaign?.status ?? null, dto.opens_at !== undefined, dto.opens_at ?? null,
            dto.closes_at !== undefined, dto.closes_at ?? null],
        ) as [Array<{ id: string }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        if (items) await this.replaceDriveItems(manager, id, items);
        const value = await readDrive(manager, id);
        await writeAudit(manager, session.userId, 'DRIVE_UPDATED', id, beforeState(current), value);
        return { status: 200, value, resource: { type: 'donation_drive', id } };
      },
      replay: (manager, resource) => this.replayDrive(manager, resource),
    });
  }

  transition(
    id: string,
    action: 'open' | 'pause' | 'resume' | 'close',
    dto: DriveVersionActionDto | DriveReasonActionDto,
    request: DriveCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.transitionCommand(id, action, dto, request);
  }

  private async transitionCommand(
    id: string,
    action: 'open' | 'pause' | 'resume' | 'close',
    dto: DriveVersionActionDto | DriveReasonActionDto,
    request: DriveCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const before = await this.findDrive(this.dataSource, id);
    requireDrivePermission(session, 'DONATION_DRIVE_MANAGE', before);
    const campaign = action === 'open' || action === 'resume'
      ? before.campaign_id ? await this.activeCampaign(before.campaign_id, before.organization_id) : null
      : null;
    this.nextStatus(before.status, action); // rejects an invalid transition before any work starts

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.donation-drives.${action}`,
      key: idempotencyKey(request),
      requestHash: canonicalRequestHash({ id, action, ...dto }),
      execute: async (manager) => {
        const current = await this.findDrive(manager, id, true);
        requireDrivePermission(session, 'DONATION_DRIVE_MANAGE', current);
        assertExpectedVersion(current.version, dto.expected_version);
        const status = this.nextStatus(current.status, action);
        const campaignStatus = campaign?.status ?? current.campaign_status;
        const [updated] = await manager.query(
          `UPDATE donation_drive SET status=$3,campaign_status=$4,
                  campaign_status_at=CASE WHEN $5::boolean THEN clock_timestamp() ELSE campaign_status_at END,
                  version=version+1 WHERE id=$1 AND version=$2 RETURNING id`,
          [id, dto.expected_version, status, campaignStatus, Boolean(campaign)],
        ) as [Array<{ id: string }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const value = await readDrive(manager, id);
        const reason = 'reason' in dto ? dto.reason : null;
        await writeAudit(manager, session.userId, `DRIVE_${action.toUpperCase()}`, id, beforeState(current), value, reason);
        return { status: 200, value, resource: { type: 'donation_drive', id } };
      },
      replay: (manager, resource) => this.replayDrive(manager, resource),
    });
  }

  private nextStatus(status: DriveRow['status'], action: 'open' | 'pause' | 'resume' | 'close'): DriveRow['status'] {
    const transitions = {
      open: { DRAFT: 'OPEN' },
      pause: { OPEN: 'PAUSED' },
      resume: { PAUSED: 'OPEN' },
      close: { OPEN: 'CLOSED', PAUSED: 'CLOSED' },
    } as const;
    const next = transitions[action][status as keyof (typeof transitions)[typeof action]];
    if (!next) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    return next;
  }

  private async activeCampaign(id: string, organizationId: string): Promise<ResponseCampaign> {
    const campaign = await this.campaigns.getCampaign(id);
    if (campaign.status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
    if (campaign.organization_id !== organizationId) throw new AppError('VALIDATION_FAILED', { status: 400 });
    return campaign;
  }

  private validateWindow(opensAt: Date | string | null, closesAt: Date | string | null): void {
    if (opensAt && Number.isNaN(new Date(opensAt).getTime()) || closesAt && Number.isNaN(new Date(closesAt).getTime()) ||
        opensAt && closesAt && new Date(closesAt).getTime() <= new Date(opensAt).getTime()) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
  }

  private async validateDriveItems(manager: Pick<EntityManager, 'query'>, items: DriveItemDto[]): Promise<DriveItemDto[]> {
    if (items.length > 50 || new Set(items.map((line) => line.item_id)).size !== items.length) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const rows = await manager.query(
      `SELECT i.id AS item_id,u.scale FROM item i JOIN unit u ON u.code=i.unit_code
        WHERE i.id=ANY($1::uuid[]) AND i.status='ACTIVE' ORDER BY i.id`,
      [items.map((line) => line.item_id)],
    ) as Array<{ item_id: string; scale: number }>;
    if (rows.length !== items.length) throw new AppError('NOT_FOUND', { status: 404 });
    const scales = new Map(rows.map((row) => [row.item_id, row.scale]));
    for (const line of items) validateQuantity(line.target_quantity, scales.get(line.item_id)!);
    return items;
  }

  private async insertDriveItems(manager: Pick<EntityManager, 'query'>, driveId: string, items: DriveItemDto[]): Promise<void> {
    for (const item of items) {
      await manager.query(
        'INSERT INTO drive_item (drive_id,item_id,target_quantity,acceptance_note) VALUES ($1,$2,$3,$4)',
        [driveId, item.item_id, item.target_quantity, cleanDriveText(item.acceptance_note)],
      );
    }
  }

  private async replaceDriveItems(manager: Pick<EntityManager, 'query'>, driveId: string, items: DriveItemDto[]): Promise<void> {
    await manager.query('DELETE FROM drive_item WHERE drive_id=$1', [driveId]);
    await this.insertDriveItems(manager, driveId, items);
  }

  private async findWarehouse(query: Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>, id: string, forUpdate = false): Promise<WarehouseRow> {
    const rows = await query.query(
      `SELECT id,organization_id,region_code,status FROM warehouse WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    ) as WarehouseRow[];
    const warehouse = rows[0];
    if (!warehouse || warehouse.status !== 'ACTIVE') throw new AppError('NOT_FOUND', { status: 404 });
    return warehouse;
  }

  private async findDrive(query: Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>, id: string, forUpdate = false): Promise<DriveRow> {
    const rows = await query.query(
      `SELECT d.id,d.organization_id,d.intake_warehouse_id,w.region_code,d.campaign_id,d.campaign_status,d.status,
              d.title,d.description,d.opens_at,d.closes_at,d.version,d.created_at
         FROM donation_drive d JOIN warehouse w ON w.id=d.intake_warehouse_id WHERE d.id=$1${forUpdate ? ' FOR UPDATE OF d' : ''}`,
      [id],
    ) as DriveRow[];
    const drive = rows[0];
    if (!drive) throw new AppError('NOT_FOUND', { status: 404 });
    return drive;
  }

  private async replayDrive(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'donation_drive') throw new AppError('INTERNAL_ERROR', { status: 500 });
    return readDrive(manager, resource.id);
  }
}

function beforeState(row: DriveRow): Record<string, unknown> {
  return {
    id: row.id, organization_id: row.organization_id, status: row.status, campaign_id: row.campaign_id,
    title: row.title, version: Number(row.version),
  };
}
