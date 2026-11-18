import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { Grant, Permission } from '@c48/identity-contracts/permissions';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { requireWarehousePermission } from '../stock/stock.scope';

export type PickupRequest = Request & { idempotencyKey?: string };

/** Mission statuses from which a ticket may be created: the volunteer team has accepted the mission. */
export const PICKUP_ASSIGNABLE_MISSION_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'] as const;
/** READY tickets that nobody confirmed within this window are cancelled by the expiry sweep. */
export const PICKUP_EXPIRY_HOURS = 24;

export interface PickupTicketRow {
  id: string;
  mission_id: string;
  request_id: string | null;
  campaign_id: string | null;
  team_id: string | null;
  warehouse_id: string;
  status: 'OPEN' | 'READY' | 'HANDED_OVER' | 'CLOSED' | 'CANCELLED';
  distribution_id: string | null;
  ready_at: Date | string | null;
  reserved_by: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  handed_over_by: string | null;
  handed_over_at: Date | string | null;
  collected_by_user_id: string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
  closed_by?: string | null;
  closed_at?: Date | string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Computed on read (never stored): whether the ticket still holds goods, and whether that has lasted past the overdue window. */
export interface PickupReadFlags {
  unaccounted_goods: boolean;
  handover_overdue: boolean;
}

export interface PickupLineRow {
  ticket_id: string;
  relief_need_id: string;
  commitment_id: string | null;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_scale: number | string;
  requested_quantity: string;
  reserved_quantity: string;
}

const idempotencyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Deterministic UUID (version 5 layout) for one underlying command step. A retry of the same outer command derives the
 * same key, so the existing services replay their stored result instead of executing the step twice.
 */
export function deriveStepKey(outerKey: string, step: string): string {
  const hex = createHash('sha256').update(`pickup-ticket|${outerKey}|${step}`).digest('hex');
  const variant = '89ab'[Number.parseInt(hex[16] ?? '0', 16) & 3];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Request view for a sub-service call: same session, its own idempotency key derived from the outer key. */
export function stepRequest(request: PickupRequest, step: string): PickupRequest {
  const outerKey = request.idempotencyKey;
  if (!outerKey || !idempotencyPattern.test(outerKey)) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  const child = Object.create(request) as PickupRequest;
  child.idempotencyKey = deriveStepKey(outerKey, step);
  return child;
}

export function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Pickup ticket permissions are campaign-scoped like donation drives; a SYSTEM grant covers every campaign. */
export function requirePickupPermission(grants: readonly Grant[], permission: Permission, campaignId: string | null): void {
  requireWarehousePermission(grants, permission, { campaign_id: campaignId });
}

export function ticketView(
  row: PickupTicketRow,
  lines: readonly PickupLineRow[],
  flags: PickupReadFlags = { unaccounted_goods: false, handover_overdue: false },
): Record<string, unknown> {
  const computed = lines.map((line) => {
    const scale = Number(line.unit_scale);
    const requested = quantityUnits(line.requested_quantity, scale);
    const reserved = quantityUnits(line.reserved_quantity, scale);
    const shortfall = requested > reserved ? requested - reserved : 0n;
    return { line, scale, shortfall };
  });
  const viewLines = computed.map(({ line, scale, shortfall }) => ({
    relief_need_id: line.relief_need_id,
    commitment_id: line.commitment_id,
    item_id: line.item_id,
    item_name: line.item_name,
    unit_code: line.unit_code,
    requested_quantity: decimalFromUnits(quantityUnits(line.requested_quantity, scale), scale),
    reserved_quantity: decimalFromUnits(quantityUnits(line.reserved_quantity, scale), scale),
    shortfall_quantity: decimalFromUnits(shortfall, scale),
  }));
  return {
    id: row.id,
    mission_id: row.mission_id,
    request_id: row.request_id,
    campaign_id: row.campaign_id,
    team_id: row.team_id,
    warehouse_id: row.warehouse_id,
    status: row.status,
    distribution_id: row.distribution_id,
    version: Number(row.version),
    ready_at: iso(row.ready_at),
    reserved_by: row.reserved_by,
    confirmed_by: row.confirmed_by,
    confirmed_at: iso(row.confirmed_at),
    handed_over_by: row.handed_over_by,
    handed_over_at: iso(row.handed_over_at),
    collected_by_user_id: row.collected_by_user_id,
    cancelled_at: iso(row.cancelled_at),
    cancel_reason: row.cancel_reason,
    closed_by: row.closed_by ?? null,
    closed_at: iso(row.closed_at ?? null),
    unaccounted_goods: flags.unaccounted_goods,
    handover_overdue: flags.handover_overdue,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    lines: viewLines,
    shortfalls: computed
      .filter(({ shortfall }) => shortfall > 0n)
      .map(({ line, scale, shortfall }) => ({
        relief_need_id: line.relief_need_id,
        item_id: line.item_id,
        item_name: line.item_name,
        shortfall_quantity: decimalFromUnits(shortfall, scale),
      })),
  };
}

export async function writePickupAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string | null,
  action: string,
  ticketId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string | null = null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'pickup_ticket',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, ticketId, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
  );
}

export function ticketState(row: PickupTicketRow): Record<string, unknown> {
  return { status: row.status, version: Number(row.version), distribution_id: row.distribution_id };
}
