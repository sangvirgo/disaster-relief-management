import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { requireIdempotencyKey as idempotencyKey } from '@c48/technical/http/response-headers';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { CampaignWarehouseService } from '../campaign-warehouses/campaign-warehouses.service';
import { quantityUnits, decimalFromUnits } from '../common/quantity';
import { CreateDriveDto, DriveItemDto } from '../drives/drives.dto';
import { assertExpectedVersion } from '../drives/drives.helpers';
import { DriveCommandRequest, DrivesService } from '../drives/drives.service';
import {
  buildDriveDraft, calculateWarehouseGaps, GapSeverity, ItemScale, NeedFact, NeedSource, PledgeFact, reopensAfterDismissal,
  StockFact, WarehouseGap, WarehouseGapInput,
} from './supply-gap.calculator';
import { AcceptSupplyGapDto, AcceptSupplyGapOverridesDto, DismissSupplyGapDto } from './supply-gaps.dto';
import {
  assertSupplyGapOpen, readSupplyGap, requireSupplyGapPermission, SUPPLY_GAP_LIVE_NEED_STATUSES, SUPPLY_GAP_PRIMARY_STATUSES,
} from './supply-gaps.helpers';

export type SupplyGapCommandRequest = DriveCommandRequest;

export interface SupplyGapRecomputeSummary {
  /** Warehouses whose gaps were recomputed in their own transaction. */
  warehouses: number;
  /** Warehouses whose transaction failed; the failure is logged with a stable code and never thrown. */
  failed: number;
}

/** Drafts for a RED gap run for a week; the window is refreshed only after it has closed (see draftWindow). */
const DRAFT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_DISMISS_DAYS = 7;
/** Upper bound of Response lookups per recompute run, so an outage or a large backlog cannot stall the job. */
const CAMPAIGN_SWEEP_LIMIT = 50;

interface NeedRow {
  campaign_id: string;
  item_id: string;
  source: NeedSource;
  requested: string;
  committed: string;
  item_name: string;
  scale: number | string;
}

interface StockRow {
  warehouse_id: string;
  item_id: string;
  on_hand: string;
  reserved: string;
}

interface PledgeRow {
  item_id: string;
  target_quantity: string;
  received: string;
}

interface LockedGapRow extends Record<string, unknown> {
  id: string;
  warehouse_id: string;
  item_id: string;
  status: string;
  severity: GapSeverity;
  version: number | string;
  draft: Record<string, unknown>;
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';
}

async function writeAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string | null,
  action: string,
  id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string | null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'supply_gap',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
  );
}

/** Keeps the draft window while it is still open; otherwise opens a fresh seven-day window starting now. */
function draftWindow(prior: Record<string, unknown> | undefined, now: Date): { opens_at: Date; closes_at: Date } {
  const priorOpens = typeof prior?.opens_at === 'string' ? Date.parse(prior.opens_at) : Number.NaN;
  const priorCloses = typeof prior?.closes_at === 'string' ? Date.parse(prior.closes_at) : Number.NaN;
  if (Number.isFinite(priorOpens) && Number.isFinite(priorCloses) && priorCloses > now.getTime()) {
    return { opens_at: new Date(priorOpens), closes_at: new Date(priorCloses) };
  }
  return { opens_at: now, closes_at: new Date(now.getTime() + DRAFT_WINDOW_MS) };
}

