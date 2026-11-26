import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { ReporterSessionService } from '../requests/reporter-session';
import { hasPendingSupplement } from './request-operations.verification.helpers';
import { canAccessRequest } from '../requests/request-scope';

interface AdmissionRequestRow {
  id: string;
  status: string;
  work_cycle: number;
  version: number | string;
  campaign_id: string | null;
  needs_relief_supplies: boolean;
  attribution_locked_at: Date | string | null;
  logistics_admitted_at: Date | string | null;
}

interface AdmissionSubjectCounts {
  people_affected: number | null;
  children_count: number | null;
  elderly_count: number | null;
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
      if (!canAccessRequest(session, 'NEED_MANAGE', row) && !canAccessRequest(session, 'MISSION_RECORD_ON_BEHALF', row) &&
          !(await this.isActiveMissionMember(manager, requestId, workCycle, session.userId))) {
        throw new AppError('FORBIDDEN', { status: 403 });
      }
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
              RETURNING id,status,work_cycle,version,campaign_id,needs_relief_supplies,
                      attribution_locked_at,logistics_admitted_at`,
          [requestId],
        ) as [AdmissionRequestRow[], number];
        if (!updated[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return this.view(updated[0], await this.subjectCounts(manager, requestId));
      }

      return this.view(row, await this.subjectCounts(manager, requestId));
    });
  }

  /**
   * A member of a team with a live mission on this cycle may admit the SOS to Logistics: the team asks for goods for its
   * own mission (supply requests, user decision 2026-11-26). The member never sees anything beyond the admission facts.
   */
  private async isActiveMissionMember(manager: Pick<EntityManager, 'query'>, requestId: string, workCycle: number, userId: string): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1 FROM mission m JOIN team_member tm ON tm.team_id=m.team_id AND tm.left_at IS NULL
        WHERE m.request_id=$1 AND m.work_cycle=$2 AND tm.user_id=$3 AND m.status IN ('ACCEPTED','EN_ROUTE','ON_SCENE') LIMIT 1`,
      [requestId, workCycle, userId],
    ) as unknown[];
    return rows.length > 0;
  }

  private async findRequest(manager: Pick<EntityManager, 'query'>, requestId: string): Promise<AdmissionRequestRow> {
    const rows = await manager.query(
      `SELECT id,status,work_cycle,version,campaign_id,needs_relief_supplies,attribution_locked_at,logistics_admitted_at
         FROM assistance_request WHERE id=$1 FOR UPDATE`,
      [requestId],
    ) as AdmissionRequestRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async subjectCounts(manager: Pick<EntityManager, 'query'>, requestId: string): Promise<AdmissionSubjectCounts> {
    const rows = await manager.query(
      'SELECT people_affected,children_count,elderly_count FROM request_subject WHERE request_id=$1',
      [requestId],
    ) as Array<{ people_affected: number | null; children_count: number | null; elderly_count: number | null }>;
    const subject = rows[0];
    return {
      people_affected: subject?.people_affected ?? null,
      children_count: subject?.children_count ?? null,
      elderly_count: subject?.elderly_count ?? null,
    };
  }

  private view(row: AdmissionRequestRow, subject: AdmissionSubjectCounts): Record<string, unknown> {
    return {
      request_id: row.id,
      work_cycle: Number(row.work_cycle),
      version: Number(row.version),
      status: row.status,
      campaign_id: row.campaign_id,
      people_affected: subject.people_affected,
      children_count: subject.children_count,
      elderly_count: subject.elderly_count,
      needs_relief_supplies: row.needs_relief_supplies,
    };
  }
}
