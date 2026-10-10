-- C48 Logistics service — physical schema (PostgreSQL 16+ with PostGIS 3 for point columns). v3: T0-S column/index cleanup (see 01-schema-review.md §7-§9).
-- Opaque cross-service ids: campaign_id, organization_id (except local FKs below), request_id, *_user_id. No GiST index until a spatial query exists.
-- Stock changes ONLY by inserting a stock_movement; a SECURITY DEFINER trigger applies it to stock_balance. The app role (c48_logistics_app) has no UPDATE on stock_balance.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE FUNCTION is_clean_text(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(t) <> '' AND t = normalize(t, NFC) $$;
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END $$;

-- ---------- catalogs ----------
CREATE TABLE item_type (code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,40}$'), display_name text NOT NULL CHECK (is_clean_text(display_name)));
CREATE TABLE unit (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{1,20}$'),
  display_name text NOT NULL CHECK (is_clean_text(display_name)),
  scale smallint NOT NULL CHECK (scale BETWEEN 0 AND 3)          -- decimals allowed; belongs to the unit (kg=3, piece=0), enforced by trigger on quantity tables
);
CREATE TABLE item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type_code text NOT NULL REFERENCES item_type(code),
  unit_code      text NOT NULL REFERENCES unit(code),
  name           text NOT NULL CHECK (is_clean_text(name)),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at     timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX item_name_unit_uq ON item (lower(name), unit_code);
CREATE INDEX item_type_idx ON item (item_type_code);

CREATE TABLE warehouse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, region_code text NOT NULL,
  name text NOT NULL CHECK (is_clean_text(name)), address_note text, location geography(Point,4326),
  location_public boolean NOT NULL DEFAULT false,              -- public pages show the point only when the manager opts in
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id)                                  -- target of composite FKs: children cannot disagree on the owning organization
);
CREATE INDEX warehouse_scope_idx ON warehouse (organization_id, region_code) WHERE status = 'ACTIVE';
CREATE TABLE relief_point (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, region_code text NOT NULL,
  name text NOT NULL CHECK (is_clean_text(name)), contact_note text, operating_note text, location geography(Point,4326) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id)
);
CREATE INDEX relief_point_scope_idx ON relief_point (organization_id, region_code) WHERE status = 'ACTIVE';
CREATE TABLE vehicle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, region_code text NOT NULL, identifier text NOT NULL CHECK (is_clean_text(identifier)),
  vehicle_type text NOT NULL, capacity numeric(18,3) CHECK (capacity > 0), capacity_unit text REFERENCES unit(code),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  CHECK ((capacity IS NULL) = (capacity_unit IS NULL))
);
CREATE UNIQUE INDEX vehicle_identifier_uq ON vehicle (organization_id, lower(identifier));

-- ---------- donation drives ----------
CREATE TABLE donation_drive (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid,
  campaign_status     text CHECK (campaign_status IN ('DRAFT','ACTIVE','PAUSED','CLOSED')),   -- cached from Response so public pages survive a Response outage
  campaign_status_at  timestamptz,
  organization_id     uuid NOT NULL,
  intake_warehouse_id uuid NOT NULL,
  title               text NOT NULL CHECK (is_clean_text(title)),
  description         text,
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','PAUSED','CLOSED')),
  opens_at            timestamptz,
  closes_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  version             int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),                                  -- target of donation_delivery's same-organization composite FK
  FOREIGN KEY (intake_warehouse_id, organization_id) REFERENCES warehouse(id, organization_id),   -- drive and its intake site share one organization
  CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at),
  CHECK ((campaign_id IS NULL) = (campaign_status IS NULL))
);
CREATE INDEX drive_public_idx ON donation_drive (created_at DESC, id DESC) WHERE status = 'OPEN';       -- keyset on a NOT NULL column (closes_at is nullable)
CREATE INDEX drive_scope_idx ON donation_drive (organization_id, created_at DESC, id DESC);
CREATE TABLE drive_item (
  drive_id uuid NOT NULL REFERENCES donation_drive(id),
  item_id  uuid NOT NULL REFERENCES item(id),
  target_quantity numeric(18,3) NOT NULL CHECK (target_quantity > 0),
  acceptance_note text,
  PRIMARY KEY (drive_id, item_id)
);

-- ---------- donor declarations (immutable revisions) ----------
-- The current declaration revision is the highest revision per delivery (no pointer column).
-- delivery.status is the single lifecycle for both donor and staff views (receipt has no status of its own).
CREATE TABLE donation_delivery (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code          text NOT NULL UNIQUE CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{8,16}$'),   -- receipt number; identifier only, grants nothing
  drive_id             uuid NOT NULL,
  organization_id      uuid NOT NULL,                        -- copied from the drive (composite FK); leads the staff work queue index
  donor_user_id        uuid,
  donor_name           text NOT NULL CHECK (is_clean_text(donor_name)),
  donor_phone          text NOT NULL CHECK (donor_phone ~ '^\+?[0-9]{8,15}$'),
  capability_hash      text,                                 -- purpose-bound hash of the donation secret; NULL after claim/revoke
  status               text NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED','POSTED','REJECTED','CANCELLED')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  version              int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  FOREIGN KEY (drive_id, organization_id) REFERENCES donation_drive(id, organization_id)   -- delivery and drive share one organization
) WITH (fillfactor = 85);
CREATE UNIQUE INDEX delivery_capability_uq ON donation_delivery (capability_hash) WHERE capability_hash IS NOT NULL;
CREATE INDEX delivery_drive_idx ON donation_delivery (drive_id, created_at DESC, id DESC);
CREATE INDEX delivery_work_idx ON donation_delivery (organization_id, created_at, id) WHERE status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED');
CREATE TABLE donation_declaration (
  delivery_id uuid NOT NULL REFERENCES donation_delivery(id),
  revision    int NOT NULL CHECK (revision >= 1),
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('DONOR','STAFF_ASSISTED')),
  created_by_user_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id, revision)
);
CREATE TABLE donation_line (
  delivery_id uuid NOT NULL, revision int NOT NULL,
  item_id uuid NOT NULL REFERENCES item(id),
  declared_quantity numeric(18,3) NOT NULL CHECK (declared_quantity > 0),
  PRIMARY KEY (delivery_id, revision, item_id),
  FOREIGN KEY (delivery_id, revision) REFERENCES donation_declaration(delivery_id, revision)
);

