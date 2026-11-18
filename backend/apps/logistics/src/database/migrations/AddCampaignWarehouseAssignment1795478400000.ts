import { MigrationInterface, QueryRunner } from 'typeorm';

// Campaign-to-warehouse assignment. Campaign geometry is owned by Response; Logistics keeps a local cache
// (campaign_area_snapshot) so the eligibility query stays inside the c48_logistics database. campaign_id is an
// opaque cross-service id, so it has no foreign key. assignment_version is the optimistic-concurrency token for
// manager overrides; it is bumped whenever the stored assignment changes.
export class AddCampaignWarehouseAssignment1795478400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE campaign_area_snapshot (
        campaign_id uuid PRIMARY KEY,
        center geography(Point,4326),
        radius_m integer CHECK (radius_m IS NULL OR radius_m > 0),
        status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','PAUSED','CLOSED')),
        updated_at timestamptz NOT NULL DEFAULT now(),
        assignment_version integer NOT NULL DEFAULT 0 CHECK (assignment_version >= 0),
        CHECK ((center IS NULL) = (radius_m IS NULL))
      )
    `);
    await queryRunner.query('CREATE INDEX campaign_area_snapshot_center_gist ON campaign_area_snapshot USING gist(center) WHERE center IS NOT NULL');
    await queryRunner.query(`
      CREATE TABLE campaign_warehouse (
        campaign_id uuid NOT NULL,
        warehouse_id uuid NOT NULL REFERENCES warehouse(id),
        role text NOT NULL CHECK (role IN ('PRIMARY','BACKUP')),
        source text NOT NULL CHECK (source IN ('AUTO','MANUAL')),
        distance_m integer CHECK (distance_m IS NULL OR distance_m >= 0),
        evaluated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
        PRIMARY KEY (campaign_id, warehouse_id)
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX campaign_warehouse_one_primary_uq ON campaign_warehouse (campaign_id) WHERE role = \'PRIMARY\'');
    await queryRunner.query('CREATE INDEX campaign_warehouse_warehouse_idx ON campaign_warehouse (warehouse_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS campaign_warehouse');
    await queryRunner.query('DROP TABLE IF EXISTS campaign_area_snapshot');
  }
}
