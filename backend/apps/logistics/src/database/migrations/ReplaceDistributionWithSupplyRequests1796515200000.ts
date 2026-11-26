import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supply requests replace distribution slips and pickup tickets (user decision 2026-11-26).
 *
 * A team leader (or a coordinator on behalf of the team) asks for goods for one mission. The system picks one warehouse,
 * reserves the stock at once (commitment + RESERVE movement) and gives the team a pickup code. Warehouse staff hand the
 * goods over by typing that code; the hand-over issues the stock (ISSUE movement on the commitment) and counts it as
 * delivered to the SOS need. Unclaimed requests expire and release the reservation. There is no approval, dispatch,
 * handoff, loss review, close-out or reconciliation step any more.
 *
 * Removed: distribution, distribution_line, handoff_record, handoff_line, handoff_loss_review, issued_line_settlement,
 * pickup_ticket, pickup_ticket_line, pickup_ticket_closeout, pickup_closeout_line, team_custody, the
 * commitment_counter_mismatch view, commitment.returned_quantity/lost_quantity, stock_movement.distribution_line_id/
 * handoff_line_id, the RETURN movement type and logistics_attachment.handoff_id.
 *
 * Like RemoveReliefPoints, the migration refuses to run while distribution or pickup data exists so no history is
 * silently lost; reset the demo database first (bash backend/scripts/db/reset-demo --reset, or on the AWS host
 * bash backend/scripts/deploy/reset-demo-data --reset).
 */
