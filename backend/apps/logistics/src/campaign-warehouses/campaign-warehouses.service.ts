import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { cleanText } from '../common/text';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { LogisticsResponseCampaignClient } from '../integrations/response/response-campaign.client';
import {
  AssignmentPlan, AssignmentRole, AssignmentSource, CampaignArea, CampaignCenter, CandidateRow, DesiredAssignment, MAX_CAMPAIGN_RADIUS_M, MAX_SERVICE_REACH_M,
  StoredAssignment, WarehouseChange, WarehouseServiceArea, assertAssignmentVersion, assignmentRequestKey, deriveFlags,
  errorCode, planAssignment, rankCandidates, requireCampaignWarehousePermission, sameAssignment, sameCampaignArea,
  serviceAreaChanged,
} from './campaign-warehouses.helpers';
import { SetPrimaryWarehouseDto } from './campaign-warehouses.dto';

type AssignmentRequest = Request & { idempotencyKey?: string };

interface SnapshotRow {
  campaign_id: string;
  status: CampaignArea['status'];
  radius_m: number | string | null;
  assignment_version: number | string;
  lat: number | string | null;
  lng: number | string | null;
}

interface StoredRow {
  warehouse_id: string;
  role: AssignmentRole;
  source: AssignmentSource;
  distance_m: number | string | null;
  version: number | string;
}

interface SyncOptions {
  area?: CampaignArea;
  rerank: boolean;
  clearManual: boolean;
  override?: string;
  force?: boolean;
  actorUserId: string | null;
  reason: string;
  auditAction: string;
}

function lockCampaign(manager: EntityManager, campaignId: string): Promise<unknown> {
  return manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`campaign-warehouse:${campaignId}`]);
}

function areaOf(row: SnapshotRow): CampaignArea {
  return {
    status: row.status,
    center: row.lat == null || row.lng == null ? null : { lat: Number(row.lat), lng: Number(row.lng) },
    radius_m: row.radius_m == null ? null : Number(row.radius_m),
  };
}

function storedOf(row: StoredRow): StoredAssignment {
  return {
    warehouse_id: row.warehouse_id,
    role: row.role,
    source: row.source,
    distance_m: row.distance_m == null ? null : Number(row.distance_m),
    version: Number(row.version),
  };
}

function circleOf(area: WarehouseServiceArea | null): { lat: number; lng: number; radius_m: number } | null {
  if (!area || area.status !== 'ACTIVE' || !area.location || area.radius_m == null) return null;
  return { lat: area.location.lat, lng: area.location.lng, radius_m: area.radius_m };
}

/**
 * Campaign-to-warehouse assignment. Campaign geometry is owned by Response and cached in campaign_area_snapshot;
 * eligibility and ranking run against the local c48_logistics database only.
 */
