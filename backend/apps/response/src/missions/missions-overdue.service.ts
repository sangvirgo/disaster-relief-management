import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { JobRunner } from '@c48/technical/persistence/jobs';
import { grantCovers } from '../operations/request-operations.helpers';
import { ReporterSessionService, RequestCoordinatorGrant } from '../requests/reporter-session';
import { MISSIONS_CONFIG, MissionsConfig } from './missions.config';

interface OverdueMissionRow {
  id: string;
  version: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

@Injectable()
export class MissionsOverdueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MissionsOverdueService.name);
  private readonly jobs: JobRunner;
  private stopSchedule?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(MISSIONS_CONFIG) private readonly config: MissionsConfig,
  ) {
    this.jobs = new JobRunner(dataSource, () => this.logger.warn('SCHEDULED_JOB_FAILED response.missions.overdue'));
  }

  onModuleInit(): void {
    this.stopSchedule = this.jobs.schedule('response.missions.overdue.timer', 30_000, async () => {
      queueMicrotask(() => { void this.scanOverdue().catch(() => this.logger.warn('SCHEDULED_JOB_FAILED response.missions.overdue')); });
    });
  }

  onModuleDestroy(): void {
    this.stopSchedule?.();
  }

  private async scanOverdue(): Promise<number> {
    let rows: OverdueMissionRow[] = [];
    const ran = await this.jobs.runOnce('response.missions.overdue.scan', async (manager) => {
      rows = await manager.query(
        `SELECT m.id,m.version,r.organization_id,r.region_code,r.campaign_id
           FROM mission m JOIN assistance_request r ON r.id=m.request_id
          WHERE m.status='OFFERED'
            AND m.created_at<=statement_timestamp()-($1::int*interval '1 minute')
            AND NOT EXISTS (SELECT 1 FROM notice n WHERE n.source_id=m.id AND n.source_version=m.version AND n.notice_type='MISSION_OFFER_OVERDUE')
          ORDER BY m.created_at,m.id LIMIT 100`, [this.config.offerOverdueMinutes],
      ) as OverdueMissionRow[];
    });
    if (!ran || !rows.length) return 0;

    const grants = new Map<string, RequestCoordinatorGrant[]>();
    for (const organizationId of new Set(rows.map((row) => row.organization_id))) {
      grants.set(organizationId, await this.sessions.requestCoordinatorGrants(organizationId));
    }
    const notices: Array<{ missionId: string; version: number; recipient: string }> = [];
    for (const row of rows) {
      const recipients = new Set((grants.get(row.organization_id) ?? []).filter((grant) => grantCovers(grant, row)).map((grant) => grant.user_id));
      for (const recipient of recipients) notices.push({ missionId: row.id, version: Number(row.version), recipient });
    }
    if (!notices.length) return 0;
    await this.dataSource.query(
      `INSERT INTO notice (source_id,source_version,recipient_user_id,notice_type,payload)
       SELECT entry.source_id,entry.source_version,entry.recipient_user_id,'MISSION_OFFER_OVERDUE',
              jsonb_build_object('text_code','MISSION_OFFER_OVERDUE','mission_id',entry.source_id)
         FROM unnest($1::uuid[],$2::int[],$3::uuid[]) AS entry(source_id,source_version,recipient_user_id)
         JOIN mission m ON m.id=entry.source_id AND m.version=entry.source_version AND m.status='OFFERED'
       ON CONFLICT (source_id,source_version,recipient_user_id,notice_type) DO NOTHING`,
      [notices.map((item) => item.missionId), notices.map((item) => item.version), notices.map((item) => item.recipient)],
    );
    return notices.length;
  }
}
