import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, type IdempotentOutcome, type IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { checkVersion, cleanText } from '../operations/request-operations.helpers';
import { ReporterSessionService, type ReporterSession } from '../requests/reporter-session';
import type { ReopenRequestDto, RequestVersionDto } from './request-resolution.dto';
import { enqueueAiAdvisory } from '../ai/ai-advisory-input';

interface RequestStateRow {
  id: string;
  status: string;
  version: number;
  work_cycle: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  reporter_user_id: string | null;
}

interface CampaignRow {
  id: string;
  status: string;
  organization_id: string;
  region_code: string | null;
}

@Injectable()
export class RequestResolutionStateService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
  ) {}

  async close(requestId: string, dto: RequestVersionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const preflight = await this.loadRequest(this.dataSource, requestId);
    this.assertPermission(session, preflight, 'REQUEST_RESOLVE');
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-close:${requestId}:${session.userId}`,
      command: 'response.requests.close',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      execute: (manager) => this.closeInTransaction(manager, requestId, dto, session),
      replay: (manager, resource) => this.replayRequest(manager, resource, session, 'REQUEST_RESOLVE'),
    });
  }

  async reopen(requestId: string, dto: ReopenRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const preflight = await this.loadRequest(this.dataSource, requestId);
    this.assertPermission(session, preflight, 'REQUEST_REOPEN');
    if (dto.region_code !== undefined && dto.region_code !== preflight.region_code) {
      this.assertOrganizationCorrection(session, preflight.organization_id);
    }
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-reopen:${requestId}:${session.userId}`,
      command: 'response.requests.reopen',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      execute: (manager) => this.reopenInTransaction(manager, requestId, dto, session, preflight),
      replay: (manager, resource) => this.replayRequest(manager, resource, session, 'REQUEST_REOPEN'),
    });
  }

  private async closeInTransaction(
    manager: EntityManager, requestId: string, dto: RequestVersionDto, session: ReporterSession,
  ): Promise<IdempotentOutcome<Record<string, unknown>>> {
    const row = await this.loadRequest(manager, requestId, true);
    this.assertPermission(session, row, 'REQUEST_RESOLVE');
    checkVersion(Number(row.version), dto.expected_version);
    if (row.status !== 'RESOLVED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    const [updated] = await manager.query(
      `UPDATE assistance_request SET status='CLOSED',version=version+1
        WHERE id=$1 AND status='RESOLVED' AND version=$2
        RETURNING id,status,version,work_cycle,reporter_user_id`, [requestId, dto.expected_version],
    ) as [Array<RequestStateRow>, number];
    const result = updated?.[0];
    if (!result) throw new AppError('VERSION_CONFLICT', { status: 409 });
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
       VALUES ($1,$2,'REQUEST_CLOSED','REPORTER','RESOLVED','CLOSED',$3::jsonb)`,
      [requestId, session.userId, JSON.stringify({ resulting_version: Number(result.version) })],
    );
    await this.notifyReporter(manager, result, 'REQUEST_CLOSED');
    return { status: 200, value: this.view(result), resource: { type: 'assistance_request', id: requestId } };
  }

  private async reopenInTransaction(
    manager: EntityManager, requestId: string, dto: ReopenRequestDto, session: ReporterSession, preflight: RequestStateRow,
  ): Promise<IdempotentOutcome<Record<string, unknown>>> {
    const requestedCampaignId = dto.campaign_id === undefined ? preflight.campaign_id : dto.campaign_id;
    const campaignIds = [...new Set([preflight.campaign_id, requestedCampaignId].filter((id): id is string => Boolean(id)))].sort();
    const campaigns = new Map<string, CampaignRow>();
    for (const campaignId of campaignIds) {
      const rows = await manager.query(
        `SELECT id,status,organization_id,region_code FROM campaign WHERE id=$1 FOR SHARE`, [campaignId],
      ) as CampaignRow[];
      if (rows[0]) campaigns.set(campaignId, rows[0]);
    }

    const row = await this.loadRequest(manager, requestId, true);
    this.assertPermission(session, row, 'REQUEST_REOPEN');
    if (dto.region_code !== undefined && dto.region_code !== row.region_code) this.assertOrganizationCorrection(session, row.organization_id);
    checkVersion(Number(row.version), dto.expected_version);
    if (!['RESOLVED', 'CLOSED'].includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });

    const regionCode = dto.region_code ?? row.region_code;
    if (dto.region_code !== undefined) {
      const regions = await manager.query('SELECT 1 FROM region_boundary WHERE region_code=$1', [dto.region_code]) as unknown[];
      if (!regions.length) throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { region_code: ['Mã khu vực không hợp lệ hoặc chưa được cấu hình.'] } });
    }

    let campaignId: string | null = requestedCampaignId;
    if (dto.campaign_id === undefined && row.campaign_id) {
      const currentCampaign = campaigns.get(row.campaign_id);
      campaignId = currentCampaign?.status === 'ACTIVE' ? row.campaign_id : null;
    } else if (campaignId !== null) {
      const campaign = campaigns.get(campaignId);
      if (!campaign || campaign.status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
      if (campaign.organization_id !== row.organization_id || (campaign.region_code && campaign.region_code !== regionCode)) {
        throw new AppError('VALIDATION_FAILED', {
          status: 400, fieldErrors: { campaign_id: ['Chiến dịch không phù hợp với tổ chức hoặc khu vực của yêu cầu.'] },
        });
      }
    }

    const [updated] = await manager.query(
      `UPDATE assistance_request
          SET status='TRIAGED',work_cycle=work_cycle+1,region_code=$3,campaign_id=$4,
              attribution_locked_at=NULL,logistics_admitted_at=NULL,resolution_seal_id=NULL,resolved_at=NULL,
              version=version+1
        WHERE id=$1 AND version=$2 AND status=ANY($5::request_status[])
        RETURNING id,status,version,work_cycle,organization_id,region_code,campaign_id,reporter_user_id`,
      [requestId, dto.expected_version, regionCode, campaignId, ['RESOLVED', 'CLOSED']],
    ) as [Array<RequestStateRow>, number];
    const result = updated?.[0];
    if (!result) throw new AppError('VERSION_CONFLICT', { status: 409 });
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
       VALUES ($1,$2,'REQUEST_REOPENED','STAFF',$3,'TRIAGED',$4,$5::jsonb)`,
      [requestId, session.userId, row.status, cleanText(dto.reason, true), JSON.stringify({
        previous_work_cycle: Number(row.work_cycle), work_cycle: Number(result.work_cycle),
        previous_campaign_id: row.campaign_id, campaign_id: result.campaign_id,
        previous_region_code: row.region_code, region_code: result.region_code,
      })],
    );
    await enqueueAiAdvisory(manager, requestId);
    await this.notifyReporter(manager, result, 'REQUEST_REOPENED');
    return { status: 200, value: this.view(result), resource: { type: 'assistance_request', id: requestId } };
  }

  private async loadRequest(query: Pick<DataSource | EntityManager, 'query'>, requestId: string, forUpdate = false): Promise<RequestStateRow> {
    const rows = await query.query(
      `SELECT id,status,version,work_cycle,organization_id,region_code,campaign_id,reporter_user_id
         FROM assistance_request WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`, [requestId],
    ) as RequestStateRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async replayRequest(
    manager: EntityManager, resource: { type: string; id: string } | null, session: ReporterSession,
    permission: 'REQUEST_RESOLVE' | 'REQUEST_REOPEN',
  ): Promise<Record<string, unknown>> {
    if (!resource || resource.type !== 'assistance_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const row = await this.loadRequest(manager, resource.id);
    this.assertPermission(session, row, permission);
    return this.view(row);
  }

  private assertPermission(session: ReporterSession, row: RequestStateRow, permission: 'REQUEST_RESOLVE' | 'REQUEST_REOPEN'): void {
    if (!hasPermission(session.grants, permission, {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
    })) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private assertOrganizationCorrection(session: ReporterSession, organizationId: string): void {
    const authorized = session.grants.some((grant) => grant.scope_type === 'ORGANIZATION' && grant.organization_id === organizationId &&
      hasPermission([grant], 'REQUEST_UNASSIGNED_QUEUE', { organizationId }));
    if (!authorized) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private async notifyReporter(manager: EntityManager, row: Pick<RequestStateRow, 'id' | 'version' | 'reporter_user_id'>, textCode: string): Promise<void> {
    if (!row.reporter_user_id) return;
    await manager.query(
      `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
       VALUES ($1,$2,$3,'REQUEST_STATUS_CHANGED',jsonb_build_object('text_code',$4::text,'request_id',$2::uuid))
       ON CONFLICT DO NOTHING`, [row.reporter_user_id, row.id, Number(row.version), textCode],
    );
  }

  private view(row: Pick<RequestStateRow, 'id' | 'status' | 'version' | 'work_cycle'>): Record<string, unknown> {
    return { id: row.id, status: row.status, version: Number(row.version), work_cycle: Number(row.work_cycle) };
  }
}
