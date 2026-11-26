import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { hasPermission } from '@c48/identity-contracts/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { CampaignWarehouseService } from '../campaign-warehouses/campaign-warehouses.service';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { NEED_REASON_CODES, needReasonText, NeedReasonCode } from '../needs/need-reasons';
import { NeedProposalQueryDto } from './need-proposals.dto';

// Read-only manager queue: ESTIMATED lines that are still OPEN, grouped by SOS work cycle. Approval and rejection are the
// existing POST /needs/{id}/confirm and POST /needs/{id}/cancel; nothing here writes. The campaign's PRIMARY warehouse
// stock is shown for the shortfall flag only. Nothing here chooses or changes a quantity.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const route = 'logistics.need-proposals';

interface CycleRow {
  cycle_id: string;
  request_id: string;
  work_cycle: number | string;
  campaign_id: string | null;
}

interface ProposalLineRow {
  id: string;
  version: number | string;
  cycle_id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  requested_quantity: string;
  estimate_basis: Record<string, unknown> | null;
  status: string;
}

interface StockRow {
  warehouse_id: string;
  item_id: string;
  on_hand: string;
  reserved: string;
}

/** Unknown codes are dropped rather than shown raw; the Vietnamese copy exists only for known codes. */
function reasonViews(codes: unknown): Array<{ code: NeedReasonCode; message: string }> {
  if (!Array.isArray(codes)) return [];
  return codes
    .filter((code): code is NeedReasonCode => typeof code === 'string' && (NEED_REASON_CODES as readonly string[]).includes(code))
    .map((code) => ({ code, message: needReasonText(code) }));
}

function sosFacts(basis: Record<string, unknown> | null): Record<string, number> | null {
  const inputs = basis?.inputs as Record<string, unknown> | undefined;
  if (!inputs || typeof inputs.people !== 'number') return null;
  return {
    people: Number(inputs.people),
    children: Number(inputs.children ?? 0),
    elderly: Number(inputs.elderly ?? 0),
    adults: Number(inputs.adults ?? 0),
  };
}

const MAX_LAZY_ASSIGNMENTS = 5;

@Injectable()
export class NeedProposalsService {
  private readonly logger = new Logger(NeedProposalsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
    @Optional() private readonly campaignWarehouses?: CampaignWarehouseService,
  ) {}

