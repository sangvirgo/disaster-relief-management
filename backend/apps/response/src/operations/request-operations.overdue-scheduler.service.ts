import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JobRunner } from '../../../../packages/technical/src/persistence/jobs';
import { grantCovers, openDangerStatuses } from './request-operations.helpers';
import { REQUEST_OPERATIONS_CONFIG } from './request-operations.config';
import { RequestCoordinatorGrant, ReporterSessionService } from '../requests/reporter-session';
import { OperationRequestRow, RequestOperationsConfig } from './request-operations.types';

@Injectable()
export class RequestOperationsOverdueSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RequestOperationsService');
  private readonly jobs: JobRunner;
  private stopSchedule?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_OPERATIONS_CONFIG) private readonly config: RequestOperationsConfig,
  ) {
    this.jobs = new JobRunner(dataSource, () => this.logger.warn('SCHEDULED_JOB_FAILED response.requests.overdue'));
  }

  onModuleInit(): void {
    this.stopSchedule = this.jobs.schedule('response.requests.overdue.timer', 30_000, async () => {
      queueMicrotask(() => { void this.scanOverdue().catch(() => this.logger.warn('SCHEDULED_JOB_FAILED response.requests.overdue')); });
    });
  }

  onModuleDestroy(): void { this.stopSchedule?.(); }

  private async scanOverdue(): Promise<number> {
    let rows: OperationRequestRow[] = [];
    const ran = await this.jobs.runOnce('response.requests.overdue.scan', async (manager) => {
      rows = await manager.query(
        `SELECT r.id,r.version,r.status,r.received_at,r.verifying_since,r.organization_id,r.region_code,r.campaign_id,
                r.reporter_declared_danger
           FROM assistance_request r
          WHERE ((r.status IN ('SUBMITTED','VERIFYING') AND
                    (r.reporter_declared_danger OR
                     (r.status='SUBMITTED' AND r.received_at<clock_timestamp()-($1 * interval '1 minute')) OR
                     (r.status='VERIFYING' AND r.verifying_since<clock_timestamp()-($1 * interval '1 minute'))))
                 OR (r.reporter_declared_danger AND r.status IN (${openDangerStatuses})))
            AND NOT EXISTS (SELECT 1 FROM notice n WHERE n.source_id=r.id AND n.source_version=r.version AND n.notice_type='REQUEST_OVERDUE')
          ORDER BY r.received_at,r.id LIMIT 100`,
        [this.config.overdueMinutes],
      ) as OperationRequestRow[];
    });
    if (!ran || !rows.length) return 0;
    const grants = new Map<string, RequestCoordinatorGrant[]>();
    for (const organizationId of new Set(rows.map((row) => row.organization_id))) {
      grants.set(organizationId, await this.sessions.requestCoordinatorGrants(organizationId));
    }
    const notices: Array<{ sourceId: string; version: number; recipient: string }> = [];
    for (const row of rows) {
      const recipients = new Set((grants.get(row.organization_id) ?? []).filter((grant) => grantCovers(grant, row)).map((grant) => grant.user_id));
      for (const recipient of recipients) notices.push({ sourceId: row.id, version: Number(row.version), recipient });
    }
    if (!notices.length) return 0;
    await this.dataSource.query(
      `INSERT INTO notice (source_id,source_version,recipient_user_id,notice_type,payload)
       SELECT entry.source_id,entry.source_version,entry.recipient_user_id,'REQUEST_OVERDUE',
              jsonb_build_object('text_code','REQUEST_OVERDUE','request_id',entry.source_id)
         FROM unnest($1::uuid[],$2::int[],$3::uuid[]) AS entry(source_id,source_version,recipient_user_id)
       ON CONFLICT (source_id,source_version,recipient_user_id,notice_type) DO NOTHING`,
      [notices.map((item) => item.sourceId), notices.map((item) => item.version), notices.map((item) => item.recipient)],
    );
    return notices.length;
  }
}
