import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hasPermission, Permission } from '../../../../packages/identity-contracts/src/permissions';
import type { ReporterSession } from '../requests/reporter-session';
import type { OperationRequestRow } from './request-operations.types';

@Injectable()
export class RequestOperationsPersistenceService {
  async staffRequest(
    queryable: Pick<DataSource | EntityManager, 'query'>, requestId: string, session: ReporterSession,
    permission: Permission, lock = false,
  ): Promise<OperationRequestRow> {
    const rows = await queryable.query(
      `SELECT id,tracking_code,tracking_secret_hash,reporter_user_id,reporter_name,reporter_contact_phone,source_ip_hash,report_mode,
              status,version,review_lane,received_at,verifying_since,organization_id,region_code,campaign_id,description,
              reporter_declared_danger,needs_rescue,needs_relief_supplies,priority,priority_basis,work_cycle,canonical_request_id,attribution_locked_at,incident_category_code
         FROM assistance_request WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as OperationRequestRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    if (!hasPermission(session.grants, permission, { organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id })) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    return row;
  }

  async currentRequestValue(manager: EntityManager, requestId: string): Promise<Record<string, unknown>> {
    const rows = await manager.query(
      `SELECT id,status,version,region_code,campaign_id,priority,priority_basis,verification_revision,canonical_request_id
         FROM assistance_request WHERE id=$1`, [requestId],
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return { ...rows[0], version: Number(rows[0].version) };
  }

  async insertEvent(
    manager: EntityManager, requestId: string, actorUserId: string | null, eventType: string, visibility: 'REPORTER' | 'STAFF',
    fromStatus: string | null, toStatus: string | null, reason: string | null, payload: Record<string, unknown>,
  ): Promise<string> {
    const rows = await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
      [requestId, actorUserId, eventType, visibility, fromStatus, toStatus, reason, JSON.stringify(payload)],
    ) as Array<{ id: string }>;
    if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return rows[0].id;
  }

  async notifyReporter(
    manager: EntityManager, recipientId: string | null, requestId: string, version: number, type: string, textCode: string,
  ): Promise<void> {
    if (!recipientId) return;
    await manager.query(
      `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
       VALUES ($1,$2,$3,$4,jsonb_build_object('text_code',$5::text,'request_id',$2::uuid)) ON CONFLICT DO NOTHING`,
      [recipientId, requestId, version, type, textCode],
    );
  }
}