-- ---------- receipts, counts, reviews ----------
CREATE TABLE donation_receipt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL UNIQUE REFERENCES donation_delivery(id),
  warehouse_id uuid NOT NULL REFERENCES warehouse(id),
  created_at   timestamptz NOT NULL DEFAULT now(),   -- the current count revision is the highest revision in receipt_count
  version      int NOT NULL DEFAULT 1,
  UNIQUE (id, delivery_id)
);
CREATE TABLE receipt_count (
  receipt_id uuid NOT NULL REFERENCES donation_receipt(id),
  revision   int NOT NULL CHECK (revision >= 1),
  counted_by_user_id uuid NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  note       text,
  PRIMARY KEY (receipt_id, revision)
);
CREATE TABLE receipt_count_line (
  receipt_id uuid NOT NULL, revision int NOT NULL,
  item_id uuid NOT NULL REFERENCES item(id),            -- may differ from the declaration (unexpected goods are recorded, not hidden)
  counted_quantity  numeric(18,3) NOT NULL CHECK (counted_quantity >= 0),
  accepted_quantity numeric(18,3) NOT NULL CHECK (accepted_quantity >= 0),
  held_quantity     numeric(18,3) NOT NULL CHECK (held_quantity >= 0),
  rejected_quantity numeric(18,3) NOT NULL CHECK (rejected_quantity >= 0),
  condition_note text, expiry_date date,
  PRIMARY KEY (receipt_id, revision, item_id),
  FOREIGN KEY (receipt_id, revision) REFERENCES receipt_count(receipt_id, revision),
  CONSTRAINT counted_split CHECK (counted_quantity = accepted_quantity + held_quantity + rejected_quantity)
);
CREATE TABLE receipt_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL, delivery_id uuid NOT NULL,       -- delivery_id is denormalised only so the composite FK to the declaration revision can be enforced
  count_revision int NOT NULL, declaration_revision int NOT NULL,
  reviewer_user_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT','REQUEST_RECOUNT')),
  reason text CHECK (reason IS NULL OR btrim(reason) <> ''), reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (receipt_id, count_revision) REFERENCES receipt_count(receipt_id, revision),
  FOREIGN KEY (receipt_id, delivery_id) REFERENCES donation_receipt(id, delivery_id),
  FOREIGN KEY (delivery_id, declaration_revision) REFERENCES donation_declaration(delivery_id, revision),   -- reviews name real revisions
  CHECK (decision = 'APPROVE' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX receipt_review_one_approve_uq ON receipt_review (receipt_id, count_revision) WHERE decision = 'APPROVE';
CREATE INDEX receipt_review_receipt_idx ON receipt_review (receipt_id, reviewed_at);
CREATE TABLE donation_dispute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES donation_delivery(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  opened_by_kind text NOT NULL CHECK (opened_by_kind IN ('DONOR','STAFF')),
  opened_by_user_id uuid,                                   -- NULL for a donor acting through the capability secret
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  resolution_note text, resolved_by_user_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  CHECK ((status = 'OPEN') = (resolved_at IS NULL)),
  CHECK (status <> 'RESOLVED' OR (coalesce(btrim(resolution_note), '') <> '' AND resolved_by_user_id IS NOT NULL))
);
CREATE INDEX dispute_delivery_idx ON donation_dispute (delivery_id);
CREATE INDEX dispute_open_idx ON donation_dispute (opened_at, id) WHERE status = 'OPEN';

-- ---------- stock balance (written only by the movement trigger) ----------
CREATE TABLE stock_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouse(id),
  item_id uuid NOT NULL REFERENCES item(id),
  on_hand  numeric(18,3) NOT NULL DEFAULT 0,
  reserved numeric(18,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, item_id),
  CHECK (on_hand >= 0), CHECK (reserved >= 0), CHECK (reserved <= on_hand)
) WITH (fillfactor = 85);

