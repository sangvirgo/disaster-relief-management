import { MigrationInterface, QueryRunner } from 'typeorm';

// The citizen names the supplies needed in a free-text field when needs_relief_supplies is ticked. The text is used only
// to map catalog items for a Logistics need proposal (Gemini or alias matching), never as a quantity. Existing rows keep
// NULL; their proposal falls back to the default bundle.
export class AddReliefItemsText1795824000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE assistance_request
      ADD COLUMN relief_items_text text NULL CHECK (relief_items_text IS NULL OR char_length(relief_items_text) <= 500)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE assistance_request DROP COLUMN IF EXISTS relief_items_text');
  }
}
