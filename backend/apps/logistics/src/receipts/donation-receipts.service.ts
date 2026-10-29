import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef } from '@c48/technical/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { requireWarehousePermission, hasWarehouseScope } from '../stock/stock.scope';
import { decimalFromUnits } from '../common/quantity';
import {
  CreateDonationReceiptDto, RecordReceiptCountDto, ReleaseHeldDonationDto, ResolveDonationDisputeDto,
  ReviewDonationReceiptDto, PostDonationReceiptDto, ReceiptCountLineDto,
} from './donation-receipts.dto';
import {
  assertHeldReleaseConserved, assertUniqueCountItems, ReceiptLineFacts, receiptQuantityUnits, validateCountSplit,
} from './donation-receipts.helpers';
import { readReceiptLines, readReceiptView } from './donation-receipts.read';
import { cleanDriveText } from '../drives/drives.helpers';
import { requireIdempotencyKey as key } from '@c48/technical/http/response-headers';

type ReceiptRequest = Request & { idempotencyKey?: string };

interface ReceiptContext {
  id: string;
  delivery_id: string;
  warehouse_id: string;
  version: number | string;
  delivery_status: string;
  donor_user_id: string | null;
  organization_id: string;
  region_code: string;
  drive_id: string;
}

interface DeliveryCreateContext {
  id: string;
  status: string;
  version: number | string;
  drive_id: string;
  drive_status: string;
  organization_id: string;
  region_code: string;
  intake_warehouse_id: string;
  selected_warehouse_id: string | null;
  selected_organization_id: string | null;
  selected_region_code: string | null;
  selected_warehouse_status: string | null;
}

interface CountLine extends ReceiptLineFacts {
  unit_scale: number;
}

function requireReceiptPermission(
  grants: Parameters<typeof hasWarehouseScope>[0],
  permission: 'DONATION_INTAKE' | 'DONATION_REVIEW',
  scope: Pick<ReceiptContext, 'organization_id' | 'region_code'>,
): void {
  if (!hasWarehouseScope(grants, scope.organization_id, scope.region_code)) throw new AppError('NOT_FOUND', { status: 404 });
  requireWarehousePermission(grants, permission, scope.organization_id, scope.region_code);
}

function expectVersion(actual: number | string, expected: number): void {
  if (Number(actual) !== expected) {
    throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(actual) } });
  }
}