-- ---------- fulfillment ----------
CREATE TABLE fulfillment_cycle (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL, work_cycle int NOT NULL CHECK (work_cycle >= 1),
  organization_id uuid NOT NULL, campaign_id uuid, region_code text,        -- attribution copied from Response; same for every need in the cycle
  state      text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','FROZEN','SEALED')),   -- hot guard; must match the latest non-aborted cycle_intent (see check_cycle_state_matches_intent())
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, work_cycle)
);
-- The seal identifier handed to Response is the SEALED RESOLUTION cycle_intent.intent_id.
CREATE TABLE cycle_intent (
  intent_id  uuid PRIMARY KEY,
  cycle_id   uuid NOT NULL REFERENCES fulfillment_cycle(id),
  kind       text NOT NULL CHECK (kind IN ('RESOLUTION','CANCELLATION')),
  state      text NOT NULL CHECK (state IN ('SEALED','FROZEN','ABORTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intent_kind_state CHECK ((kind = 'RESOLUTION' AND state IN ('SEALED','ABORTED')) OR (kind = 'CANCELLATION' AND state IN ('FROZEN','ABORTED')))
);
-- At most one live (non-aborted) intent per cycle; ABORTED rows are permanent tombstones (no TTL, any number per cycle).
CREATE UNIQUE INDEX cycle_intent_live_uq ON cycle_intent (cycle_id) WHERE state <> 'ABORTED';
CREATE INDEX cycle_scope_idx ON fulfillment_cycle (organization_id, created_at DESC, id DESC);
CREATE INDEX cycle_region_idx ON fulfillment_cycle (region_code, created_at);       -- region reports
CREATE INDEX cycle_campaign_idx ON fulfillment_cycle (campaign_id) WHERE campaign_id IS NOT NULL;
-- delivery target is derived: designated_point_id IS NULL => FINAL_RECIPIENT, else RELIEF_POINT (no redundant kind column)
CREATE TABLE relief_need (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id    uuid NOT NULL REFERENCES fulfillment_cycle(id),
  item_id     uuid NOT NULL REFERENCES item(id),
  original_quantity  numeric(18,3) NOT NULL CHECK (original_quantity > 0),   -- initial quantity (history); requested may later exceed it
  requested_quantity numeric(18,3) NOT NULL CHECK (requested_quantity > 0),   -- current effective quantity (may be reduced or increased)
  cancelled_remaining numeric(18,3) CHECK (cancelled_remaining >= 0),
  designated_point_id uuid REFERENCES relief_point(id),
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_FULFILLED','FULFILLED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  version     int NOT NULL DEFAULT 1,
  CHECK ((status = 'CANCELLED') = (cancelled_remaining IS NOT NULL)),
  CHECK (cancelled_remaining IS NULL OR cancelled_remaining <= requested_quantity),
  UNIQUE (id, item_id)
);
CREATE UNIQUE INDEX need_one_live_per_item_uq ON relief_need (cycle_id, item_id) WHERE status <> 'CANCELLED';
CREATE INDEX need_cycle_idx ON relief_need (cycle_id);                       -- the fulfillment board also lists CANCELLED needs
CREATE TABLE commitment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relief_need_id uuid NOT NULL,
  item_id        uuid NOT NULL,                                -- must equal the need's item (composite FK)
  warehouse_id   uuid NOT NULL REFERENCES warehouse(id),
  quantity           numeric(18,3) NOT NULL CHECK (quantity > 0),
  -- cumulative counters: intentional denormalisation of the settlement/movement ledgers so CHECKs and row locks work; one writer, reconciled by test
  -- (view commitment_counter_mismatch compares delivered/returned/lost with settlements); item_id is kept for the composite FKs to need and distribution_line
  released_quantity  numeric(18,3) NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  issued_quantity    numeric(18,3) NOT NULL DEFAULT 0 CHECK (issued_quantity >= 0),
  delivered_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
  returned_quantity  numeric(18,3) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  lost_quantity      numeric(18,3) NOT NULL DEFAULT 0 CHECK (lost_quantity >= 0),
  created_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  FOREIGN KEY (relief_need_id, item_id) REFERENCES relief_need(id, item_id),
  UNIQUE (id, item_id, warehouse_id),
  CHECK (released_quantity + issued_quantity <= quantity),
  CHECK (delivered_quantity + returned_quantity + lost_quantity <= issued_quantity)
) WITH (fillfactor = 85);
CREATE INDEX commitment_need_idx ON commitment (relief_need_id);

-- ---------- distribution & handoff ----------
CREATE TABLE distribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL, organization_id uuid NOT NULL,               -- organization comes from the warehouse (composite FK), region via join
  relief_point_id uuid, vehicle_id uuid,
  campaign_id uuid,
  purpose text NOT NULL CHECK (purpose IN ('REQUEST_AID','CAMPAIGN_DISTRIBUTION','POINT_REPLENISHMENT')),
  status  text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','DISPATCHED','RECONCILED','CANCELLED')),
  preparer_user_id uuid NOT NULL,
  approver_user_id uuid, approved_version int, approved_at timestamptz,
  dispatch_actor_user_id uuid, dispatched_at timestamptz, reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  FOREIGN KEY (warehouse_id, organization_id) REFERENCES warehouse(id, organization_id),
  FOREIGN KEY (relief_point_id, organization_id) REFERENCES relief_point(id, organization_id),
  FOREIGN KEY (vehicle_id, organization_id) REFERENCES vehicle(id, organization_id),
  UNIQUE (id, warehouse_id),
  CHECK (approver_user_id IS NULL OR approver_user_id <> preparer_user_id),
  CHECK (dispatch_actor_user_id IS NULL OR dispatch_actor_user_id <> approver_user_id),
  CHECK ((approver_user_id IS NULL) = (approved_version IS NULL) AND (approver_user_id IS NULL) = (approved_at IS NULL)),
  CHECK (approved_version IS NULL OR approved_version <= version),
  CHECK (status <> 'APPROVED' OR approved_version = version),          -- any edit bumps version and voids the approval
  CHECK (status IN ('DRAFT','CANCELLED') OR approver_user_id IS NOT NULL),
  CHECK (status NOT IN ('DISPATCHED','RECONCILED') OR (dispatch_actor_user_id IS NOT NULL AND dispatched_at IS NOT NULL)),
  CHECK (status <> 'RECONCILED' OR reconciled_at IS NOT NULL),
  CHECK (purpose <> 'POINT_REPLENISHMENT' OR relief_point_id IS NOT NULL)
) WITH (fillfactor = 85);
CREATE INDEX distribution_scope_idx ON distribution (organization_id, created_at, id);
CREATE INDEX distribution_warehouse_idx ON distribution (warehouse_id);        -- campaign/warehouse report
CREATE INDEX distribution_campaign_idx ON distribution (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE distribution_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL, warehouse_id uuid NOT NULL,       -- warehouse_id: composite FK keeps line, distribution and commitment on one warehouse
  item_id uuid NOT NULL REFERENCES item(id),
  commitment_id uuid,                                    -- request-linked aid; item and warehouse must match the commitment (composite FK)
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  in_transit_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),   -- counters (race-review result: avoid re-summing handoffs under the line lock); one writer, CHECKed non-negative
  at_point_quantity   numeric(18,3) NOT NULL DEFAULT 0 CHECK (at_point_quantity >= 0),
  FOREIGN KEY (distribution_id, warehouse_id) REFERENCES distribution(id, warehouse_id),
  FOREIGN KEY (commitment_id, item_id, warehouse_id) REFERENCES commitment(id, item_id, warehouse_id),
  UNIQUE (distribution_id, id),
  UNIQUE (id, commitment_id),
  CHECK (in_transit_quantity + at_point_quantity <= quantity)
);
CREATE UNIQUE INDEX distribution_line_commitment_uq ON distribution_line (distribution_id, commitment_id) WHERE commitment_id IS NOT NULL;
CREATE INDEX distribution_line_commitment_idx ON distribution_line (commitment_id) WHERE commitment_id IS NOT NULL;
CREATE TABLE handoff_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL REFERENCES distribution(id),
  handoff_kind text NOT NULL CHECK (handoff_kind IN ('DIRECT_HOUSEHOLD','POINT_RECEIPT','HOUSEHOLD_HANDOUT','RETURN','LOSS')),
  source_stage text CHECK (source_stage IN ('IN_TRANSIT','AT_POINT')),   -- where returned/lost goods were
  receiver_user_id uuid, receiver_label text,            -- household may have no account; no names/IDs required
  recorder_user_id uuid NOT NULL,
  confirmation_basis text NOT NULL CHECK (btrim(confirmation_basis) <> ''),
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, distribution_id),
  CHECK ((handoff_kind IN ('RETURN','LOSS')) = (source_stage IS NOT NULL)),
  CHECK (receiver_user_id IS NULL OR receiver_user_id <> recorder_user_id)
);
CREATE INDEX handoff_distribution_idx ON handoff_record (distribution_id, occurred_at, id);
-- A LOSS handoff is only a request until an independent reviewer APPROVEs it here. Custody/stock semantics: LOSS counts toward
-- lost_quantity (and its settlement exists) ONLY when this table holds an APPROVE row; REJECT leaves custody unchanged.
-- handoff_record stays append-only, so the review lives in its own append-only row (one review per handoff).
CREATE TABLE handoff_loss_review (
  handoff_id       uuid PRIMARY KEY REFERENCES handoff_record(id),
  reviewer_user_id uuid NOT NULL,
  decision         text NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  reason           text NOT NULL CHECK (btrim(reason) <> ''),
  reviewed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE handoff_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handoff_id uuid NOT NULL, distribution_id uuid NOT NULL, distribution_line_id uuid NOT NULL,
  commitment_id uuid,                                    -- copy of the line's commitment so settlements cannot point at another one
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (handoff_id, distribution_id) REFERENCES handoff_record(id, distribution_id),
  FOREIGN KEY (distribution_id, distribution_line_id) REFERENCES distribution_line(distribution_id, id),
  FOREIGN KEY (distribution_line_id, commitment_id) REFERENCES distribution_line(id, commitment_id),
  UNIQUE (id, commitment_id),
  UNIQUE (handoff_id, distribution_line_id)
);
CREATE INDEX handoff_line_dline_idx ON handoff_line (distribution_line_id);
-- One settlement per handoff line; quantity is the handoff line's, the actor is the handoff recorder (or the LOSS reviewer).
CREATE TABLE issued_line_settlement (
  handoff_line_id uuid PRIMARY KEY,
  commitment_id   uuid NOT NULL REFERENCES commitment(id),
  settlement_type text NOT NULL CHECK (settlement_type IN ('DELIVERED','RETURNED','LOST')),   -- reconciliation grouping key: commitment.delivered/returned/lost
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (handoff_line_id, commitment_id) REFERENCES handoff_line(id, commitment_id)   -- same commitment as the handoff line
);
CREATE INDEX settlement_commitment_idx ON issued_line_settlement (commitment_id);
-- Reconciliation: rows returned are commitments whose counters disagree with their settlements (expected: zero rows).
CREATE VIEW commitment_counter_mismatch AS
SELECT c.id AS commitment_id, c.delivered_quantity, c.returned_quantity, c.lost_quantity,
       coalesce(x.delivered,0) AS settled_delivered, coalesce(x.returned,0) AS settled_returned, coalesce(x.lost,0) AS settled_lost
