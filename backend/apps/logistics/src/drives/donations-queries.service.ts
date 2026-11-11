import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { GuestDonationLookupDto, MyDonationPageQueryDto } from './donations.dto';
import { LogisticsSessionService, AuthenticatedLogisticsSession } from '../auth/logistics-session.service';
import { DONATION_SECRET_CONFIG, DonationSecretConfig, verifyDonationCapability } from './donations.helpers';
import { readReceiptLines } from '../receipts/donation-receipts.read';

interface DeliveryAccessRow {
  id: string;
  drive_id: string;
  public_code: string;
  donor_user_id: string | null;
  donor_name: string;
  donor_phone: string;
  capability_hash: string | null;
  status: string;
  version: number | string;
}

@Injectable()
export class DonationsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
    @Inject(DONATION_SECRET_CONFIG) private readonly secretConfig: DonationSecretConfig,
  ) {}

  async track(id: string, secret: string | undefined, request: Request): Promise<Record<string, unknown>> {
    const session = await this.optionalSession(request);
    const delivery = await this.findDelivery(id);
    this.assertDonorAccess(delivery, session, secret);
    const declarations = await this.dataSource.query(
      `SELECT revision,created_by_kind FROM donation_declaration WHERE delivery_id=$1 ORDER BY revision DESC LIMIT 1`,
      [id],
    ) as Array<{ revision: number; created_by_kind: string }>;
    const declaration = declarations[0];
    const lines = declaration ? await this.dataSource.query(
      `SELECT dl.item_id,i.name AS item_name,u.display_name AS unit_name,dl.declared_quantity::text AS declared_quantity
         FROM donation_line dl JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
        WHERE dl.delivery_id=$1 AND dl.revision=$2 ORDER BY i.name,dl.item_id`,
      [id, declaration.revision],
    ) as Array<Record<string, unknown>> : [];
    const receipt = await this.currentReceipt(id);
    const disputes = await this.dataSource.query(
      `SELECT id,status,reason,opened_at,resolution_note FROM donation_dispute WHERE delivery_id=$1 ORDER BY opened_at,id`,
      [id],
    ) as Array<Record<string, unknown>>;
    return {
      id: delivery.id,
      public_code: delivery.public_code,
      status: delivery.status,
      declaration: { revision: declaration?.revision ?? null, created_by_kind: declaration?.created_by_kind ?? null, lines },
      receipt,
      disputes,
      progress: { status: delivery.status },
    };
  }

  async listMine(query: MyDonationPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = { route: 'logistics.donations.mine', user_id: session.userId, status: query.status ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    const [sort] = cursor?.sort ?? [];
    if (cursor && (cursor.sort.length !== 1 || typeof sort !== 'string' || Number.isNaN(Date.parse(sort)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor.id))) {
      throw new AppError('CURSOR_INVALID', { status: 400 });
    }
    const values: unknown[] = [session.userId];
    const conditions = ['dd.donor_user_id=$1'];
    if (query.status) conditions.push(`dd.status=$${values.push(query.status)}`);
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(dd.created_at,dd.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT dd.id,dd.drive_id,d.title AS drive_title,dd.public_code,dd.status,dd.version,dd.created_at,
              EXISTS(SELECT 1 FROM donation_receipt r WHERE r.delivery_id=dd.id) AS has_count_result,
              to_char(dd.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
         FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
        WHERE ${conditions.join(' AND ')} ORDER BY dd.created_at DESC,dd.id DESC LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & { id: string; cursor_at: string }>;
    const items = rows.slice(0, limit);
    const more = rows.length > limit;
    const last = items.at(-1);
    return {
      items: items.map(({ cursor_at: _cursorAt, ...row }) => ({
        ...row,
        created_at: new Date(row.created_at as Date | string).toISOString(),
        version: Number(row.version),
      })),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_at], last.id, filters) } : {}),
    };
  }

  /** Guest lookup: each id is returned only when its own secret verifies; failures are indistinguishable. */
  async lookupGuest(dto: GuestDonationLookupDto): Promise<Record<string, unknown>> {
    const ids = [...new Set(dto.items.map((item) => item.id))];
    const rows = await this.dataSource.query(
      `SELECT dd.id,dd.drive_id,d.title AS drive_title,dd.public_code,dd.status,dd.version,dd.created_at,dd.capability_hash,
              EXISTS(SELECT 1 FROM donation_receipt r WHERE r.delivery_id=dd.id) AS has_count_result
         FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
        WHERE dd.id=ANY($1::uuid[]) AND dd.donor_user_id IS NULL`,
      [ids],
    ) as Array<Record<string, unknown> & { id: string; capability_hash: string | null }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items: Array<Record<string, unknown>> = [];
    const unavailable: string[] = [];
    for (const requested of dto.items) {
      const row = byId.get(requested.id);
      if (row && verifyDonationCapability(requested.secret, row.capability_hash, this.secretConfig)) {
        const { capability_hash: _hash, ...safe } = row;
        if (!items.some((item) => item.id === safe.id)) {
          items.push({ ...safe, created_at: new Date(safe.created_at as Date | string).toISOString(), version: Number(safe.version) });
        }
      } else if (!unavailable.includes(requested.id)) {
        unavailable.push(requested.id);
      }
    }
    items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { items, unavailable };
  }

  private async optionalSession(request: Request): Promise<AuthenticatedLogisticsSession | null> {
    return request.headers.authorization || request.headers.cookie ? this.sessions.require(request) : null;
  }

  private async findDelivery(id: string): Promise<DeliveryAccessRow> {
    const rows = await this.dataSource.query(
      `SELECT id,drive_id,public_code,donor_user_id,donor_name,donor_phone,capability_hash,status,version
         FROM donation_delivery WHERE id=$1`,
      [id],
    ) as DeliveryAccessRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private assertDonorAccess(
    delivery: DeliveryAccessRow,
    session: AuthenticatedLogisticsSession | null,
    secret: string | undefined,
  ): void {
    if (session && delivery.donor_user_id === session.userId) return;
    if (verifyDonationCapability(secret, delivery.capability_hash, this.secretConfig)) return;
    throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
  }

  private async currentReceipt(id: string): Promise<Record<string, unknown> | null> {
    const rows = await this.dataSource.query(
      `SELECT r.id,rc.revision AS count_revision
         FROM donation_receipt r JOIN receipt_count rc ON rc.receipt_id=r.id
        WHERE r.delivery_id=$1 ORDER BY rc.revision DESC LIMIT 1`,
      [id],
    ) as Array<{ id: string; count_revision: number }>;
    const current = rows[0];
    if (!current) return null;
    return {
      count_revision: Number(current.count_revision),
      lines: (await readReceiptLines(this.dataSource, id, current.id, Number(current.count_revision))).map((line) => ({
        item_id: line.item_id,
        declared_quantity: line.declared_quantity,
        counted_quantity: line.counted_quantity,
        accepted_quantity: line.accepted_quantity,
        held_quantity: line.held_quantity,
        rejected_quantity: line.rejected_quantity,
        condition_note: line.condition_note,
      })),
    };
  }
}
