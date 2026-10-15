import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { jitteredInterval } from '../../../../packages/technical/src/persistence/postgres-errors';
import { LogisticsResponseCampaignClient } from '../integrations/response/response-campaign.client';

const intervalMs = 5 * 60_000;
const jobName = 'logistics.donation-drive-campaign-sync';

interface OpenDriveRow {
  id: string;
  organization_id: string;
  campaign_status: string | null;
  version: number | string;
}

@Injectable()
export class DriveCampaignSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LogisticsDriveCampaignSync');
  private timer?: NodeJS.Timeout;
  private active = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly campaigns: LogisticsResponseCampaignClient,
  ) {}

  onModuleInit(): void {
    if (process.env.SCHEDULER_ENABLED !== 'true') return;
    this.active = true;
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
  }

  async syncCampaign(campaignId: string): Promise<void> {
    let campaign;
    try {
      campaign = await this.campaigns.getCampaign(campaignId);
    } catch (error) {
      const code = error instanceof AppError ? error.code : undefined;
      if (code === 'RESPONSE_UNAVAILABLE' || code === 'IDENTITY_UNAVAILABLE') return;
      throw error;
    }

    await this.dataSource.transaction(async (manager) => {
      const drives = await manager.query(
        `SELECT id,organization_id,campaign_status,version FROM donation_drive
          WHERE campaign_id=$1 AND status='OPEN' ORDER BY id FOR UPDATE`,
        [campaignId],
      ) as OpenDriveRow[];
      for (const drive of drives) {
        const closing = campaign.status === 'CLOSED';
        await manager.query(
          `UPDATE donation_drive SET campaign_status=$2,campaign_status_at=clock_timestamp(),
                  status=CASE WHEN $3::boolean THEN 'CLOSED' ELSE status END,
                  version=version+CASE WHEN $3::boolean OR campaign_status IS DISTINCT FROM $2 THEN 1 ELSE 0 END
            WHERE id=$1 AND status='OPEN'`,
          [drive.id, campaign.status, closing],
        );
        if (closing) {
          const after = { id: drive.id, organization_id: drive.organization_id, status: 'CLOSED', campaign_status: 'CLOSED', version: Number(drive.version) + 1 };
          const before = { id: drive.id, organization_id: drive.organization_id, status: 'OPEN', campaign_status: drive.campaign_status, version: Number(drive.version) };
          await manager.query(
            `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
             VALUES (NULL,'DRIVE_CLOSED_CAMPAIGN','donation_drive',$1,$2::jsonb,$3::jsonb,'CAMPAIGN_CLOSED')`,
            [drive.id, JSON.stringify(before), JSON.stringify(after)],
          );
        }
      }
    });
  }

  private scheduleNext(): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      void this.runScheduled().finally(() => this.scheduleNext());
    }, jitteredInterval(intervalMs));
    this.timer.unref();
  }

  private async runScheduled(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const rows = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [jobName]) as Array<{ locked: boolean }>;
      locked = Boolean(rows[0]?.locked);
      if (!locked) return;
      const campaigns = await runner.query(
        "SELECT DISTINCT campaign_id FROM donation_drive WHERE status='OPEN' AND campaign_id IS NOT NULL ORDER BY campaign_id",
      ) as Array<{ campaign_id: string }>;
      for (const row of campaigns) await this.syncCampaign(row.campaign_id);
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';
      this.logger.error({ code }, 'Drive campaign synchronization failed');
    } finally {
      if (locked) await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [jobName]).catch(() => undefined);
      await runner.release().catch(() => undefined);
    }
  }
}
