import { assessmentFields, enqueueAiAdvisory } from '../ai/ai-advisory-input';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { hasPermission } from '@c48/identity-contracts/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import type { SupplementReviewDto } from './request-operations.dto';
import { asObject, checkVersion, cleanText } from './request-operations.helpers';
import { sourceRefsView } from './request-operations.mapper';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { approvedFacts as loadApprovedFacts, validateSourceRefs } from './request-operations.verification.helpers';

@Injectable()
export class RequestOperationsSupplementReviewService {
  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly persistence: RequestOperationsPersistenceService,
    private readonly commandRunner: RequestOperationsCommandRunner,
  ) {}

  async reviewSupplement(
    requestId: string, eventId: string, dto: SupplementReviewDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const sourceNote = cleanText(dto.source_note ?? undefined);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.review-supplement', { event_id: eventId, ...dto },
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (!['VERIFYING', 'VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const supplementRows = await manager.query(
          `SELECT id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type='REPORTER_SUPPLEMENT'`, [eventId, row.id],
        ) as Array<{ id: string; payload: Record<string, unknown> | null }>;
        const supplement = supplementRows[0];
        if (!supplement || asObject(supplement.payload).pending_review !== true) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const reviewed = await manager.query(
          `SELECT 1 FROM request_event WHERE request_id=$1 AND event_type='SUPPLEMENT_REVIEW' AND payload->>'reviewed_event_id'=$2 LIMIT 1`, [row.id, eventId],
        ) as unknown[];
        if (reviewed.length) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        await validateSourceRefs(manager, row, dto.source_refs, session);
        const reported = asObject(asObject(supplement.payload).reported_facts);
        let nextRegion = row.region_code;
        if (dto.decision === 'ACCEPT' && reported.location !== undefined) {
          const location = asObject(reported.location);
          const coordinates = Array.isArray(location.coordinates) ? location.coordinates : [];
          const [longitude, latitude] = coordinates;
          if (coordinates.length !== 2 || typeof longitude !== 'number' || typeof latitude !== 'number' ||
              longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new AppError('INTERNAL_ERROR', { status: 500 });
          const regionRows = await manager.query(
            `SELECT min(region_code) AS region_code FROM region_boundary
              WHERE ST_Covers(geom,ST_SetSRID(ST_MakePoint($1,$2),4326)) HAVING count(*)=1`, [longitude, latitude],
          ) as Array<{ region_code: string }>;
          nextRegion = regionRows[0]?.region_code ?? null;
          if (row.attribution_locked_at !== null && nextRegion !== row.region_code) {
            throw new AppError('ATTRIBUTION_LOCKED', { status: 409 });
          }
          if (!hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: row.organization_id, regionCode: nextRegion, campaignId: row.campaign_id })) {
            throw new AppError('FORBIDDEN', { status: 403 });
          }
        }
        const approvedFacts = dto.decision === 'ACCEPT' ? await loadApprovedFacts(manager, row.id, reported, nextRegion) : undefined;
        const reviewId = await this.persistence.insertEvent(manager, row.id, session.userId, 'SUPPLEMENT_REVIEW', 'STAFF', row.status, row.status, reason, {
          reviewed_event_id: eventId, decision: dto.decision, source_refs: sourceRefsView(dto.source_refs),
          source_note: sourceNote, ...(approvedFacts ? { approved_facts: approvedFacts } : {}),
        });
        if (dto.decision === 'ACCEPT') await this.applySupplementFacts(manager, row.id, reported);
        const [updated] = await manager.query(
          `UPDATE assistance_request SET
             description=CASE WHEN $3::boolean THEN $4 ELSE description END,
             reporter_declared_danger=CASE WHEN $5::boolean THEN $6 ELSE reporter_declared_danger END,
             region_code=CASE WHEN $7::boolean THEN $8 ELSE region_code END,
             needs_rescue=CASE WHEN $11::boolean THEN $12::boolean ELSE needs_rescue END,
             needs_relief_supplies=CASE WHEN $13::boolean THEN $14::boolean ELSE needs_relief_supplies END,
             verification_revision=CASE WHEN $9::boolean THEN $10::uuid ELSE verification_revision END,
             version=version+1 WHERE id=$1 AND version=$2 RETURNING status,version,verification_revision`,
          [row.id, dto.expected_version,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'description'), reported.description ?? null,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'reporter_declared_danger'), reported.reporter_declared_danger ?? false,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'location'), nextRegion,
            dto.decision === 'ACCEPT', reviewId,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'needs_rescue'), reported.needs_rescue ?? false,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'needs_relief_supplies'), reported.needs_relief_supplies ?? false],
        ) as [Array<{ status: string; version: number; verification_revision: string | null }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        if (dto.decision === 'ACCEPT' && assessmentFields.some((field) => Object.hasOwn(reported, field))) {
          await enqueueAiAdvisory(manager, row.id);
        }
        await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'SUPPLEMENT_REVIEWED', `SUPPLEMENT_${dto.decision}`);
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), decision: dto.decision, event_id: reviewId, verification_revision: updated[0]!.verification_revision }, resource: { type: 'request_event', id: reviewId } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'SUPPLEMENT_REVIEW\'', [resource?.id, requestId]) as Array<{ id: string; payload: Record<string, unknown> }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.persistence.currentRequestValue(manager, requestId);
        return { ...current, event_id: rows[0].id, decision: rows[0].payload.decision };
      },
    );
  }

  private async applySupplementFacts(manager: EntityManager, requestId: string, reported: Record<string, unknown>): Promise<void> {
    const location = asObject(reported.location);
    const coordinates = Array.isArray(location.coordinates) ? location.coordinates : [];
    const [longitude, latitude] = coordinates;
    await manager.query(
      `UPDATE request_subject SET
         people_affected=CASE WHEN $2::boolean THEN $3::integer ELSE people_affected END,
         household_reference_note=CASE WHEN $4::boolean THEN $5::text ELSE household_reference_note END,
         children_count=CASE WHEN $12::boolean THEN $13::integer ELSE children_count END,
         elderly_count=CASE WHEN $14::boolean THEN $15::integer ELSE elderly_count END,
         location=CASE WHEN $6::boolean THEN ST_SetSRID(ST_MakePoint($7::float8,$8::float8),4326)::geography ELSE location END,
         location_source=CASE WHEN $6::boolean THEN $9::text ELSE location_source END,
         location_accuracy_m=CASE WHEN $6::boolean THEN $10::numeric ELSE location_accuracy_m END,
         location_captured_at=CASE WHEN $6::boolean THEN $11::timestamptz ELSE location_captured_at END
       WHERE request_id=$1`,
      [requestId, Object.hasOwn(reported, 'people_affected'), reported.people_affected ?? null,
        Object.hasOwn(reported, 'household_reference_note'), reported.household_reference_note ?? null,
        Object.hasOwn(reported, 'location'), longitude ?? null, latitude ?? null, location.source ?? null,
        location.accuracy_m ?? null, location.captured_at ?? null,
        Object.hasOwn(reported, 'children_count'), reported.children_count ?? null,
        Object.hasOwn(reported, 'elderly_count'), reported.elderly_count ?? null],
    );
  }
}
