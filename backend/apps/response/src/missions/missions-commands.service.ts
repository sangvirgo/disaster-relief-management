import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentOutcome, IdempotentResult,
} from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { ReporterSession, ReporterSessionService } from '../requests/reporter-session';
import { RequestOperationsService } from '../operations/request-operations.service';
import { cleanText, checkVersion } from '../operations/request-operations.helpers';
import { CreateMissionDto, MissionReasonDto, MissionTransitionDto, MissionVersionDto, RecordMissionOnBehalfDto } from './missions.dto';
import { missionProgressStatus, missionTransitionAllowed, MissionStatus } from './missions.helpers';

type MissionRequest = Request & { idempotencyKey?: string };
type Queryable = Pick<DataSource | EntityManager, 'query'>;
type MissionCommandView = {
  id: string;
  request_id: string;
  team_id: string;
  status: string;
  version: number;
  work_cycle: number;
  created_at: string;
  suggested_team_id: string | null;
};

interface RequestRow {
  id: string;
  status: string;
  version: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  incident_category_code: string;
  priority: string | null;
  priority_basis: string | null;
  work_cycle: number;
  verification_revision: string | null;
  attribution_locked_at: Date | string | null;
  reporter_user_id: string | null;
}

interface TeamRow {
  id: string;
  organization_id: string;
  operating_region_code: string;
  reporting_mode: 'APP' | 'COORDINATOR';
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  status: 'ACTIVE' | 'INACTIVE';
  readiness_required: boolean;
  external_contact_note: string | null;
}

interface MissionRow {
  id: string;
  request_id: string;
  team_id: string;
  work_cycle: number;
  status: MissionStatus;
  version: number;
  created_at: Date | string;
  suggested_team_id: string | null;
}

type ChangeMode = 'LEADER' | 'ON_BEHALF' | 'ASSIGN';

const activeMissionStatuses = ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];
const protectedRequestStatuses = ['RESOLVING', 'RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'];
const missionUniqueErrors = { unique: { mission_team_one_active_uq: 'TEAM_BUSY' } };

