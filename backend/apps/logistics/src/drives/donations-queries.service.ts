import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
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