FROM commitment c
LEFT JOIN (SELECT s.commitment_id,
                  sum(h.quantity) FILTER (WHERE s.settlement_type = 'DELIVERED') AS delivered,
                  sum(h.quantity) FILTER (WHERE s.settlement_type = 'RETURNED')  AS returned,
                  sum(h.quantity) FILTER (WHERE s.settlement_type = 'LOST')      AS lost
           FROM issued_line_settlement s JOIN handoff_line h ON h.id = s.handoff_line_id GROUP BY s.commitment_id) x ON x.commitment_id = c.id
WHERE c.delivered_quantity <> coalesce(x.delivered,0) OR c.returned_quantity <> coalesce(x.returned,0) OR c.lost_quantity <> coalesce(x.lost,0);

-- ---------- adjustments and the append-only stock ledger ----------
CREATE TABLE stock_adjustment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES stock_balance(id),
  delta_on_hand numeric(18,3) NOT NULL CHECK (delta_on_hand <> 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by_user_id uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id uuid, reviewed_at timestamptz, review_note text,
  CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id <> requested_by_user_id),
  CHECK ((reviewed_by_user_id IS NULL) = (reviewed_at IS NULL)),
  CHECK ((status = 'PENDING') = (reviewed_by_user_id IS NULL)),
  CHECK (status <> 'REJECTED' OR coalesce(btrim(review_note), '') <> ''),
  compensates_movement_id uuid          -- full inverse of a nonoperational OPENING/ADJUSTMENT movement (FK added after stock_movement exists)
);
CREATE UNIQUE INDEX stock_adjustment_compensates_uq ON stock_adjustment (compensates_movement_id) WHERE compensates_movement_id IS NOT NULL;
CREATE INDEX stock_adjustment_pending_idx ON stock_adjustment (requested_at, id) WHERE status = 'PENDING';
CREATE TABLE stock_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id uuid NOT NULL REFERENCES stock_balance(id),
  movement_type text NOT NULL CHECK (movement_type IN ('OPENING','RECEIPT','RECEIPT_HELD_RELEASE','RESERVE','RELEASE','ISSUE','RETURN','ADJUSTMENT')),
  delta_on_hand  numeric(18,3) NOT NULL,
  delta_reserved numeric(18,3) NOT NULL,
  receipt_id uuid REFERENCES donation_receipt(id),
  commitment_id uuid REFERENCES commitment(id),
  distribution_line_id uuid REFERENCES distribution_line(id),
  handoff_line_id uuid REFERENCES handoff_line(id),                  -- RETURN: the physical receipt record that credits stock
  adjustment_id uuid UNIQUE REFERENCES stock_adjustment(id),         -- ADJUSTMENT: the independently approved request (applied at most once)
  operation_ref text NOT NULL UNIQUE,                                -- idempotency / exactly-once key
  actor_user_id uuid NOT NULL, reason text,                          -- reason: OPENING note only; ADJUSTMENT reason lives on stock_adjustment
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movement_shape CHECK (
    (movement_type IN ('OPENING','RECEIPT','RECEIPT_HELD_RELEASE','RETURN') AND delta_on_hand > 0 AND delta_reserved = 0) OR
    (movement_type = 'RESERVE' AND delta_on_hand = 0 AND delta_reserved > 0) OR
    (movement_type = 'RELEASE' AND delta_on_hand = 0 AND delta_reserved < 0) OR
    (movement_type = 'ISSUE'   AND delta_on_hand < 0 AND delta_reserved = delta_on_hand) OR
    (movement_type = 'ADJUSTMENT' AND delta_on_hand <> 0 AND delta_reserved = 0)),
  CONSTRAINT movement_source CHECK (
    (movement_type IN ('RESERVE','RELEASE','ISSUE') AND num_nonnulls(commitment_id, distribution_line_id) = 1 AND receipt_id IS NULL AND handoff_line_id IS NULL AND adjustment_id IS NULL) OR
    (movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE') AND receipt_id IS NOT NULL AND commitment_id IS NULL AND distribution_line_id IS NULL AND handoff_line_id IS NULL AND adjustment_id IS NULL) OR
    (movement_type = 'RETURN' AND handoff_line_id IS NOT NULL AND receipt_id IS NULL AND commitment_id IS NULL AND distribution_line_id IS NULL AND adjustment_id IS NULL) OR
    (movement_type = 'ADJUSTMENT' AND adjustment_id IS NOT NULL AND receipt_id IS NULL AND commitment_id IS NULL AND distribution_line_id IS NULL AND handoff_line_id IS NULL) OR
    (movement_type = 'OPENING' AND num_nonnulls(receipt_id, commitment_id, distribution_line_id, handoff_line_id, adjustment_id) = 0))
);
CREATE UNIQUE INDEX movement_initial_receipt_uq ON stock_movement (receipt_id, balance_id) WHERE movement_type = 'RECEIPT';
CREATE UNIQUE INDEX movement_return_once_uq ON stock_movement (handoff_line_id) WHERE movement_type = 'RETURN';
ALTER TABLE stock_adjustment ADD FOREIGN KEY (compensates_movement_id) REFERENCES stock_movement(id);
CREATE INDEX movement_balance_idx ON stock_movement (balance_id, created_at, id) INCLUDE (delta_on_hand, delta_reserved);   -- keyset + index-only reconciliation
CREATE INDEX movement_receipt_idx ON stock_movement (receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX movement_commitment_idx ON stock_movement (commitment_id) WHERE commitment_id IS NOT NULL;
CREATE INDEX movement_dline_idx ON stock_movement (distribution_line_id) WHERE distribution_line_id IS NOT NULL;

CREATE TABLE logistics_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid REFERENCES donation_delivery(id),
  dispute_id  uuid REFERENCES donation_dispute(id),
  handoff_id  uuid REFERENCES handoff_record(id),
  object_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY','FAILED')),
  declared_bytes bigint NOT NULL CHECK (declared_bytes > 0), size_bytes bigint CHECK (size_bytes > 0),
  detected_mime text CHECK (detected_mime IN ('image/jpeg','image/png','video/mp4')), checksum text,       -- integrity manifest
  uploader_user_id uuid,                                    -- NULL = uploaded through a donor capability
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exactly_one_owner CHECK (num_nonnulls(delivery_id, dispute_id, handoff_id) = 1),
  CONSTRAINT ready_complete CHECK (state <> 'READY' OR (size_bytes IS NOT NULL AND detected_mime IS NOT NULL AND checksum IS NOT NULL)),
  CONSTRAINT size_within_declared CHECK (size_bytes IS NULL OR size_bytes <= declared_bytes)
);
CREATE INDEX attachment_delivery_idx ON logistics_attachment (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX attachment_dispute_idx ON logistics_attachment (dispute_id) WHERE dispute_id IS NOT NULL;
CREATE INDEX attachment_handoff_idx ON logistics_attachment (handoff_id) WHERE handoff_id IS NOT NULL;
CREATE INDEX attachment_pending_idx ON logistics_attachment (created_at) WHERE state = 'PENDING';

-- ---------- cross-cutting ----------
CREATE TABLE notice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_user_id uuid NOT NULL,
  source_id uuid NOT NULL, source_version int NOT NULL, notice_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  UNIQUE (source_id, source_version, recipient_user_id, notice_type)
) WITH (fillfactor = 85);
CREATE INDEX notice_recipient_idx ON notice (recipient_user_id, created_at DESC, id DESC);
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_user_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  before_state jsonb, after_state jsonb, reason text, correlation_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC, id DESC);
CREATE TABLE idempotency_record (
  scope_key text NOT NULL, command text NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
  response_status int, resource_type text, resource_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, command, idempotency_key),
  CHECK ((resource_type IS NULL) = (resource_id IS NULL))               -- replay re-reads the resource
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);
CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);
-- Staff-issued, purpose-bound, one-use recovery of a donor capability (plaintext never stored).
CREATE TABLE capability_recovery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES donation_delivery(id),
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  issued_by_user_id uuid NOT NULL,
  basis text NOT NULL CHECK (btrim(basis) <> ''),
  source_note text,
  consumed_at timestamptz, consumed_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((consumed_at IS NULL) = (consumed_by_user_id IS NULL)),
  CHECK (expires_at > created_at)
);