/** Builds the existing CreateDriveDto from the stored draft; the drive rules then validate it as for any other drive. */
function driveRequestFor(row: LockedGapRow, overrides: AcceptSupplyGapOverridesDto | undefined): CreateDriveDto {
  const draft = row.draft;
  const campaignId = typeof draft.campaign_id === 'string' ? draft.campaign_id : null;
  const opensAt = overrides?.opens_at ?? (typeof draft.opens_at === 'string' ? draft.opens_at : null);
  const closesAt = overrides?.closes_at ?? (typeof draft.closes_at === 'string' ? draft.closes_at : null);
  return {
    title: overrides?.title ?? String(draft.title ?? ''),
    description: overrides?.description !== undefined ? overrides.description : (typeof draft.description === 'string' ? draft.description : null),
    intake_warehouse_id: row.warehouse_id,
    ...(campaignId ? { campaign_id: campaignId } : {}),
    ...(opensAt ? { opens_at: opensAt } : {}),
    ...(closesAt ? { closes_at: closesAt } : {}),
    items: overrides?.items ?? (draft.items as DriveItemDto[]),
  };
}

/**
 * Supply-gap suggestions (proposal section 3.4). Suggestions only: a human accepts a RED gap, which creates a DRAFT drive
 * through the existing DrivesService.create, or dismisses it. Nothing here creates a drive by itself.
 */
