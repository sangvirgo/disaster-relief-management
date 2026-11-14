import { MigrationInterface, QueryRunner } from 'typeorm';

// Synthetic demo coverage only: the central demo region has separate Da Nang and Quy Nhon patches.
export class ExtendDemoCentralCoverage1794441600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO region_boundary (region_code, geom)
      VALUES ('DEMO_B', ST_Multi(ST_Collect(
        ST_MakeEnvelope(107.50, 16.00, 107.70, 16.15, 4326),
        ST_MakeEnvelope(109.15, 13.72, 109.29, 13.86, 4326)
      )))
      ON CONFLICT (region_code) DO UPDATE
      SET geom=ST_Multi(ST_Union(region_boundary.geom, EXCLUDED.geom))
    `);
    await queryRunner.query(`
      UPDATE assistance_request r SET region_code='DEMO_B'
       FROM request_subject s
       WHERE s.request_id=r.id AND r.region_code IS NULL
         AND ST_Covers(ST_MakeEnvelope(109.15, 13.72, 109.29, 13.86, 4326), s.location::geometry)
         AND (SELECT count(*) FROM region_boundary b WHERE ST_Covers(b.geom, s.location::geometry))=1
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(`
      SELECT 1 FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
       WHERE r.region_code='DEMO_B'
         AND ST_Covers(ST_MakeEnvelope(109.15, 13.72, 109.29, 13.86, 4326), s.location::geometry)
       LIMIT 1
    `) as unknown[];
    if (rows.length) throw new Error('Cannot remove demo coverage while SOS records use Quy Nhon');
    await queryRunner.query(`
      UPDATE region_boundary SET geom=ST_Multi(ST_Difference(
        geom, ST_MakeEnvelope(109.15, 13.72, 109.29, 13.86, 4326)))
       WHERE region_code='DEMO_B'
    `);
  }
}