-- =====================  triggers  =====================
-- 1. Ledger -> balance: the only way stock changes. CHECKs on stock_balance fire inside the same statement.
-- SECURITY DEFINER: runs as the NOLOGIN owner role c48_logistics_owner (see "roles and privileges" at the end of this file), which alone
-- holds UPDATE(on_hand, reserved, updated_at) on stock_balance. search_path is pinned and every relation is schema-qualified, so the
-- application role cannot redirect the function by creating shadow objects; it also cannot own or replace the function.
CREATE FUNCTION apply_stock_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.stock_balance SET on_hand = on_hand + NEW.delta_on_hand, reserved = reserved + NEW.delta_reserved, updated_at = pg_catalog.now() WHERE id = NEW.balance_id;
  RETURN NULL;
END $$;
CREATE TRIGGER stock_movement_apply AFTER INSERT ON stock_movement FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- 2. An ADJUSTMENT movement must match an APPROVED request reviewed by the person who posts it (two-person control in the DB)
CREATE FUNCTION check_adjustment_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a stock_adjustment%ROWTYPE;
BEGIN
  IF NEW.movement_type <> 'ADJUSTMENT' THEN RETURN NEW; END IF;
  SELECT * INTO a FROM stock_adjustment WHERE id = NEW.adjustment_id;
  IF NOT FOUND OR a.status <> 'APPROVED' OR a.balance_id <> NEW.balance_id OR a.delta_on_hand <> NEW.delta_on_hand OR a.reviewed_by_user_id <> NEW.actor_user_id THEN
    RAISE EXCEPTION 'ADJUSTMENT movement does not match an approved adjustment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movement_adjustment_guard BEFORE INSERT ON stock_movement FOR EACH ROW EXECUTE FUNCTION check_adjustment_movement();