@Injectable()
export class DonationReceiptsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async create(dto: CreateDonationReceiptDto, request: ReceiptRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const initial = await this.deliveryForCreate(this.dataSource, dto.delivery_id, dto.warehouse_id);
    this.assertCreateScope(session.grants, initial);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-receipts.create',
      key: key(request),
      requestHash: canonicalRequestHash(dto),
      execute: async (manager) => {
        const delivery = await this.deliveryForCreate(manager, dto.delivery_id, dto.warehouse_id, true);
        this.assertCreateScope(session.grants, delivery);
        if (delivery.status !== 'DECLARED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const existing = await manager.query('SELECT id FROM donation_receipt WHERE delivery_id=$1', [dto.delivery_id]) as Array<{ id: string }>;
        if (existing[0]) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const inserted = await manager.query(
          'INSERT INTO donation_receipt (delivery_id,warehouse_id) VALUES ($1,$2) RETURNING id',
          [dto.delivery_id, dto.warehouse_id],
        ) as Array<{ id: string }>;
        const id = inserted[0]!.id;
        await manager.query("UPDATE donation_delivery SET status='COUNTING',version=version+1 WHERE id=$1", [dto.delivery_id]);
        await this.audit(manager, session.userId, 'DONATION_RECEIPT_CREATED', 'donation_receipt', id, null, { delivery_id: dto.delivery_id });
        return { status: 201, value: (await readReceiptView(manager, id)).value, resource: { type: 'donation_receipt', id } };
      },
      replay: async (manager, resource) => this.replayReceipt(manager, resource),
    });
  }

  async recordCount(id: string, dto: RecordReceiptCountDto, request: ReceiptRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const receipt = await this.receiptContext(this.dataSource, id);
    requireReceiptPermission(session.grants, 'DONATION_INTAKE', receipt);
    const itemIds = assertUniqueCountItems(dto.lines);
    const scales = await this.itemScales(this.dataSource, itemIds);
    this.validateLines(dto.lines, scales);
    const note = cleanDriveText(dto.note);
    const lines: ReceiptCountLineDto[] = dto.lines.map((line) => {
      const conditionNote = cleanDriveText(line.condition_note);
      return { ...line, ...(conditionNote === null ? {} : { condition_note: conditionNote }) };
    });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-receipts.counts',
      key: key(request),
      requestHash: canonicalRequestHash({ receipt_id: id, dto }),
      execute: async (manager) => {
        const current = await this.receiptContext(manager, id, true);
        requireReceiptPermission(session.grants, 'DONATION_INTAKE', current);
        expectVersion(current.version, dto.expected_version);
        if (['REJECTED', 'CANCELLED'].includes(current.delivery_status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const currentScales = await this.itemScales(manager, itemIds);
        this.validateLines(lines, currentScales);
        const rows = await manager.query('SELECT COALESCE(max(revision),0)::int AS revision FROM receipt_count WHERE receipt_id=$1', [id]) as Array<{ revision: number }>;
        const revision = Number(rows[0]?.revision ?? 0) + 1;
        if (current.delivery_status === 'POSTED') {
          const nextLines: CountLine[] = lines.map((line) => ({
            ...line,
            declared_quantity: null,
            expiry_date: line.expiry_date ?? null,
            unit_scale: currentScales.get(line.item_id)!,
            has_count_line: true,
          }));
          assertHeldReleaseConserved(await this.countLines(manager, id, revision - 1), nextLines);
        }
        await manager.query('INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id,note) VALUES ($1,$2,$3,$4)',
          [id, revision, session.userId, note]);
        for (const line of lines) {
          await manager.query(
            `INSERT INTO receipt_count_line
               (receipt_id,revision,item_id,counted_quantity,accepted_quantity,held_quantity,rejected_quantity,condition_note,expiry_date)
             VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8,$9::date)`,
            [id, revision, line.item_id, line.counted_quantity, line.accepted_quantity, line.held_quantity,
              line.rejected_quantity, line.condition_note, line.expiry_date ?? null],
          );
        }
        await this.advanceReceiptVersion(manager, id, dto.expected_version);
        if (current.delivery_status !== 'POSTED') await this.setDeliveryStatus(manager, current.delivery_id, 'PENDING_REVIEW');
        await this.audit(manager, session.userId, 'DONATION_COUNT_RECORDED', 'donation_receipt', id,
          { version: Number(current.version), delivery_status: current.delivery_status }, { version: Number(current.version) + 1, count_revision: revision });
        return { status: 200, value: (await readReceiptView(manager, id)).value, resource: { type: 'donation_receipt', id } };
      },
      replay: async (manager, resource) => this.replayReceipt(manager, resource),
    });
  }

  async review(id: string, dto: ReviewDonationReceiptDto, request: ReceiptRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const receipt = await this.receiptContext(this.dataSource, id);
    requireReceiptPermission(session.grants, 'DONATION_REVIEW', receipt);
    const reason = cleanDriveText(dto.reason, dto.decision !== 'APPROVE');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-receipts.review',
      key: key(request),
      requestHash: canonicalRequestHash({ receipt_id: id, dto }),
      execute: async (manager) => {
        const current = await this.receiptContext(manager, id, true);
        requireReceiptPermission(session.grants, 'DONATION_REVIEW', current);
        expectVersion(current.version, dto.expected_version);
        const revisions = await this.currentRevisions(manager, id, current.delivery_id);
        if (revisions.count !== dto.count_revision || revisions.declaration !== dto.declaration_revision) {
          throw new AppError('STALE_REVISION', { status: 409 });
        }
        const prior = await manager.query(
          `SELECT decision FROM receipt_review WHERE receipt_id=$1 AND count_revision=$2 AND declaration_revision=$3 LIMIT 1`,
          [id, revisions.count, revisions.declaration],
        ) as Array<{ decision: string }>;
        if (prior[0]) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const counted = await manager.query(
          'SELECT 1 FROM receipt_count WHERE receipt_id=$1 AND counted_by_user_id=$2 LIMIT 1', [id, session.userId],
        ) as unknown[];
        if (counted.length) throw new AppError('SELF_REVIEW_FORBIDDEN', { status: 403 });

        await manager.query(
          `INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision,reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, current.delivery_id, revisions.count, revisions.declaration, session.userId, dto.decision, reason],
        );
        if (current.delivery_status !== 'POSTED') {
          const status = dto.decision === 'APPROVE' ? 'APPROVED' : dto.decision === 'REJECT' ? 'REJECTED' : 'COUNTING';
          await this.setDeliveryStatus(manager, current.delivery_id, status);
        }
        await this.advanceReceiptVersion(manager, id, dto.expected_version);
        if (dto.decision === 'APPROVE') await this.notifyReceiptDifference(manager, current, revisions.count, revisions.declaration);
        await this.audit(manager, session.userId, 'DONATION_RECEIPT_REVIEWED', 'donation_receipt', id,
          { version: Number(current.version) }, { version: Number(current.version) + 1, count_revision: revisions.count,
            declaration_revision: revisions.declaration, decision: dto.decision }, reason);
        return { status: 200, value: (await readReceiptView(manager, id)).value, resource: { type: 'donation_receipt', id } };
      },
      replay: async (manager, resource) => this.replayReceipt(manager, resource),
    });
  }

  async post(id: string, dto: PostDonationReceiptDto, request: ReceiptRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const receipt = await this.receiptContext(this.dataSource, id);
    requireReceiptPermission(session.grants, 'DONATION_REVIEW', receipt);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-receipts.post',
      key: key(request),
      requestHash: canonicalRequestHash({ receipt_id: id, dto }),
      execute: async (manager) => {
        const current = await this.receiptContext(manager, id, true);
        requireReceiptPermission(session.grants, 'DONATION_REVIEW', current);
        if (current.delivery_status === 'POSTED') throw new AppError('ALREADY_POSTED', { status: 409 });
        expectVersion(current.version, dto.expected_version);
        if (current.delivery_status !== 'APPROVED') throw new AppError('RECEIPT_NOT_APPROVED', { status: 409 });
        const revisions = await this.currentRevisions(manager, id, current.delivery_id);
        await this.assertApproved(manager, id, current.delivery_id, revisions);
        await this.assertNeverCounted(manager, id, session.userId);
        const lines = await this.acceptedLines(manager, id, revisions.count);
        await this.postAccepted(manager, id, current.warehouse_id, lines, session.userId, revisions.count);
        await this.setDeliveryStatus(manager, current.delivery_id, 'POSTED');
        await this.advanceReceiptVersion(manager, id, dto.expected_version);
        await this.audit(manager, session.userId, 'DONATION_RECEIPT_POSTED', 'donation_receipt', id,
          { version: Number(current.version), delivery_status: current.delivery_status }, { version: Number(current.version) + 1, count_revision: revisions.count });
        await this.notifyDonor(manager, current.donor_user_id, id, 1, 'DONATION_RECEIPT_POSTED', 'Hàng quyên góp đã được ghi nhận vào kho.');
        return { status: 200, value: (await readReceiptView(manager, id)).value, resource: { type: 'donation_receipt', id } };
      },
      replay: async (manager, resource) => this.replayReceipt(manager, resource),
    });
  }

  async releaseHeld(id: string, dto: ReleaseHeldDonationDto, request: ReceiptRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const receipt = await this.receiptContext(this.dataSource, id);
    requireReceiptPermission(session.grants, 'DONATION_REVIEW', receipt);
    const reason = cleanDriveText(dto.reason, true)!;

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-receipts.release-held',
      key: key(request),
      requestHash: canonicalRequestHash({ receipt_id: id, dto }),
      execute: async (manager) => {
        const current = await this.receiptContext(manager, id, true);
        requireReceiptPermission(session.grants, 'DONATION_REVIEW', current);
        expectVersion(current.version, dto.expected_version);
        if (current.delivery_status !== 'POSTED') throw new AppError('RECEIPT_NOT_APPROVED', { status: 409 });
        const revisions = await this.currentRevisions(manager, id, current.delivery_id);
        if (revisions.count !== dto.count_revision || revisions.declaration !== dto.declaration_revision) {
          throw new AppError('STALE_REVISION', { status: 409 });
        }
        await this.assertApproved(manager, id, current.delivery_id, revisions);
        await this.assertNeverCounted(manager, id, session.userId);
        if (revisions.count < 2) throw new AppError('VALIDATION_FAILED', { status: 400 });
        const previous = await this.countLines(manager, id, revisions.count - 1);
        const latest = await this.countLines(manager, id, revisions.count);
        assertHeldReleaseConserved(previous, latest);
        const accepted = await this.acceptedLines(manager, id, revisions.count);
        const posted = await this.postedQuantities(manager, id);
        const deltas = accepted.flatMap((line) => {
          const amount = receiptQuantityUnits(line.accepted_quantity, line.unit_scale) -
            receiptQuantityUnits(posted.get(line.item_id) ?? '0', line.unit_scale);
          if (amount < 0n) throw new AppError('VALIDATION_FAILED', { status: 400 });
          return amount > 0n ? [{ ...line, amount: decimalFromUnits(amount, line.unit_scale) }] : [];
        });
        if (deltas.length) {
          await this.postAccepted(manager, id, current.warehouse_id, deltas, session.userId, revisions.count, reason, true);
          await this.advanceReceiptVersion(manager, id, dto.expected_version);
          await this.audit(manager, session.userId, 'DONATION_HELD_RELEASED', 'donation_receipt', id,
            { version: Number(current.version) }, { version: Number(current.version) + 1, count_revision: revisions.count }, reason);
          await this.notifyDonor(manager, current.donor_user_id, id, revisions.count, 'DONATION_HELD_RELEASED', 'Hàng được giữ lại đã được duyệt bổ sung và ghi nhận vào kho.');
        }
        return { status: 200, value: (await readReceiptView(manager, id)).value, resource: { type: 'donation_receipt', id } };
      },
      replay: async (manager, resource) => this.replayReceipt(manager, resource),
    });
  }

  async resolveDispute(id: string, dto: ResolveDonationDisputeDto, request: ReceiptRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const initial = await this.disputeContext(this.dataSource, id);
    requireReceiptPermission(session.grants, 'DONATION_REVIEW', initial);
    const resolutionNote = cleanDriveText(dto.resolution_note, true)!;

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-disputes.resolve',
      key: key(request),
      requestHash: canonicalRequestHash({ dispute_id: id, dto }),
      execute: async (manager) => {
        const dispute = await this.disputeContext(manager, id, true);
        requireReceiptPermission(session.grants, 'DONATION_REVIEW', dispute);
        if (dispute.status !== 'OPEN') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updatedRows] = await manager.query(
          `UPDATE donation_dispute SET status='RESOLVED',resolution_note=$2,resolved_by_user_id=$3,resolved_at=now()
            WHERE id=$1 AND status='OPEN' RETURNING id,status,delivery_id,resolution_note,opened_at,resolved_at`,
          [id, resolutionNote, session.userId],
        ) as [Array<Record<string, unknown> & { id: string; delivery_id: string; resolved_at: Date | string }>, number];
        const disputeRow = updatedRows[0];
        if (!disputeRow) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        await this.notifyDonor(manager, dispute.donor_user_id, id, 1, 'DONATION_DISPUTE_RESOLVED', 'Ý kiến về phiếu nhận đã được xử lý.');
        await this.audit(manager, session.userId, 'DONATION_DISPUTE_RESOLVED', 'donation_dispute', id,
          { status: 'OPEN' }, { status: 'RESOLVED' }, resolutionNote);
        const value = { ...disputeRow, resolved_at: new Date(disputeRow.resolved_at).toISOString() };
        return { status: 200, value, resource: { type: 'donation_dispute', id } };
      },
      replay: async (manager, resource) => this.replayDispute(manager, resource),
    });
  }

  private assertCreateScope(grants: Parameters<typeof hasWarehouseScope>[0], delivery: DeliveryCreateContext): void {
    const target = delivery.selected_warehouse_id;
    if (!target || delivery.selected_organization_id !== delivery.organization_id || delivery.selected_region_code !== delivery.region_code) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if (delivery.selected_warehouse_status !== 'ACTIVE' && delivery.selected_warehouse_id !== delivery.intake_warehouse_id) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if (!hasWarehouseScope(grants, delivery.organization_id, delivery.region_code)) throw new AppError('NOT_FOUND', { status: 404 });
    requireWarehousePermission(grants, 'DONATION_INTAKE', delivery.organization_id, delivery.region_code);
  }

  private async deliveryForCreate(query: Pick<DataSource | EntityManager, 'query'>, deliveryId: string, warehouseId: string, lock = false): Promise<DeliveryCreateContext> {
    const rows = await query.query(
      `SELECT dd.id,dd.status,dd.version,d.id AS drive_id,d.status AS drive_status,d.organization_id,iw.region_code,
              d.intake_warehouse_id,tw.id AS selected_warehouse_id,tw.organization_id AS selected_organization_id,
              tw.region_code AS selected_region_code,tw.status AS selected_warehouse_status
         FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
         JOIN warehouse iw ON iw.id=d.intake_warehouse_id LEFT JOIN warehouse tw ON tw.id=$2
        WHERE dd.id=$1${lock ? ' FOR UPDATE OF dd' : ''}`,
      [deliveryId, warehouseId],
    ) as DeliveryCreateContext[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async receiptContext(query: Pick<DataSource | EntityManager, 'query'>, id: string, lock = false): Promise<ReceiptContext> {
    const rows = await query.query(
      `SELECT r.id,r.delivery_id,r.warehouse_id,r.version,dd.status AS delivery_status,dd.donor_user_id,
              w.organization_id,w.region_code,d.id AS drive_id
         FROM donation_receipt r JOIN donation_delivery dd ON dd.id=r.delivery_id
         JOIN donation_drive d ON d.id=dd.drive_id JOIN warehouse w ON w.id=r.warehouse_id
        WHERE r.id=$1${lock ? ' FOR UPDATE OF r' : ''}`,
      [id],
    ) as ReceiptContext[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async disputeContext(query: Pick<DataSource | EntityManager, 'query'>, id: string, lock = false): Promise<ReceiptContext & { status: string }> {
    const rows = await query.query(
      `SELECT dis.id,dis.status,dd.id AS delivery_id,dd.donor_user_id,w.organization_id,w.region_code,d.id AS drive_id
         FROM donation_dispute dis JOIN donation_delivery dd ON dd.id=dis.delivery_id
         JOIN donation_drive d ON d.id=dd.drive_id JOIN warehouse w ON w.id=d.intake_warehouse_id
        WHERE dis.id=$1${lock ? ' FOR UPDATE OF dis,dd' : ''}`,
      [id],
    ) as Array<ReceiptContext & { status: string }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async itemScales(query: Pick<DataSource | EntityManager, 'query'>, ids: string[]): Promise<Map<string, number>> {
    const rows = await query.query('SELECT i.id,u.scale FROM item i JOIN unit u ON u.code=i.unit_code WHERE i.id=ANY($1::uuid[])', [ids]) as Array<{ id: string; scale: number }>;
    if (rows.length !== ids.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
    return new Map(rows.map((row) => [row.id, Number(row.scale)]));
  }

  private validateLines(lines: readonly ReceiptCountLineDto[], scales: Map<string, number>): void {
    for (const line of lines) {
      const scale = scales.get(line.item_id);
      if (scale === undefined) throw new AppError('VALIDATION_FAILED', { status: 400 });
      validateCountSplit(line, scale);
    }
  }

  private async currentRevisions(query: Pick<DataSource | EntityManager, 'query'>, receiptId: string, deliveryId: string): Promise<{ count: number; declaration: number }> {
    const rows = await query.query(
      `SELECT (SELECT max(revision) FROM receipt_count WHERE receipt_id=$1) AS count,
              (SELECT max(revision) FROM donation_declaration WHERE delivery_id=$2) AS declaration`, [receiptId, deliveryId],
    ) as Array<{ count: number | null; declaration: number | null }>;
    const value = rows[0];
    if (!value?.count || !value.declaration) throw new AppError('RECEIPT_NOT_APPROVED', { status: 409 });
    return { count: Number(value.count), declaration: Number(value.declaration) };
  }

  private async assertApproved(
    manager: EntityManager,
    receiptId: string,
    deliveryId: string,
    revisions: { count: number; declaration: number },
  ): Promise<void> {
    const rows = await manager.query(
      `SELECT 1 FROM receipt_review WHERE receipt_id=$1 AND delivery_id=$2 AND count_revision=$3
         AND declaration_revision=$4 AND decision='APPROVE' LIMIT 1`,
      [receiptId, deliveryId, revisions.count, revisions.declaration],
    ) as unknown[];
    if (!rows.length) throw new AppError('RECEIPT_NOT_APPROVED', { status: 409 });
  }

  private async assertNeverCounted(manager: EntityManager, receiptId: string, actorId: string): Promise<void> {
    const rows = await manager.query('SELECT 1 FROM receipt_count WHERE receipt_id=$1 AND counted_by_user_id=$2 LIMIT 1', [receiptId, actorId]) as unknown[];
    if (rows.length) throw new AppError('SELF_REVIEW_FORBIDDEN', { status: 403 });
  }

  private async acceptedLines(manager: EntityManager, receiptId: string, revision: number): Promise<Array<{ item_id: string; accepted_quantity: string; unit_scale: number }>> {
    return manager.query(
      `SELECT rcl.item_id,rcl.accepted_quantity::text AS accepted_quantity,u.scale AS unit_scale
         FROM receipt_count_line rcl JOIN item i ON i.id=rcl.item_id JOIN unit u ON u.code=i.unit_code
        WHERE rcl.receipt_id=$1 AND rcl.revision=$2 ORDER BY rcl.item_id`, [receiptId, revision],
    ) as Promise<Array<{ item_id: string; accepted_quantity: string; unit_scale: number }>>;
  }

  private async countLines(manager: EntityManager, receiptId: string, revision: number): Promise<CountLine[]> {
    return manager.query(
      `SELECT rcl.item_id,rcl.counted_quantity::text AS counted_quantity,rcl.accepted_quantity::text AS accepted_quantity,
              rcl.held_quantity::text AS held_quantity,rcl.rejected_quantity::text AS rejected_quantity,
              rcl.expiry_date,rcl.condition_note,u.scale AS unit_scale,NULL::text AS declared_quantity,true AS has_count_line
         FROM receipt_count_line rcl JOIN item i ON i.id=rcl.item_id JOIN unit u ON u.code=i.unit_code
        WHERE rcl.receipt_id=$1 AND rcl.revision=$2 ORDER BY rcl.item_id`, [receiptId, revision],
    ) as Promise<CountLine[]>;
  }

  private async postedQuantities(manager: EntityManager, receiptId: string): Promise<Map<string, string>> {
    const rows = await manager.query(
      `SELECT b.item_id,COALESCE(sum(sm.delta_on_hand),0)::text AS quantity
         FROM stock_movement sm JOIN stock_balance b ON b.id=sm.balance_id
        WHERE sm.receipt_id=$1 AND sm.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE') GROUP BY b.item_id`,
      [receiptId],
    ) as Array<{ item_id: string; quantity: string }>;
    return new Map(rows.map((row) => [row.item_id, row.quantity]));
  }

  private async postAccepted(
    manager: EntityManager,
    receiptId: string,
    warehouseId: string,
    lines: Array<{ item_id: string; accepted_quantity?: string; amount?: string; unit_scale: number }>,
    actorId: string,
    revision: number,
    reason: string | null = null,
    heldRelease = false,
  ): Promise<void> {
    const amounts = lines.map((line) => ({
      item_id: line.item_id, quantity: line.amount ?? line.accepted_quantity!, unit_scale: line.unit_scale,
    })).filter((line) => receiptQuantityUnits(line.quantity, line.unit_scale) > 0n);
    amounts.sort((a, b) => a.item_id.localeCompare(b.item_id));
    for (const line of amounts) {
      await manager.query(
        'INSERT INTO stock_balance (warehouse_id,item_id) VALUES ($1,$2) ON CONFLICT (warehouse_id,item_id) DO NOTHING',
        [warehouseId, line.item_id],
      );
    }
    const balances = await manager.query(
      `SELECT id,item_id FROM stock_balance WHERE warehouse_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY warehouse_id,item_id`,
        [warehouseId, amounts.map((line) => line.item_id).sort()],
    ) as Array<{ id: string; item_id: string }>;
    const balanceByItem = new Map(balances.map((balance) => [balance.item_id, balance.id]));
    for (const line of amounts) {
      const balanceId = balanceByItem.get(line.item_id);
      if (!balanceId) throw new AppError('INTERNAL_ERROR', { status: 500 });
      await manager.query(
        `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id,reason)
         VALUES ($1,$2,$3::numeric,0,$4,$5,$6,$7)`,
        [balanceId, heldRelease ? 'RECEIPT_HELD_RELEASE' : 'RECEIPT', line.quantity, receiptId,
          heldRelease ? `RCPT_HELD:${receiptId}:${revision}:${line.item_id}` : `RCPT:${receiptId}:${line.item_id}`,
          actorId, heldRelease ? reason : null],
      );
    }
  }

  private async advanceReceiptVersion(manager: EntityManager, id: string, expectedVersion: number): Promise<void> {
    const rows = await manager.query(
      'UPDATE donation_receipt SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version', [id, expectedVersion],
    ) as Array<{ version: number }>;
    if (!rows[0]) {
      const current = await manager.query('SELECT version FROM donation_receipt WHERE id=$1', [id]) as Array<{ version: number }>;
      throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(current[0]?.version) } });
    }
  }

  private async setDeliveryStatus(manager: EntityManager, deliveryId: string, status: string): Promise<void> {
    await manager.query('UPDATE donation_delivery SET status=$2,version=version+1 WHERE id=$1 AND status<>$2', [deliveryId, status]);
  }

  private async notifyReceiptDifference(manager: EntityManager, receipt: ReceiptContext, countRevision: number, declarationRevision: number): Promise<void> {
    const lines = await readReceiptLines(manager, receipt.delivery_id, receipt.id);
    const flags = [...new Set(lines.flatMap((line) => line.flags as string[]).filter((flag) => flag !== 'MATCH'))];
    if (flags.length) {
      await this.notifyDonor(manager, receipt.donor_user_id, receipt.id, countRevision, 'DONATION_RECEIPT_DIFFERENCE',
        'Kết quả kiểm đếm có điểm cần lưu ý. Vui lòng xem thông tin cập nhật.',
        { flags, count_revision: countRevision, declaration_revision: declarationRevision });
    }
  }

  private async notifyDonor(
    manager: EntityManager,
    donorId: string | null,
    sourceId: string,
    sourceVersion: number,
    noticeType: string,
    message: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    if (!donorId) return;
    await manager.query(
      `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
       VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (source_id,source_version,recipient_user_id,notice_type) DO NOTHING`,
      [donorId, sourceId, sourceVersion, noticeType, JSON.stringify({ message, ...details })],
    );
  }

  private async audit(
    manager: EntityManager,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string | null = null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [actorId, action, entityType, entityId, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
    );
  }

  private async replayReceipt(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'donation_receipt') throw new AppError('INTERNAL_ERROR', { status: 500 });
    return (await readReceiptView(manager, resource.id)).value;
  }

  private async replayDispute(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'donation_dispute') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      'SELECT id,delivery_id,status,resolution_note,opened_at,resolved_at FROM donation_dispute WHERE id=$1', [resource.id],
    ) as Array<Record<string, unknown> & { resolved_at: Date | string | null }>;
    const dispute = rows[0];
    if (!dispute) throw new AppError('NOT_FOUND', { status: 404 });
    return { ...dispute, opened_at: new Date(dispute.opened_at as Date | string).toISOString(),
      resolved_at: dispute.resolved_at ? new Date(dispute.resolved_at).toISOString() : null };
  }
}
