import { randomInt } from 'node:crypto';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { grantPermissions, hasPermission, type Grant } from '@c48/identity-contracts/permissions';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import type { ResponseMission } from '../integrations/response/response-mission.client';
import type { SupplyRequestStatus } from './supply-requests.dto';

export type SupplyRequestCommand = Request & { idempotencyKey?: string };

/** Mission statuses for which a team may ask for goods: the team accepted the mission and it is still running. */
export const SUPPLY_MISSION_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] as const;
/** A READY request that nobody collects within this window expires and releases its reservation. */
export const SUPPLY_REQUEST_EXPIRY_HOURS = 6;

export interface SupplyRequestRow {
  id: string;
  mission_id: string;
  request_id: string;
  work_cycle: number | string;
  campaign_id: string | null;
  team_id: string;
  team_name: string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_address: string | null;
  warehouse_lat: number | string | null;
  warehouse_lng: number | string | null;
  status: SupplyRequestStatus;
  pickup_code: string;
  requested_by: string;
  on_behalf: boolean;
  expires_at: Date | string;
  handed_over_by: string | null;
  handed_over_at: Date | string | null;
  cancelled_by: string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SupplyLineRow {
  supply_request_id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  relief_need_id: string;
  commitment_id: string | null;
  requested_quantity: string;
  reserved_quantity: string;
}

export const supplyRequestSelect = `SELECT s.id,s.mission_id,s.request_id,s.work_cycle,s.campaign_id,s.team_id,s.team_name,s.warehouse_id,
    w.name AS warehouse_name,w.address_note AS warehouse_address,
    ST_Y(w.location::geometry)::float8 AS warehouse_lat,ST_X(w.location::geometry)::float8 AS warehouse_lng,
    s.status,s.pickup_code,s.requested_by,s.on_behalf,s.expires_at,s.handed_over_by,s.handed_over_at,
    s.cancelled_by,s.cancelled_at,s.cancel_reason,s.version,s.created_at,s.updated_at
  FROM supply_request s JOIN warehouse w ON w.id=s.warehouse_id`;

export const supplyLineSelect = `SELECT l.supply_request_id,l.item_id,i.name AS item_name,i.unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
    l.relief_need_id,l.commitment_id,l.requested_quantity::text,l.reserved_quantity::text
  FROM supply_request_line l JOIN item i ON i.id=l.item_id JOIN unit u ON u.code=i.unit_code`;

export function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/**
 * Who may ask for goods for a mission, or cancel the open request: a leader of the mission's team (with the volunteer
 * permission), or a coordinator whose grant covers the mission's campaign, acting on behalf of the team.
 */
export function supplyActor(grants: readonly Grant[], userId: string, mission: ResponseMission): { onBehalf: boolean } {
  if (mission.leader_user_ids.includes(userId) && hasPermission(grants, 'SUPPLY_REQUEST_CREATE', { campaignId: mission.campaign_id })) {
    return { onBehalf: false };
  }
  const coordinator = grants.some((grant) => grant.role_code === 'COORDINATOR' &&
    grantPermissions(grant).includes('SUPPLY_REQUEST_CREATE') &&
    (grant.scope_type === 'SYSTEM' ? !grant.campaign_id : Boolean(mission.campaign_id) && grant.campaign_id === mission.campaign_id));
  if (coordinator) return { onBehalf: true };
  throw new AppError('FORBIDDEN', { status: 403 });
}

/** Warehouse staff hand over goods; a campaign grant covers only that campaign's requests. */
export function requireHandover(grants: readonly Grant[], campaignId: string | null): void {
  if (!hasPermission(grants, 'SUPPLY_REQUEST_HANDOVER', { campaignId })) throw new AppError('FORBIDDEN', { status: 403 });
}

export function newPickupCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function needStatus(delivered: bigint, requested: bigint): 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' {
  if (delivered >= requested) return 'FULFILLED';
  return delivered === 0n ? 'OPEN' : 'PARTIALLY_FULFILLED';
}