CREATE FUNCTION guard_adjustment_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'reviewed adjustments are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_adjustment_immutable BEFORE UPDATE OR DELETE ON stock_adjustment FOR EACH ROW EXECUTE FUNCTION guard_adjustment_update();

-- 3. Independent review: a reviewer of a receipt can never have counted it, and a counter can never later review it
CREATE FUNCTION check_review_independence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'receipt_review' THEN
    IF EXISTS (SELECT 1 FROM receipt_count WHERE receipt_id = NEW.receipt_id AND counted_by_user_id = NEW.reviewer_user_id) THEN
      RAISE EXCEPTION 'reviewer counted this receipt' USING ERRCODE = 'check_violation'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM receipt_review WHERE receipt_id = NEW.receipt_id AND reviewer_user_id = NEW.counted_by_user_id) THEN
      RAISE EXCEPTION 'counter already reviewed this receipt' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipt_review_independence BEFORE INSERT ON receipt_review FOR EACH ROW EXECUTE FUNCTION check_review_independence();
CREATE TRIGGER receipt_count_independence BEFORE INSERT ON receipt_count FOR EACH ROW EXECUTE FUNCTION check_review_independence();

-- 4. Handoff kind must agree with the distribution's route; settlement type must agree with the handoff kind
CREATE FUNCTION check_handoff_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid;
BEGIN
  SELECT relief_point_id INTO p FROM distribution WHERE id = NEW.distribution_id;
  IF NEW.handoff_kind = 'DIRECT_HOUSEHOLD' AND p IS NOT NULL THEN RAISE EXCEPTION 'direct handoff on a distribution that has a relief point' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.handoff_kind IN ('POINT_RECEIPT','HOUSEHOLD_HANDOUT') AND p IS NULL THEN RAISE EXCEPTION 'point handoff on a distribution without a relief point' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handoff_route_guard BEFORE INSERT ON handoff_record FOR EACH ROW EXECUTE FUNCTION check_handoff_route();
CREATE FUNCTION check_settlement_kind() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  SELECT r.handoff_kind INTO k FROM handoff_line l JOIN handoff_record r ON r.id = l.handoff_id WHERE l.id = NEW.handoff_line_id;
  IF NOT ((NEW.settlement_type = 'DELIVERED' AND k IN ('DIRECT_HOUSEHOLD','HOUSEHOLD_HANDOUT','POINT_RECEIPT')) OR
          (NEW.settlement_type = 'RETURNED' AND k = 'RETURN') OR (NEW.settlement_type = 'LOST' AND k = 'LOSS')) THEN
    RAISE EXCEPTION 'settlement % is not valid for handoff kind %', NEW.settlement_type, k USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.settlement_type = 'LOST' AND NOT EXISTS (SELECT 1 FROM handoff_loss_review r JOIN handoff_line l ON l.handoff_id = r.handoff_id WHERE l.id = NEW.handoff_line_id AND r.decision = 'APPROVE') THEN
    RAISE EXCEPTION 'a LOST settlement needs an APPROVE handoff_loss_review' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_kind_guard BEFORE INSERT ON issued_line_settlement FOR EACH ROW EXECUTE FUNCTION check_settlement_kind();

CREATE FUNCTION check_loss_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; rec uuid;
BEGIN
  SELECT handoff_kind, recorder_user_id INTO k, rec FROM handoff_record WHERE id = NEW.handoff_id;
  IF k IS DISTINCT FROM 'LOSS' THEN RAISE EXCEPTION 'only a LOSS handoff can be reviewed' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.reviewer_user_id = rec THEN RAISE EXCEPTION 'the recorder cannot review their own LOSS handoff' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handoff_loss_review_guard BEFORE INSERT ON handoff_loss_review FOR EACH ROW EXECUTE FUNCTION check_loss_review();

