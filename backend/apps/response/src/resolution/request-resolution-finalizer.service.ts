import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { withDatabaseRetry } from '../../../../packages/technical/src/persistence/postgres-errors';
import { hasPermission, type Permission } from '../../../../packages/technical/src/security/permissions';
import { LogisticsCycleClient } from '../integrations/logistics/logistics-cycle.client';
import { ReporterSessionService, type RequestCoordinatorGrant } from '../requests/reporter-session';

type IntentSnapshot = {
  id: string;
  request_id: string;
  work_cycle: number;
  kind: 'RESOLUTION' | 'CANCELLATION';
  state: 'PENDING' | 'ABORTING' | 'COMPLETED' | 'ABORTED';
  actor_user_id: string;
  expected_request_version: number;
  previous_status: string;
  reason: string | null;
  request_status: string;
  request_version: number;
  abort_reason?: string | null;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  reporter_user_id: string | null;
  logistics_admitted_at: Date | string | null;
  outcome_basis: 'RESCUE_COMPLETED' | 'SUPPLY_ONLY' | 'NO_ACTION_REQUIRED' | null;
};

type MissionToCancel = { id: string; team_id: string; status: string; version: number };
type LockedRequest = { id: string; status: string; version: number; work_cycle: number; reporter_user_id: string | null; canonical_request_id: string | null };

const activeMissionStatuses = ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];
const teamEngagedStatuses = new Set(['ACCEPTED', 'EN_ROUTE', 'ON_SCENE']);

