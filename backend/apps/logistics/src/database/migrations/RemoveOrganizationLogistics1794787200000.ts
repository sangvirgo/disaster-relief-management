import { MigrationInterface, QueryRunner } from 'typeorm';

// Organization is removed from Logistics. Warehouses, relief points, vehicles and donation drives are
// shared resources (SYSTEM scope); campaign-attached rows keep campaign_id for CAMPAIGN scope.
// Composite (id, organization_id) keys/FKs and the same-organization guards are dropped.
// Rollback restores the structure only: organization attribution is not recoverable and the
// re-added columns are nullable.
const ATTRIBUTED_TABLES = [
  'warehouse',
  'relief_point',
  'vehicle',
  'donation_drive',
  'donation_delivery',
  'fulfillment_cycle',
  'distribution',
] as const;

export class RemoveOrganizationLogistics1794787200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS relief_need_point_org_guard ON relief_need');
    await queryRunner.query('DROP TRIGGER IF EXISTS commitment_warehouse_org_guard ON commitment');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_need_point_org()');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_commitment_warehouse_org()');

    // Composite FKs that reference (id, organization_id) targets must go before those targets lose the column.
    await queryRunner.query('ALTER TABLE donation_delivery DROP CONSTRAINT IF EXISTS donation_delivery_drive_id_organization_id_fkey');
    await queryRunner.query('ALTER TABLE donation_drive DROP CONSTRAINT IF EXISTS donation_drive_intake_warehouse_id_organization_id_fkey');
    await queryRunner.query('ALTER TABLE distribution DROP CONSTRAINT IF EXISTS distribution_warehouse_id_organization_id_fkey');
    await queryRunner.query('ALTER TABLE distribution DROP CONSTRAINT IF EXISTS distribution_relief_point_id_organization_id_fkey');
    await queryRunner.query('ALTER TABLE distribution DROP CONSTRAINT IF EXISTS distribution_vehicle_id_organization_id_fkey');
    await queryRunner.query('ALTER TABLE warehouse DROP CONSTRAINT IF EXISTS warehouse_id_organization_id_key');
    await queryRunner.query('ALTER TABLE relief_point DROP CONSTRAINT IF EXISTS relief_point_id_organization_id_key');
    await queryRunner.query('ALTER TABLE vehicle DROP CONSTRAINT IF EXISTS vehicle_id_organization_id_key');
    await queryRunner.query('ALTER TABLE donation_drive DROP CONSTRAINT IF EXISTS donation_drive_id_organization_id_key');
    await queryRunner.query('ALTER TABLE donation_delivery DROP CONSTRAINT IF EXISTS donation_delivery_id_organization_id_key');

    for (const index of [
      'warehouse_scope_idx',
      'relief_point_scope_idx',
      'vehicle_identifier_uq',
      'drive_scope_idx',
      'delivery_work_idx',
      'cycle_scope_idx',
      'distribution_scope_idx',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS ${index}`);
    }

    for (const table of ATTRIBUTED_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN organization_id`);
    }

    await queryRunner.query('CREATE INDEX warehouse_active_idx ON warehouse (created_at, id) WHERE status = \'ACTIVE\'');
    await queryRunner.query('CREATE INDEX relief_point_active_idx ON relief_point (created_at, id) WHERE status = \'ACTIVE\'');
    await queryRunner.query('CREATE UNIQUE INDEX vehicle_identifier_uq ON vehicle (lower(identifier))');
    await queryRunner.query('CREATE INDEX drive_campaign_created_idx ON donation_drive (campaign_id, created_at DESC, id DESC)');
    await queryRunner.query(`
      CREATE INDEX delivery_work_idx ON donation_delivery (created_at, id)
       WHERE status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED')
    `);
    await queryRunner.query('CREATE INDEX cycle_campaign_created_idx ON fulfillment_cycle (campaign_id, created_at DESC, id DESC)');
    await queryRunner.query('CREATE INDEX distribution_campaign_created_idx ON distribution (campaign_id, created_at, id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS distribution_campaign_created_idx');
    await queryRunner.query('DROP INDEX IF EXISTS cycle_campaign_created_idx');
    await queryRunner.query('DROP INDEX IF EXISTS delivery_work_idx');
    await queryRunner.query('DROP INDEX IF EXISTS drive_campaign_created_idx');
    await queryRunner.query('DROP INDEX IF EXISTS vehicle_identifier_uq');
    await queryRunner.query('DROP INDEX IF EXISTS relief_point_active_idx');
    await queryRunner.query('DROP INDEX IF EXISTS warehouse_active_idx');

    for (const table of ATTRIBUTED_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN organization_id uuid`);
    }

    await queryRunner.query('ALTER TABLE warehouse ADD CONSTRAINT warehouse_id_organization_id_key UNIQUE (id,organization_id)');
    await queryRunner.query('ALTER TABLE relief_point ADD CONSTRAINT relief_point_id_organization_id_key UNIQUE (id,organization_id)');
    await queryRunner.query('ALTER TABLE vehicle ADD CONSTRAINT vehicle_id_organization_id_key UNIQUE (id,organization_id)');
    await queryRunner.query('ALTER TABLE donation_drive ADD CONSTRAINT donation_drive_id_organization_id_key UNIQUE (id,organization_id)');
    await queryRunner.query('ALTER TABLE donation_delivery ADD CONSTRAINT donation_delivery_id_organization_id_key UNIQUE (id,organization_id)');
    await queryRunner.query(`
      ALTER TABLE donation_drive ADD CONSTRAINT donation_drive_intake_warehouse_id_organization_id_fkey
        FOREIGN KEY (intake_warehouse_id, organization_id) REFERENCES warehouse(id, organization_id)
    `);
    await queryRunner.query(`
      ALTER TABLE donation_delivery ADD CONSTRAINT donation_delivery_drive_id_organization_id_fkey
        FOREIGN KEY (drive_id, organization_id) REFERENCES donation_drive(id, organization_id)
    `);
    await queryRunner.query(`
      ALTER TABLE distribution ADD CONSTRAINT distribution_warehouse_id_organization_id_fkey
        FOREIGN KEY (warehouse_id, organization_id) REFERENCES warehouse(id, organization_id)
    `);
    await queryRunner.query(`
      ALTER TABLE distribution ADD CONSTRAINT distribution_relief_point_id_organization_id_fkey
        FOREIGN KEY (relief_point_id, organization_id) REFERENCES relief_point(id, organization_id)
    `);
    await queryRunner.query(`
      ALTER TABLE distribution ADD CONSTRAINT distribution_vehicle_id_organization_id_fkey
        FOREIGN KEY (vehicle_id, organization_id) REFERENCES vehicle(id, organization_id)
    `);

    await queryRunner.query('CREATE INDEX warehouse_scope_idx ON warehouse (organization_id) WHERE status = \'ACTIVE\'');
    await queryRunner.query('CREATE INDEX relief_point_scope_idx ON relief_point (organization_id) WHERE status = \'ACTIVE\'');
    await queryRunner.query('CREATE UNIQUE INDEX vehicle_identifier_uq ON vehicle (organization_id, lower(identifier))');
    await queryRunner.query('CREATE INDEX drive_scope_idx ON donation_drive (organization_id, created_at DESC, id DESC)');
    await queryRunner.query(`
      CREATE INDEX delivery_work_idx ON donation_delivery (organization_id, created_at, id)
       WHERE status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED')
    `);
    await queryRunner.query('CREATE INDEX cycle_scope_idx ON fulfillment_cycle (organization_id, created_at DESC, id DESC)');
    await queryRunner.query('CREATE INDEX distribution_scope_idx ON distribution (organization_id, created_at, id)');

    await queryRunner.query(`
      CREATE FUNCTION check_need_point_org() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE po uuid; co uuid;
      BEGIN
        IF NEW.designated_point_id IS NULL THEN RETURN NEW; END IF;
        SELECT organization_id INTO po FROM relief_point WHERE id = NEW.designated_point_id;
        SELECT organization_id INTO co FROM fulfillment_cycle WHERE id = NEW.cycle_id;
        IF po IS DISTINCT FROM co THEN
          RAISE EXCEPTION 'designated relief point belongs to another organization than the fulfillment cycle' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER relief_need_point_org_guard BEFORE INSERT OR UPDATE OF designated_point_id, cycle_id ON relief_need
        FOR EACH ROW EXECUTE FUNCTION check_need_point_org()
    `);
    await queryRunner.query(`
      CREATE FUNCTION check_commitment_warehouse_org() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE wo uuid; co uuid;
      BEGIN
        SELECT organization_id INTO wo FROM warehouse WHERE id = NEW.warehouse_id;
        SELECT c.organization_id INTO co FROM relief_need n JOIN fulfillment_cycle c ON c.id = n.cycle_id WHERE n.id = NEW.relief_need_id;
        IF wo IS DISTINCT FROM co THEN
          RAISE EXCEPTION 'commitment warehouse belongs to another organization than the need''s fulfillment cycle' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER commitment_warehouse_org_guard BEFORE INSERT OR UPDATE OF warehouse_id, relief_need_id ON commitment
        FOR EACH ROW EXECUTE FUNCTION check_commitment_warehouse_org()
    `);
  }
}