@Injectable()
export class MissionsCommandsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    private readonly operations: RequestOperationsService,
  ) {}

  async offer(requestId: string, dto: CreateMissionDto, key: string, request: MissionRequest): Promise<IdempotentResult<MissionCommandView>> {
    const session = await this.sessions.require(request);
    const candidatePage = await this.operations.teamCandidates(requestId, {}, request);
    const candidateItems = Array.isArray(candidatePage.items) ? candidatePage.items as Array<{ suggested?: boolean; team?: { id?: string } }> : [];
    const suggestedTeamId = candidateItems.find((item) => item.suggested && typeof item.team?.id === 'string')?.team?.id ?? null;
    const targetRows = await this.dataSource.query(
      `SELECT r.organization_id,t.reporting_mode FROM assistance_request r LEFT JOIN rescue_team t ON t.id=$2 WHERE r.id=$1`,
      [requestId, dto.team_id],
    ) as Array<{ organization_id: string; reporting_mode: TeamRow['reporting_mode'] | null }>;
    if (!targetRows[0]) throw new AppError('NOT_FOUND', { status: 404 });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.mission-offer:${requestId}:${session.userId}`,
      command: 'response.missions.offer',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      databaseErrorMappings: missionUniqueErrors,
      execute: (manager) => this.offerInTransaction(manager, requestId, dto, session, suggestedTeamId),
      replay: (manager, resource) => {
        if (resource?.type !== 'mission') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return this.missionValue(manager, requestId, resource.id);
      },
    });
  }

  accept(missionId: string, dto: MissionVersionDto, key: string, request: Request): Promise<IdempotentResult<MissionCommandView>> {
    return this.change(missionId, dto, key, request, { command: 'accept', target: 'ACCEPTED', mode: 'LEADER' });
  }

  decline(missionId: string, dto: MissionReasonDto, key: string, request: Request): Promise<IdempotentResult<MissionCommandView>> {
    return this.change(missionId, dto, key, request, { command: 'decline', target: 'DECLINED', mode: 'LEADER', reason: dto.reason });
  }

  transition(missionId: string, dto: MissionTransitionDto, key: string, request: Request): Promise<IdempotentResult<MissionCommandView>> {
    return this.change(missionId, dto, key, request, {
      command: 'transition', target: dto.to, mode: 'LEADER',
      ...(dto.note === undefined ? {} : { note: dto.note }),
      ...(dto.result?.outcome_note === undefined ? {} : { outcomeNote: dto.result.outcome_note }),
    });
  }

  recordOnBehalf(missionId: string, dto: RecordMissionOnBehalfDto, key: string, request: Request): Promise<IdempotentResult<MissionCommandView>> {
    return this.change(missionId, dto, key, request, {
      command: 'record-on-behalf', target: dto.to, mode: 'ON_BEHALF', reason: dto.reason,
      ...(dto.note === undefined ? {} : { note: dto.note }),
      ...(dto.result?.outcome_note === undefined ? {} : { outcomeNote: dto.result.outcome_note }),
      recordedBasis: dto.recorded_basis,
      reportedBy: dto.reported_by, occurredAt: dto.occurred_at,
    });
  }

  cancel(missionId: string, dto: MissionReasonDto, key: string, request: Request): Promise<IdempotentResult<MissionCommandView>> {
    return this.change(missionId, dto, key, request, { command: 'cancel', target: 'CANCELLED', mode: 'ASSIGN', reason: dto.reason });
  }

  fail(missionId: string, dto: MissionReasonDto, key: string, request: Request): Promise<IdempotentResult<MissionCommandView>> {
    return this.change(missionId, dto, key, request, { command: 'fail', target: 'FAILED', mode: 'ASSIGN', reason: dto.reason });
  }

  private async offerInTransaction(
    manager: EntityManager, requestId: string, dto: CreateMissionDto, session: ReporterSession, suggestedTeamId: string | null,
  ): Promise<IdempotentOutcome<MissionCommandView>> {
    const row = await this.lockRequest(manager, requestId, session, 'MISSION_ASSIGN', true);
    checkVersion(Number(row.version), dto.expected_version);
    if (!row.region_code) throw new AppError('REGION_REQUIRED', { status: 409 });
    if (!['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(row.status) || !row.priority || !row.priority_basis || !row.verification_revision) {
      throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    }

    const teamRows = await manager.query(
      `SELECT id,organization_id,operating_region_code,reporting_mode,availability,status,readiness_required,external_contact_note
         FROM rescue_team WHERE id=$1 FOR SHARE`, [dto.team_id],
    ) as TeamRow[];
    const team = teamRows[0];
    if (!team) throw new AppError('NOT_FOUND', { status: 404 });
    if (team.status !== 'ACTIVE') throw this.teamNotEligible('INACTIVE');
    if (team.availability !== 'AVAILABLE' || team.readiness_required) throw this.teamNotEligible('UNAVAILABLE');
    if (team.organization_id !== row.organization_id || team.operating_region_code !== row.region_code) throw this.teamNotEligible('SCOPE_MISMATCH');
    if (team.reporting_mode === 'COORDINATOR' && !team.external_contact_note?.trim()) throw new AppError('TEAM_NOT_ELIGIBLE', { status: 409 });

    const missingSkills = await manager.query(
      `SELECT 1 FROM incident_category_skill required
        WHERE required.category_code=$1 AND NOT EXISTS (
          SELECT 1 FROM team_skill assigned WHERE assigned.team_id=$2 AND assigned.skill_code=required.skill_code
        ) LIMIT 1`, [row.incident_category_code, team.id],
    ) as unknown[];
    if (missingSkills.length) throw this.teamNotEligible('SKILL_MISSING');
    const busy = await manager.query(
      `SELECT 1 FROM mission WHERE team_id=$1 AND status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE') LIMIT 1`, [team.id],
    ) as unknown[];
    if (busy.length) throw new AppError('TEAM_BUSY', { status: 409 });

    const leaders = team.reporting_mode === 'APP'
      ? await manager.query(
        `SELECT user_id FROM team_member WHERE team_id=$1 AND member_role='LEADER' AND left_at IS NULL FOR SHARE`, [team.id],
      ) as Array<{ user_id: string }>
      : [];
    if (team.reporting_mode === 'APP' && !leaders.length) throw new AppError('LEADER_REQUIRED', { status: 409 });
    const overrideReason = cleanText(dto.override_reason);
    if (dto.team_id !== suggestedTeamId && !overrideReason) throw new AppError('OVERRIDE_REASON_REQUIRED', { status: 400 });

    const inserted = await manager.query(
      `INSERT INTO mission
         (request_id,team_id,work_cycle,status,coordinator_user_id,suggested_team_id,override_reason,verification_revision)
       VALUES ($1,$2,$3,'OFFERED',$4,$5,$6,$7)
       RETURNING id,request_id,team_id,work_cycle,status,version,created_at,suggested_team_id`,
      [requestId, team.id, row.work_cycle, session.userId, suggestedTeamId, overrideReason, row.verification_revision],
    ) as MissionRow[];
    const mission = inserted[0];
    if (!mission) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await this.insertMissionEvent(manager, mission.id, session.userId, null, 'OFFERED', null, overrideReason, null, null);

    const active = await manager.query(
      `SELECT status FROM mission WHERE request_id=$1 AND work_cycle=$2 AND status=ANY($3::mission_status[])`,
      [requestId, row.work_cycle, activeMissionStatuses],
    ) as Array<{ status: string }>;
    const nextRequestStatus = missionProgressStatus(active.map(({ status }) => status), row.status);
    if (!nextRequestStatus) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    const [updatedRequest] = await manager.query(
      `UPDATE assistance_request
          SET status=$2,attribution_locked_at=COALESCE(attribution_locked_at,clock_timestamp()),version=version+1
        WHERE id=$1 AND version=$3 RETURNING id`,
      [requestId, nextRequestStatus, row.version],
    ) as [Array<{ id: string }>, number];
    if (!updatedRequest[0]) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
       VALUES ($1,$2,'MISSION_OFFERED','STAFF',$3,$4,$5::jsonb)`,
      [requestId, session.userId, row.status, nextRequestStatus, JSON.stringify({ mission_id: mission.id, suggested_team_id: suggestedTeamId })],
    );

    const recipients = team.reporting_mode === 'APP' ? leaders.map(({ user_id }) => user_id) : [session.userId];
    for (const recipient of recipients) {
      await manager.query(
        `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
         VALUES ($1,$2,1,'MISSION_OFFERED',jsonb_build_object('text_code','MISSION_OFFERED','mission_id',$2::uuid,'request_id',$3::uuid))
         ON CONFLICT DO NOTHING`, [recipient, mission.id, requestId],
      );
    }
    return { status: 201, value: this.commandView(mission), resource: { type: 'mission', id: mission.id } };
  }

  private async change(
    missionId: string,
    dto: MissionVersionDto | MissionReasonDto | MissionTransitionDto | RecordMissionOnBehalfDto,
    key: string,
    request: Request,
    change: {
      command: string; target: MissionStatus; mode: ChangeMode; reason?: string; note?: string; outcomeNote?: string;
      recordedBasis?: RecordMissionOnBehalfDto['recorded_basis']; reportedBy?: string; occurredAt?: string;
    },
  ): Promise<IdempotentResult<MissionCommandView>> {
    const session = await this.sessions.require(request);
    const refs = await this.dataSource.query('SELECT request_id,team_id FROM mission WHERE id=$1', [missionId]) as Array<{ request_id: string; team_id: string }>;
    if (!refs[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const { request_id: requestId, team_id: teamId } = refs[0];
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.mission:${missionId}:${session.userId}`,
      command: `response.missions.${change.command}`,
      key,
      requestHash: canonicalRequestHash({ mission_id: missionId, actor_user_id: session.userId, dto }),
      execute: (manager) => this.changeInTransaction(manager, missionId, requestId, teamId, dto.expected_version, session, change),
      replay: (manager, resource) => {
        if (resource?.type !== 'mission') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return this.missionValue(manager, requestId, resource.id);
      },
    });
  }

  private async changeInTransaction(
    manager: EntityManager, missionId: string, requestId: string, teamId: string, expectedVersion: number,
    session: ReporterSession,
    change: {
      command: string; target: MissionStatus; mode: ChangeMode; reason?: string; note?: string; outcomeNote?: string;
      recordedBasis?: RecordMissionOnBehalfDto['recorded_basis']; reportedBy?: string; occurredAt?: string;
    },
  ): Promise<IdempotentOutcome<MissionCommandView>> {
    const permission = change.mode === 'ON_BEHALF' ? 'MISSION_RECORD_ON_BEHALF' : change.mode === 'ASSIGN' ? 'MISSION_ASSIGN' : undefined;
    const request = await this.lockRequest(manager, requestId, session, permission);
    if (protectedRequestStatuses.includes(request.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    const teams = await manager.query(
      `SELECT id,organization_id,operating_region_code,reporting_mode,availability,status,readiness_required,external_contact_note
         FROM rescue_team WHERE id=$1 FOR SHARE`, [teamId],
    ) as TeamRow[];
    const team = teams[0];
    if (!team) throw new AppError('NOT_FOUND', { status: 404 });
    if (change.mode === 'LEADER') {
      const leaders = await manager.query(
        `SELECT 1 FROM team_member WHERE team_id=$1 AND user_id=$2 AND member_role='LEADER' AND left_at IS NULL FOR SHARE`,
        [teamId, session.userId],
      ) as unknown[];
      if (team.reporting_mode !== 'APP' || team.status !== 'ACTIVE' || !leaders.length) throw new AppError('MISSION_NOT_LEADER', { status: 403 });
    } else if (change.mode === 'ASSIGN' && !hasPermission(session.grants, 'MISSION_ASSIGN', {
      organizationId: request.organization_id, regionCode: request.region_code, campaignId: request.campaign_id,
    })) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }

    const missions = await manager.query(
      `SELECT id,request_id,team_id,work_cycle,status,version,created_at,suggested_team_id
         FROM mission WHERE id=$1 AND request_id=$2 AND team_id=$3 FOR UPDATE`, [missionId, requestId, teamId],
    ) as MissionRow[];
    const mission = missions[0];
    if (!mission) throw new AppError('NOT_FOUND', { status: 404 });
    checkVersion(Number(mission.version), expectedVersion);
    if (mission.work_cycle !== request.work_cycle || !missionTransitionAllowed(mission.status, change.target)) {
      throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    }

    const reason = this.eventReason(change);
    const outcomeNote = cleanText(change.outcomeNote ?? undefined);
    if (change.target === 'COMPLETED' && !outcomeNote) {
      throw new AppError('VALIDATION_FAILED', {
        status: 400, fieldErrors: { 'result.outcome_note': ['Vui lòng mô tả kết quả nhiệm vụ hoặc đính kèm bằng chứng.'] },
      });
    }
    if (change.mode === 'ON_BEHALF' && !change.recordedBasis) throw new AppError('RECORDED_BASIS_REQUIRED', { status: 400 });

    const [updates] = await manager.query(
      `UPDATE mission SET status=$2,version=version+1 WHERE id=$1 AND version=$3
       RETURNING id,request_id,team_id,work_cycle,status,version,created_at,suggested_team_id`,
      [missionId, change.target, expectedVersion],
    ) as [MissionRow[], number];
    const updated = updates[0];
    if (!updated) checkVersion(Number(mission.version), expectedVersion);
    await this.insertMissionEvent(
      manager, missionId, session.userId, mission.status, change.target, change.recordedBasis ?? null,
      reason, outcomeNote, change.occurredAt ?? null, change.reportedBy ?? null,
    );

    if (change.target === 'CANCELLED' && ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'].includes(mission.status)) {
      await manager.query(
        `UPDATE rescue_team SET availability='UNAVAILABLE',readiness_required=true,version=version+1
          WHERE id=$1 AND (availability IS DISTINCT FROM 'UNAVAILABLE' OR readiness_required IS DISTINCT FROM true)`, [teamId],
      );
    }
    await this.recomputeRequest(manager, request, session.userId, missionId);
    return { status: 200, value: this.commandView(updated!), resource: { type: 'mission', id: missionId } };
  }

  private async lockRequest(
    manager: EntityManager, requestId: string, session: ReporterSession,
    permission?: 'MISSION_ASSIGN' | 'MISSION_RECORD_ON_BEHALF', rejectPausedCampaign = false,
  ): Promise<RequestRow> {
    const pointers = await manager.query('SELECT campaign_id FROM assistance_request WHERE id=$1', [requestId]) as Array<{ campaign_id: string | null }>;
    if (!pointers[0]) throw new AppError('NOT_FOUND', { status: 404 });
    if (pointers[0].campaign_id) {
      const campaigns = await manager.query('SELECT status FROM campaign WHERE id=$1 FOR SHARE', [pointers[0].campaign_id]) as Array<{ status: string }>;
      if (!campaigns[0]) throw new AppError('NOT_FOUND', { status: 404 });
      if (rejectPausedCampaign && campaigns[0].status === 'PAUSED') throw new AppError('CAMPAIGN_PAUSED', { status: 409 });
    }
    const rows = await manager.query(
      `SELECT id,status,version,organization_id,region_code,campaign_id,incident_category_code,priority,priority_basis,
              work_cycle,verification_revision,attribution_locked_at,reporter_user_id
         FROM assistance_request WHERE id=$1 FOR UPDATE`,
      [requestId],
    ) as RequestRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    if (row.campaign_id !== pointers[0].campaign_id) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
    if (permission && !hasPermission(session.grants, permission, {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
    })) throw new AppError('FORBIDDEN', { status: 403 });
    return row;
  }

  private async recomputeRequest(manager: EntityManager, request: RequestRow, actorId: string, missionId: string): Promise<void> {
    const active = await manager.query(
      `SELECT status FROM mission WHERE request_id=$1 AND work_cycle=$2 AND status=ANY($3::mission_status[])`,
      [request.id, request.work_cycle, activeMissionStatuses],
    ) as Array<{ status: string }>;
    const nextStatus = missionProgressStatus(active.map(({ status }) => status), request.status);
    if (!nextStatus || nextStatus === request.status) return;
    const [updated] = await manager.query(
      `UPDATE assistance_request SET status=$2,version=version+1 WHERE id=$1 AND version=$3 RETURNING id`,
      [request.id, nextStatus, request.version],
    ) as [Array<{ id: string }>, number];
    if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(request.version) } });
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
       VALUES ($1,$2,'MISSION_PROGRESS_UPDATED','STAFF',$3,$4,$5::jsonb)`,
      [request.id, actorId, request.status, nextStatus, JSON.stringify({ mission_id: missionId })],
    );
  }

  private async insertMissionEvent(
    manager: EntityManager, missionId: string, actorId: string, fromStatus: string | null, toStatus: string,
    recordedBasis: string | null, reason: string | null, outcomeNote: string | null, occurredAt: string | null, reportedBy: string | null = null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO mission_event (mission_id,actor_user_id,from_status,to_status,recorded_basis,reported_by,reason,outcome_note,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,clock_timestamp()))`,
      [missionId, actorId, fromStatus, toStatus, recordedBasis, reportedBy, reason, outcomeNote, occurredAt],
    );
  }

  private eventReason(change: { mode: ChangeMode; reason?: string; note?: string }): string | null {
    const reason = cleanText(change.reason);
    const note = cleanText(change.note);
    if (change.mode === 'ON_BEHALF' && reason && note) return `${reason}\n${note}`;
    return reason ?? note;
  }

  private async missionValue(queryable: Queryable, requestId: string, missionId: string): Promise<MissionCommandView> {
    const rows = await queryable.query(
      `SELECT id,request_id,team_id,work_cycle,status,version,created_at,suggested_team_id
         FROM mission WHERE id=$1 AND request_id=$2`, [missionId, requestId],
    ) as MissionRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return this.commandView(rows[0]);
  }

  private commandView(row: MissionRow): MissionCommandView {
    return {
      id: row.id, request_id: row.request_id, team_id: row.team_id, status: row.status,
      version: Number(row.version), work_cycle: Number(row.work_cycle), created_at: new Date(row.created_at).toISOString(),
      suggested_team_id: row.suggested_team_id,
    };
  }

  private teamNotEligible(reason: 'INACTIVE' | 'UNAVAILABLE' | 'SCOPE_MISMATCH' | 'SKILL_MISSING'): AppError {
    return new AppError('TEAM_NOT_ELIGIBLE', { status: 409, details: { reason } });
  }
}
