import { MigrationInterface, QueryRunner } from 'typeorm';

/** Counted packages: labels change, quantities and append-only movements do not. */
export class UsePackagedItemUnits1796601600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO unit (code, display_name, scale) VALUES
      ('CHAI', 'chai', 0), ('GOI', 'gói', 0) ON CONFLICT (code) DO NOTHING`);
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM unit WHERE code IN ('CHAI','GOI') AND scale <> 0) THEN
        RAISE EXCEPTION 'CATALOG_PACKAGE_UNIT_SCALE_CONFLICT';
      END IF;
    END $$`);
    // Only the three known demo items previously measured as individual pieces.
    await queryRunner.query(`UPDATE item SET unit_code = CASE
        WHEN id = '00000000-0000-4000-8000-0000000a1002'::uuid THEN 'GOI' ELSE 'CHAI' END,
        version = version + 1
      WHERE unit_code = 'CAI' AND id IN (
        '00000000-0000-4000-8000-0000000a1002'::uuid,
        '00000000-0000-4000-8000-0000000a1003'::uuid,
        '00000000-0000-4000-8000-0000000a1011'::uuid)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE item SET unit_code = 'CAI', version = version + 1
      WHERE (id = '00000000-0000-4000-8000-0000000a1002'::uuid AND unit_code = 'GOI')
        OR (id IN ('00000000-0000-4000-8000-0000000a1003'::uuid,
          '00000000-0000-4000-8000-0000000a1011'::uuid) AND unit_code = 'CHAI')`);
    // Keep catalog units: other items may have adopted them after deployment.
  }
}