@Injectable()
export class RequestResolutionFinalizer {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logistics: LogisticsCycleClient,
    private readonly sessions: ReporterSessionService,
  ) {}

  async completePending(intentId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT i.id,i.request_id,i.work_cycle,i.kind,i.state,i.actor_user_id,i.expected_request_version,
              i.previous_status,i.reason,r.status AS request_status,r.version AS request_version,
              r.organization_id,r.region_code,r.campaign_id,r.reporter_user_id,r.logistics_admitted_at,
              (SELECT e.payload->>'outcome_basis' FROM request_event e
                WHERE e.request_id=i.request_id AND e.event_type='RESOLUTION_INTENT_CREATED'
                  AND e.payload->>'intent_id'=i.id::text ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) AS outcome_basis
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id WHERE i.id=$1`,
      [intentId],
    ) as IntentSnapshot[];
    const intent = rows[0];
    if (!intent || intent.state !== 'PENDING' || intent.request_status !== 'RESOLVING') return false;
    if (!await this.actorStillAuthorized(intent)) return false;

    if (intent.logistics_admitted_at !== null) {
      if (intent.kind === 'RESOLUTION') {
        if (!intent.outcome_basis) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.logistics.seal(intent.request_id, Number(intent.work_cycle), {
          intent_id: intent.id,
          outcome_basis: intent.outcome_basis,
        });
      } else {
        await this.logistics.freeze(intent.request_id, Number(intent.work_cycle), { intent_id: intent.id });
      }
    }

    return withDatabaseRetry(() => this.dataSource.transaction(async (manager) => {
      // This compare-and-set is deliberately the finalizer transaction's first business statement.
      const [claimed] = await manager.query(
        `UPDATE resolution_intent SET state='COMPLETED',version=version+1,updated_at=clock_timestamp()
          WHERE id=$1 AND state='PENDING' RETURNING id,request_id,work_cycle,kind,actor_user_id,
                                                     expected_request_version,previous_status,reason`,
        [intent.id],
      ) as [Array<Pick<IntentSnapshot, 'id' | 'request_id' | 'work_cycle' | 'kind' | 'actor_user_id' | 'expected_request_version' | 'previous_status' | 'reason'>>, number];
      const completed = claimed?.[0];
      if (!completed) return false;

      const requestRefs = await manager.query(
        `SELECT id FROM assistance_request WHERE id=$1
          OR (canonical_request_id=$1 AND status='DUPLICATE') ORDER BY id`, [completed.request_id],
      ) as Array<{ id: string }>;
      const lockedRequests = new Map<string, LockedRequest>();
      for (const ref of requestRefs) {
        const rows = await manager.query(
          `SELECT id,status,version,work_cycle,reporter_user_id,canonical_request_id
             FROM assistance_request WHERE id=$1 FOR UPDATE`, [ref.id],
        ) as LockedRequest[];
        if (rows[0]) lockedRequests.set(rows[0].id, rows[0]);
      }
      const request = lockedRequests.get(completed.request_id);
      if (!request || request.status !== 'RESOLVING' || Number(request.version) !== Number(completed.expected_request_version) ||
          Number(request.work_cycle) !== Number(completed.work_cycle)) {
        throw new AppError('VERSION_CONFLICT', { status: 409 });
      }

      const duplicateRefs = completed.kind === 'CANCELLATION'
        ? await manager.query(
          `SELECT id FROM assistance_request WHERE canonical_request_id=$1 AND status='DUPLICATE' ORDER BY id`, [completed.request_id],
        ) as Array<{ id: string }>
        : [];
      for (const ref of duplicateRefs) {
        if (lockedRequests.has(ref.id)) continue;
        const rows = await manager.query(
          `SELECT id,status,version,work_cycle,reporter_user_id,canonical_request_id
             FROM assistance_request WHERE id=$1 FOR UPDATE`, [ref.id],
        ) as LockedRequest[];
        if (rows[0]?.status === 'DUPLICATE' && rows[0].canonical_request_id === completed.request_id) {
          lockedRequests.set(rows[0].id, rows[0]);
        }
      }

      if (completed.kind === 'CANCELLATION') {
        await this.cancelCurrentMissions(manager, completed);
      }
      const nextStatus = completed.kind === 'RESOLUTION' ? 'RESOLVED' : 'CANCELLED';
      const eventType = completed.kind === 'RESOLUTION' ? 'REQUEST_RESOLVED' : 'REQUEST_CANCELLED';
      const [updated] = await manager.query(
        `UPDATE assistance_request
            SET status=$2,
                resolved_at=CASE WHEN $5::boolean THEN clock_timestamp() ELSE NULL END,
                resolution_seal_id=CASE WHEN $5::boolean AND logistics_admitted_at IS NOT NULL THEN $3::uuid ELSE NULL END,
                version=version+1
          WHERE id=$1 AND status='RESOLVING' AND version=$4
          RETURNING id,status,version,reporter_user_id`,
        [completed.request_id, nextStatus, completed.kind === 'RESOLUTION' ? completed.id : null, completed.expected_request_version,
          completed.kind === 'RESOLUTION'],
      ) as [Array<{ id: string; status: string; version: number; reporter_user_id: string | null }>, number];
      const result = updated?.[0];
      if (!result) throw new AppError('VERSION_CONFLICT', { status: 409 });

      await manager.query(
        `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
         VALUES ($1,$2,$3,'REPORTER','RESOLVING',$4,$5,$6::jsonb)`,
        [completed.request_id, completed.actor_user_id, eventType, nextStatus, completed.reason,
          JSON.stringify({ operation_id: completed.id, ...(intent.outcome_basis ? { outcome_basis: intent.outcome_basis } : {}) })],
      );
      if (result.reporter_user_id) {
        await manager.query(
          `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
           VALUES ($1,$2,$3,'REQUEST_STATUS_CHANGED',jsonb_build_object('text_code',$4::text,'request_id',$2::uuid))
           ON CONFLICT DO NOTHING`,
          [result.reporter_user_id, result.id, Number(result.version), eventType],
        );
      }
      if (completed.kind === 'CANCELLATION') {
        await this.orphanInboundDuplicates(manager, completed, [...lockedRequests.values()].filter((row) => row.id !== completed.request_id &&
          row.status === 'DUPLICATE' && row.canonical_request_id === completed.request_id));
      }
      return true;
    }));
  }

  async abortIntent(intentId: string, abortReason: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT i.id,i.request_id,i.work_cycle,i.kind,i.state,i.actor_user_id,i.expected_request_version,
              i.previous_status,i.reason,r.status AS request_status,r.version AS request_version,
              r.organization_id,r.region_code,r.campaign_id,r.reporter_user_id,r.logistics_admitted_at,NULL::text AS outcome_basis,
              (SELECT e.reason FROM request_event e WHERE e.request_id=i.request_id
                AND e.event_type=CASE WHEN i.kind='RESOLUTION' THEN 'RESOLUTION_ABORT_REQUESTED' ELSE 'CANCELLATION_ABORT_REQUESTED' END
                AND e.payload->>'operation_id'=i.id::text ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) AS abort_reason
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id WHERE i.id=$1`, [intentId],
    ) as IntentSnapshot[];
    const intent = rows[0];
    if (!intent || intent.state !== 'ABORTING' || intent.request_status !== 'RESOLVING') return false;
    if (intent.logistics_admitted_at !== null) {
      await this.logistics.unseal(intent.request_id, Number(intent.work_cycle), { intent_id: intent.id });
    }

    const durableAbortReason = intent.abort_reason ?? abortReason;
    return withDatabaseRetry(() => this.dataSource.transaction(async (manager) => {
      const [claimed] = await manager.query(
        `UPDATE resolution_intent SET state='ABORTED',version=version+1,updated_at=clock_timestamp()
          WHERE id=$1 AND state='ABORTING' RETURNING id,request_id,work_cycle,kind,actor_user_id,
                                                      expected_request_version,previous_status`,
        [intent.id],
      ) as [Array<Pick<IntentSnapshot, 'id' | 'request_id' | 'work_cycle' | 'kind' | 'actor_user_id' | 'expected_request_version' | 'previous_status'>>, number];
      const aborted = claimed?.[0];
      if (!aborted) return false;

      const requestRows = await manager.query(
        `SELECT id,status,version,work_cycle,reporter_user_id FROM assistance_request
          WHERE id=$1 FOR UPDATE`, [aborted.request_id],
      ) as Array<{ id: string; status: string; version: number; work_cycle: number; reporter_user_id: string | null }>;
      const request = requestRows[0];
      if (!request || request.status !== 'RESOLVING' || Number(request.version) !== Number(aborted.expected_request_version) ||
          Number(request.work_cycle) !== Number(aborted.work_cycle)) throw new AppError('VERSION_CONFLICT', { status: 409 });
      const active = await manager.query(
        `SELECT status FROM mission WHERE request_id=$1 AND work_cycle=$2 AND status=ANY($3::mission_status[])`,
        [aborted.request_id, aborted.work_cycle, activeMissionStatuses],
      ) as Array<{ status: string }>;
      const restoredStatus = active.some(({ status }) => teamEngagedStatuses.has(status))
        ? 'IN_PROGRESS'
        : active.some(({ status }) => status === 'OFFERED') ? 'DISPATCHED' : aborted.previous_status;
      const [updated] = await manager.query(
        `UPDATE assistance_request SET status=$2,resolved_at=NULL,resolution_seal_id=NULL,version=version+1
          WHERE id=$1 AND status='RESOLVING' AND version=$3 RETURNING id,status,version,reporter_user_id`,
        [aborted.request_id, restoredStatus, aborted.expected_request_version],
      ) as [Array<{ id: string; status: string; version: number; reporter_user_id: string | null }>, number];
      const result = updated?.[0];
      if (!result) throw new AppError('VERSION_CONFLICT', { status: 409 });
      const eventType = aborted.kind === 'RESOLUTION' ? 'RESOLUTION_ABORTED' : 'CANCELLATION_ABORTED';
      await manager.query(
        `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
         VALUES ($1,$2,$3,'STAFF','RESOLVING',$4,$5,$6::jsonb)`,
        [aborted.request_id, aborted.actor_user_id, eventType, restoredStatus, durableAbortReason,
          JSON.stringify({ operation_id: aborted.id })],
      );
      if (result.reporter_user_id) {
        await manager.query(
          `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
           VALUES ($1,$2,$3,'REQUEST_STATUS_CHANGED',jsonb_build_object('text_code','REQUEST_STATUS_CHANGED','request_id',$2::uuid))
           ON CONFLICT DO NOTHING`, [result.reporter_user_id, result.id, Number(result.version)],
        );
      }
      return true;
    }));
  }

  private async actorStillAuthorized(intent: IntentSnapshot): Promise<boolean> {
    const grants = await this.sessions.requestCoordinatorGrants(intent.organization_id);
    const actorGrants = grants.filter(({ user_id }) => user_id === intent.actor_user_id).map((grant) => ({
      role_code: grant.role_code,
      scope_type: grant.scope_type,
      organization_id: grant.organization_id,
      region_code: grant.region_code,
      campaign_id: grant.campaign_id,
    }));
    const permission: Permission = intent.kind === 'CANCELLATION' ? 'REQUEST_CANCEL' : 'REQUEST_RESOLVE';
    return hasPermission(actorGrants, permission, {
      organizationId: intent.organization_id,
      regionCode: intent.region_code,
      campaignId: intent.campaign_id,
    });
  }

  private async cancelCurrentMissions(
    manager: EntityManager,
    intent: Pick<IntentSnapshot, 'request_id' | 'work_cycle' | 'actor_user_id' | 'reason'>,
  ): Promise<void> {
    const missionRefs = await manager.query(
      `SELECT id,team_id,status,version FROM mission
        WHERE request_id=$1 AND work_cycle=$2 AND status=ANY($3::mission_status[])
        ORDER BY team_id,id`, [intent.request_id, intent.work_cycle, activeMissionStatuses],
    ) as MissionToCancel[];
    if (!missionRefs.length) return;

    const teamIds = [...new Set(missionRefs.map(({ team_id }) => team_id))].sort();
    await manager.query(
      'SELECT id FROM rescue_team WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [teamIds],
    );
    const missions = await manager.query(
      `SELECT id,team_id,status,version FROM mission
        WHERE request_id=$1 AND work_cycle=$2 AND status=ANY($3::mission_status[])
        ORDER BY id FOR UPDATE`, [intent.request_id, intent.work_cycle, activeMissionStatuses],
    ) as MissionToCancel[];
    const engagedTeams = [...new Set(missions.filter(({ status }) => teamEngagedStatuses.has(status)).map(({ team_id }) => team_id))].sort();
    if (engagedTeams.length) {
      await manager.query(
        `UPDATE rescue_team SET availability='UNAVAILABLE',readiness_required=true,version=version+1
          WHERE id=ANY($1::uuid[])
            AND (availability IS DISTINCT FROM 'UNAVAILABLE' OR readiness_required IS DISTINCT FROM true)`, [engagedTeams],
      );
    }
    for (const mission of missions) {
      const [updated] = await manager.query(
        `UPDATE mission SET status='CANCELLED',version=version+1
          WHERE id=$1 AND status=$2 AND version=$3 RETURNING id,version`,
        [mission.id, mission.status, mission.version],
      ) as [Array<{ id: string; version: number }>, number];
      if (!updated?.[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
      await manager.query(
        `INSERT INTO mission_event (mission_id,actor_user_id,from_status,to_status,reason)
         VALUES ($1,$2,$3,'CANCELLED',$4)`, [mission.id, intent.actor_user_id, mission.status, intent.reason],
      );
    }
  }

  private async orphanInboundDuplicates(
    manager: EntityManager,
    intent: Pick<IntentSnapshot, 'id' | 'request_id' | 'actor_user_id'>,
    children: LockedRequest[],
  ): Promise<void> {
    for (const child of children) {
      const [updated] = await manager.query(
        `UPDATE assistance_request SET status='VERIFYING',canonical_request_id=NULL,
                verifying_since=clock_timestamp(),version=version+1
          WHERE id=$1 AND canonical_request_id=$2 AND status='DUPLICATE' AND version=$3
          RETURNING id,version`, [child.id, intent.request_id, child.version],
      ) as [Array<{ id: string; version: number }>, number];
      if (!updated?.[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
      await manager.query(
        `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
         VALUES ($1,NULL,'DUPLICATE_ORPHANED','REPORTER','DUPLICATE','VERIFYING',$2::jsonb)`,
        [child.id, JSON.stringify({ public_text_code: 'DUPLICATE_ORPHANED', canonical_request_id: intent.request_id,
          operation_id: intent.id, resulting_version: Number(updated[0].version) })],
      );
      if (child.reporter_user_id) {
        await manager.query(
          `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
           VALUES ($1,$2,$3,'REQUEST_STATUS_CHANGED',jsonb_build_object('text_code','DUPLICATE_ORPHANED','request_id',$2::uuid))
           ON CONFLICT DO NOTHING`, [child.reporter_user_id, child.id, Number(updated[0].version)],
        );
      }
    }
  }
}
