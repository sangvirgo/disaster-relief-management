import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef } from '@c48/technical/idempotency/idempotency';
import { hashPurposeBoundSecret } from '@c48/technical/security/secret-hash';
import { validateQuantity } from '../common/quantity';
import { LogisticsSessionService, AuthenticatedLogisticsSession } from '../auth/logistics-session.service';
import {
  CreateDonationDeliveryDto, DeclarationRevisionDto, DonationRecoveryIssueDto, DonationRecoveryRedeemDto,
  OpenDonationDisputeDto, DonationLineDto,
} from './donations.dto';
import { DonationPhoneThrottle } from './donation-phone-throttle.service';
import { assertDriveWindow, assertExpectedVersion, cleanDriveText, generatePublicCode, requireDrivePermission } from './drives.helpers';
import { DONATION_SECRET_CONFIG, DonationSecretConfig, donationCapabilityHash, verifyDonationCapability } from './donations.helpers';
import { requireIdempotencyKey as key } from '@c48/technical/http/response-headers';

export type DonationCommandRequest = Request & { idempotencyKey?: string };

interface DeliveryRow {
  id: string;
  drive_id: string;
  organization_id: string;
  region_code: string;
  public_code: string;
  donor_user_id: string | null;
  donor_name: string;
  donor_phone: string;
  capability_hash: string | null;
  status: string;
  version: number | string;
  opens_at?: Date | string | null;
  closes_at?: Date | string | null;
  campaign_status?: string | null;
}

function validRecoveryCode(code: string | undefined): code is string {
  if (!code || !/^[A-Za-z0-9_-]{43}$/u.test(code)) return false;
  const bytes = Buffer.from(code, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === code;
}

function hasCredential(request: Request): boolean {
  return Boolean(request.headers.authorization || request.headers.cookie);
}

function validateLines(lines: DonationLineDto[]): void {
  if (lines.length < 1 || lines.length > 50 || new Set(lines.map((line) => line.item_id)).size !== lines.length) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
}

function donationState(row: DeliveryRow): Record<string, unknown> {
  return { id: row.id, drive_id: row.drive_id, status: row.status, donor_user_id: row.donor_user_id, version: Number(row.version) };
}

async function writeAudit(
  manager: Pick<EntityManager, 'query'>,
  actorId: string | null,
  action: string,
  row: DeliveryRow,
  after: Record<string, unknown>,
  reason: string | null = null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'donation_delivery',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, row.id, JSON.stringify(donationState(row)), JSON.stringify(after), reason],
  );
}