/** One candidate warehouse with its free stock (on hand minus reserved) per requested item, in stock units. */
export interface WarehouseCandidate {
  id: string;
  name: string;
  /** 0 = campaign PRIMARY, 1 = campaign BACKUP, 2 = any other active warehouse. */
  tier: 0 | 1 | 2;
  free: Map<string, bigint>;
}

export interface WantedLine {
  item_id: string;
  units: bigint;
}

/** Share of the requested lines a warehouse can cover, in parts per million (each line weighs the same). */
export function coverage(candidate: WarehouseCandidate, lines: readonly WantedLine[]): number {
  if (lines.length === 0) return 0;
  let total = 0;
  for (const line of lines) {
    const free = candidate.free.get(line.item_id) ?? 0n;
    const covered = free >= line.units ? line.units : free > 0n ? free : 0n;
    total += Number((covered * 1_000_000n) / line.units);
  }
  return Math.floor(total / lines.length);
}

/**
 * Picks one warehouse so the team makes one trip. Campaign warehouses come first: the best-covering campaign warehouse
 * wins (PRIMARY before BACKUP on a tie). Another active warehouse is used only when no campaign warehouse holds any of
 * the goods. Returns null when no warehouse holds anything requested.
 */
export function chooseWarehouse(candidates: readonly WarehouseCandidate[], lines: readonly WantedLine[]): WarehouseCandidate | null {
  const ranked = candidates
    .map((candidate) => ({ candidate, score: coverage(candidate, lines) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      const leftCampaign = left.candidate.tier < 2 ? 0 : 1;
      const rightCampaign = right.candidate.tier < 2 ? 0 : 1;
      return leftCampaign - rightCampaign || right.score - left.score || left.candidate.tier - right.candidate.tier ||
        left.candidate.name.localeCompare(right.candidate.name, 'vi') || left.candidate.id.localeCompare(right.candidate.id);
    });
  return ranked[0]?.candidate ?? null;
}

function lineView(line: SupplyLineRow): Record<string, unknown> {
  const scale = Number(line.unit_scale);
  const requested = quantityUnits(line.requested_quantity, scale);
  const reserved = quantityUnits(line.reserved_quantity, scale);
  return {
    item_id: line.item_id,
    item_name: line.item_name,
    unit_code: line.unit_code,
    unit_name: line.unit_name,
    requested_quantity: decimalFromUnits(requested, scale),
    reserved_quantity: decimalFromUnits(reserved, scale),
    shortfall_quantity: decimalFromUnits(requested > reserved ? requested - reserved : 0n, scale),
  };
}

function warehouseView(row: SupplyRequestRow): Record<string, unknown> {
  return {
    id: row.warehouse_id,
    name: row.warehouse_name,
    address_note: row.warehouse_address,
    location: row.warehouse_lat === null || row.warehouse_lng === null
      ? null
      : { lat: Number(row.warehouse_lat), lng: Number(row.warehouse_lng) },
  };
}

/** The team's view (leader, members through the coordinator, coordinator): includes the pickup code and the mission. */
export function teamView(row: SupplyRequestRow, lines: readonly SupplyLineRow[]): Record<string, unknown> {
  return {
    id: row.id,
    mission_id: row.mission_id,
    team_id: row.team_id,
    team_name: row.team_name,
    status: row.status,
    pickup_code: row.status === 'READY' ? row.pickup_code : null,
    on_behalf: row.on_behalf,
    warehouse: warehouseView(row),
    expires_at: iso(row.expires_at),
    handed_over_at: iso(row.handed_over_at),
    cancelled_at: iso(row.cancelled_at),
    cancel_reason: row.cancel_reason,
    version: Number(row.version),
    created_at: iso(row.created_at),
    lines: lines.map(lineView),
    has_shortfall: lines.some((line) => quantityUnits(line.reserved_quantity, Number(line.unit_scale)) <
      quantityUnits(line.requested_quantity, Number(line.unit_scale))),
  };
}

/**
 * The warehouse view. It names the team and the goods only: no SOS, mission, request, location, people or pickup code.
 * Only reserved quantities are shown, because only they wait on the shelf.
 */
export function warehouseQueueView(row: SupplyRequestRow, lines: readonly SupplyLineRow[]): Record<string, unknown> {
  return {
    id: row.id,
    team_name: row.team_name,
    status: row.status,
    warehouse: { id: row.warehouse_id, name: row.warehouse_name },
    expires_at: iso(row.expires_at),
    handed_over_at: iso(row.handed_over_at),
    cancelled_at: iso(row.cancelled_at),
    version: Number(row.version),
    created_at: iso(row.created_at),
    lines: lines
      .filter((line) => quantityUnits(line.reserved_quantity, Number(line.unit_scale)) > 0n)
      .map((line) => {
        const scale = Number(line.unit_scale);
        return {
          item_id: line.item_id,
          item_name: line.item_name,
          unit_code: line.unit_code,
          unit_name: line.unit_name,
          quantity: decimalFromUnits(quantityUnits(line.reserved_quantity, scale), scale),
        };
      }),
  };
}

export function requestState(row: Pick<SupplyRequestRow, 'status' | 'version' | 'warehouse_id'>): Record<string, unknown> {
  return { status: row.status, version: Number(row.version), warehouse_id: row.warehouse_id };
}

export async function writeSupplyAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string | null,
  action: string,
  id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string | null = null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'supply_request',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
  );
}