@Injectable()
export class CampaignWarehouseService {
  private readonly logger = new Logger('LogisticsCampaignWarehouse');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly campaigns: LogisticsResponseCampaignClient,
  ) {}

  /**
   * Read model. Strictly read-only: no transaction, advisory lock, INSERT, UPDATE or audit. Eligibility is computed
   * against the latest Response area, which is not persisted. The stored assignment is returned as is; a missing
   * PRIMARY is reported as a non-persisted `proposed_primary_warehouse_id`. Writes happen in the commands,
   * reevaluateCampaign and onWarehouseChanged.
   */
  async list(campaignId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireCampaignWarehousePermission(session, 'CAMPAIGN_WAREHOUSE_VIEW', campaignId);
    const area = await this.fetchArea(campaignId);
    return this.readView(this.dataSource.manager, campaignId, area);
  }

  /** Manager override. Idempotent, optimistic on assignment_version, and never bypasses eligibility. */
  async setPrimary(campaignId: string, dto: SetPrimaryWarehouseDto, request: AssignmentRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCampaignWarehousePermission(session, 'CAMPAIGN_WAREHOUSE_MANAGE', campaignId);
    const reason = cleanText(dto.reason, 500);
    const area = await this.fetchArea(campaignId);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.campaign-warehouse.primary.set',
      key: assignmentRequestKey(request.idempotencyKey),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, campaign_id: campaignId, dto: { ...dto, reason } }),
      execute: async (manager) => {
        await lockCampaign(manager, campaignId);
        const previous = await this.loadSnapshot(manager, campaignId);
        assertAssignmentVersion(previous ? Number(previous.assignment_version) : 0, dto.expected_version);
        await this.storeArea(manager, campaignId, area);
        if (!area.center || area.radius_m == null) throw new AppError('CAMPAIGN_AREA_MISSING', { status: 409 });
        const warehouses = await manager.query('SELECT id FROM warehouse WHERE id=$1', [dto.warehouse_id]) as Array<{ id: string }>;
        if (!warehouses[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const candidates = await this.eligibleFor(manager, campaignId, area);
        if (!candidates.some((candidate) => candidate.warehouse_id === dto.warehouse_id)) {
          throw new AppError('WAREHOUSE_NOT_ELIGIBLE', { status: 409 });
        }
        const stored = (await this.queryStored(manager, campaignId)).map(storedOf);
        const plan = planAssignment({ candidates, stored, rerank: false, clearManual: false, override: dto.warehouse_id });
        await this.applyAssignment(manager, campaignId, plan, stored, previous ? Number(previous.assignment_version) : 0, {
          actorUserId: session.userId, reason, auditAction: 'CAMPAIGN_PRIMARY_WAREHOUSE_SET',
        });
        return { status: 200, value: await this.view(manager, campaignId), resource: { type: 'campaign', id: campaignId } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'campaign' || resource.id !== campaignId) throw new AppError('INTERNAL_ERROR', { status: 500 });
        requireCampaignWarehousePermission(session, 'CAMPAIGN_WAREHOUSE_MANAGE', campaignId);
        return this.view(manager, campaignId);
      },
    });
  }

  /** Manager request to re-rank. Clears a MANUAL primary only when clear_manual is true. */
  async reevaluate(campaignId: string, clearManual: boolean, request: AssignmentRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    requireCampaignWarehousePermission(session, 'CAMPAIGN_WAREHOUSE_MANAGE', campaignId);
    const area = await this.fetchArea(campaignId);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.campaign-warehouse.reevaluate',
      key: assignmentRequestKey(request.idempotencyKey),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, campaign_id: campaignId, clear_manual: clearManual }),
      execute: async (manager) => {
        await lockCampaign(manager, campaignId);
        await this.syncAssignment(manager, campaignId, {
          area, rerank: true, clearManual, actorUserId: session.userId, reason: clearManual ? 'MANAGER_CLEAR_MANUAL' : 'MANAGER_REQUEST',
          auditAction: 'CAMPAIGN_WAREHOUSE_ASSIGNMENT_CHANGED',
        });
        return { status: 200, value: await this.view(manager, campaignId), resource: { type: 'campaign', id: campaignId } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'campaign' || resource.id !== campaignId) throw new AppError('INTERNAL_ERROR', { status: 500 });
        requireCampaignWarehousePermission(session, 'CAMPAIGN_WAREHOUSE_MANAGE', campaignId);
        return this.view(manager, campaignId);
      },
    });
  }

  /** For the scheduled gap job: refresh the campaign area from Response and apply the sticky rule. Throws on Response outage. */
  async reevaluateCampaign(campaignId: string, reason = 'SCHEDULED_SWEEP'): Promise<void> {
    const area = await this.fetchArea(campaignId);
    await this.dataSource.transaction(async (manager) => {
      await lockCampaign(manager, campaignId);
      await this.syncAssignment(manager, campaignId, {
        area, rerank: false, clearManual: false, actorUserId: null, reason, auditAction: 'CAMPAIGN_WAREHOUSE_ASSIGNMENT_CHANGED',
      });
    });
  }

  /**
   * Called after a warehouse create, patch or deactivate. Uses only the local snapshot (no Response call).
   * Never throws: failures are logged so the warehouse command still succeeds.
   */
  async onWarehouseChanged(change: WarehouseChange): Promise<void> {
    if (!serviceAreaChanged(change.before, change.after)) return;
    try {
      const campaignIds = await this.affectedCampaignIds(change);
      for (const campaignId of campaignIds) {
        try {
          await this.dataSource.transaction(async (manager) => {
            await lockCampaign(manager, campaignId);
            await this.syncAssignment(manager, campaignId, {
              rerank: true, clearManual: false, actorUserId: null, reason: 'WAREHOUSE_CHANGED', auditAction: 'CAMPAIGN_WAREHOUSE_ASSIGNMENT_CHANGED',
            });
          });
        } catch (error) {
          this.logger.warn({ code: errorCode(error) }, 'Campaign warehouse re-evaluation failed');
        }
      }
    } catch (error) {
      this.logger.warn({ code: errorCode(error) }, 'Campaign warehouse trigger failed');
    }
  }

  private async fetchArea(campaignId: string): Promise<CampaignArea> {
    const campaign = await this.campaigns.getCampaign(campaignId);
    if (campaign.center === undefined || campaign.radius_m === undefined) {
      throw new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
    }
    return { status: campaign.status, center: campaign.center, radius_m: campaign.radius_m };
  }

  /** Applies the sticky rule under the campaign lock. Writes and audits only when the stored assignment changes. */
  private async syncAssignment(manager: EntityManager, campaignId: string, options: SyncOptions): Promise<void> {
    const previous = await this.loadSnapshot(manager, campaignId);
    let rerank = options.rerank;
    if (options.area) {
      rerank = rerank || !sameCampaignArea(previous ? areaOf(previous) : null, options.area);
      await this.storeArea(manager, campaignId, options.area);
    }
    const snapshot = await this.loadSnapshot(manager, campaignId);
    if (!snapshot) return;

    const candidates = await this.eligibleFor(manager, campaignId, areaOf(snapshot));
    const stored = (await this.queryStored(manager, campaignId)).map(storedOf);
    const plan = planAssignment({ candidates, stored, rerank, clearManual: options.clearManual, override: options.override });
    if (!options.force && sameAssignment(plan.rows, stored)) return;
    await this.applyAssignment(manager, campaignId, plan, stored, Number(snapshot.assignment_version), {
      actorUserId: options.actorUserId, reason: options.reason, auditAction: options.auditAction,
    });
  }

  private async applyAssignment(
    manager: EntityManager,
    campaignId: string,
    plan: AssignmentPlan,
    stored: readonly StoredAssignment[],
    currentVersion: number,
    audit: { actorUserId: string | null; reason: string; auditAction: string },
  ): Promise<void> {
    const nextVersion = currentVersion + 1;
    const desired: DesiredAssignment[] = plan.rows;
    const keep = desired.map((row) => row.warehouse_id);
    await manager.query(
      'UPDATE campaign_area_snapshot SET assignment_version=$2, updated_at=now() WHERE campaign_id=$1',
      [campaignId, nextVersion],
    );
    // Free the single PRIMARY slot before inserting the new primary (partial unique index).
    await manager.query("UPDATE campaign_warehouse SET role='BACKUP' WHERE campaign_id=$1 AND role='PRIMARY'", [campaignId]);
    await manager.query(
      'DELETE FROM campaign_warehouse WHERE campaign_id=$1 AND NOT (warehouse_id = ANY($2::uuid[]))',
      [campaignId, keep],
    );
    for (const row of desired) {
      await manager.query(
        `INSERT INTO campaign_warehouse (campaign_id,warehouse_id,role,source,distance_m,evaluated_at,version)
         VALUES ($1,$2,$3,$4,$5::integer,now(),$6)
         ON CONFLICT (campaign_id, warehouse_id) DO UPDATE SET role=EXCLUDED.role, source=EXCLUDED.source,
           distance_m=EXCLUDED.distance_m, evaluated_at=now(), version=EXCLUDED.version`,
        [campaignId, row.warehouse_id, row.role, row.source, row.distance_m, nextVersion],
      );
    }
    await manager.query(
      `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
       VALUES ($1,$2,'campaign',$3,$4::jsonb,$5::jsonb,$6)`,
      [
        audit.actorUserId,
        audit.auditAction,
        campaignId,
        JSON.stringify({ assignment_version: currentVersion, rows: stored }),
        JSON.stringify({ assignment_version: nextVersion, rows: desired, primary_id: plan.primaryId }),
        audit.reason,
      ],
    );
  }

  private async loadSnapshot(manager: EntityManager, campaignId: string): Promise<SnapshotRow | null> {
    const rows = await manager.query(
      `SELECT campaign_id,status,radius_m,assignment_version,
              CASE WHEN center IS NULL THEN NULL ELSE ST_Y(center::geometry) END AS lat,
              CASE WHEN center IS NULL THEN NULL ELSE ST_X(center::geometry) END AS lng
         FROM campaign_area_snapshot WHERE campaign_id=$1`,
      [campaignId],
    ) as SnapshotRow[];
    return rows[0] ?? null;
  }

  private async storeArea(manager: EntityManager, campaignId: string, area: CampaignArea): Promise<void> {
    await manager.query(
      `INSERT INTO campaign_area_snapshot (campaign_id,center,radius_m,status,updated_at)
       VALUES ($1,
         CASE WHEN $2::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($3::float8,$2::float8),4326)::geography END,
         $4::integer, $5, now())
       ON CONFLICT (campaign_id) DO UPDATE SET center=EXCLUDED.center, radius_m=EXCLUDED.radius_m,
         status=EXCLUDED.status, updated_at=now()`,
      [campaignId, area.center?.lat ?? null, area.center?.lng ?? null, area.radius_m, area.status],
    );
  }

  /** Eligible warehouses for the given area. An area without a center or radius has no eligible warehouse. */
  private eligibleFor(manager: EntityManager, campaignId: string, area: CampaignArea): Promise<CandidateRow[]> {
    if (!area.center || area.radius_m == null) return Promise.resolve([]);
    return this.queryCandidates(manager, campaignId, area.center, area.radius_m);
  }

  /** The area is passed in, never read from the snapshot, so a read can use the latest Response area without persisting it. */
  private queryCandidates(manager: EntityManager, campaignId: string, center: CampaignCenter, radiusM: number): Promise<CandidateRow[]> {
    return manager.query(
      `WITH needs AS (
         SELECT DISTINCT rn.item_id
           FROM relief_need rn JOIN fulfillment_cycle fc ON fc.id = rn.cycle_id
          WHERE fc.campaign_id = $1 AND rn.status IN ('OPEN','PARTIALLY_FULFILLED')
       ), area AS (
         SELECT ST_SetSRID(ST_MakePoint($3::float8,$4::float8),4326)::geography AS center, $5::integer AS radius_m
       )
       SELECT w.id AS warehouse_id, w.name,
              ROUND(ST_Distance(w.location, a.center))::int AS distance_m,
              (SELECT COUNT(*)::int FROM needs) AS open_needed_items,
              (SELECT COUNT(DISTINCT sb.item_id)::int FROM stock_balance sb JOIN needs n ON n.item_id = sb.item_id
                WHERE sb.warehouse_id = w.id AND sb.on_hand - sb.reserved > 0) AS needed_items_in_stock,
              (SELECT COUNT(*)::int FROM distribution d
                WHERE d.warehouse_id = w.id AND d.status IN ('DRAFT','APPROVED','DISPATCHED')) AS open_distributions
         FROM area a
         JOIN warehouse w ON w.status = 'ACTIVE' AND w.location IS NOT NULL AND w.service_radius_m IS NOT NULL
          AND ST_DWithin(w.location, a.center, $2::float8)
          AND ST_DWithin(w.location, a.center, (w.service_radius_m + a.radius_m)::float8)`,
      [campaignId, MAX_SERVICE_REACH_M, center.lng, center.lat, radiusM],
    ) as Promise<CandidateRow[]>;
  }

  private async queryStored(manager: EntityManager, campaignId: string): Promise<StoredRow[]> {
    return manager.query(
      'SELECT warehouse_id,role,source,distance_m,version FROM campaign_warehouse WHERE campaign_id=$1 ORDER BY warehouse_id',
      [campaignId],
    ) as Promise<StoredRow[]>;
  }

  /** Read model shared by every command response and replay. Runs after the sync, so the snapshot is current. */
  private async view(manager: EntityManager, campaignId: string): Promise<Record<string, unknown>> {
    const snapshot = await this.loadSnapshot(manager, campaignId);
    if (!snapshot) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const area = areaOf(snapshot);
    const candidates = await this.eligibleFor(manager, campaignId, area);
    const stored = (await this.queryStored(manager, campaignId)).map(storedOf);
    return this.buildView({ campaignId, area, assignmentVersion: Number(snapshot.assignment_version), candidates, stored });
  }

  /** Read-only view for GET. Uses the latest fetched area and the stored rows; writes nothing. */
  private async readView(manager: EntityManager, campaignId: string, area: CampaignArea): Promise<Record<string, unknown>> {
    const snapshot = await this.loadSnapshot(manager, campaignId);
    const candidates = await this.eligibleFor(manager, campaignId, area);
    const stored = (await this.queryStored(manager, campaignId)).map(storedOf);
    return this.buildView({
      campaignId, area, assignmentVersion: snapshot ? Number(snapshot.assignment_version) : 0, candidates, stored,
    });
  }

  private buildView(input: {
    campaignId: string;
    area: CampaignArea;
    assignmentVersion: number;
    candidates: CandidateRow[];
    stored: StoredAssignment[];
  }): Record<string, unknown> {
    const { campaignId, area, assignmentVersion, candidates, stored } = input;
    const eligibleIds = new Set(candidates.map((candidate) => candidate.warehouse_id));
    const primary = stored.find((row) => row.role === 'PRIMARY') ?? null;
    const storedById = new Map(stored.map((row) => [row.warehouse_id, row]));
    const ranked = rankCandidates(candidates);
    const ordered = [
      ...ranked.filter((candidate) => candidate.warehouse_id === primary?.warehouse_id),
      ...ranked.filter((candidate) => candidate.warehouse_id !== primary?.warehouse_id),
    ];
    const view: Record<string, unknown> = {
      campaign_id: campaignId,
      campaign_status: area.status,
      assignment_version: assignmentVersion,
      area: area.center ? { center: area.center, radius_m: area.radius_m } : null,
      primary: primary ? { warehouse_id: primary.warehouse_id, source: primary.source, eligible: eligibleIds.has(primary.warehouse_id) } : null,
      warehouses: ordered.map((candidate) => {
        const row = storedById.get(candidate.warehouse_id);
        return {
          warehouse_id: candidate.warehouse_id,
          name: candidate.name,
          role: row?.role ?? null,
          source: row?.source ?? null,
          distance_m: candidate.distance_m,
          eligible: true,
          stock: { open_needed_items: candidate.open_needed_items, needed_items_in_stock: candidate.needed_items_in_stock },
          open_distributions: candidate.open_distributions,
        };
      }),
      flags: deriveFlags({ hasArea: Boolean(area.center), primary, eligibleIds }),
      generated_at: new Date().toISOString(),
    };
    if (!primary) {
      // Not persisted: what the next sync would assign. Null when no warehouse is eligible.
      view.proposed_primary_warehouse_id = planAssignment({ candidates, stored, rerank: true, clearManual: false }).primaryId;
    }
    return view;
  }

  private async affectedCampaignIds(change: WarehouseChange): Promise<string[]> {
    const ids = new Set<string>();
    for (const circle of [circleOf(change.before), circleOf(change.after)]) {
      if (!circle) continue;
      const rows = await this.dataSource.query(
        `SELECT s.campaign_id FROM campaign_area_snapshot s
          WHERE s.status <> 'CLOSED' AND s.center IS NOT NULL
            AND ST_DWithin(s.center, ST_SetSRID(ST_MakePoint($1::float8,$2::float8),4326)::geography, $3::float8 + $4::float8)
            AND ST_DWithin(s.center, ST_SetSRID(ST_MakePoint($1::float8,$2::float8),4326)::geography, $3::float8 + s.radius_m)`,
        [circle.lng, circle.lat, circle.radius_m, MAX_CAMPAIGN_RADIUS_M],
      ) as Array<{ campaign_id: string }>;
      for (const row of rows) ids.add(row.campaign_id);
    }
    const assigned = await this.dataSource.query(
      `SELECT DISTINCT cw.campaign_id FROM campaign_warehouse cw
         JOIN campaign_area_snapshot s ON s.campaign_id = cw.campaign_id
        WHERE cw.warehouse_id = $1 AND s.status <> 'CLOSED'`,
      [change.after.warehouse_id],
    ) as Array<{ campaign_id: string }>;
    for (const row of assigned) ids.add(row.campaign_id);
    return [...ids];
  }
}