-- 4b. Stock receipt needs an independent APPROVE on the CURRENT count revision and CURRENT declaration revision (no auto approval),
-- and the poster must not have counted any revision of that receipt. Applies to RECEIPT and RECEIPT_HELD_RELEASE.
CREATE FUNCTION check_receipt_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d uuid; cur int; decl int;
BEGIN
  IF NEW.movement_type NOT IN ('RECEIPT','RECEIPT_HELD_RELEASE') THEN RETURN NEW; END IF;
  SELECT delivery_id INTO d FROM donation_receipt WHERE id = NEW.receipt_id;
  SELECT max(revision) INTO cur FROM receipt_count WHERE receipt_id = NEW.receipt_id;
  SELECT max(revision) INTO decl FROM donation_declaration WHERE delivery_id = d;
  IF cur IS NULL OR NOT EXISTS (SELECT 1 FROM receipt_review WHERE receipt_id = NEW.receipt_id AND decision = 'APPROVE' AND count_revision = cur AND declaration_revision = decl) THEN
    RAISE EXCEPTION 'receipt has no APPROVE review on its current count and declaration revisions' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM receipt_count WHERE receipt_id = NEW.receipt_id AND counted_by_user_id = NEW.actor_user_id) THEN
    RAISE EXCEPTION 'the poster counted this receipt' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movement_receipt_guard BEFORE INSERT ON stock_movement FOR EACH ROW EXECUTE FUNCTION check_receipt_posting();

-- 4c. A compensating adjustment is the exact inverse of a nonoperational movement on the same balance
CREATE FUNCTION check_adjustment_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m stock_movement%ROWTYPE;
BEGIN
  IF NEW.compensates_movement_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO m FROM stock_movement WHERE id = NEW.compensates_movement_id;
  IF NOT FOUND OR m.movement_type NOT IN ('OPENING','ADJUSTMENT') OR m.balance_id <> NEW.balance_id OR m.delta_on_hand <> -NEW.delta_on_hand THEN
    RAISE EXCEPTION 'compensation must fully invert an OPENING/ADJUSTMENT movement on the same balance' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_adjustment_compensation_guard BEFORE INSERT ON stock_adjustment FOR EACH ROW EXECUTE FUNCTION check_adjustment_compensation();

-- 4d. cycle_intent: binding columns are immutable; the only transition is to ABORTED (tombstone); rows are never deleted
CREATE FUNCTION guard_cycle_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'cycle_intent rows are permanent tombstones'; END IF;
  IF (OLD.intent_id, OLD.cycle_id, OLD.kind, OLD.created_at) IS DISTINCT FROM (NEW.intent_id, NEW.cycle_id, NEW.kind, NEW.created_at) THEN
    RAISE EXCEPTION 'cycle_intent binding columns are immutable' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.state <> OLD.state AND NOT (NEW.state = 'ABORTED' AND OLD.state <> 'ABORTED') THEN
    RAISE EXCEPTION 'cycle_intent may only move to ABORTED' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cycle_intent_guard BEFORE UPDATE OR DELETE ON cycle_intent FOR EACH ROW EXECUTE FUNCTION guard_cycle_intent();
-- Verification query (expected: zero rows): hot-guard fulfillment_cycle.state vs the latest non-aborted cycle_intent
CREATE FUNCTION check_cycle_state_matches_intent() RETURNS TABLE (cycle_id uuid, cycle_state text, intent_state text) LANGUAGE sql STABLE AS $$
  SELECT c.id, c.state, i.state FROM fulfillment_cycle c LEFT JOIN cycle_intent i ON i.cycle_id = c.id AND i.state <> 'ABORTED'
  WHERE c.state IS DISTINCT FROM CASE i.state WHEN 'SEALED' THEN 'SEALED' WHEN 'FROZEN' THEN 'FROZEN' ELSE 'OPEN' END
$$;

-- 4e. Organization guards (01 §7): a designated relief point and a commitment warehouse must belong to the cycle's organization
CREATE FUNCTION check_need_point_org() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE po uuid; co uuid;
BEGIN
  IF NEW.designated_point_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO po FROM relief_point WHERE id = NEW.designated_point_id;
  SELECT organization_id INTO co FROM fulfillment_cycle WHERE id = NEW.cycle_id;
  IF po IS DISTINCT FROM co THEN
    RAISE EXCEPTION 'designated relief point belongs to another organization than the fulfillment cycle' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relief_need_point_org_guard BEFORE INSERT OR UPDATE OF designated_point_id, cycle_id ON relief_need FOR EACH ROW EXECUTE FUNCTION check_need_point_org();
CREATE FUNCTION check_commitment_warehouse_org() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wo uuid; co uuid;
BEGIN
  SELECT organization_id INTO wo FROM warehouse WHERE id = NEW.warehouse_id;
  SELECT c.organization_id INTO co FROM relief_need n JOIN fulfillment_cycle c ON c.id = n.cycle_id WHERE n.id = NEW.relief_need_id;
  IF wo IS DISTINCT FROM co THEN
    RAISE EXCEPTION 'commitment warehouse belongs to another organization than the need''s fulfillment cycle' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commitment_warehouse_org_guard BEFORE INSERT OR UPDATE OF warehouse_id, relief_need_id ON commitment FOR EACH ROW EXECUTE FUNCTION check_commitment_warehouse_org();

-- 5. Distribution lines are frozen once the distribution leaves DRAFT (only the two counters may move afterwards)
CREATE FUNCTION guard_distribution_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; d uuid;
BEGIN
  d := COALESCE(NEW.distribution_id, OLD.distribution_id);
  SELECT status INTO st FROM distribution WHERE id = d;
  IF TG_OP = 'UPDATE' AND (OLD.distribution_id, OLD.item_id, OLD.commitment_id, OLD.quantity, OLD.warehouse_id) IS NOT DISTINCT FROM (NEW.distribution_id, NEW.item_id, NEW.commitment_id, NEW.quantity, NEW.warehouse_id) THEN
    RETURN NEW;                                   -- counter-only update
  END IF;
  IF st <> 'DRAFT' THEN RAISE EXCEPTION 'distribution lines can only change while the distribution is DRAFT' USING ERRCODE = 'check_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER distribution_line_guard BEFORE INSERT OR UPDATE OR DELETE ON distribution_line FOR EACH ROW EXECUTE FUNCTION guard_distribution_lines();

