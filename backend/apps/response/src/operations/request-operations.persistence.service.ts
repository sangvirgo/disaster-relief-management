import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import { hasPermission, Permission } from '../../../../packages/technical/src/permissions';
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
              reporter_declared_danger,priority,priority_basis,work_cycle,canonical_request_id,attribution_locked_at,incident_category_code
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
}