@Injectable()
export class DonationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    @Inject(DONATION_SECRET_CONFIG) private readonly secretConfig: DonationSecretConfig,
    private readonly phoneThrottle: DonationPhoneThrottle,
  ) {}

  async createDelivery(
    driveId: string,
    dto: CreateDonationDeliveryDto,
    secret: string | undefined,
    request: DonationCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.optionalSession(request);
    const capabilityHash = donationCapabilityHash(secret, this.secretConfig);
    if (!session && !capabilityHash) throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
    const donorName = cleanDriveText(dto.donor_name, true)!;
    const donorPhone = dto.donor_phone;
    if (!/^\+?[0-9]{8,15}$/u.test(donorPhone)) throw new AppError('VALIDATION_FAILED', { status: 400 });
    validateLines(dto.lines);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: session ? `user:${session.userId}` : `donation-capability:${capabilityHash}`,
      command: 'logistics.donation-deliveries.create',
      key: key(request),
      requestHash: canonicalRequestHash({ drive_id: driveId, dto }, capabilityHash ?? undefined),
      databaseErrorMappings: { unique: { delivery_capability_uq: 'DONATION_SECRET_IN_USE' } },
      execute: async (manager) => {
        const driveRows = await manager.query(
          `SELECT d.id,d.organization_id,d.status,d.opens_at,d.closes_at,d.campaign_status
             FROM donation_drive d WHERE d.id=$1 FOR UPDATE`,
          [driveId],
        ) as Array<{ id: string; organization_id: string; status: string; opens_at: Date | string | null; closes_at: Date | string | null; campaign_status: string | null }>;
        const drive = driveRows[0];
        if (!drive) throw new AppError('NOT_FOUND', { status: 404 });
        if (drive.status !== 'OPEN') throw new AppError('DRIVE_NOT_OPEN', { status: 409 });
        assertDriveWindow(drive.opens_at, drive.closes_at);
        if (drive.campaign_status && drive.campaign_status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
        await this.validateDriveLines(manager, driveId, dto.lines);
        this.phoneThrottle.assertAllowed(donorPhone);
        const publicCode = generatePublicCode();
        const rows = await manager.query(
          `INSERT INTO donation_delivery
             (public_code,drive_id,organization_id,donor_user_id,donor_name,donor_phone,capability_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,public_code`,
          [publicCode, driveId, drive.organization_id, session?.userId ?? null, donorName, donorPhone, capabilityHash],
        ) as Array<{ id: string; public_code: string }>;
        const delivery = rows[0]!;
        await manager.query(
          `INSERT INTO donation_declaration (delivery_id,revision,created_by_kind,created_by_user_id)
           VALUES ($1,1,'DONOR',$2)`,
          [delivery.id, session?.userId ?? null],
        );
        await this.insertDeclarationLines(manager, delivery.id, 1, dto.lines);
        return {
          status: 201,
          value: { id: delivery.id, public_code: delivery.public_code, status: 'DECLARED', declaration_revision: 1 },
          resource: { type: 'donation_delivery', id: delivery.id },
        };
      },
      replay: (manager, resource) => this.replayCreation(manager, resource),
    });
  }

  async reviseDeclaration(
    id: string,
    dto: DeclarationRevisionDto,
    secret: string | undefined,
    request: DonationCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.optionalSession(request);
    const capabilityHash = donationCapabilityHash(secret, this.secretConfig);
    validateLines(dto.lines);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: this.donorScope(id, session, capabilityHash),
      command: 'logistics.donation-declarations.revise',
      key: key(request),
      requestHash: canonicalRequestHash({ id, dto }, capabilityHash ?? undefined),
      execute: async (manager) => {
        const delivery = await this.findDelivery(manager, id, true);
        this.assertDonorAccess(delivery, session, secret);
        assertExpectedVersion(delivery.version, dto.expected_version);
        if (delivery.status !== 'DECLARED') throw new AppError('DECLARATION_LOCKED', { status: 409 });
        const revision = await this.nextDeclarationRevision(manager, id);
        await this.validateDriveLines(manager, delivery.drive_id, dto.lines);
        await this.insertDeclaration(manager, delivery, revision, 'DONOR', session?.userId ?? null, dto.lines);
        const [updated] = await manager.query(
          'UPDATE donation_delivery SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version',
          [id, dto.expected_version],
        ) as [Array<{ version: number }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        return {
          status: 200,
          value: { id, status: 'DECLARED', declaration_revision: revision, version: Number(updated[0].version) },
          resource: { type: 'donation_delivery', id },
        };
      },
      replay: (manager, resource) => this.replayDelivery(manager, resource),
    });
  }

  async openDispute(
    id: string,
    dto: OpenDonationDisputeDto,
    secret: string | undefined,
    request: DonationCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.optionalSession(request);
    const capabilityHash = donationCapabilityHash(secret, this.secretConfig);
    const reason = cleanDriveText(dto.reason, true)!;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: this.donorScope(id, session, capabilityHash),
      command: 'logistics.donation-disputes.open',
      key: key(request),
      requestHash: canonicalRequestHash({ id, reason }, capabilityHash ?? undefined),
      execute: async (manager) => {
        const delivery = await this.findDelivery(manager, id, true);
        this.assertDonorAccess(delivery, session, secret);
        const rows = await manager.query(
          `INSERT INTO donation_dispute (delivery_id,opened_by_kind,opened_by_user_id,reason)
           VALUES ($1,'DONOR',$2,$3) RETURNING id,status,reason,opened_at`,
          [id, session?.userId ?? null, reason],
        ) as Array<Record<string, unknown> & { id: string }>;
        return { status: 201, value: rows[0]!, resource: { type: 'donation_dispute', id: rows[0]!.id } };
      },
      replay: (manager, resource) => this.replayDispute(manager, resource),
    });
  }

  async claim(id: string, secret: string | undefined, request: DonationCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    donationCapabilityHash(secret, this.secretConfig);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-deliveries.claim',
      key: key(request),
      requestHash: canonicalRequestHash({ id }, secret),
      execute: async (manager) => {
        const delivery = await this.findDelivery(manager, id, true);
        if (delivery.donor_user_id) throw new AppError('ALREADY_CLAIMED', { status: 409 });
        if (!verifyDonationCapability(secret, delivery.capability_hash, this.secretConfig)) {
          throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
        }
        const [updated] = await manager.query(
          `UPDATE donation_delivery SET donor_user_id=$2,capability_hash=NULL,version=version+1
            WHERE id=$1 AND donor_user_id IS NULL RETURNING status,version`,
          [id, session.userId],
        ) as [Array<{ status: string; version: number }>, number];
        if (!updated[0]) throw new AppError('ALREADY_CLAIMED', { status: 409 });
        const value = { id, public_code: delivery.public_code, status: updated[0].status, donor_user_id: session.userId, version: Number(updated[0].version) };
        await writeAudit(manager, session.userId, 'DONATION_CLAIMED', delivery, value);
        return { status: 200, value, resource: { type: 'donation_delivery', id } };
      },
      replay: (manager, resource) => this.replayDelivery(manager, resource),
    });
  }

  async assistedDeclaration(
    id: string,
    dto: DeclarationRevisionDto,
    request: DonationCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    validateLines(dto.lines);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-declarations.assisted',
      key: key(request),
      requestHash: canonicalRequestHash({ id, dto }),
      execute: async (manager) => {
        const delivery = await this.findDelivery(manager, id, true);
        requireDrivePermission(session, 'DONATION_INTAKE', delivery);
        assertExpectedVersion(delivery.version, dto.expected_version);
        if (delivery.status !== 'DECLARED') throw new AppError('DECLARATION_LOCKED', { status: 409 });
        const revision = await this.nextDeclarationRevision(manager, id);
        await this.validateDriveLines(manager, delivery.drive_id, dto.lines);
        await this.insertDeclaration(manager, delivery, revision, 'STAFF_ASSISTED', session.userId, dto.lines);
        const [updated] = await manager.query(
          'UPDATE donation_delivery SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version',
          [id, dto.expected_version],
        ) as [Array<{ version: number }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const value = { id, status: 'DECLARED', declaration_revision: revision, created_by_kind: 'STAFF_ASSISTED', version: Number(updated[0].version) };
        await writeAudit(manager, session.userId, 'DONATION_ASSISTED_DECLARATION', delivery, value);
        return { status: 201, value, resource: { type: 'donation_delivery', id } };
      },
      replay: (manager, resource) => this.replayDelivery(manager, resource),
    });
  }

  async revokeCapability(id: string, request: DonationCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-capability.revoke',
      key: key(request),
      requestHash: canonicalRequestHash({ id }),
      execute: async (manager) => {
        const delivery = await this.findDelivery(manager, id, true);
        requireDrivePermission(session, 'DONATION_INTAKE', delivery);
        if (delivery.capability_hash) {
          const [updated] = await manager.query(
            'UPDATE donation_delivery SET capability_hash=NULL,version=version+1 WHERE id=$1 AND capability_hash IS NOT NULL RETURNING version',
            [id],
          ) as [Array<{ version: number }>, number];
          const value = { id, capability_revoked: true, version: Number(updated[0]?.version ?? delivery.version) };
          await writeAudit(manager, session.userId, 'DONATION_CAPABILITY_REVOKED', delivery, value, 'CAPABILITY_REVOKED');
          return { status: 200, value, resource: { type: 'donation_delivery', id } };
        }
        return { status: 200, value: { id, capability_revoked: false, version: Number(delivery.version) }, resource: { type: 'donation_delivery', id } };
      },
      replay: (manager, resource) => this.replayDelivery(manager, resource),
    });
  }

  async issueRecovery(
    id: string,
    dto: DonationRecoveryIssueDto,
    request: DonationCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-capability.recovery.issue',
      key: key(request),
      requestHash: canonicalRequestHash({ delivery_id: id, dto, user_id: session.userId }),
      execute: async (manager) => {
        const delivery = await this.findDelivery(manager, id, true);
        requireDrivePermission(session, 'DONATION_INTAKE', delivery);
        assertExpectedVersion(delivery.version, dto.expected_version);
        if (delivery.donor_user_id) throw new AppError('ALREADY_CLAIMED', { status: 409 });

        const recoveryCode = randomBytes(32).toString('base64url');
        const codeHash = hashPurposeBoundSecret(
          recoveryCode, `donation-recovery:${id}`, this.secretConfig.peppers, this.secretConfig.currentPepperVersion,
        );
        const rows = await manager.query(
          `INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis,source_note)
           VALUES ($1,$2,clock_timestamp()+interval '30 minutes',$3,$4,$5) RETURNING id,expires_at`,
          [id, codeHash, session.userId, dto.confirmation_basis, dto.source_note ?? null],
        ) as Array<{ id: string; expires_at: Date | string }>;
        const issuance = rows[0];
        if (!issuance) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await manager.query(
          `UPDATE capability_recovery SET consumed_at=clock_timestamp(),consumed_by_user_id=$2
            WHERE delivery_id=$1 AND id<>$3 AND consumed_at IS NULL`,
          [id, session.userId, issuance.id],
        );
        const [updated] = await manager.query(
          'UPDATE donation_delivery SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version',
          [id, dto.expected_version],
        ) as [Array<{ version: number }>, number];
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        await writeAudit(manager, session.userId, 'CAPABILITY_RECOVERY_ISSUED', delivery, {
          id, version: Number(updated[0].version), issuance_id: issuance.id,
        }, dto.reason);
        return {
          status: 201,
          value: { issuance_id: issuance.id, recovery_code: recoveryCode, expires_at: new Date(issuance.expires_at).toISOString() },
          resource: { type: 'capability_recovery', id: issuance.id },
        };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'capability_recovery') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query(
          'SELECT id,expires_at FROM capability_recovery WHERE id=$1', [resource.id],
        ) as Array<{ id: string; expires_at: Date | string }>;
        const issuance = rows[0];
        if (!issuance) throw new AppError('NOT_FOUND', { status: 404 });
        return { issuance_id: issuance.id, expires_at: new Date(issuance.expires_at).toISOString() };
      },
    });
  }

  async recover(
    dto: DonationRecoveryRedeemDto,
    recoveryCode: string | undefined,
    request: DonationCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const deliveries = await this.dataSource.query(
      'SELECT id FROM donation_delivery WHERE public_code=$1', [dto.public_code],
    ) as Array<{ id: string }>;
    const deliveryId = deliveries[0]?.id;
    if (!deliveryId) throw new AppError('NOT_FOUND', { status: 404 });
    const codeHash = validRecoveryCode(recoveryCode)
      ? hashPurposeBoundSecret(recoveryCode, `donation-recovery:${deliveryId}`, this.secretConfig.peppers, this.secretConfig.currentPepperVersion)
      : null;

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.donation-capability.recovery.redeem',
      key: key(request),
      requestHash: canonicalRequestHash({ public_code: dto.public_code }, codeHash ?? undefined),
      execute: async (manager) => {
        const rows = await manager.query(
          `SELECT id,drive_id,organization_id,public_code,donor_user_id,donor_name,donor_phone,
                  capability_hash,status,version,w.region_code
             FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
             JOIN warehouse w ON w.id=d.intake_warehouse_id WHERE dd.id=$1 FOR UPDATE OF dd`,
          [deliveryId],
        ) as DeliveryRow[];
        const delivery = rows[0];
        if (!delivery) throw new AppError('NOT_FOUND', { status: 404 });
        if (!codeHash) throw new AppError('NOT_FOUND', { status: 404 });
        const recoveryRows = await manager.query(
          `SELECT id FROM capability_recovery
            WHERE delivery_id=$1 AND code_hash=$2 AND expires_at>clock_timestamp() AND consumed_at IS NULL
            FOR UPDATE`,
          [deliveryId, codeHash],
        ) as Array<{ id: string }>;
        const recovery = recoveryRows[0];
        if (!recovery) throw new AppError('NOT_FOUND', { status: 404 });
        if (delivery.donor_user_id) throw new AppError('ALREADY_CLAIMED', { status: 409 });
        await manager.query(
          `UPDATE capability_recovery SET consumed_at=clock_timestamp(),consumed_by_user_id=$2
            WHERE id=$1 AND consumed_at IS NULL`,
          [recovery.id, session.userId],
        );
        const [updated] = await manager.query(
          `UPDATE donation_delivery SET donor_user_id=$2,capability_hash=NULL,version=version+1
            WHERE id=$1 AND donor_user_id IS NULL RETURNING status,version`,
          [deliveryId, session.userId],
        ) as [Array<{ status: string; version: number }>, number];
        if (!updated[0]) throw new AppError('ALREADY_CLAIMED', { status: 409 });
        const value = {
          id: delivery.id, public_code: delivery.public_code, status: updated[0].status,
          donor_user_id: session.userId, capability_revoked: true, version: Number(updated[0].version),
        };
        await writeAudit(manager, session.userId, 'DONATION_CAPABILITY_RECOVERED', delivery, value);
        return { status: 200, value, resource: { type: 'donation_delivery', id: deliveryId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'donation_delivery') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query(
          'SELECT id,public_code,status,donor_user_id,version FROM donation_delivery WHERE id=$1', [resource.id],
        ) as Array<{ id: string; public_code: string; status: string; donor_user_id: string | null; version: number }>;
        const delivery = rows[0];
        if (!delivery) throw new AppError('NOT_FOUND', { status: 404 });
        return { ...delivery, capability_revoked: true, version: Number(delivery.version) };
      },
    });
  }

  private async optionalSession(request: Request): Promise<AuthenticatedLogisticsSession | null> {
    return hasCredential(request) ? this.sessions.require(request) : null;
  }

  private assertDonorAccess(delivery: DeliveryRow, session: AuthenticatedLogisticsSession | null, secret: string | undefined): void {
    if (session && delivery.donor_user_id === session.userId) return;
    if (verifyDonationCapability(secret, delivery.capability_hash, this.secretConfig)) return;
    throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
  }

  private donorScope(id: string, session: AuthenticatedLogisticsSession | null, capabilityHash: string | null): string {
    if (session) return `user:${session.userId}`;
    if (!capabilityHash) throw new AppError('DONATION_SECRET_INVALID', { status: 400 });
    return `donation-capability:${id}:${capabilityHash}`;
  }

  private async findDelivery(
    query: Pick<DataSource, 'query'> | Pick<EntityManager, 'query'>,
    id: string,
    forUpdate = false,
  ): Promise<DeliveryRow> {
    const rows = await query.query(
      `SELECT dd.id,dd.drive_id,dd.organization_id,dd.public_code,dd.donor_user_id,dd.donor_name,dd.donor_phone,
              dd.capability_hash,dd.status,dd.version,w.region_code,d.opens_at,d.closes_at,d.campaign_status
         FROM donation_delivery dd JOIN donation_drive d ON d.id=dd.drive_id
         JOIN warehouse w ON w.id=d.intake_warehouse_id WHERE dd.id=$1${forUpdate ? ' FOR UPDATE OF dd' : ''}`,
      [id],
    ) as DeliveryRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async validateDriveLines(manager: Pick<EntityManager, 'query'>, driveId: string, lines: DonationLineDto[]): Promise<void> {
    const rows = await manager.query(
      `SELECT di.item_id,u.scale FROM drive_item di JOIN item i ON i.id=di.item_id JOIN unit u ON u.code=i.unit_code
        WHERE di.drive_id=$1 AND di.item_id=ANY($2::uuid[]) AND i.status='ACTIVE'`,
      [driveId, lines.map((line) => line.item_id)],
    ) as Array<{ item_id: string; scale: number }>;
    if (rows.length !== lines.length) throw new AppError('ITEM_NOT_ON_DRIVE', { status: 400 });
    const scales = new Map(rows.map((row) => [row.item_id, row.scale]));
    for (const line of lines) validateQuantity(line.declared_quantity, scales.get(line.item_id)!);
  }

  private async insertDeclarationLines(manager: Pick<EntityManager, 'query'>, deliveryId: string, revision: number, lines: DonationLineDto[]): Promise<void> {
    for (const line of lines) {
      await manager.query(
        'INSERT INTO donation_line (delivery_id,revision,item_id,declared_quantity) VALUES ($1,$2,$3,$4)',
        [deliveryId, revision, line.item_id, line.declared_quantity],
      );
    }
  }

  private async insertDeclaration(
    manager: Pick<EntityManager, 'query'>,
    delivery: DeliveryRow,
    revision: number,
    kind: 'DONOR' | 'STAFF_ASSISTED',
    actorId: string | null,
    lines: DonationLineDto[],
  ): Promise<void> {
    await manager.query(
      'INSERT INTO donation_declaration (delivery_id,revision,created_by_kind,created_by_user_id) VALUES ($1,$2,$3,$4)',
      [delivery.id, revision, kind, actorId],
    );
    await this.insertDeclarationLines(manager, delivery.id, revision, lines);
  }

  private async nextDeclarationRevision(manager: Pick<EntityManager, 'query'>, id: string): Promise<number> {
    const rows = await manager.query(
      'SELECT COALESCE(MAX(revision),0)::int AS revision FROM donation_declaration WHERE delivery_id=$1',
      [id],
    ) as Array<{ revision: number }>;
    return Number(rows[0]?.revision ?? 0) + 1;
  }

  private async replayCreation(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'donation_delivery') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query('SELECT id,public_code FROM donation_delivery WHERE id=$1', [resource.id]) as Array<{ id: string; public_code: string }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return { id: rows[0].id, public_code: rows[0].public_code, status: 'DECLARED', declaration_revision: 1 };
  }

  private async replayDelivery(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'donation_delivery') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      'SELECT id,public_code,status,donor_user_id,version FROM donation_delivery WHERE id=$1',
      [resource.id],
    ) as Array<{ id: string; public_code: string; status: string; donor_user_id: string | null; version: number }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return { ...rows[0], version: Number(rows[0].version) };
  }

  private async replayDispute(manager: EntityManager, resource: ResourceRef | null): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'donation_dispute') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query('SELECT id,status,reason,opened_at FROM donation_dispute WHERE id=$1', [resource.id]) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }
}