-- 6. Quantity scale comes from the unit (0 for pieces, up to 3 for kg/litre)
CREATE FUNCTION enforce_quantity_scale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb := to_jsonb(NEW); sc smallint; q numeric; i int;
BEGIN
  SELECT u.scale INTO sc FROM item it JOIN unit u ON u.code = it.unit_code WHERE it.id = (j ->> TG_ARGV[0])::uuid;
  IF sc IS NULL THEN RAISE EXCEPTION 'unknown item' USING ERRCODE = 'foreign_key_violation'; END IF;
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    q := (j ->> TG_ARGV[i])::numeric;
    IF q IS NOT NULL AND scale(trim_scale(q)) > sc THEN RAISE EXCEPTION 'quantity % has more decimals than the unit allows (%)', q, sc USING ERRCODE = 'check_violation'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER donation_line_scale BEFORE INSERT ON donation_line FOR EACH ROW EXECUTE FUNCTION enforce_quantity_scale('item_id','declared_quantity');
CREATE TRIGGER count_line_scale BEFORE INSERT ON receipt_count_line FOR EACH ROW EXECUTE FUNCTION enforce_quantity_scale('item_id','counted_quantity','accepted_quantity','held_quantity','rejected_quantity');
CREATE TRIGGER drive_item_scale BEFORE INSERT OR UPDATE ON drive_item FOR EACH ROW EXECUTE FUNCTION enforce_quantity_scale('item_id','target_quantity');
CREATE TRIGGER need_scale BEFORE INSERT OR UPDATE ON relief_need FOR EACH ROW EXECUTE FUNCTION enforce_quantity_scale('item_id','original_quantity','requested_quantity','cancelled_remaining');
CREATE TRIGGER commitment_scale BEFORE INSERT ON commitment FOR EACH ROW EXECUTE FUNCTION enforce_quantity_scale('item_id','quantity');
CREATE TRIGGER distribution_line_scale BEFORE INSERT ON distribution_line FOR EACH ROW EXECUTE FUNCTION enforce_quantity_scale('item_id','quantity');

-- 7. Append-only / immutable tables: row changes and TRUNCATE are refused (also REVOKE UPDATE, DELETE, TRUNCATE from the application role)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stock_movement','issued_line_settlement','audit_log','receipt_count','receipt_count_line','donation_declaration','donation_line','receipt_review','handoff_record','handoff_line','handoff_loss_review'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t||'_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t||'_no_truncate', t);
  END LOOP;
END $$;

-- =====================  roles and privileges  =====================
-- NOLOGIN group roles. Real deployments create a login user and GRANT c48_logistics_app TO that user (the application connects as it);
-- c48_logistics_owner is never granted to anyone and never logs in. Role names are cluster-wide, hence the idempotent DO block.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_owner') THEN CREATE ROLE c48_logistics_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_logistics_app')   THEN CREATE ROLE c48_logistics_app NOLOGIN; END IF;
END $$;

-- Nobody can create objects in public (no shadow functions/tables); the owner receives CREATE only for the ownership transfer below.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM c48_logistics_app;
GRANT USAGE ON SCHEMA public TO c48_logistics_owner, c48_logistics_app;

-- Stock writer: the definer function is owned by c48_logistics_owner, whose only table privileges are SELECT and column-level UPDATE.
GRANT CREATE ON SCHEMA public TO c48_logistics_owner;           -- ALTER ... OWNER TO requires CREATE on the schema
ALTER FUNCTION apply_stock_movement() OWNER TO c48_logistics_owner;
REVOKE CREATE ON SCHEMA public FROM c48_logistics_owner;
REVOKE ALL ON FUNCTION apply_stock_movement() FROM PUBLIC;       -- only the trigger machinery runs it
GRANT SELECT ON stock_balance TO c48_logistics_owner;
GRANT UPDATE (on_hand, reserved, updated_at) ON stock_balance TO c48_logistics_owner;

-- Application role. Default: read everything; insert/update mutable tables; never delete except the two cleanup tables.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO c48_logistics_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO c48_logistics_app;
DO $$ DECLARE t text; BEGIN
  -- mutable tables: INSERT + UPDATE (DELETE is not granted; row-level lifecycle is by status columns)
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
             AND c.relname NOT IN ('stock_balance','spatial_ref_sys',
                 -- append-only list = the forbid_mutation() trigger list below: INSERT only
                 'stock_movement','issued_line_settlement','audit_log','receipt_count','receipt_count_line','donation_declaration','donation_line','receipt_review','handoff_record','handoff_line','handoff_loss_review')
  LOOP EXECUTE format('GRANT INSERT, UPDATE ON %I TO c48_logistics_app', t); END LOOP;
  -- append-only tables: INSERT only (UPDATE/DELETE/TRUNCATE not granted; the forbid_mutation triggers are the second defence)
  FOREACH t IN ARRAY ARRAY['stock_movement','issued_line_settlement','audit_log','receipt_count','receipt_count_line','donation_declaration','donation_line','receipt_review','handoff_record','handoff_line','handoff_loss_review'] LOOP
    EXECUTE format('GRANT INSERT ON %I TO c48_logistics_app', t);
  END LOOP;
END $$;
-- cycle_intent is covered by the mutable list: UPDATE is allowed because guard_cycle_intent() permits only the move to ABORTED.
-- stock_balance: controlled zero-balance creation only. No UPDATE, no DELETE; on_hand/reserved start at their defaults (0).
GRANT INSERT (id, warehouse_id, item_id) ON stock_balance TO c48_logistics_app;
-- Retention/cleanup jobs.
GRANT DELETE ON idempotency_record, notice TO c48_logistics_app;   -- retention cleanup
GRANT DELETE ON distribution_line, drive_item TO c48_logistics_app;  -- 'replace lines / items as a set' commands; distribution_line_guard still refuses it once the distribution leaves DRAFT
