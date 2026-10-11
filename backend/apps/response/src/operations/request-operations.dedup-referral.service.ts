import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency';
import { hasPermission } from '../../../../packages/technical/src/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import { AuthorityReferralDto, CorrectRegionDto, DuplicateRequestDto } from './request-operations.dto';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { blockedCanonicalStatuses, checkVersion, cleanText, hasOrganizationPermission, terminalStatuses, unverifiedStatuses } from './request-operations.helpers';
import type { OperationRequestRow } from './request-operations.types';

@Injectable()
export class RequestOperationsDedupReferralService {
  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly commandRunner: RequestOperationsCommandRunner,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async duplicate(requestId: string, dto: DuplicateRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.duplicate', dto,
      async (manager) => {
        const ids = [...new Set([requestId, dto.canonical_request_id])].sort();
        const locked = new Map<string, OperationRequestRow>();
        for (const id of ids) {
          const rows = await manager.query(
            `SELECT id,tracking_code,reporter_user_id,reporter_name,reporter_contact_phone,report_mode,status,version,
                    review_lane,received_at,verifying_since,organization_id,region_code,campaign_id,description,
                    reporter_declared_danger,priority,priority_basis,work_cycle,canonical_request_id,incident_category_code
               FROM assistance_request WHERE id=$1 FOR UPDATE`, [id],
          ) as OperationRequestRow[];
          if (rows[0]) locked.set(id, rows[0]);
        }
        const source = locked.get(requestId);
        const canonical = locked.get(dto.canonical_request_id);
        if (!source) throw new AppError('NOT_FOUND', { status: 404 });
        if (!hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: source.organization_id, regionCode: source.region_code, campaignId: source.campaign_id })) throw new AppError('FORBIDDEN', { status: 403 });
        if (!canonical || canonical.id === source.id || blockedCanonicalStatuses.has(canonical.status) ||
            !hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: canonical.organization_id, regionCode: canonical.region_code, campaignId: canonical.campaign_id })) {
          throw new AppError('CANONICAL_INVALID', { status: 409 });
        }
        checkVersion(Number(source.version), dto.expected_version);
        if (!unverifiedStatuses.has(source.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const inbound = await manager.query('SELECT 1 FROM assistance_request WHERE canonical_request_id=$1 LIMIT 1', [source.id]) as unknown[];
        if (inbound.length) throw new AppError('CANONICAL_HAS_DUPLICATES', { status: 409 });
        const decisions = await manager.query(
          `INSERT INTO verification_decision (request_id,outcome,reviewer_user_id,reason)
           VALUES ($1,'DUPLICATE',$2,$3) RETURNING id`, [source.id, session.userId, reason],
        ) as Array<{ id: string }>;
        const decision = decisions[0];
        if (!decision) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.persistence.insertEvent(manager, source.id, session.userId, 'REQUEST_DUPLICATED', 'REPORTER', source.status, 'DUPLICATE', reason, {
          public_text_code: 'REQUEST_DUPLICATED', decision_id: decision.id, canonical_request_id: canonical.id,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='DUPLICATE',canonical_request_id=$3,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,canonical_request_id`,
          [source.id, dto.expected_version, canonical.id],
        ) as [Array<{ id: string; status: string; version: number; canonical_request_id: string }>, number];
        if (!updated[0]) checkVersion(Number(source.version), dto.expected_version);
        await this.persistence.notifyReporter(manager, source.reporter_user_id, source.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_DUPLICATED');
        return { status: 200, value: { id: source.id, status: updated[0]!.status, version: Number(updated[0]!.version), canonical_request_id: updated[0]!.canonical_request_id, decision_id: decision.id }, resource: { type: 'verification_decision', id: decision.id } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2 AND outcome=\'DUPLICATE\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return this.persistence.currentRequestValue(manager, requestId);
      },
    );
  }

  async authorityReferral(requestId: string, dto: AuthorityReferralDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const referredBody = cleanText(dto.referred_body, true)!;
    const note = cleanText(dto.note, true)!;
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.authority-referral', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        if (terminalStatuses.has(row.status) || row.status === 'RESOLVING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updated] = await manager.query('UPDATE assistance_request SET version=version+1 WHERE id=$1 RETURNING version', [row.id]) as [Array<{ version: number }>, number];
        const eventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'AUTHORITY_REFERRED', 'STAFF', row.status, row.status, note, { referred_body: referredBody });
        return { status: 201, value: { id: row.id, status: row.status, version: Number(updated[0]?.version), event_id: eventId }, resource: { type: 'request_event', id: eventId } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'AUTHORITY_REFERRED\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return { ...(await this.persistence.currentRequestValue(manager, requestId)), event_id: rows[0].id };
      },
    );
  }

  async correctRegion(requestId: string, dto: CorrectRegionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.correct-region', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_UNASSIGNED_QUEUE', true);
        if (!hasOrganizationPermission(session, 'REQUEST_UNASSIGNED_QUEUE', row.organization_id)) throw new AppError('FORBIDDEN', { status: 403 });
        checkVersion(Number(row.version), dto.expected_version);
        if (row.attribution_locked_at) throw new AppError('ATTRIBUTION_LOCKED', { status: 409 });
        const regions = await manager.query('SELECT 1 FROM region_boundary WHERE region_code=$1', [dto.region_code]) as unknown[];
        if (!regions.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
        if (row.region_code === dto.region_code) return { status: 200, value: { id: row.id, region_code: row.region_code, version: Number(row.version) }, resource: { type: 'assistance_request', id: row.id } };
        const [updated] = await manager.query(
          'UPDATE assistance_request SET region_code=$3,version=version+1 WHERE id=$1 AND version=$2 RETURNING region_code,version',
          [row.id, dto.expected_version, dto.region_code],
        ) as [Array<{ region_code: string; version: number }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.persistence.insertEvent(manager, row.id, session.userId, 'REGION_CORRECTED', 'STAFF', row.status, row.status, reason, { previous_region_code: row.region_code, region_code: updated[0]!.region_code });
        return { status: 200, value: { id: row.id, region_code: updated[0]!.region_code, version: Number(updated[0]!.version) }, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.persistence.currentRequestValue(manager, requestId),
    );
  }
}
