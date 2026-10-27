import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, type IdempotentOutcome, type IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { checkVersion, cleanText } from '../operations/request-operations.helpers';
import { ReporterSessionService, type ReporterSession } from '../requests/reporter-session';
import type { FailureReviewDto } from './request-resolution.dto';

interface FailureMissionRow {
  id: string;
  request_id: string;
  work_cycle: number;
  status: string;
  version: number;
  request_status: string;
  request_version: number;
  request_work_cycle: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

interface RequestLockRow {
  id: string;
  status: string;
  version: number;
  work_cycle: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

interface MissionLockRow {
  id: string;
  request_id: string;
  work_cycle: number;
  status: string;
  version: number;
}

@Injectable()
export class RequestFailureReviewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
  ) {}

  async review(
    missionId: string, dto: FailureReviewDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    this.validateDisposition(dto);
    const preflight = await this.findMission(this.dataSource, missionId);
    this.assertPermission(session, preflight);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.mission-failure-review:${missionId}:${session.userId}`,
      command: 'response.missions.review-failure',
      key,
      requestHash: canonicalRequestHash({ mission_id: missionId, actor_user_id: session.userId, dto }),
      execute: (manager) => this.reviewInTransaction(manager, missionId, dto, reason, session),
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'mission') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await this.findMission(manager, resource.id);
        this.assertPermission(session, row);
        const events = await manager.query(
          `SELECT payload FROM request_event WHERE request_id=$1 AND event_type='MISSION_FAILURE_REVIEW'
            AND payload->>'mission_id'=$2 ORDER BY occurred_at DESC,id DESC LIMIT 1`, [row.request_id, row.id],
        ) as Array<{ payload: Record<string, unknown> }>;
        if (!events[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return this.resultValue(row.id, Number(row.version), Number(row.request_version), events[0].payload);
      },
    });
  }

  private async reviewInTransaction(
    manager: EntityManager, missionId: string, dto: FailureReviewDto, reason: string, session: ReporterSession,
  ): Promise<IdempotentOutcome<Record<string, unknown>>> {
    const refs = await manager.query('SELECT request_id FROM mission WHERE id=$1', [missionId]) as Array<{ request_id: string }>;
    if (!refs[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const requestRows = await manager.query(
      `SELECT id,status,version,work_cycle,organization_id,region_code,campaign_id
         FROM assistance_request WHERE id=$1 FOR UPDATE`, [refs[0].request_id],
    ) as RequestLockRow[];
    const requestRow = requestRows[0];
    if (!requestRow) throw new AppError('NOT_FOUND', { status: 404 });
    this.assertPermission(session, requestRow);
    checkVersion(Number(requestRow.version), dto.expected_version);
    if (requestRow.status === 'RESOLVING' || ['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(requestRow.status)) {
      throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    }

    const missionRows = await manager.query(
      `SELECT id,request_id,work_cycle,status,version FROM mission WHERE id=$1 FOR UPDATE`, [missionId],
    ) as MissionLockRow[];
    const mission = missionRows[0];
    if (!mission) throw new AppError('NOT_FOUND', { status: 404 });
    if (mission.request_id !== requestRow.id || Number(mission.work_cycle) !== Number(requestRow.work_cycle) || mission.status !== 'FAILED') {
      throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    }
    const existing = await manager.query(
      `SELECT 1 FROM request_event WHERE request_id=$1 AND event_type='MISSION_FAILURE_REVIEW'
        AND payload->>'mission_id'=$2 AND payload->>'mission_version'=$3 LIMIT 1`,
      [requestRow.id, mission.id, String(mission.version)],
    ) as unknown[];
    if (existing.length) throw new AppError('VERSION_CONFLICT', { status: 409 });

    if (dto.disposition === 'REPLACED') {
      const replacements = await manager.query(
        `SELECT id FROM mission WHERE id=$1 AND request_id=$2 AND work_cycle=$3 AND status='COMPLETED'`,
        [dto.replacement_mission_id, requestRow.id, requestRow.work_cycle],
      ) as Array<{ id: string }>;
      if (!replacements.length) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    }

    const [updatedMission] = await manager.query(
      `UPDATE mission SET version=version+1 WHERE id=$1 AND status='FAILED' AND version=$2 RETURNING id,version`,
      [mission.id, mission.version],
    ) as [Array<{ id: string; version: number }>, number];
    if (!updatedMission?.[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
    const [updatedRequest] = await manager.query(
      `UPDATE assistance_request SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version`,
      [requestRow.id, dto.expected_version],
    ) as [Array<{ version: number }>, number];
    if (!updatedRequest?.[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });

    const payload = {
      mission_id: mission.id,
      mission_version: Number(updatedMission[0].version),
      disposition: dto.disposition,
      ...(dto.replacement_mission_id ? { replacement_mission_id: dto.replacement_mission_id } : {}),
    };
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
       VALUES ($1,$2,'MISSION_FAILURE_REVIEW','STAFF',$3,$3,$4,$5::jsonb)`,
      [requestRow.id, session.userId, requestRow.status, reason, JSON.stringify(payload)],
    );
    return {
      status: 200,
      value: this.resultValue(mission.id, Number(updatedMission[0].version), Number(updatedRequest[0].version), payload),
      resource: { type: 'mission', id: mission.id },
    };
  }

  private async findMission(query: Pick<DataSource | EntityManager, 'query'>, missionId: string): Promise<FailureMissionRow> {
    const rows = await query.query(
      `SELECT m.id,m.request_id,m.work_cycle,m.status,m.version,r.status AS request_status,r.version AS request_version,
              r.work_cycle AS request_work_cycle,r.organization_id,r.region_code,r.campaign_id
         FROM mission m JOIN assistance_request r ON r.id=m.request_id WHERE m.id=$1`, [missionId],
    ) as FailureMissionRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private validateDisposition(dto: FailureReviewDto): void {
    if (!['REPLACED', 'NO_FURTHER_ACTION', 'REFERRED'].includes(dto.disposition)) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if ((dto.disposition === 'REPLACED') !== Boolean(dto.replacement_mission_id)) {
      throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { replacement_mission_id: ['Thông tin nhiệm vụ thay thế không hợp lệ.'] } });
    }
  }

  private assertPermission(session: ReporterSession, row: Pick<FailureMissionRow, 'organization_id' | 'region_code' | 'campaign_id'>): void {
    if (!hasPermission(session.grants, 'REQUEST_RESOLVE', {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
    })) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private resultValue(missionId: string, missionVersion: number, requestVersion: number, payload: Record<string, unknown>): Record<string, unknown> {
    return { mission_id: missionId, mission_version: missionVersion, request_version: requestVersion, ...payload };
  }
}
