import type { EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import type { RequestCoordinatorGrant, ReporterSession } from '../requests/reporter-session';
import type { SupplementReviewDto, VerifyRequestDto } from './request-operations.dto';
import { asObject, grantCovers, scopeSql, toIso } from './request-operations.helpers';
import type { OperationRequestRow, ValidatedSourceRefs } from './request-operations.types';

export async function hasPendingSupplement(manager: EntityManager, requestId: string): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1 FROM request_event supplement
      WHERE supplement.request_id=$1 AND supplement.event_type='REPORTER_SUPPLEMENT'
        AND supplement.payload->>'pending_review'='true'
        AND NOT EXISTS (
          SELECT 1 FROM request_event review WHERE review.request_id=supplement.request_id
            AND review.event_type='SUPPLEMENT_REVIEW' AND review.payload->>'reviewed_event_id'=supplement.id::text
        ) LIMIT 1`, [requestId],
  ) as unknown[];
  return rows.length > 0;
}

export async function validConcurrence(
  manager: EntityManager, row: OperationRequestRow, eventId: string, reviewerId: string,
  currentGrants: RequestCoordinatorGrant[],
): Promise<{ actor_user_id: string }> {
  const rows = await manager.query(
    `SELECT actor_user_id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type='CONCURRENCE'`, [eventId, row.id],
  ) as Array<{ actor_user_id: string | null; payload: Record<string, unknown> | null }>;
  const event = rows[0];
  const payload = asObject(event?.payload);
  if (!event?.actor_user_id || event.actor_user_id === reviewerId ||
      !Object.hasOwn(payload, 'material_fact_event_id') ||
      payload.material_fact_event_id !== await latestMaterialFactEventId(manager, row.id)) {
    throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
  }
  if (!currentGrants.some((grant) => grant.role_code === 'COORDINATOR' && grant.user_id === event.actor_user_id && grantCovers(grant, row))) {
    throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
  }
  return { actor_user_id: event.actor_user_id };
}

export async function latestMaterialFactEventId(manager: EntityManager, requestId: string): Promise<string | null> {
  const rows = await manager.query(
    `SELECT id FROM request_event
      WHERE request_id=$1 AND event_type='REPORTER_SUPPLEMENT'
        AND (payload->'reported_facts' ? 'location' OR payload->'reported_facts' ? 'people_affected' OR
             payload->'reported_facts' ? 'reporter_declared_danger')
      ORDER BY (payload #>> '{result,version}')::int DESC NULLS LAST,id DESC LIMIT 1`, [requestId],
  ) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function validateSourceRefs(
  manager: EntityManager, row: OperationRequestRow, refs: VerifyRequestDto['source_refs'] | SupplementReviewDto['source_refs'] | undefined,
  session: ReporterSession,
): Promise<ValidatedSourceRefs> {
  const attemptIds = refs?.contact_attempt_ids ?? [];
  const evidenceIds = refs?.evidence_ids ?? [];
  const requestIds = refs?.request_ids ?? [];
  const attempts = attemptIds.length ? await manager.query(
    'SELECT id,outcome FROM contact_attempt WHERE request_id=$1 AND id=ANY($2::uuid[])', [row.id, attemptIds],
  ) as Array<{ id: string; outcome: string }> : [];
  if (attempts.length !== attemptIds.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
  const evidenceRows = evidenceIds.length ? await manager.query(
    `SELECT id,uploader_user_id,upload_source_ip_hash FROM evidence_metadata
      WHERE request_id=$1 AND state='READY' AND id=ANY($2::uuid[])`, [row.id, evidenceIds],
  ) as Array<{ id: string; uploader_user_id: string | null; upload_source_ip_hash: string | null }> : [];
  if (evidenceRows.length !== evidenceIds.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
  const requests: ValidatedSourceRefs['requests'] = [];
  if (requestIds.length) {
    const values: unknown[] = [row.id, requestIds];
    const scope = scopeSql(session.grants, 'REQUEST_VERIFY', values, 'candidate');
    const candidates = await manager.query(
      `SELECT candidate.id,candidate.reporter_user_id,candidate.reporter_contact_phone,candidate.source_ip_hash,
              target.reporter_user_id AS target_user_id,target.reporter_contact_phone AS target_phone,
              target.source_ip_hash AS target_ip
         FROM assistance_request target JOIN request_subject target_subject ON target_subject.request_id=target.id
         JOIN assistance_request candidate ON candidate.id=ANY($2::uuid[])
         JOIN request_subject candidate_subject ON candidate_subject.request_id=candidate.id
        WHERE target.id=$1 AND candidate.id<>target.id
          AND candidate.incident_category_code=target.incident_category_code
          AND candidate.received_at BETWEEN target.received_at-interval '24 hours' AND target.received_at+interval '24 hours'
          AND ST_DWithin(target_subject.location,candidate_subject.location,1000) AND ${scope}`,
      values,
    ) as Array<{ id: string; reporter_user_id: string | null; reporter_contact_phone: string | null; source_ip_hash: string | null; target_user_id: string | null; target_phone: string | null; target_ip: string | null }>;
    if (candidates.length !== requestIds.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
    for (const candidate of candidates) {
      const independent = !(candidate.target_user_id && candidate.reporter_user_id === candidate.target_user_id) &&
        !(candidate.target_phone && candidate.reporter_contact_phone === candidate.target_phone) &&
        !(candidate.target_ip && candidate.source_ip_hash === candidate.target_ip);
      requests.push({ id: candidate.id, independent });
    }
  }
  const evidence = evidenceRows.map((item) => ({
    ...item,
    independent: !(row.reporter_user_id && item.uploader_user_id === row.reporter_user_id) &&
      !(row.source_ip_hash && item.upload_source_ip_hash === row.source_ip_hash),
  }));
  return {
    attempts,
    evidence,
    requests,
    independent: requests.some((item) => item.independent) || evidence.some((item) => item.independent),
  };
}

export async function approvedFacts(
  manager: EntityManager, requestId: string, reported?: Record<string, unknown>, regionOverride?: string | null,
): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT r.report_mode,r.description,r.reporter_name,r.reporter_contact_phone,r.reporter_declared_danger,r.needs_rescue,r.needs_relief_supplies,
            r.region_code,r.campaign_id,r.incident_category_code,s.people_affected,s.children_count,s.elderly_count,s.location_source,
            s.location_accuracy_m,s.location_captured_at,ST_X(s.location::geometry) AS longitude,
            ST_Y(s.location::geometry) AS latitude,s.reporter_relationship,s.beneficiary_contact_phone,
            s.alternate_contact_name,s.alternate_contact_phone,s.information_source,s.last_known_situation_at,
            s.contactability,s.household_reference_note
       FROM assistance_request r JOIN request_subject s ON s.request_id=r.id WHERE r.id=$1`, [requestId],
  ) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) throw new AppError('INTERNAL_ERROR', { status: 500 });
  const facts: Record<string, unknown> = {
    report_mode: row.report_mode, incident_category_code: row.incident_category_code,
    description: row.description, reporter_name: row.reporter_name, reporter_contact_phone: row.reporter_contact_phone,
    reporter_declared_danger: row.reporter_declared_danger, needs_rescue: row.needs_rescue, needs_relief_supplies: row.needs_relief_supplies,
    region_code: regionOverride === undefined ? row.region_code : regionOverride,
    campaign_id: row.campaign_id, people_affected: row.people_affected, children_count: row.children_count, elderly_count: row.elderly_count,
    location: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)], source: row.location_source,
      accuracy_m: row.location_accuracy_m, captured_at: row.location_captured_at == null ? null : toIso(row.location_captured_at as Date | string) },
    reporter_relationship: row.reporter_relationship, beneficiary_contact_phone: row.beneficiary_contact_phone,
    alternate_contact: { name: row.alternate_contact_name, phone: row.alternate_contact_phone },
    information_source: row.information_source,
    last_known_situation_at: row.last_known_situation_at == null ? null : toIso(row.last_known_situation_at as Date | string),
    contactability: row.contactability, household_reference_note: row.household_reference_note,
  };
  if (reported) {
    for (const field of ['description', 'reporter_declared_danger', 'needs_rescue', 'needs_relief_supplies', 'people_affected', 'children_count', 'elderly_count', 'household_reference_note']) {
      if (Object.hasOwn(reported, field)) facts[field] = reported[field];
    }
    if (reported.location !== undefined) facts.location = reported.location;
  }
  return facts;
}
