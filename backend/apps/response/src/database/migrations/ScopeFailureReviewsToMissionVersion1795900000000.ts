import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep legacy audit entries while allowing the current mission revision to be reviewed. */
export class ScopeFailureReviewsToMissionVersion1795900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX request_event_failure_review_uq');
    await queryRunner.query(`CREATE UNIQUE INDEX request_event_failure_review_uq
      ON request_event ((payload->>'mission_id'),(COALESCE(payload->>'mission_version','legacy')))
      WHERE event_type='MISSION_FAILURE_REVIEW'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const duplicates = await queryRunner.query(`SELECT 1 FROM request_event WHERE event_type='MISSION_FAILURE_REVIEW'
      GROUP BY payload->>'mission_id' HAVING count(*)>1 LIMIT 1`) as unknown[];
    if (duplicates.length) throw new Error('Cannot restore mission-only uniqueness while revisioned reviews exist');
    await queryRunner.query('DROP INDEX request_event_failure_review_uq');
    await queryRunner.query(`CREATE UNIQUE INDEX request_event_failure_review_uq
      ON request_event ((payload->>'mission_id')) WHERE event_type='MISSION_FAILURE_REVIEW'`);
  }
}
