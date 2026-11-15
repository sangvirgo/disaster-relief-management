import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { IdempotentResult, ResourceRef } from '@c48/technical/idempotency/idempotency';
import { ReporterSessionService } from '../requests/reporter-session';
import { AttachCampaignDto, RequestVersionDto } from './request-operations.dto';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { checkVersion } from './request-operations.helpers';
import { isSystemCoordinator } from './request-claims.helpers';
import { updateCampaignAttribution } from './request-campaign-attribution';

interface RequestCampaignRow {
  id: string;
  status: string;
  version: number;
  campaign_id: string | null;
  campaign_match_state: string;
  campaign_candidate_ids: string[] | null;
  handled_by: string | null;
  attribution_locked_at: Date | string | null;
}

interface CampaignRow {
  id: string;
  status: string;
}

interface RequestCampaignView {
  id: string;
  status: string;
  version: number;
  campaign_id: string | null;
  campaign_match_state: string;
  campaign_candidate_ids: string[] | null;
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
        this.assertPermission(session, dto.campaign_id);
        if (row.campaign_id && row.campaign_id !== dto.campaign_id) this.assertPermission(session, row.campaign_id);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.campaign_id === campaign.id && row.campaign_match_state === 'MANUAL') {
          return { status: 200, value: this.view(row), resource: { type: 'assistance_request', id: row.id } };
        }
        if (campaign.status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
        checkVersion(Number(row.version), dto.expected_version);
        const { row: result, eventId } = await updateCampaignAttribution(manager, row, {
          campaignId: campaign.id, matchState: 'MANUAL', actorId: session.userId,
          eventType: 'CAMPAIGN_ATTACHED', auditAction: 'CAMPAIGN_ATTACHED', reason: 'MANUAL_ATTRIBUTION',
        });
        await this.releaseAttachingClaim(manager, row, session.userId);
        return { status: 200, value: this.view(result), resource: { type: 'request_event', id: eventId } };
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
        this.assertPermission(session, row.campaign_id);
        checkVersion(Number(row.version), dto.expected_version);
        if (!row.campaign_id && row.campaign_match_state === 'MANUAL' && !row.campaign_candidate_ids?.length) {
          return { status: 200, value: this.view(row), resource: { type: 'assistance_request', id: row.id } };
        }

        checkVersion(Number(row.version), dto.expected_version);
        const { row: result, eventId } = await updateCampaignAttribution(manager, row, {
          campaignId: null, matchState: 'MANUAL', actorId: session.userId,
          eventType: 'CAMPAIGN_DETACHED', auditAction: 'CAMPAIGN_DETACHED', reason: 'MANUAL_ATTRIBUTION',
        });
        return { status: 200, value: this.view(result), resource: { type: 'request_event', id: eventId } };
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
      `SELECT id,status FROM campaign WHERE id=$1${lock ? ' FOR SHARE' : ''}`,
      [campaignId],
    ) as CampaignRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async loadRequest(manager: EntityManager, requestId: string, lock = false): Promise<RequestCampaignRow> {
    const rows = await manager.query(
      `SELECT id,status,version,campaign_id,attribution_locked_at
              ,campaign_match_state,campaign_candidate_ids,handled_by
         FROM assistance_request WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as RequestCampaignRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private assertPermission(
    session: Awaited<ReturnType<ReporterSessionService['require']>>,
    campaignId: string | null,
  ): void {
    void campaignId;
    if (!isSystemCoordinator(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private async releaseAttachingClaim(manager: EntityManager, row: RequestCampaignRow, userId: string): Promise<void> {
    if (row.handled_by !== userId) return;
    await manager.query('UPDATE assistance_request SET handled_by=NULL,handled_at=NULL WHERE id=$1 AND handled_by=$2', [row.id, userId]);
    await this.persistence.insertEvent(manager, row.id, userId, 'CLAIM_RELEASED', 'STAFF', row.status, row.status, null,
      { previous_handled_by: userId, reason: 'CAMPAIGN_ATTACHED' });
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
      this.assertPermission(session, row.campaign_id);
    } else if (resource.type === 'request_event') {
      const events = await manager.query(
        'SELECT event_type,payload FROM request_event WHERE id=$1 AND request_id=$2', [resource.id, requestId],
      ) as Array<{ event_type: string; payload: Record<string, unknown> | null }>;
      const event = events[0];
      if (!event || event.event_type !== eventType) throw new AppError('NOT_FOUND', { status: 404 });
      const campaignId = eventType === 'CAMPAIGN_ATTACHED'
        ? event.payload?.campaign_id
        : event.payload?.previous_campaign_id;
      this.assertPermission(session, typeof campaignId === 'string' ? campaignId : null);
      if (row.campaign_id) this.assertPermission(session, row.campaign_id);
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
      campaign_id: row.campaign_id,
      campaign_match_state: row.campaign_match_state,
      campaign_candidate_ids: row.campaign_candidate_ids,
    };
  }
}
