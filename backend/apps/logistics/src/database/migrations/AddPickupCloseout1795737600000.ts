import { MigrationInterface, QueryRunner } from 'typeorm';

// Step 6b: close-out of a pickup ticket (proposal section 3.6 and 3.7). A close-out records, per item, how the goods issued to
// the ticket were accounted for: delivered on scene (derived from DIRECT_HOUSEHOLD handoffs), returned to the warehouse, or
// retired with a reason. The invariant delivered + returned + retired = held is stored as a CHECK on every line.
// Stock still moves only through existing writers: returns post a RETURN movement through the distribution handoff service,
// and retired goods are already off-warehouse (the dispatch ISSUE removed them), so a retire writes no stock movement.
// No stock_movement type or CHECK changes are needed.
export class AddPickupCloseout1795737600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pickup_ticket
      ADD COLUMN closed_by uuid,
      ADD COLUMN closed_at timestamptz,
      ADD CONSTRAINT pickup_ticket_closed_shape CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL))`);

    await queryRunner.query(`CREATE TABLE pickup_ticket_closeout (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id uuid NOT NULL REFERENCES pickup_ticket(id),
      status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
      submitted_by uuid,
      submitted_at timestamptz,
      reviewed_by uuid,
      reviewed_at timestamptz,
      review_note text CHECK (review_note IS NULL OR btrim(review_note) <> ''),
      version int NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status = 'DRAFT' OR submitted_by IS NOT NULL),
      CHECK (status <> 'SUBMITTED' OR submitted_at IS NOT NULL),
      CHECK (status NOT IN ('APPROVED','REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
      CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by)
    )`);
    // At most one open close-out per ticket, and at most one approved close-out per ticket (CLOSED is terminal).
    await queryRunner.query(`CREATE UNIQUE INDEX pickup_ticket_closeout_open_uq ON pickup_ticket_closeout (ticket_id)
      WHERE status IN ('DRAFT','SUBMITTED')`);
    await queryRunner.query(`CREATE UNIQUE INDEX pickup_ticket_closeout_approved_uq ON pickup_ticket_closeout (ticket_id)
      WHERE status = 'APPROVED'`);

    await queryRunner.query(`CREATE TABLE pickup_closeout_line (
      closeout_id uuid NOT NULL REFERENCES pickup_ticket_closeout(id),
      item_id uuid NOT NULL REFERENCES item(id),
      held_quantity numeric(18,3) NOT NULL CHECK (held_quantity > 0),
      delivered_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
      returned_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
      retired_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (retired_quantity >= 0),
      retire_reason text CHECK (retire_reason IN ('CONSUMED','EXPIRED','DAMAGED','LOST','NOT_RETURNABLE')),
      note text CHECK (note IS NULL OR btrim(note) <> ''),
      PRIMARY KEY (closeout_id, item_id),
      CHECK (delivered_quantity + returned_quantity + retired_quantity = held_quantity),
      CHECK (retired_quantity = 0 OR retire_reason IS NOT NULL),
      CHECK (retired_quantity > 0 OR retire_reason IS NULL)
    )`);

    // Guarded like the other migrations so a migration-only database without the application role still migrates.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON pickup_ticket_closeout, pickup_closeout_line TO c48_logistics_app;
      END IF;
    END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS pickup_closeout_line');
    await queryRunner.query('DROP TABLE IF EXISTS pickup_ticket_closeout');
    await queryRunner.query('ALTER TABLE pickup_ticket DROP CONSTRAINT IF EXISTS pickup_ticket_closed_shape');
    await queryRunner.query('ALTER TABLE pickup_ticket DROP COLUMN IF EXISTS closed_at');
    await queryRunner.query('ALTER TABLE pickup_ticket DROP COLUMN IF EXISTS closed_by');
  }
}
