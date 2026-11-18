import { MigrationInterface, QueryRunner } from 'typeorm';

// Supply gap suggestions (proposal section 3.4). One row per (warehouse, item) while OPEN; the system refreshes that row
// instead of inserting duplicates. RED rows carry a draft donation drive that a manager must accept; YELLOW rows are
// warnings only and keep an empty draft. Quantities use numeric(18,3) like stock_balance and follow the item unit scale.
// gap_qty may be zero or negative on YELLOW rows (demand is below supply but close to it).
export class AddSupplyGaps1795564800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE supply_gap (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      warehouse_id uuid NOT NULL REFERENCES warehouse(id),
      item_id uuid NOT NULL REFERENCES item(id),
      demand numeric(18,3) NOT NULL CHECK (demand >= 0),
      supply numeric(18,3) NOT NULL CHECK (supply >= 0),
      pledged numeric(18,3) NOT NULL DEFAULT 0 CHECK (pledged >= 0),
      gap_qty numeric(18,3) NOT NULL,
      severity text NOT NULL CHECK (severity IN ('YELLOW','RED')),
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED','DISMISSED','EXPIRED')),
      campaign_ids uuid[] NOT NULL DEFAULT '{}',
      backup_warehouse_ids uuid[] NOT NULL DEFAULT '{}',
      reason_codes text[] NOT NULL DEFAULT '{}',
      draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
      drive_id uuid REFERENCES donation_drive(id),
      dismissed_reason text CHECK (dismissed_reason IS NULL OR btrim(dismissed_reason) <> ''),
      dismissed_until timestamptz,
      computed_at timestamptz NOT NULL DEFAULT now(),
      version int NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (severity <> 'RED' OR gap_qty > 0),
      CHECK (status <> 'ACCEPTED' OR drive_id IS NOT NULL),
      CHECK (status <> 'DISMISSED' OR (dismissed_reason IS NOT NULL AND dismissed_until IS NOT NULL))
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX supply_gap_open_uq ON supply_gap (warehouse_id, item_id) WHERE status = \'OPEN\'');
    await queryRunner.query('CREATE INDEX supply_gap_status_idx ON supply_gap (status)');
    await queryRunner.query('CREATE INDEX supply_gap_scope_idx ON supply_gap (created_at DESC, id DESC)');
    // Guarded like the other migrations so a migration-only database without the application role still migrates.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON supply_gap TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS supply_gap');
  }
}
