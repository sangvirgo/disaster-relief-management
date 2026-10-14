import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import type { IdempotentResult, ResourceRef } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import { AttachCampaignDto, RequestVersionDto } from './request-operations.dto';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { checkVersion } from './request-operations.helpers';

interface RequestCampaignRow {
  id: string;
  status: string;
  version: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  attribution_locked_at: Date | string | null;
}

interface CampaignRow {
  id: string;
  status: string;
  organization_id: string;
  region_code: string | null;
}

interface RequestCampaignView {
  id: string;
  status: string;
  version: number;
  region_code: string | null;
  campaign_id: string | null;
}

@Injectable()
export class RequestCampaignAssociationService {
  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly commandRunner: RequestOperationsCommandRunner,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async attach(
    requestId: string, dto: AttachCampaignDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.attach-campaign', dto,
      async (manager) => {
        const pointer = await this.campaignPointer(manager, requestId);
        const campaignIds = [...new Set([dto.campaign_id, ...(pointer.campaign_id ? [pointer.campaign_id] : [])])].sort();
        const campaigns = new Map<string, CampaignRow>();
        for (const campaignId of campaignIds) campaigns.set(campaignId, await this.loadCampaign(manager, campaignId, true));
        const campaign = campaigns.get(dto.campaign_id);
        if (!campaign) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await this.loadRequest(manager, requestId, true);
        if (row.campaign_id !== pointer.campaign_id) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        }
        this.assertPermission(session, row, dto.campaign_id);
        if (row.campaign_id && row.campaign_id !== dto.campaign_id) this.assertPermission(session, row, row.campaign_id);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.attribution_locked_at) throw new AppError('ATTRIBUTION_LOCKED', { status: 409 });
        if (row.campaign_id === campaign.id) {
          return { status: 200, value: this.view(row), resource: { type: 'assistance_request', id: row.id } };
        }
        if (campaign.status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
        this.assertCompatible(row, campaign);

        const [updated] = await manager.query(
          `UPDATE assistance_request SET campaign_id=$3,version=version+1
            WHERE id=$1 AND version=$2
            RETURNING id,status,version,region_code,campaign_id`,
          [row.id, dto.expected_version, campaign.id],
        ) as [Array<RequestCampaignView>, number];
        const result = updated?.[0];
        if (!result) checkVersion(Number(row.version), dto.expected_version);
        const eventId = await this.persistence.insertEvent(
          manager, row.id, session.userId, 'CAMPAIGN_ATTACHED', 'STAFF', row.status, row.status, null,
          { previous_campaign_id: row.campaign_id, campaign_id: campaign.id },
        );
        return { status: 200, value: this.view(result!), resource: { type: 'request_event', id: eventId } };
      },
      (manager, resource) => this.replay(manager, resource, requestId, session, 'CAMPAIGN_ATTACHED'),
    );
  }

  async detach(
    requestId: string, dto: RequestVersionDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.detach-campaign', dto,
      async (manager) => {
        const pointer = await this.campaignPointer(manager, requestId);
        if (pointer.campaign_id) await this.loadCampaign(manager, pointer.campaign_id, true);
        const row = await this.loadRequest(manager, requestId, true);
        if (row.campaign_id !== pointer.campaign_id) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        }
        this.assertPermission(session, row, row.campaign_id);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.attribution_locked_at) throw new AppError('ATTRIBUTION_LOCKED', { status: 409 });
        if (!row.campaign_id) {
          return { status: 200, value: this.view(row), resource: { type: 'assistance_request', id: row.id } };
        }

        const [updated] = await manager.query(
          `UPDATE assistance_request SET campaign_id=NULL,version=version+1
            WHERE id=$1 AND version=$2
            RETURNING id,status,version,region_code,campaign_id`,
          [row.id, dto.expected_version],
        ) as [Array<RequestCampaignView>, number];
        const result = updated?.[0];
        if (!result) checkVersion(Number(row.version), dto.expected_version);
        const eventId = await this.persistence.insertEvent(
          manager, row.id, session.userId, 'CAMPAIGN_DETACHED', 'STAFF', row.status, row.status, null,
          { previous_campaign_id: row.campaign_id, campaign_id: null },
        );
        return { status: 200, value: this.view(result!), resource: { type: 'request_event', id: eventId } };
      },
      (manager, resource) => this.replay(manager, resource, requestId, session, 'CAMPAIGN_DETACHED'),
    );
  }

  private async campaignPointer(manager: EntityManager, requestId: string): Promise<{ campaign_id: string | null }> {
    const rows = await manager.query('SELECT campaign_id FROM assistance_request WHERE id=$1', [requestId]) as Array<{ campaign_id: string | null }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async loadCampaign(manager: EntityManager, campaignId: string, lock = false): Promise<CampaignRow> {
    const rows = await manager.query(
      `SELECT id,status,organization_id,region_code FROM campaign WHERE id=$1${lock ? ' FOR SHARE' : ''}`,
      [campaignId],
    ) as CampaignRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async loadRequest(manager: EntityManager, requestId: string, lock = false): Promise<RequestCampaignRow> {
    const rows = await manager.query(
      `SELECT id,status,version,organization_id,region_code,campaign_id,attribution_locked_at
         FROM assistance_request WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as RequestCampaignRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private assertPermission(
    session: Awaited<ReturnType<ReporterSessionService['require']>>,
    row: Pick<RequestCampaignRow, 'organization_id' | 'region_code'>,
    campaignId: string | null,
  ): void {
    if (!hasPermission(session.grants, 'CAMPAIGN_MANAGE', {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId,
    })) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private assertCompatible(row: RequestCampaignRow, campaign: CampaignRow): void {
    if (campaign.organization_id !== row.organization_id || (campaign.region_code && campaign.region_code !== row.region_code)) {
      throw new AppError('VALIDATION_FAILED', {
        status: 400, fieldErrors: { campaign_id: ['Chiến dịch không phù hợp với tổ chức hoặc khu vực của yêu cầu.'] },
      });
    }
  }

  private async replay(
    manager: EntityManager,
    resource: ResourceRef | null,
    requestId: string,
    session: Awaited<ReturnType<ReporterSessionService['require']>>,
    eventType: 'CAMPAIGN_ATTACHED' | 'CAMPAIGN_DETACHED',
  ): Promise<Record<string, unknown>> {
    if (!resource) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const row = await this.loadRequest(manager, requestId, true);
    if (resource.type === 'assistance_request') {
      this.assertPermission(session, row, row.campaign_id);
    } else if (resource.type === 'request_event') {
      const events = await manager.query(
        'SELECT event_type,payload FROM request_event WHERE id=$1 AND request_id=$2', [resource.id, requestId],
      ) as Array<{ event_type: string; payload: Record<string, unknown> | null }>;
      const event = events[0];
      if (!event || event.event_type !== eventType) throw new AppError('NOT_FOUND', { status: 404 });
      const campaignId = eventType === 'CAMPAIGN_ATTACHED'
        ? event.payload?.campaign_id
        : event.payload?.previous_campaign_id;
      this.assertPermission(session, row, typeof campaignId === 'string' ? campaignId : null);
      if (row.campaign_id) this.assertPermission(session, row, row.campaign_id);
    } else {
      throw new AppError('INTERNAL_ERROR', { status: 500 });
    }
    return this.persistence.currentRequestValue(manager, requestId);
  }

  private view(row: RequestCampaignView | RequestCampaignRow): Record<string, unknown> {
    return {
      id: row.id,
      status: row.status,
      version: Number(row.version),
      region_code: row.region_code,
      campaign_id: row.campaign_id,
    };
  }
}
