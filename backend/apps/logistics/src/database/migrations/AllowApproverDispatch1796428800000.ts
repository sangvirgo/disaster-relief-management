import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shortened distribution flow (2026-11-25): the reviewer who approves a slip may also dispatch it in the same step.
 * Independence is kept elsewhere: the approver must differ from the preparer, and the person recording the
 * handoff must differ from the dispatcher. The unnamed CHECK is located by its definition, not its generated name.
 */
export class AllowApproverDispatch1796428800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'distribution'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%dispatch_actor_user_id <> approver_user_id%'
      LOOP
        EXECUTE format('ALTER TABLE distribution DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // NOT VALID keeps rollback possible when slips were already approved and dispatched by one person.
    await queryRunner.query(`ALTER TABLE distribution ADD CONSTRAINT distribution_dispatch_not_approver
      CHECK (dispatch_actor_user_id IS NULL OR dispatch_actor_user_id <> approver_user_id) NOT VALID`);
  }
}
