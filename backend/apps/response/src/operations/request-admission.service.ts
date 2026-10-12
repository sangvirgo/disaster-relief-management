import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import { hasPendingSupplement } from './request-operations.verification.helpers';

interface AdmissionRequestRow {
  id: string;
  status: string;
  work_cycle: number;
  version: number | string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  attribution_locked_at: Date | string | null;
  logistics_admitted_at: Date | string | null;
}

@Injectable()
export class RequestAdmissionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
  ) {}

  async admit(requestId: string, workCycle: number, request: Request): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(workCycle) || workCycle < 1) throw new AppError('VALIDATION_FAILED', { status: 400 });
    const session = await this.sessions.require(request);
    return this.dataSource.transaction(async (manager) => {
      const row = await this.findRequest(manager, requestId);
      if (!hasPermission(session.grants, 'NEED_MANAGE', {
        organizationId: row.organization_id,
        regionCode: row.region_code,
        campaignId: row.campaign_id,
      })) throw new AppError('FORBIDDEN', { status: 403 });
      if (Number(row.work_cycle) !== workCycle) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
      if (!['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(row.status)) {
        throw new AppError('REQUEST_NOT_VERIFIED', { status: 409 });
      }
      if (await hasPendingSupplement(manager, row.id)) throw new AppError('PENDING_SUPPLEMENT_REVIEW', { status: 409 });

      if (!row.logistics_admitted_at) {
        const [updated] = await manager.query(
          `UPDATE assistance_request
              SET attribution_locked_at=COALESCE(attribution_locked_at,clock_timestamp()),
                  logistics_admitted_at=clock_timestamp(),version=version+1
            WHERE id=$1 AND logistics_admitted_at IS NULL
              RETURNING id,status,work_cycle,version,organization_id,region_code,campaign_id,
                      attribution_locked_at,logistics_admitted_at`,
          [requestId],
        ) as [AdmissionRequestRow[], number];
        if (!updated[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return this.view(updated[0]);
      }

      return this.view(row);
    });
  }

  private async findRequest(manager: Pick<EntityManager, 'query'>, requestId: string): Promise<AdmissionRequestRow> {
    const rows = await manager.query(
      `SELECT id,status,work_cycle,version,organization_id,region_code,campaign_id,attribution_locked_at,logistics_admitted_at
         FROM assistance_request WHERE id=$1 FOR UPDATE`,
      [requestId],
    ) as AdmissionRequestRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private view(row: AdmissionRequestRow): Record<string, unknown> {
    return {
      request_id: row.id,
      work_cycle: Number(row.work_cycle),
      version: Number(row.version),
      status: row.status,
      organization_id: row.organization_id,
      region_code: row.region_code,
      campaign_id: row.campaign_id,
    };
  }
}
