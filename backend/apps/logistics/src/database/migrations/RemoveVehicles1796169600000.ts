import { MigrationInterface, QueryRunner } from 'typeorm';

/** Vehicles are out of scope: distributions no longer reference a vehicle and the vehicle registry is removed. */
export class RemoveVehicles1796169600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE distribution DROP COLUMN IF EXISTS vehicle_id');
    await queryRunner.query('DROP TABLE IF EXISTS vehicle');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE vehicle (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL CHECK (is_clean_text(identifier)),
      vehicle_type text NOT NULL, capacity numeric(18,3) CHECK (capacity > 0), capacity_unit text REFERENCES unit(code),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
      CHECK ((capacity IS NULL) = (capacity_unit IS NULL))
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX vehicle_identifier_uq ON vehicle (lower(identifier))');
    await queryRunner.query('ALTER TABLE distribution ADD COLUMN vehicle_id uuid REFERENCES vehicle(id)');
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON vehicle TO c48_logistics_app;
      END IF;
    END $$`);
  }
}
