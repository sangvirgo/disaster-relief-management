import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A donation drive gets its own drop-off point inside the intake warehouse's service area, so donors can find the closest drive.
 * Both columns are nullable: existing drives keep working and fall back to the warehouse position.
 */
export class AddDonationDriveLocation1796342400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE donation_drive ADD COLUMN location geography(Point,4326), ADD COLUMN location_note text');
    await queryRunner.query('CREATE INDEX donation_drive_location_idx ON donation_drive USING gist (location) WHERE location IS NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS donation_drive_location_idx');
    await queryRunner.query('ALTER TABLE donation_drive DROP COLUMN IF EXISTS location_note, DROP COLUMN IF EXISTS location');
  }
}
