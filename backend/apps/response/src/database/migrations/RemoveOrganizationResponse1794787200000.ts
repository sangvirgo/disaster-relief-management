import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveOrganizationResponse1794787200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE item record;
      BEGIN
        FOR item IN
          SELECT rel.relname AS table_name, trg.tgname AS trigger_name
            FROM pg_trigger trg
            JOIN pg_class rel ON rel.oid = trg.tgrelid
            JOIN pg_namespace ns ON ns.oid = rel.relnamespace
            JOIN pg_proc proc ON proc.oid = trg.tgfoid
           WHERE ns.nspname = 'public' AND NOT trg.tgisinternal
             AND rel.relname IN ('assistance_request','campaign','rescue_team')
             AND proc.prosrc ILIKE '%organization%'
        LOOP
          EXECUTE format('DROP TRIGGER %I ON %I', item.trigger_name, item.table_name);
        END LOOP;
      END $$
    `);
    await queryRunner.query(`
      DO $$
      DECLARE item record;
      BEGIN
        FOR item IN
          SELECT rel.relname AS table_name, con.conname AS constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace ns ON ns.oid = rel.relnamespace
           WHERE ns.nspname = 'public'
             AND rel.relname IN ('assistance_request','campaign','rescue_team')
             AND pg_get_constraintdef(con.oid) ILIKE '%organization_id%'
        LOOP
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.table_name, item.constraint_name);
        END LOOP;
      END $$
    `);
    await queryRunner.query('DROP INDEX IF EXISTS request_org_fifo_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_attention_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_unassigned_idx');
    await queryRunner.query('CREATE INDEX request_fifo_idx ON assistance_request (received_at,id)');
    await queryRunner.query(`
      CREATE INDEX request_campaign_fifo_idx ON assistance_request (campaign_id,status,received_at,id)
       WHERE campaign_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX request_unassigned_idx ON assistance_request (received_at,id)
       WHERE campaign_id IS NULL AND status NOT IN ('REJECTED','DUPLICATE','CANCELLED','CLOSED')
    `);
    await queryRunner.query(`
      CREATE INDEX request_attention_idx ON assistance_request (received_at,id)
       WHERE status IN ('SUBMITTED','VERIFYING')
          OR (reporter_declared_danger AND status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'))
    `);
    await queryRunner.query(`
      CREATE INDEX request_campaign_attention_idx ON assistance_request (campaign_id,status,received_at,id)
       WHERE campaign_id IS NOT NULL AND (
         status IN ('SUBMITTED','VERIFYING')
         OR (reporter_declared_danger AND status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING')))
    `);
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN organization_id');
    await queryRunner.query('ALTER TABLE campaign DROP COLUMN organization_id');
    await queryRunner.query('ALTER TABLE rescue_team DROP COLUMN organization_id');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS request_campaign_attention_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_campaign_fifo_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_attention_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_unassigned_idx');
    await queryRunner.query('DROP INDEX IF EXISTS request_fifo_idx');
    await queryRunner.query('ALTER TABLE assistance_request ADD COLUMN organization_id uuid');
    await queryRunner.query('ALTER TABLE campaign ADD COLUMN organization_id uuid');
    await queryRunner.query('ALTER TABLE rescue_team ADD COLUMN organization_id uuid');
    await queryRunner.query('CREATE INDEX request_org_fifo_idx ON assistance_request (organization_id,received_at,id)');
    await queryRunner.query(`
      CREATE INDEX request_attention_idx ON assistance_request (organization_id,received_at,id)
       WHERE status IN ('SUBMITTED','VERIFYING')
          OR (reporter_declared_danger AND status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'))
    `);
  }
}
