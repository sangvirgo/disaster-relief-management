import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { hasPermission } from '@c48/identity-contracts/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { LogisticsResponseMissionClient, ResponseMission } from '../integrations/response/response-mission.client';
import { MissionSupplyQueryDto, SupplyQueueQueryDto } from './supply-requests.dto';
import {
  loadSupplyLines, supplyActor, SupplyRequestRow, supplyRequestSelect, teamView, warehouseQueueView,
} from './supply-requests.helpers';

interface SuggestionRow {
  relief_need_id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  source: 'DECLARED' | 'ESTIMATED' | 'CONFIRMED';
  from_text: boolean;
  requested_quantity: string;
  delivered: string;
  reserved: string;
}

/** Read side of supply requests: the team's mission view, the AI/norm suggestion and the warehouse queue. */
@Injectable()
export class SupplyRequestsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
    private readonly missions: LogisticsResponseMissionClient,
  ) {}

  /** Every request of one mission, newest first. Team members may read it to show the pickup code at the warehouse. */
  async forMission(query: MissionSupplyQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const mission = await this.missions.getMission(query.mission_id);
    this.requireMissionReader(session.grants, session.userId, mission);
    const rows = await this.dataSource.query(
      `${supplyRequestSelect} WHERE s.mission_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 20`,
      [mission.id],
    ) as SupplyRequestRow[];
    const lines = await loadSupplyLines(this.dataSource, rows.map((row) => row.id));
    return {
      items: rows.map((row) => teamView(row, lines.filter((line) => line.supply_request_id === row.id))),
      can_request: this.canRequest(session.grants, session.userId, mission),
    };
  }

  /**
   * Suggested goods for the mission: every live need of the SOS cycle (AI text extraction, norm estimate or a confirmed
   * line) minus what was already delivered or is still reserved. It is a proposal; the leader edits it before sending.
   */
  async suggestion(query: MissionSupplyQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const mission = await this.missions.getMission(query.mission_id);
    this.requireMissionReader(session.grants, session.userId, mission);
    const rows = await this.dataSource.query(
      `SELECT n.id AS relief_need_id,n.item_id,i.name AS item_name,i.unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
              n.source,(n.estimate_basis ? 'extraction') AS from_text,n.requested_quantity::text,
              COALESCE(SUM(cm.delivered_quantity),0)::text AS delivered,
              COALESCE(SUM(cm.quantity-cm.released_quantity-cm.issued_quantity),0)::text AS reserved
         FROM fulfillment_cycle c JOIN relief_need n ON n.cycle_id=c.id
         JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
         LEFT JOIN commitment cm ON cm.relief_need_id=n.id
        WHERE c.request_id=$1 AND c.work_cycle=$2 AND n.status IN ('OPEN','PARTIALLY_FULFILLED') AND i.status='ACTIVE'
        GROUP BY n.id,i.id,u.code
        ORDER BY i.name,n.item_id`,
      [mission.request_id, mission.work_cycle],
    ) as SuggestionRow[];
    const lines = rows.flatMap((row) => {
      const scale = Number(row.unit_scale);
      const open = quantityUnits(row.requested_quantity, scale) - quantityUnits(row.delivered, scale) - quantityUnits(row.reserved, scale);
      if (open <= 0n) return [];
      return [{
        item_id: row.item_id,
        item_name: row.item_name,
        unit_code: row.unit_code,
        unit_name: row.unit_name,
        quantity: decimalFromUnits(open, scale),
        basis: row.source === 'ESTIMATED' ? (row.from_text ? 'AI_TEXT' : 'NORM') : 'CONFIRMED',
      }];
    });
    return { mission_id: mission.id, lines };
  }

  /**
   * The warehouse queue. Rows carry the team name and goods only. A SYSTEM grant sees every warehouse; a campaign grant
   * sees requests of its campaigns.
   */
  async queue(query: SupplyQueueQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const grants = session.grants;
    const system = hasPermission(grants, 'SUPPLY_REQUEST_HANDOVER', { campaignId: null });
    const campaignIds = [...new Set(grants.flatMap((grant) => (
      grant.scope_type === 'CAMPAIGN' && grant.campaign_id && hasPermission(grants, 'SUPPLY_REQUEST_HANDOVER', { campaignId: grant.campaign_id })
        ? [grant.campaign_id]
        : []
    )))];
    if (!system && campaignIds.length === 0) throw new AppError('FORBIDDEN', { status: 403 });

    const status = query.status ?? 'READY';
    const filters = { status, warehouse_id: query.warehouse_id ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const limit = query.limit ?? 20;
    const values: unknown[] = [status];
    const where = ['s.status=$1'];
    if (!system) {
      values.push(campaignIds);
      where.push(`s.campaign_id=ANY($${values.length}::uuid[])`);
    }
    if (query.warehouse_id) {
      values.push(query.warehouse_id);
      where.push(`s.warehouse_id=$${values.length}`);
    }
    // Open requests are served oldest first (closest to expiry); history is newest first.
    const ascending = status === 'READY';
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      where.push(`(s.created_at,s.id) ${ascending ? '>' : '<'} ($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const order = ascending ? 'ASC' : 'DESC';
    const select = supplyRequestSelect.replace(
      'SELECT s.id,',
      `SELECT to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,s.id,`,
    );
    const rows = await this.dataSource.query(
      `${select} WHERE ${where.join(' AND ')} ORDER BY s.created_at ${order},s.id ${order} LIMIT $${values.length}`,
      values,
    ) as Array<SupplyRequestRow & { cursor_created_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const lines = await loadSupplyLines(this.dataSource, page.map((row) => row.id));
    const next = more ? page.at(-1) : undefined;
    return {
      items: page.map((row) => warehouseQueueView(row, lines.filter((line) => line.supply_request_id === row.id))),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}),
    };
  }

  private canRequest(grants: Parameters<typeof supplyActor>[0], userId: string, mission: ResponseMission): boolean {
    try {
      supplyActor(grants, userId, mission);
      return ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(mission.status);
    } catch {
      return false;
    }
  }

  private requireMissionReader(grants: Parameters<typeof supplyActor>[0], userId: string, mission: ResponseMission): void {
    if (mission.member_user_ids.includes(userId)) return;
    supplyActor(grants, userId, mission);
  }
}
