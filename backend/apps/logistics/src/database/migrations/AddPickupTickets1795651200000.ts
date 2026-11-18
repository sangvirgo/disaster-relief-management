import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 6a: one pickup ticket per Response mission (proposal section 3.7). The ticket is a thin facade over the existing
// need -> commitment -> distribution tables; stock still changes only through stock_movement. team_custody records goods
// that a team holds after handover. Response-side identifiers (mission, request, campaign, team) are opaque references
// with no cross-service foreign keys.
// item.returnable / item.perishable are catalog flags for the close-out step (Step 6b). Consumable items default to
// returnable=false in the seed files; existing rows keep the default true until a catalog edit changes them.
export class AddPickupTickets1795651200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE item ADD COLUMN returnable boolean NOT NULL DEFAULT true');
    await queryRunner.query('ALTER TABLE item ADD COLUMN perishable boolean NOT NULL DEFAULT false');

    await queryRunner.query(`CREATE TABLE pickup_ticket (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mission_id uuid NOT NULL UNIQUE,
      request_id uuid,
      campaign_id uuid,
      team_id uuid,
      warehouse_id uuid REFERENCES warehouse(id),
      status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','READY','HANDED_OVER','CLOSED','CANCELLED')),
      distribution_id uuid REFERENCES distribution(id),
      ready_at timestamptz,
      reserved_by uuid,
      confirmed_by uuid,
      confirmed_at timestamptz,
      handed_over_by uuid,
      handed_over_at timestamptz,
      collected_by_user_id uuid,
      cancelled_at timestamptz,
      cancel_reason text CHECK (cancel_reason IS NULL OR btrim(cancel_reason) <> ''),
      version int NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (warehouse_id IS NOT NULL),
      CHECK (status NOT IN ('READY','HANDED_OVER','CLOSED') OR reserved_by IS NOT NULL),
      CHECK (status NOT IN ('READY','HANDED_OVER','CLOSED') OR ready_at IS NOT NULL),
      CHECK (status NOT IN ('READY','HANDED_OVER','CLOSED') OR distribution_id IS NOT NULL),
      CHECK (status <> 'HANDED_OVER' OR (handed_over_at IS NOT NULL AND handed_over_by IS NOT NULL)),
      CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
      CHECK (confirmed_at IS NULL OR confirmed_by IS NOT NULL)
    )`);
    await queryRunner.query('CREATE INDEX pickup_ticket_status_idx ON pickup_ticket (status, updated_at DESC, id DESC)');
    await queryRunner.query('CREATE INDEX pickup_ticket_ready_idx ON pickup_ticket (ready_at) WHERE status = \'READY\'');
    await queryRunner.query('CREATE INDEX pickup_ticket_campaign_idx ON pickup_ticket (campaign_id, created_at DESC, id DESC) WHERE campaign_id IS NOT NULL');

    await queryRunner.query(`CREATE TABLE pickup_ticket_line (
      ticket_id uuid NOT NULL REFERENCES pickup_ticket(id),
      relief_need_id uuid NOT NULL REFERENCES relief_need(id),
      commitment_id uuid REFERENCES commitment(id),
      item_id uuid NOT NULL REFERENCES item(id),
      requested_quantity numeric(18,3) NOT NULL CHECK (requested_quantity > 0),
      reserved_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
      PRIMARY KEY (ticket_id, relief_need_id),
      CHECK (reserved_quantity <= requested_quantity),
      CHECK (reserved_quantity = 0 OR commitment_id IS NOT NULL)
    )`);
    await queryRunner.query('CREATE INDEX pickup_ticket_line_need_idx ON pickup_ticket_line (relief_need_id)');

    await queryRunner.query(`CREATE TABLE team_custody (
      team_id uuid NOT NULL,
      item_id uuid NOT NULL REFERENCES item(id),
      quantity_held numeric(18,3) NOT NULL DEFAULT 0 CHECK (quantity_held >= 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (team_id, item_id)
    )`);

    // Guarded like the other migrations so a migration-only database without the application role still migrates.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON pickup_ticket, pickup_ticket_line, team_custody TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS team_custody');
    await queryRunner.query('DROP TABLE IF EXISTS pickup_ticket_line');
    await queryRunner.query('DROP TABLE IF EXISTS pickup_ticket');
    await queryRunner.query('ALTER TABLE item DROP COLUMN IF EXISTS perishable');
    await queryRunner.query('ALTER TABLE item DROP COLUMN IF EXISTS returnable');
  }
}