@Injectable()
export class SupplyGapsService {
  private readonly logger = new Logger('LogisticsSupplyGaps');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly drives: DrivesService,
    private readonly campaignWarehouses: CampaignWarehouseService,
  ) {}

  /**
   * Recomputes gaps for one warehouse, or for every warehouse that has a primary campaign or an open gap. Each warehouse
   * runs in its own transaction under pg_advisory_xact_lock. Never throws: failures are logged and counted.
   */
  async recompute(warehouseId?: string): Promise<SupplyGapRecomputeSummary> {
    await this.reevaluateCampaignsWithoutPrimary();
    let warehouseIds: string[];
    try {
      warehouseIds = warehouseId ? [warehouseId] : await this.candidateWarehouseIds();
    } catch (error) {
      this.logger.warn({ code: errorCode(error) }, 'Supply gap warehouse selection failed');
      return { warehouses: 0, failed: 1 };
    }
    let processed = 0;
    let failed = 0;
    for (const id of warehouseIds) {
      try {
        await this.dataSource.transaction((manager) => this.recomputeWarehouse(manager, id));
        processed += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn({ code: errorCode(error) }, 'Supply gap recomputation failed');
      }
    }
    return { warehouses: processed, failed };
  }

  async accept(id: string, dto: AcceptSupplyGapDto, request: SupplyGapCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireSupplyGapPermission(session, 'SUPPLY_GAP_MANAGE');
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.supply-gaps.accept',
      key: idempotencyKey(request),
      requestHash: canonicalRequestHash({ id, ...dto }),
      execute: async (manager) => {
        // The row lock serializes accept and dismiss, and the drive is created while the lock is held, so one gap can
        // never produce two drives. DrivesService.create runs its own transaction and idempotency record.
        const row = await this.lockGap(manager, id);
        assertExpectedVersion(row.version, dto.expected_version);
        assertSupplyGapOpen(row.status);
        if (row.severity !== 'RED') throw new AppError('SUPPLY_GAP_WARNING_ONLY', { status: 409 });
        const before = { id, status: row.status, severity: row.severity, version: Number(row.version) };
        const drive = await this.drives.create(driveRequestFor(row, dto.overrides), request);
        const driveId = String(drive.value.id);
        await manager.query(
          "UPDATE supply_gap SET status='ACCEPTED', drive_id=$2, version=version+1, updated_at=now() WHERE id=$1",
          [id, driveId],
        );
        const after = await readSupplyGap(manager, id);
        await writeAudit(manager, session.userId, 'SUPPLY_GAP_ACCEPTED', id, before, after, null);
        return { status: 200, value: after, resource: { type: 'supply_gap', id } };
      },
      replay: (manager, resource) => {
        if (!resource || resource.type !== 'supply_gap') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readSupplyGap(manager, resource.id);
      },
    });
  }

  async dismiss(id: string, dto: DismissSupplyGapDto, request: SupplyGapCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireSupplyGapPermission(session, 'SUPPLY_GAP_MANAGE');
    const reason = dto.reason.trim();
    const days = dto.dismissed_days ?? DEFAULT_DISMISS_DAYS;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.supply-gaps.dismiss',
      key: idempotencyKey(request),
      requestHash: canonicalRequestHash({ id, ...dto, reason }),
      execute: async (manager) => {
        const row = await this.lockGap(manager, id);
        assertExpectedVersion(row.version, dto.expected_version);
        assertSupplyGapOpen(row.status);
        const before = { id, status: row.status, version: Number(row.version) };
        await manager.query(
          `UPDATE supply_gap SET status='DISMISSED', dismissed_reason=$2,
                  dismissed_until=now()+($3::int * interval '1 day'), version=version+1, updated_at=now()
            WHERE id=$1`,
          [id, reason, days],
        );
        const after = await readSupplyGap(manager, id);
        await writeAudit(manager, session.userId, 'SUPPLY_GAP_DISMISSED', id, before, after, reason);
        return { status: 200, value: after, resource: { type: 'supply_gap', id } };
      },
      replay: (manager, resource) => {
        if (!resource || resource.type !== 'supply_gap') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readSupplyGap(manager, resource.id);
      },
    });
  }

  private async lockGap(manager: EntityManager, id: string): Promise<LockedGapRow> {
    const rows = await manager.query(
      'SELECT id,warehouse_id,item_id,status,severity,version,draft FROM supply_gap WHERE id=$1 FOR UPDATE',
      [id],
    ) as LockedGapRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    return row;
  }

  /**
   * Campaigns that need a PRIMARY but have none yet: ACTIVE snapshots, plus campaigns with live needs (a campaign may not
   * have a snapshot until someone reads it). Bounded per run; a campaign with no eligible warehouse is retried next run.
   */
  private async reevaluateCampaignsWithoutPrimary(): Promise<void> {
    let campaignIds: string[];
    try {
      const rows = await this.dataSource.query(
        `SELECT s.campaign_id FROM campaign_area_snapshot s
          WHERE s.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM campaign_warehouse cw WHERE cw.campaign_id=s.campaign_id AND cw.role='PRIMARY')
         UNION
         SELECT DISTINCT fc.campaign_id FROM fulfillment_cycle fc JOIN relief_need rn ON rn.cycle_id=fc.id
          WHERE fc.campaign_id IS NOT NULL AND rn.status = ANY($1::text[])
            AND NOT EXISTS (SELECT 1 FROM campaign_warehouse cw WHERE cw.campaign_id=fc.campaign_id AND cw.role='PRIMARY')
         ORDER BY campaign_id LIMIT $2`,
        [[...SUPPLY_GAP_LIVE_NEED_STATUSES], CAMPAIGN_SWEEP_LIMIT],
      ) as Array<{ campaign_id: string }>;
      campaignIds = rows.map((row) => row.campaign_id);
    } catch (error) {
      this.logger.warn({ code: errorCode(error) }, 'Supply gap campaign selection failed');
      return;
    }
    for (const campaignId of campaignIds) {
      try {
        await this.campaignWarehouses.reevaluateCampaign(campaignId);
      } catch (error) {
        this.logger.warn({ code: errorCode(error) }, 'Supply gap campaign assignment failed');
      }
    }
  }

  private async candidateWarehouseIds(): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT cw.warehouse_id FROM campaign_warehouse cw JOIN warehouse w ON w.id=cw.warehouse_id
        WHERE cw.role='PRIMARY' AND w.status='ACTIVE'
       UNION
       SELECT DISTINCT warehouse_id FROM supply_gap WHERE status='OPEN'`,
    ) as Array<{ warehouse_id: string }>;
    return rows.map((row) => row.warehouse_id);
  }

  private async recomputeWarehouse(manager: EntityManager, warehouseId: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`supply-gap:${warehouseId}`]);
    const warehouse = await manager.query('SELECT status FROM warehouse WHERE id=$1', [warehouseId]) as Array<{ status: string }>;
    const primaryIds = warehouse[0]?.status === 'ACTIVE'
      ? (await manager.query(
        `SELECT cw.campaign_id FROM campaign_warehouse cw JOIN campaign_area_snapshot s ON s.campaign_id=cw.campaign_id
          WHERE cw.warehouse_id=$1 AND cw.role='PRIMARY' AND s.status = ANY($2::text[]) ORDER BY cw.campaign_id`,
        [warehouseId, [...SUPPLY_GAP_PRIMARY_STATUSES]],
      ) as Array<{ campaign_id: string }>).map((row) => row.campaign_id)
      : [];
    const gaps = primaryIds.length > 0
      ? calculateWarehouseGaps(await this.loadWarehouseInput(manager, warehouseId, primaryIds)).gaps
      : [];

    const open = await manager.query(
      "SELECT item_id, draft FROM supply_gap WHERE warehouse_id=$1 AND status='OPEN'",
      [warehouseId],
    ) as Array<{ item_id: string; draft: Record<string, unknown> }>;
    const openDrafts = new Map(open.map((row) => [row.item_id, row.draft]));
    const dismissed = await manager.query(
      `SELECT DISTINCT ON (item_id) item_id, severity, gap_qty::text AS gap_qty
         FROM supply_gap WHERE warehouse_id=$1 AND status='DISMISSED' AND dismissed_until > now()
        ORDER BY item_id, dismissed_until DESC`,
      [warehouseId],
    ) as Array<{ item_id: string; severity: GapSeverity; gap_qty: string }>;
    const dismissedByItem = new Map(dismissed.map((row) => [row.item_id, row]));

    const now = new Date();
    for (const gap of gaps) {
      const marker = dismissedByItem.get(gap.item_id);
      const dismissedMarker = marker ? { severity: marker.severity, gap: quantityUnits(marker.gap_qty, gap.scale) } : null;
      if (!reopensAfterDismissal({ severity: gap.severity, gap: gap.gap }, dismissedMarker)) continue;
      const draft = gap.severity === 'RED' ? this.draftFor(warehouseId, gap, openDrafts.get(gap.item_id), now) : {};
      await this.upsertGap(manager, warehouseId, gap, draft);
    }
    await this.expireMissing(manager, warehouseId, gaps.map((gap) => gap.item_id));
  }

  private draftFor(
    warehouseId: string,
    gap: WarehouseGap,
    prior: Record<string, unknown> | undefined,
    now: Date,
  ): Record<string, unknown> {
    const window = draftWindow(prior, now);
    const item: ItemScale = { item_id: gap.item_id, scale: gap.scale, name: gap.item_name };
    return buildDriveDraft({
      warehouse_id: warehouseId,
      item,
      gap: gap.gap,
      campaign_id: gap.campaign_ids[0]!,
      opens_at: window.opens_at,
      closes_at: window.closes_at,
    });
  }

  private async loadWarehouseInput(manager: EntityManager, warehouseId: string, primaryIds: string[]): Promise<WarehouseGapInput> {
    const needRows = await manager.query(
      `SELECT fc.campaign_id, rn.item_id, rn.source, rn.requested_quantity::text AS requested,
              COALESCE(SUM(c.quantity - c.released_quantity),0)::text AS committed, i.name AS item_name, u.scale
         FROM relief_need rn
         JOIN fulfillment_cycle fc ON fc.id=rn.cycle_id
         JOIN item i ON i.id=rn.item_id
         JOIN unit u ON u.code=i.unit_code
         LEFT JOIN commitment c ON c.relief_need_id=rn.id
        WHERE fc.campaign_id = ANY($1::uuid[]) AND rn.status = ANY($2::text[])
        GROUP BY fc.campaign_id, rn.id, rn.item_id, rn.source, rn.requested_quantity, i.name, u.scale`,
      [primaryIds, [...SUPPLY_GAP_LIVE_NEED_STATUSES]],
    ) as NeedRow[];
    const items = new Map<string, ItemScale>();
    const needs: NeedFact[] = needRows.map((row) => {
      const scale = Number(row.scale);
      items.set(row.item_id, { item_id: row.item_id, scale, name: row.item_name });
      return {
        campaign_id: row.campaign_id,
        item_id: row.item_id,
        source: row.source,
        requested: quantityUnits(row.requested, scale),
        committed: quantityUnits(row.committed, scale),
      };
    });
    const itemIds = [...items.keys()];
    if (itemIds.length === 0) {
      return { warehouse_id: warehouseId, primary_campaign_ids: primaryIds, items: [], needs, stock: [], pledges: [], backups: [] };
    }

    const backupRows = await manager.query(
      `SELECT cw.campaign_id, cw.warehouse_id FROM campaign_warehouse cw JOIN warehouse w ON w.id=cw.warehouse_id
        WHERE cw.campaign_id = ANY($1::uuid[]) AND cw.role='BACKUP' AND cw.warehouse_id<>$2 AND w.status='ACTIVE'`,
      [primaryIds, warehouseId],
    ) as Array<{ campaign_id: string; warehouse_id: string }>;
    const warehouseIds = [...new Set([warehouseId, ...backupRows.map((row) => row.warehouse_id)])];
    const stockRows = await manager.query(
      `SELECT sb.warehouse_id, sb.item_id, sb.on_hand::text AS on_hand, sb.reserved::text AS reserved
         FROM stock_balance sb
        WHERE sb.item_id = ANY($1::uuid[]) AND sb.warehouse_id = ANY($2::uuid[])`,
      [itemIds, warehouseIds],
    ) as StockRow[];
    const stock: StockFact[] = stockRows.map((row) => {
      const scale = items.get(row.item_id)!.scale;
      return {
        warehouse_id: row.warehouse_id,
        item_id: row.item_id,
        on_hand: quantityUnits(row.on_hand, scale),
        reserved: quantityUnits(row.reserved, scale),
      };
    });

    // Remaining pledge = target minus what the drive has already received at its intake warehouse. Received stock is
    // already in on_hand, so only the unreceived part is added on top of stock (no double count). Drives count when OPEN,
    // or when a gap accepted them and they are still DRAFT or PAUSED (so the same gap is not suggested again).
    const pledgeRows = await manager.query(
      `SELECT di.item_id, di.target_quantity::text AS target_quantity,
              COALESCE((SELECT SUM(sm.delta_on_hand)
                          FROM donation_delivery dd
                          JOIN donation_receipt r ON r.delivery_id=dd.id
                          JOIN stock_movement sm ON sm.receipt_id=r.id AND sm.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')
                          JOIN stock_balance sb ON sb.id=sm.balance_id
                         WHERE dd.drive_id=d.id AND sb.item_id=di.item_id AND sb.warehouse_id=d.intake_warehouse_id),0)::text AS received
         FROM drive_item di
         JOIN donation_drive d ON d.id=di.drive_id
        WHERE d.intake_warehouse_id=$1 AND di.item_id = ANY($2::uuid[])
          AND (d.status='OPEN' OR (d.status IN ('DRAFT','PAUSED') AND EXISTS (
                SELECT 1 FROM supply_gap g WHERE g.drive_id=d.id AND g.status='ACCEPTED')))`,
      [warehouseId, itemIds],
    ) as PledgeRow[];
    const pledges: PledgeFact[] = pledgeRows.map((row) => {
      const scale = items.get(row.item_id)!.scale;
      const remaining = quantityUnits(row.target_quantity, scale) - quantityUnits(row.received, scale);
      return { warehouse_id: warehouseId, item_id: row.item_id, remaining: remaining > 0n ? remaining : 0n };
    });

    return {
      warehouse_id: warehouseId,
      primary_campaign_ids: primaryIds,
      items: [...items.values()],
      needs,
      stock,
      pledges,
      backups: backupRows.map((row) => ({ campaign_id: row.campaign_id, warehouse_id: row.warehouse_id })),
    };
  }

  /** Inserts or refreshes the OPEN row for (warehouse, item). Bumps version only when the content changed. */
  private async upsertGap(manager: EntityManager, warehouseId: string, gap: WarehouseGap, draft: Record<string, unknown>): Promise<void> {
    const scale = gap.scale;
    const rows = await manager.query(
      `INSERT INTO supply_gap (warehouse_id,item_id,demand,supply,pledged,gap_qty,severity,status,campaign_ids,backup_warehouse_ids,
                               reason_codes,draft,computed_at,updated_at)
       VALUES ($1,$2,$3::numeric,$4::numeric,$5::numeric,$6::numeric,$7,'OPEN',$8::uuid[],$9::uuid[],$10::text[],$11::jsonb,now(),now())
       ON CONFLICT (warehouse_id,item_id) WHERE status='OPEN' DO UPDATE SET
         demand=EXCLUDED.demand, supply=EXCLUDED.supply, pledged=EXCLUDED.pledged, gap_qty=EXCLUDED.gap_qty,
         severity=EXCLUDED.severity, campaign_ids=EXCLUDED.campaign_ids, backup_warehouse_ids=EXCLUDED.backup_warehouse_ids,
         reason_codes=EXCLUDED.reason_codes, draft=EXCLUDED.draft,
         version=CASE WHEN (supply_gap.demand,supply_gap.supply,supply_gap.pledged,supply_gap.gap_qty,supply_gap.severity,
                            supply_gap.campaign_ids,supply_gap.backup_warehouse_ids,supply_gap.reason_codes,supply_gap.draft)
                       IS DISTINCT FROM (EXCLUDED.demand,EXCLUDED.supply,EXCLUDED.pledged,EXCLUDED.gap_qty,EXCLUDED.severity,
                            EXCLUDED.campaign_ids,EXCLUDED.backup_warehouse_ids,EXCLUDED.reason_codes,EXCLUDED.draft)
                 THEN supply_gap.version+1 ELSE supply_gap.version END,
         computed_at=now(), updated_at=now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        warehouseId, gap.item_id,
        decimalFromUnits(gap.demand, scale), decimalFromUnits(gap.supply, scale), decimalFromUnits(gap.pledged, scale),
        decimalFromUnits(gap.gap, scale), gap.severity, gap.campaign_ids, gap.backup_warehouse_ids, gap.reason_codes,
        JSON.stringify(draft),
      ],
    ) as Array<{ id: string; inserted: boolean }>;
    const row = rows[0];
    if (row?.inserted) {
      await writeAudit(manager, null, 'SUPPLY_GAP_OPENED', row.id, null, {
        id: row.id, warehouse_id: warehouseId, item_id: gap.item_id, severity: gap.severity, status: 'OPEN',
      }, 'SUPPLY_GAP_RECOMPUTED');
    }
  }

  private async expireMissing(manager: EntityManager, warehouseId: string, keepItemIds: string[]): Promise<void> {
    const result = await manager.query(
      `UPDATE supply_gap SET status='EXPIRED', version=version+1, computed_at=now(), updated_at=now()
        WHERE warehouse_id=$1 AND status='OPEN' AND NOT (item_id = ANY($2::uuid[]))
        RETURNING id, severity`,
      [warehouseId, keepItemIds],
    ) as Array<{ id: string; severity: GapSeverity }> | [Array<{ id: string; severity: GapSeverity }>, number];
    const expired = Array.isArray(result[0]) ? result[0] : result as Array<{ id: string; severity: GapSeverity }>;
    for (const row of expired) {
      await writeAudit(manager, null, 'SUPPLY_GAP_EXPIRED', row.id, { status: 'OPEN' }, { status: 'EXPIRED', severity: row.severity }, 'SUPPLY_GAP_RECOMPUTED');
    }
  }
}