export async function loadSupplyRequest(manager: Pick<EntityManager, 'query'>, id: string, lock = false): Promise<SupplyRequestRow> {
  if (lock) await manager.query('SELECT id FROM supply_request WHERE id=$1 FOR UPDATE', [id]);
  const rows = await manager.query(`${supplyRequestSelect} WHERE s.id=$1`, [id]) as SupplyRequestRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

export async function loadSupplyLines(manager: Pick<EntityManager, 'query'>, ids: readonly string[]): Promise<SupplyLineRow[]> {
  if (ids.length === 0) return [];
  return await manager.query(
    `${supplyLineSelect} WHERE l.supply_request_id=ANY($1::uuid[]) ORDER BY l.supply_request_id,i.name,l.item_id`,
    [ids],
  ) as SupplyLineRow[];
}

/**
 * Releases the unissued part of every reservation on the request (cancel and expiry). Locks cycle, then need, then
 * commitment, the same order as the need commands. Movements are attributed to `actorId`.
 */
export async function releaseSupplyReservations(
  manager: Pick<EntityManager, 'query'>,
  lines: readonly SupplyLineRow[],
  actorId: string,
  supplyRequestId: string,
): Promise<void> {
  for (const line of lines) {
    if (!line.commitment_id) continue;
    await manager.query(
      `SELECT c.id FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE n.id=$1 FOR UPDATE OF c`,
      [line.relief_need_id],
    );
    await manager.query('SELECT id FROM relief_need WHERE id=$1 FOR UPDATE', [line.relief_need_id]);
    const rows = await manager.query(
      `SELECT id,warehouse_id,item_id,quantity::text,released_quantity::text,issued_quantity::text
         FROM commitment WHERE id=$1 FOR UPDATE`,
      [line.commitment_id],
    ) as Array<{ id: string; warehouse_id: string; item_id: string; quantity: string; released_quantity: string; issued_quantity: string }>;
    const commitment = rows[0];
    if (!commitment) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const scale = Number(line.unit_scale);
    const remaining = quantityUnits(commitment.quantity, scale) - quantityUnits(commitment.released_quantity, scale) -
      quantityUnits(commitment.issued_quantity, scale);
    if (remaining <= 0n) continue;
    const quantity = decimalFromUnits(remaining, scale);
    await manager.query(
      'UPDATE commitment SET released_quantity=released_quantity+$2::numeric,version=version+1 WHERE id=$1',
      [commitment.id, quantity],
    );
    const balances = await manager.query(
      'SELECT id FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
      [commitment.warehouse_id, commitment.item_id],
    ) as Array<{ id: string }>;
    if (!balances[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await manager.query(
      `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
       VALUES ($1,'RELEASE',0,-$2::numeric,$3,$4,$5)`,
      [balances[0].id, quantity, commitment.id, `SUPPLY_RELEASE:${supplyRequestId}:${commitment.id}`, actorId],
    );
  }
}