export class ReplaceDistributionWithSupplyRequests1796515200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM distribution) OR EXISTS (SELECT 1 FROM pickup_ticket)
         OR EXISTS (SELECT 1 FROM logistics_attachment WHERE handoff_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM commitment WHERE returned_quantity <> 0 OR lost_quantity <> 0) THEN
        RAISE EXCEPTION 'Distribution or pickup data still exists; reset the demo database before replacing distributions with supply requests'
          USING ERRCODE = 'check_violation';
      END IF;
    END $$`);

    // Old views, triggers and functions that read the removed tables.
    await queryRunner.query('DROP VIEW IF EXISTS commitment_counter_mismatch');
    await queryRunner.query('DROP TRIGGER IF EXISTS settlement_kind_guard ON issued_line_settlement');
    await queryRunner.query('DROP TRIGGER IF EXISTS handoff_loss_review_guard ON handoff_loss_review');
    await queryRunner.query('DROP TRIGGER IF EXISTS distribution_line_guard ON distribution_line');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_settlement_kind()');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_loss_review()');
    await queryRunner.query('DROP FUNCTION IF EXISTS guard_distribution_lines()');

    // Ledger references to the removed tables. The ledger is append-only for rows; dropping a column is a schema change.
    await queryRunner.query('ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS movement_shape');
    await queryRunner.query('ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS movement_source');
    await queryRunner.query('DROP INDEX IF EXISTS movement_return_once_uq');
    await queryRunner.query('DROP INDEX IF EXISTS movement_dline_idx');
    await queryRunner.query('ALTER TABLE stock_movement DROP COLUMN IF EXISTS handoff_line_id');
    await queryRunner.query('ALTER TABLE stock_movement DROP COLUMN IF EXISTS distribution_line_id');
    await this.dropChecksMentioning(queryRunner, 'stock_movement', 'RETURN');
    await queryRunner.query(`ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_movement_type_check
      CHECK (movement_type IN ('OPENING','RECEIPT','RECEIPT_HELD_RELEASE','RESERVE','RELEASE','ISSUE','ADJUSTMENT'))`);
    await queryRunner.query(`ALTER TABLE stock_movement ADD CONSTRAINT movement_shape CHECK (
      (movement_type IN ('OPENING','RECEIPT','RECEIPT_HELD_RELEASE') AND delta_on_hand > 0 AND delta_reserved = 0) OR
      (movement_type = 'RESERVE' AND delta_on_hand = 0 AND delta_reserved > 0) OR
      (movement_type = 'RELEASE' AND delta_on_hand = 0 AND delta_reserved < 0) OR
      (movement_type = 'ISSUE'   AND delta_on_hand < 0 AND delta_reserved = delta_on_hand) OR
      (movement_type = 'ADJUSTMENT' AND delta_on_hand <> 0 AND delta_reserved = 0))`);
    await queryRunner.query(`ALTER TABLE stock_movement ADD CONSTRAINT movement_source CHECK (
      (movement_type IN ('RESERVE','RELEASE','ISSUE') AND commitment_id IS NOT NULL AND receipt_id IS NULL AND adjustment_id IS NULL) OR
      (movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE') AND receipt_id IS NOT NULL AND commitment_id IS NULL AND adjustment_id IS NULL) OR
      (movement_type = 'ADJUSTMENT' AND adjustment_id IS NOT NULL AND receipt_id IS NULL AND commitment_id IS NULL) OR
      (movement_type = 'OPENING' AND num_nonnulls(receipt_id, commitment_id, adjustment_id) = 0))`);

    // Handoff evidence goes away with the handoffs.
    await queryRunner.query('ALTER TABLE logistics_attachment DROP CONSTRAINT IF EXISTS exactly_one_owner');
    await queryRunner.query('DROP INDEX IF EXISTS attachment_handoff_idx');
    await queryRunner.query('ALTER TABLE logistics_attachment DROP COLUMN IF EXISTS handoff_id');
    await queryRunner.query('ALTER TABLE logistics_attachment ADD CONSTRAINT exactly_one_owner CHECK (num_nonnulls(delivery_id, dispute_id) = 1)');

    await queryRunner.query('DROP TABLE IF EXISTS pickup_closeout_line');
    await queryRunner.query('DROP TABLE IF EXISTS pickup_ticket_closeout');
    await queryRunner.query('DROP TABLE IF EXISTS pickup_ticket_line');
    await queryRunner.query('DROP TABLE IF EXISTS pickup_ticket');
    await queryRunner.query('DROP TABLE IF EXISTS team_custody');
    await queryRunner.query('DROP TABLE IF EXISTS issued_line_settlement');
    await queryRunner.query('DROP TABLE IF EXISTS handoff_line');
    await queryRunner.query('DROP TABLE IF EXISTS handoff_loss_review');
    await queryRunner.query('DROP TABLE IF EXISTS handoff_record');
    await queryRunner.query('DROP TABLE IF EXISTS distribution_line');
    await queryRunner.query('DROP TABLE IF EXISTS distribution');

    // A hand-over issues and delivers in one step, so returned/lost counters have no writer any more.
    await this.dropChecksMentioning(queryRunner, 'commitment', 'returned_quantity');
    await queryRunner.query('ALTER TABLE commitment DROP COLUMN IF EXISTS returned_quantity');
    await queryRunner.query('ALTER TABLE commitment DROP COLUMN IF EXISTS lost_quantity');
    await queryRunner.query('ALTER TABLE commitment ADD CONSTRAINT commitment_delivered_within_issued CHECK (delivered_quantity <= issued_quantity)');

    await queryRunner.query(`CREATE TABLE supply_request (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mission_id uuid NOT NULL,
      request_id uuid NOT NULL,
      work_cycle int NOT NULL CHECK (work_cycle >= 1),
      campaign_id uuid,
      team_id uuid NOT NULL,
      team_name text NOT NULL CHECK (btrim(team_name) <> ''),
      warehouse_id uuid NOT NULL REFERENCES warehouse(id),
      status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY','HANDED_OVER','CANCELLED','EXPIRED')),
      pickup_code text NOT NULL CHECK (pickup_code ~ '^[0-9]{6}$'),
      requested_by uuid NOT NULL,
      on_behalf boolean NOT NULL DEFAULT false,
      expires_at timestamptz NOT NULL,
      handed_over_by uuid,
      handed_over_at timestamptz,
      cancelled_by uuid,
      cancelled_at timestamptz,
      cancel_reason text CHECK (cancel_reason IS NULL OR btrim(cancel_reason) <> ''),
      version int NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (expires_at > created_at),
      CHECK ((status = 'HANDED_OVER') = (handed_over_at IS NOT NULL AND handed_over_by IS NOT NULL)),
      CHECK ((status IN ('CANCELLED','EXPIRED')) = (cancelled_at IS NOT NULL)),
      CHECK (status <> 'CANCELLED' OR (cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL))
    )`);
    // A live pickup code is unique so the warehouse can find the request by code alone.
    await queryRunner.query("CREATE UNIQUE INDEX supply_request_live_code_uq ON supply_request (pickup_code) WHERE status = 'READY'");
    // One open request per mission keeps the team's view and the warehouse queue simple.
    await queryRunner.query("CREATE UNIQUE INDEX supply_request_live_mission_uq ON supply_request (mission_id) WHERE status = 'READY'");
    await queryRunner.query('CREATE INDEX supply_request_mission_idx ON supply_request (mission_id, created_at DESC, id DESC)');
    await queryRunner.query('CREATE INDEX supply_request_queue_idx ON supply_request (warehouse_id, status, created_at DESC, id DESC)');
    await queryRunner.query("CREATE INDEX supply_request_expiry_idx ON supply_request (expires_at) WHERE status = 'READY'");
    await queryRunner.query('CREATE INDEX supply_request_request_idx ON supply_request (request_id, work_cycle)');

    await queryRunner.query(`CREATE TABLE supply_request_line (
      supply_request_id uuid NOT NULL REFERENCES supply_request(id),
      item_id uuid NOT NULL REFERENCES item(id),
      relief_need_id uuid NOT NULL REFERENCES relief_need(id),
      commitment_id uuid REFERENCES commitment(id),
      requested_quantity numeric(18,3) NOT NULL CHECK (requested_quantity > 0),
      reserved_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
      PRIMARY KEY (supply_request_id, item_id),
      UNIQUE (commitment_id),
      CHECK (reserved_quantity <= requested_quantity),
      CHECK ((reserved_quantity > 0) = (commitment_id IS NOT NULL))
    )`);
    await queryRunner.query('CREATE INDEX supply_request_line_need_idx ON supply_request_line (relief_need_id)');

    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app') THEN
        GRANT SELECT, INSERT, UPDATE ON supply_request, supply_request_line TO c48_logistics_app;
      END IF;
    END $$`);
  }

  /**
   * Best-effort rollback: drops the supply request tables and restores the removed columns and the RETURN type so the
   * previous migrations can roll back further. The distribution and pickup tables are not recreated; roll back to an
   * empty database (dropSchema) to restore them.
   */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS supply_request_line');
    await queryRunner.query('DROP TABLE IF EXISTS supply_request');
    await queryRunner.query('ALTER TABLE commitment DROP CONSTRAINT IF EXISTS commitment_delivered_within_issued');
    await queryRunner.query('ALTER TABLE commitment ADD COLUMN returned_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0)');
    await queryRunner.query('ALTER TABLE commitment ADD COLUMN lost_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (lost_quantity >= 0)');
    await queryRunner.query('ALTER TABLE commitment ADD CONSTRAINT commitment_settled_within_issued CHECK (delivered_quantity + returned_quantity + lost_quantity <= issued_quantity)');
    await queryRunner.query('ALTER TABLE logistics_attachment ADD COLUMN handoff_id uuid');
    await queryRunner.query('ALTER TABLE logistics_attachment DROP CONSTRAINT IF EXISTS exactly_one_owner');
    await queryRunner.query('ALTER TABLE logistics_attachment ADD CONSTRAINT exactly_one_owner CHECK (num_nonnulls(delivery_id, dispute_id, handoff_id) = 1)');
    await queryRunner.query('ALTER TABLE stock_movement ADD COLUMN distribution_line_id uuid');
    await queryRunner.query('ALTER TABLE stock_movement ADD COLUMN handoff_line_id uuid');
    await queryRunner.query('ALTER TABLE stock_movement DROP CONSTRAINT IF EXISTS stock_movement_movement_type_check');
    await queryRunner.query(`ALTER TABLE stock_movement ADD CONSTRAINT stock_movement_movement_type_check
      CHECK (movement_type IN ('OPENING','RECEIPT','RECEIPT_HELD_RELEASE','RESERVE','RELEASE','ISSUE','RETURN','ADJUSTMENT'))`);
  }

  /** Drops every CHECK on the table whose definition mentions the marker. */
  private async dropChecksMentioning(queryRunner: QueryRunner, table: string, marker: string): Promise<void> {
    await queryRunner.query(`DO $$
      DECLARE c record;
      BEGIN
        FOR c IN SELECT conname FROM pg_constraint
                  WHERE conrelid = '${table}'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%${marker}%'
        LOOP
          EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', c.conname);
        END LOOP;
      END $$`);
  }
}