  async list(query: NeedProposalQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const grants = session.grants;
    const scopeAll = hasPermission(grants, 'NEED_ESTIMATE_CONFIRM', { campaignId: null });
    const campaignIds = [...new Set(grants
      .filter((grant) => grant.scope_type === 'CAMPAIGN' && grant.campaign_id)
      .map((grant) => grant.campaign_id as string)
      .filter((campaignId) => hasPermission(grants, 'NEED_ESTIMATE_CONFIRM', { campaignId })))].sort();
    if (!scopeAll && campaignIds.length === 0) throw new AppError('FORBIDDEN', { status: 403 });

    const unassignedOnly = query.campaign_scope === 'NONE';
    // Proposals of an SOS outside every campaign have no warehouse, so they are listed apart and never mixed with campaign work.
    if (unassignedOnly && !scopeAll) throw new AppError('FORBIDDEN', { status: 403 });
    const filters = { route, scope: scopeAll ? 'SYSTEM' : campaignIds, campaign_scope: unassignedOnly ? 'NONE' : null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' || !uuidPattern.test(cursor.id) || cursor.sort[0] !== cursor.id)) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }

    const values: unknown[] = [];
    const conditions = ["EXISTS (SELECT 1 FROM relief_need n WHERE n.cycle_id=c.id AND n.source='ESTIMATED' AND n.status='OPEN')"];
    if (unassignedOnly) {
      conditions.push('c.campaign_id IS NULL');
    } else if (!scopeAll) {
      values.push(campaignIds);
      conditions.push(`c.campaign_id=ANY($${values.length}::uuid[])`);
    } else {
      conditions.push('c.campaign_id IS NOT NULL');
    }
    if (cursor) {
      values.push(cursor.id);
      conditions.push(`c.id>$${values.length}::uuid`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const cycles = await this.dataSource.query(
      `SELECT c.id AS cycle_id,c.request_id,c.work_cycle,c.campaign_id
         FROM fulfillment_cycle c
        WHERE ${conditions.join(' AND ')}
        ORDER BY c.id ASC LIMIT $${values.length}`,
      values,
    ) as CycleRow[];
    const page = cycles.slice(0, limit);
    const more = cycles.length > limit;
    const last = page.at(-1);
    const generatedAt = new Date().toISOString();
    // Awareness count only: it is not part of any warehouse demand or supply gap number.
    const unassignedTotal = scopeAll ? await this.countUnassigned() : null;
    const unassigned = unassignedTotal === null ? {} : { unassigned_total: unassignedTotal };
    if (page.length === 0) return { items: [], more: false, ...unassigned, generated_at: generatedAt };

    const cycleIds = page.map((row) => row.cycle_id);
    const lines = await this.dataSource.query(
      `SELECT n.id,n.version,n.cycle_id,n.item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,
              u.scale AS unit_scale,n.requested_quantity::text,n.estimate_basis,n.status
         FROM relief_need n JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
        WHERE n.cycle_id=ANY($1::uuid[]) AND n.source='ESTIMATED' AND n.status='OPEN'
        ORDER BY n.created_at ASC, n.id ASC`,
      [cycleIds],
    ) as ProposalLineRow[];

    const campaignsOnPage = [...new Set(page.map((row) => row.campaign_id).filter((id): id is string => Boolean(id)))];
    const primaries = await this.primaryWarehouses(campaignsOnPage);
    const primaryByCampaign = new Map(primaries.map((row) => [row.campaign_id, row.warehouse_id]));
    const warehouseIds = [...new Set(primaries.map((row) => row.warehouse_id))];
    const itemIds = [...new Set(lines.map((line) => line.item_id))];
    const stock = warehouseIds.length === 0 || itemIds.length === 0 ? [] : await this.dataSource.query(
      'SELECT warehouse_id,item_id,on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=ANY($1::uuid[]) AND item_id=ANY($2::uuid[])',
      [warehouseIds, itemIds],
    ) as StockRow[];
    const stockByKey = new Map(stock.map((row) => [`${row.warehouse_id}:${row.item_id}`, row]));

    const mentionedIds = [...new Set(lines.flatMap((line) => {
      const extraction = line.estimate_basis?.extraction as { mentioned_items?: Array<{ item_id: string }> } | undefined;
      return (extraction?.mentioned_items ?? []).map((entry) => entry.item_id);
    }))];
    const mentionedNames = new Map<string, string>();
    if (mentionedIds.length > 0) {
      const rows = await this.dataSource.query('SELECT id,name FROM item WHERE id=ANY($1::uuid[])', [mentionedIds]) as Array<{ id: string; name: string }>;
      for (const row of rows) mentionedNames.set(row.id, row.name);
    }

    const linesByCycle = new Map<string, ProposalLineRow[]>();
    for (const line of lines) {
      const bucket = linesByCycle.get(line.cycle_id) ?? [];
      bucket.push(line);
      linesByCycle.set(line.cycle_id, bucket);
    }

    const items = page.map((cycle) => {
      const cycleLines = linesByCycle.get(cycle.cycle_id) ?? [];
      const warehouseId = cycle.campaign_id ? primaryByCampaign.get(cycle.campaign_id) ?? null : null;
      const first = cycleLines[0]?.estimate_basis ?? null;
      const extraction = first?.extraction as Record<string, unknown> | undefined;
      return {
        cycle_id: cycle.cycle_id,
        request_id: cycle.request_id,
        work_cycle: Number(cycle.work_cycle),
        campaign_id: cycle.campaign_id,
        sos: sosFacts(first),
        warehouse: warehouseId ? { id: warehouseId } : null,
        lines: cycleLines.map((line) => {
          const scale = Number(line.unit_scale);
          const requested = quantityUnits(line.requested_quantity, scale);
          const balance = warehouseId ? stockByKey.get(`${warehouseId}:${line.item_id}`) : undefined;
          const availableUnits = balance
            ? (() => {
              const free = quantityUnits(balance.on_hand, scale) - quantityUnits(balance.reserved, scale);
              return free > 0n ? free : 0n;
            })()
            : warehouseId ? 0n : null;
          const reasonCodes = Array.isArray(line.estimate_basis?.reason_codes) ? line.estimate_basis?.reason_codes as string[] : [];
          return {
            need_id: line.id,
            version: Number(line.version),
            category: String(line.estimate_basis?.category ?? ''),
            item: { id: line.item_id, name: line.item_name, unit: { code: line.unit_code, display_name: line.unit_name, scale } },
            quantity: line.requested_quantity,
            available: availableUnits === null ? null : decimalFromUnits(availableUnits, scale),
            shortfall: availableUnits === null ? null : requested > availableUnits,
            reason_codes: reasonCodes,
            reasons: reasonViews(reasonCodes),
          };
        }),
        extraction: extraction ? {
          source: extraction.source,
          model: extraction.model ?? null,
          unmatched_terms: Array.isArray(extraction.unmatched_terms) ? extraction.unmatched_terms : [],
          mentioned_items: (Array.isArray(extraction.mentioned_items) ? extraction.mentioned_items as Array<Record<string, unknown>> : [])
            .map((entry) => ({
              item_id: entry.item_id,
              item_name: mentionedNames.get(String(entry.item_id)) ?? null,
              category: entry.category ?? null,
            })),
          reasons: reasonViews(extraction.reason_codes),
        } : null,
      };
    });

    return {
      items,
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cycle_id], last.cycle_id, filters) } : {}),
      ...unassigned,
      generated_at: generatedAt,
    };
  }

  /** SOS work cycles outside every campaign that still hold at least one OPEN estimated line. */
  private async countUnassigned(): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM fulfillment_cycle AS unassigned
        WHERE unassigned.campaign_id IS NULL
          AND EXISTS (SELECT 1 FROM relief_need n WHERE n.cycle_id=unassigned.id AND n.source='ESTIMATED' AND n.status='OPEN')`,
    ) as Array<{ total: number | string }>;
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * PRIMARY warehouse per campaign. A campaign that has none yet (new or just moved) is assigned now instead of waiting
   * for the 15-minute sweep; at most MAX_LAZY_ASSIGNMENTS per read, and a failure only leaves the proposal without a warehouse.
   */
  private async primaryWarehouses(campaignIds: string[]): Promise<Array<{ campaign_id: string; warehouse_id: string }>> {
    if (campaignIds.length === 0) return [];
    const read = () => this.dataSource.query(
      "SELECT campaign_id,warehouse_id FROM campaign_warehouse WHERE role='PRIMARY' AND campaign_id=ANY($1::uuid[])",
      [campaignIds],
    ) as Promise<Array<{ campaign_id: string; warehouse_id: string }>>;
    const found = await read();
    const missing = campaignIds.filter((id) => !found.some((row) => row.campaign_id === id)).slice(0, MAX_LAZY_ASSIGNMENTS);
    if (!missing.length || !this.campaignWarehouses) return found;
    for (const campaignId of missing) {
      try {
        await this.campaignWarehouses.reevaluateCampaign(campaignId, 'PROPOSAL_READ');
      } catch (error) {
        this.logger.warn({ code: error instanceof Error ? error.name : 'UNKNOWN' }, 'Lazy campaign warehouse assignment failed');
      }
    }
    return read();
  }
}
