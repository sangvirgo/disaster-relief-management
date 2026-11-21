import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Relief points are out of scope: goods go from the warehouse straight to the household (DIRECT_HOUSEHOLD).
 * Removes the relief_point table, relief_need.designated_point_id, distribution.relief_point_id, the point handoff kinds
 * and the at_point custody counter. The migration refuses to run while point data exists so no history is silently lost;
 * reset the demo database (bash backend/scripts/db/reset-demo --reset) or clear that data first.
 */
export class RemoveReliefPoints1796256000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM relief_need WHERE designated_point_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM distribution WHERE relief_point_id IS NOT NULL OR purpose = 'POINT_REPLENISHMENT')
         OR EXISTS (SELECT 1 FROM handoff_record WHERE handoff_kind IN ('POINT_RECEIPT','HOUSEHOLD_HANDOUT') OR source_stage = 'AT_POINT')
         OR EXISTS (SELECT 1 FROM distribution_line WHERE at_point_quantity <> 0) THEN
        RAISE EXCEPTION 'Relief point data still exists; reset the demo database or clear it before removing relief points'
          USING ERRCODE = 'check_violation';
      END IF;
    END $$`);

    await queryRunner.query('DROP TRIGGER IF EXISTS relief_need_point_org_guard ON relief_need');
    await queryRunner.query('DROP TRIGGER IF EXISTS handoff_route_guard ON handoff_record');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_handoff_route()');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_need_point_org()');

    await queryRunner.query('ALTER TABLE relief_need DROP COLUMN IF EXISTS designated_point_id');
    await queryRunner.query('ALTER TABLE distribution DROP COLUMN IF EXISTS relief_point_id');
    await queryRunner.query('ALTER TABLE distribution_line DROP COLUMN IF EXISTS at_point_quantity');
    await queryRunner.query('DROP TABLE IF EXISTS relief_point');

    await this.replaceChecks(queryRunner, 'distribution', 'POINT_REPLENISHMENT',
      "ALTER TABLE distribution ADD CONSTRAINT distribution_purpose_check CHECK (purpose IN ('REQUEST_AID','CAMPAIGN_DISTRIBUTION'))");
    await this.replaceChecks(queryRunner, 'handoff_record', 'POINT_RECEIPT',
      "ALTER TABLE handoff_record ADD CONSTRAINT handoff_record_handoff_kind_check CHECK (handoff_kind IN ('DIRECT_HOUSEHOLD','RETURN','LOSS'))");
    await this.replaceChecks(queryRunner, 'handoff_record', 'AT_POINT',
      "ALTER TABLE handoff_record ADD CONSTRAINT handoff_record_source_stage_check CHECK (source_stage IN ('IN_TRANSIT'))");
    await queryRunner.query(
      'ALTER TABLE distribution_line ADD CONSTRAINT distribution_line_in_transit_check CHECK (in_transit_quantity <= quantity)',
    );

    await queryRunner.query(`CREATE OR REPLACE FUNCTION check_settlement_kind() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE k text;
      BEGIN
        SELECT r.handoff_kind INTO k FROM handoff_line l JOIN handoff_record r ON r.id = l.handoff_id WHERE l.id = NEW.handoff_line_id;
        IF NOT ((NEW.settlement_type = 'DELIVERED' AND k = 'DIRECT_HOUSEHOLD') OR
                (NEW.settlement_type = 'RETURNED' AND k = 'RETURN') OR (NEW.settlement_type = 'LOST' AND k = 'LOSS')) THEN
          RAISE EXCEPTION 'settlement % is not valid for handoff kind %', NEW.settlement_type, k USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.settlement_type = 'LOST' AND NOT EXISTS (SELECT 1 FROM handoff_loss_review r JOIN handoff_line l ON l.handoff_id = r.handoff_id WHERE l.id = NEW.handoff_line_id AND r.decision = 'APPROVE') THEN
          RAISE EXCEPTION 'a LOST settlement needs an APPROVE handoff_loss_review' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$`);
  }

  /** Best-effort rollback: restores the structures (empty) so the previous code can run; point data is not restored. */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE relief_point (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (is_clean_text(name)), contact_note text, operating_note text,
      location geography(Point,4326) NOT NULL,
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1
    )`);
    await queryRunner.query('ALTER TABLE relief_need ADD COLUMN designated_point_id uuid REFERENCES relief_point(id)');
    await queryRunner.query('ALTER TABLE distribution ADD COLUMN relief_point_id uuid REFERENCES relief_point(id)');
    await queryRunner.query('ALTER TABLE distribution_line ADD COLUMN at_point_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (at_point_quantity >= 0)');
    await queryRunner.query('ALTER TABLE distribution_line DROP CONSTRAINT IF EXISTS distribution_line_in_transit_check');
    await queryRunner.query('ALTER TABLE distribution_line ADD CONSTRAINT distribution_line_in_transit_check CHECK (in_transit_quantity + at_point_quantity <= quantity)');
    await queryRunner.query('ALTER TABLE distribution DROP CONSTRAINT IF EXISTS distribution_purpose_check');
    await queryRunner.query("ALTER TABLE distribution ADD CONSTRAINT distribution_purpose_check CHECK (purpose IN ('REQUEST_AID','CAMPAIGN_DISTRIBUTION','POINT_REPLENISHMENT'))");
    await queryRunner.query('ALTER TABLE handoff_record DROP CONSTRAINT IF EXISTS handoff_record_handoff_kind_check');
    await queryRunner.query("ALTER TABLE handoff_record ADD CONSTRAINT handoff_record_handoff_kind_check CHECK (handoff_kind IN ('DIRECT_HOUSEHOLD','POINT_RECEIPT','HOUSEHOLD_HANDOUT','RETURN','LOSS'))");
    await queryRunner.query('ALTER TABLE handoff_record DROP CONSTRAINT IF EXISTS handoff_record_source_stage_check');
    await queryRunner.query("ALTER TABLE handoff_record ADD CONSTRAINT handoff_record_source_stage_check CHECK (source_stage IN ('IN_TRANSIT','AT_POINT'))");
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON relief_point TO c48_logistics_app;
      END IF;
    END $$`);
  }

  /** Drops every CHECK on the table whose definition mentions the removed value, then adds the narrowed one. */
  private async replaceChecks(queryRunner: QueryRunner, table: string, marker: string, addSql: string): Promise<void> {
    await queryRunner.query(`DO $$
      DECLARE c record;
      BEGIN
        FOR c IN SELECT conname FROM pg_constraint
                  WHERE conrelid = '${table}'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%${marker}%'
        LOOP
          EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', c.conname);
        END LOOP;
      END $$`);
    await queryRunner.query(addSql);
  }
}
