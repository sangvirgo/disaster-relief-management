import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignEngagementAndSpatialMatching1794960000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campaign_engagement (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id uuid NOT NULL REFERENCES campaign(id),
        user_id uuid NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        last_active_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        ended_reason text,
        CONSTRAINT campaign_engagement_end_reason_check CHECK (ended_reason IS NULL OR ended_reason IN ('LEFT','EXPIRED','SWITCHED','CAMPAIGN_CLOSED')),
        CONSTRAINT campaign_engagement_end_pair_check CHECK ((ended_at IS NULL) = (ended_reason IS NULL)),
        CONSTRAINT campaign_engagement_end_after_start_check CHECK (ended_at IS NULL OR ended_at >= started_at),
        CONSTRAINT campaign_engagement_activity_after_start_check CHECK (last_active_at >= started_at)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX campaign_engagement_open_uq ON campaign_engagement (campaign_id,user_id) WHERE ended_at IS NULL`);
    await queryRunner.query(`CREATE INDEX campaign_engagement_user_open_idx ON campaign_engagement (user_id) WHERE ended_at IS NULL`);
    await queryRunner.query(`CREATE INDEX campaign_engagement_campaign_started_idx ON campaign_engagement (campaign_id,started_at)`);
    await queryRunner.query('GRANT SELECT, INSERT, UPDATE ON campaign_engagement TO c48_response_app');
    await queryRunner.query('REVOKE DELETE ON campaign_engagement FROM c48_response_app');

    await queryRunner.query('ALTER TABLE campaign ADD COLUMN center geography(Point,4326)');
    await queryRunner.query('ALTER TABLE campaign ADD COLUMN radius_m integer');
    await queryRunner.query(`
      ALTER TABLE campaign ADD CONSTRAINT campaign_spatial_pair_check CHECK ((center IS NULL) = (radius_m IS NULL))
    `);
    await queryRunner.query(`
      ALTER TABLE campaign ADD CONSTRAINT campaign_radius_range_check CHECK (radius_m IS NULL OR radius_m BETWEEN 500 AND 300000)
    `);
    await queryRunner.query('CREATE INDEX campaign_center_gist ON campaign USING gist(center) WHERE center IS NOT NULL');

    await queryRunner.query(`ALTER TABLE assistance_request ADD COLUMN campaign_match_state text NOT NULL DEFAULT 'UNMATCHED'`);
    await queryRunner.query('ALTER TABLE assistance_request ADD COLUMN campaign_candidate_ids uuid[]');
    await queryRunner.query(`
      UPDATE assistance_request
         SET campaign_match_state = CASE WHEN campaign_id IS NULL THEN 'UNMATCHED' ELSE 'MANUAL' END
    `);
    await queryRunner.query(`
      ALTER TABLE assistance_request ADD CONSTRAINT assistance_request_campaign_match_state_check
        CHECK (campaign_match_state IN ('UNMATCHED','AUTO_ATTACHED','CONFLICT','MANUAL'))
    `);
    await queryRunner.query(`
      ALTER TABLE assistance_request ADD CONSTRAINT assistance_request_campaign_conflict_check
        CHECK (campaign_match_state <> 'CONFLICT' OR
          (campaign_id IS NULL AND campaign_candidate_ids IS NOT NULL AND cardinality(campaign_candidate_ids) >= 2))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE assistance_request DROP CONSTRAINT IF EXISTS assistance_request_campaign_conflict_check');
    await queryRunner.query('ALTER TABLE assistance_request DROP CONSTRAINT IF EXISTS assistance_request_campaign_match_state_check');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS campaign_candidate_ids');
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS campaign_match_state');
    await queryRunner.query('DROP INDEX IF EXISTS campaign_center_gist');
    await queryRunner.query('ALTER TABLE campaign DROP CONSTRAINT IF EXISTS campaign_radius_range_check');
    await queryRunner.query('ALTER TABLE campaign DROP CONSTRAINT IF EXISTS campaign_spatial_pair_check');
    await queryRunner.query('ALTER TABLE campaign DROP COLUMN IF EXISTS radius_m');
    await queryRunner.query('ALTER TABLE campaign DROP COLUMN IF EXISTS center');
    await queryRunner.query('DROP INDEX IF EXISTS campaign_engagement_campaign_started_idx');
    await queryRunner.query('DROP INDEX IF EXISTS campaign_engagement_user_open_idx');
    await queryRunner.query('DROP INDEX IF EXISTS campaign_engagement_open_uq');
    await queryRunner.query('DROP TABLE IF EXISTS campaign_engagement');
  }
}
