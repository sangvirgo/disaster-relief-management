-- C48 Logistics service — physical schema (PostgreSQL 16+ with PostGIS 3 for point columns). v2: after the 4-agent review (see 01-schema-review.md §6).
-- Opaque cross-service ids: campaign_id, organization_id (except local FKs below), request_id, *_user_id. No GiST index until a spatial query exists.
-- Stock changes ONLY by inserting a stock_movement; triggers apply it to stock_balance. REVOKE direct UPDATE on stock_balance from the app role.
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
  created_at     timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX item_name_unit_uq ON item (lower(name), unit_code);
CREATE INDEX item_type_idx ON item (item_type_code);
CREATE INDEX item_unit_idx ON item (unit_code);

CREATE TABLE warehouse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, region_code text NOT NULL,
  name text NOT NULL CHECK (is_clean_text(name)), address_note text, location geography(Point,4326),
  location_public boolean NOT NULL DEFAULT false,              -- public pages show the point only when the manager opts in
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id)                                  -- target of composite FKs: children cannot disagree on the owning organization
);
CREATE INDEX warehouse_scope_idx ON warehouse (organization_id, region_code) WHERE status = 'ACTIVE';
CREATE TABLE relief_point (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, region_code text NOT NULL,
  name text NOT NULL CHECK (is_clean_text(name)), contact_note text, operating_note text, location geography(Point,4326) NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id)
);
CREATE INDEX relief_point_scope_idx ON relief_point (organization_id, region_code) WHERE status = 'ACTIVE';
CREATE TABLE vehicle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, identifier text NOT NULL CHECK (is_clean_text(identifier)),
  vehicle_type text NOT NULL, capacity numeric(18,3) CHECK (capacity > 0), capacity_unit text REFERENCES unit(code),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (id, organization_id),
  CHECK ((capacity IS NULL) = (capacity_unit IS NULL))
);
CREATE UNIQUE INDEX vehicle_identifier_uq ON vehicle (organization_id, lower(identifier));
CREATE INDEX vehicle_unit_idx ON vehicle (capacity_unit) WHERE capacity_unit IS NOT NULL;

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
  created_by_user_id  uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             int NOT NULL DEFAULT 1,
  FOREIGN KEY (intake_warehouse_id, organization_id) REFERENCES warehouse(id, organization_id),   -- drive and its intake site share one organization
  CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at),
  CHECK ((campaign_id IS NULL) = (campaign_status IS NULL))
);
CREATE INDEX drive_public_idx ON donation_drive (created_at DESC, id DESC) WHERE status = 'OPEN';       -- keyset on a NOT NULL column (closes_at is nullable)
CREATE INDEX drive_scope_idx ON donation_drive (organization_id, status, created_at DESC, id DESC);
CREATE INDEX drive_warehouse_idx ON donation_drive (intake_warehouse_id);
CREATE INDEX drive_campaign_idx ON donation_drive (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE drive_item (
  drive_id uuid NOT NULL REFERENCES donation_drive(id),
  item_id  uuid NOT NULL REFERENCES item(id),
  target_quantity numeric(18,3) NOT NULL CHECK (target_quantity > 0),
  acceptance_note text,
  PRIMARY KEY (drive_id, item_id)
);
CREATE INDEX drive_item_item_idx ON drive_item (item_id);

-- ---------- donor declarations (immutable revisions) ----------
-- delivery.status is the single lifecycle for both donor and staff views (receipt has no status of its own).
CREATE TABLE donation_delivery (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code          text NOT NULL UNIQUE CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{8,16}$'),   -- receipt number; identifier only, grants nothing
  drive_id             uuid NOT NULL REFERENCES donation_drive(id),
  donor_user_id        uuid,
  donor_name           text NOT NULL CHECK (is_clean_text(donor_name)),
  donor_phone          text NOT NULL CHECK (donor_phone ~ '^\+?[0-9]{8,15}$'),
  capability_hash      text,                                 -- purpose-bound hash of the donation secret; NULL after claim/revoke
  status               text NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED','POSTED','REJECTED','CANCELLED')),
  current_declaration_rev int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              int NOT NULL DEFAULT 1
) WITH (fillfactor = 85);
CREATE UNIQUE INDEX delivery_capability_uq ON donation_delivery (capability_hash) WHERE capability_hash IS NOT NULL;
CREATE INDEX delivery_drive_idx ON donation_delivery (drive_id, created_at DESC, id DESC);
CREATE INDEX delivery_donor_idx ON donation_delivery (donor_user_id, created_at DESC, id DESC) WHERE donor_user_id IS NOT NULL;
CREATE INDEX delivery_work_idx ON donation_delivery (status, created_at, id) WHERE status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED');
CREATE TABLE donation_declaration (
  delivery_id uuid NOT NULL REFERENCES donation_delivery(id),
  revision    int NOT NULL CHECK (revision >= 1),
  created_by_kind text NOT NULL CHECK (created_by_kind IN ('DONOR','STAFF_ASSISTED')),
  created_by_user_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id, revision)
);
ALTER TABLE donation_delivery ADD FOREIGN KEY (id, current_declaration_rev) REFERENCES donation_declaration(delivery_id, revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE donation_line (
  delivery_id uuid NOT NULL, revision int NOT NULL,
  item_id uuid NOT NULL REFERENCES item(id),
  declared_quantity numeric(18,3) NOT NULL CHECK (declared_quantity > 0),
  PRIMARY KEY (delivery_id, revision, item_id),
  FOREIGN KEY (delivery_id, revision) REFERENCES donation_declaration(delivery_id, revision)
);
CREATE INDEX donation_line_item_idx ON donation_line (item_id);

-- ---------- receipts, counts, reviews ----------
CREATE TABLE donation_receipt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  uuid NOT NULL UNIQUE REFERENCES donation_delivery(id),
  warehouse_id uuid NOT NULL REFERENCES warehouse(id),
  current_count_rev int,                                     -- NULL until the first count
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      int NOT NULL DEFAULT 1,
  UNIQUE (id, delivery_id)
);
CREATE INDEX receipt_warehouse_idx ON donation_receipt (warehouse_id);
CREATE TABLE receipt_count (
  receipt_id uuid NOT NULL REFERENCES donation_receipt(id),
  revision   int NOT NULL CHECK (revision >= 1),
  counted_by_user_id uuid NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  note       text,
  PRIMARY KEY (receipt_id, revision)
);
ALTER TABLE donation_receipt ADD FOREIGN KEY (id, current_count_rev) REFERENCES receipt_count(receipt_id, revision) DEFERRABLE INITIALLY DEFERRED;
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
CREATE INDEX receipt_count_line_item_idx ON receipt_count_line (item_id);
CREATE TABLE receipt_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL, delivery_id uuid NOT NULL,
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
CREATE INDEX receipt_review_decl_idx ON receipt_review (delivery_id, declaration_revision);
CREATE TABLE donation_dispute (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES donation_delivery(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','WITHDRAWN')),
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
CREATE INDEX stock_balance_item_idx ON stock_balance (item_id);

-- ---------- fulfillment ----------
CREATE TABLE fulfillment_cycle (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL, work_cycle int NOT NULL CHECK (work_cycle >= 1),
  organization_id uuid NOT NULL, campaign_id uuid, region_code text,        -- attribution copied from Response; same for every need in the cycle
  state      text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','FROZEN','SEALED')),
  seal_id    uuid UNIQUE, intent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (request_id, work_cycle),
  CHECK ((state = 'SEALED') = (seal_id IS NOT NULL))
);
CREATE INDEX cycle_scope_idx ON fulfillment_cycle (organization_id, created_at DESC, id DESC);
CREATE INDEX cycle_campaign_idx ON fulfillment_cycle (campaign_id) WHERE campaign_id IS NOT NULL;
-- delivery target is derived: designated_point_id IS NULL => FINAL_RECIPIENT, else RELIEF_POINT (no redundant kind column)
CREATE TABLE relief_need (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id    uuid NOT NULL REFERENCES fulfillment_cycle(id),
  item_id     uuid NOT NULL REFERENCES item(id),
  original_quantity  numeric(18,3) NOT NULL CHECK (original_quantity > 0),
  requested_quantity numeric(18,3) NOT NULL CHECK (requested_quantity > 0),   -- current effective quantity (may be reduced)
  cancelled_remaining numeric(18,3) CHECK (cancelled_remaining >= 0),
  designated_point_id uuid REFERENCES relief_point(id),
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_FULFILLED','FULFILLED','CANCELLED')),
  created_by_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version     int NOT NULL DEFAULT 1,
  CHECK (requested_quantity <= original_quantity),
  CHECK ((status = 'CANCELLED') = (cancelled_remaining IS NOT NULL)),
  CHECK (cancelled_remaining IS NULL OR cancelled_remaining <= requested_quantity),
  UNIQUE (id, item_id)
);
CREATE UNIQUE INDEX need_one_live_per_item_uq ON relief_need (cycle_id, item_id) WHERE status <> 'CANCELLED';
CREATE INDEX need_cycle_idx ON relief_need (cycle_id);                       -- the fulfillment board also lists CANCELLED needs
CREATE INDEX need_item_idx ON relief_need (item_id);
CREATE INDEX need_point_idx ON relief_need (designated_point_id) WHERE designated_point_id IS NOT NULL;
CREATE TABLE commitment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relief_need_id uuid NOT NULL,
  item_id        uuid NOT NULL,                                -- must equal the need's item (composite FK)
  warehouse_id   uuid NOT NULL REFERENCES warehouse(id),
  quantity           numeric(18,3) NOT NULL CHECK (quantity > 0),
  -- cumulative counters: intentional denormalisation of the settlement/movement ledgers so CHECKs and row locks work; one writer, reconciled by test
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
CREATE INDEX commitment_warehouse_idx ON commitment (warehouse_id);

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
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
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
CREATE INDEX distribution_scope_idx ON distribution (organization_id, status, created_at, id);
CREATE INDEX distribution_warehouse_idx ON distribution (warehouse_id);
CREATE INDEX distribution_point_idx ON distribution (relief_point_id) WHERE relief_point_id IS NOT NULL;
CREATE INDEX distribution_vehicle_idx ON distribution (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX distribution_campaign_idx ON distribution (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE distribution_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL, warehouse_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES item(id),
  commitment_id uuid,                                    -- request-linked aid; item and warehouse must match the commitment (composite FK)
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  in_transit_quantity numeric(18,3) NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),   -- counters: one writer, CHECKed non-negative
  at_point_quantity   numeric(18,3) NOT NULL DEFAULT 0 CHECK (at_point_quantity >= 0),
  FOREIGN KEY (distribution_id, warehouse_id) REFERENCES distribution(id, warehouse_id),
  FOREIGN KEY (commitment_id, item_id, warehouse_id) REFERENCES commitment(id, item_id, warehouse_id),
  UNIQUE (distribution_id, id),
  UNIQUE (id, commitment_id),
  CHECK (in_transit_quantity + at_point_quantity <= quantity)
);
CREATE UNIQUE INDEX distribution_line_commitment_uq ON distribution_line (distribution_id, commitment_id) WHERE commitment_id IS NOT NULL;
CREATE INDEX distribution_line_item_idx ON distribution_line (item_id);
CREATE INDEX distribution_line_commitment_idx ON distribution_line (commitment_id) WHERE commitment_id IS NOT NULL;
CREATE TABLE handoff_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id uuid NOT NULL REFERENCES distribution(id),
  handoff_kind text NOT NULL CHECK (handoff_kind IN ('DIRECT_HOUSEHOLD','POINT_RECEIPT','HOUSEHOLD_HANDOUT','RETURN','LOSS')),
  source_stage text CHECK (source_stage IN ('IN_TRANSIT','AT_POINT')),   -- where returned/lost goods were
  receiver_user_id uuid, receiver_label text,            -- household may have no account; no names/IDs required
  recorder_user_id uuid NOT NULL, approved_by_user_id uuid,
  confirmation_basis text NOT NULL CHECK (btrim(confirmation_basis) <> ''),
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, distribution_id),
  CHECK ((handoff_kind IN ('RETURN','LOSS')) = (source_stage IS NOT NULL)),
  CHECK (handoff_kind <> 'LOSS' OR (approved_by_user_id IS NOT NULL AND approved_by_user_id <> recorder_user_id)),
  CHECK (receiver_user_id IS NULL OR receiver_user_id <> recorder_user_id)
);
CREATE INDEX handoff_distribution_idx ON handoff_record (distribution_id, occurred_at, id);
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
CREATE TABLE issued_line_settlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid NOT NULL REFERENCES commitment(id),
  handoff_line_id uuid NOT NULL,
  settlement_type text NOT NULL CHECK (settlement_type IN ('DELIVERED','RETURNED','LOST')),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  actor_user_id uuid NOT NULL, operation_ref text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (handoff_line_id, commitment_id) REFERENCES handoff_line(id, commitment_id)   -- same commitment as the handoff line
);
CREATE INDEX settlement_commitment_idx ON issued_line_settlement (commitment_id);
CREATE INDEX settlement_handoff_idx ON issued_line_settlement (handoff_line_id);

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
  CHECK (status <> 'REJECTED' OR coalesce(btrim(review_note), '') <> '')
);
CREATE INDEX stock_adjustment_pending_idx ON stock_adjustment (requested_at, id) WHERE status = 'PENDING';
CREATE INDEX stock_adjustment_balance_idx ON stock_adjustment (balance_id);
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
  compensates_movement_id uuid REFERENCES stock_movement(id),
  operation_ref text NOT NULL UNIQUE,                                -- idempotency / exactly-once key
  actor_user_id uuid NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movement_shape CHECK (
    (movement_type IN ('OPENING','RECEIPT','RECEIPT_HELD_RELEASE','RETURN') AND delta_on_hand > 0 AND delta_reserved = 0) OR
    (movement_type = 'RESERVE' AND delta_on_hand = 0 AND delta_reserved > 0) OR
    (movement_type = 'RELEASE' AND delta_on_hand = 0 AND delta_reserved < 0) OR
    (movement_type = 'ISSUE'   AND delta_on_hand < 0 AND delta_reserved = delta_on_hand) OR
    (movement_type = 'ADJUSTMENT' AND delta_on_hand <> 0 AND delta_reserved = 0 AND reason IS NOT NULL)),
  CONSTRAINT movement_source CHECK (
    (movement_type IN ('RESERVE','RELEASE','ISSUE') AND num_nonnulls(commitment_id, distribution_line_id) = 1 AND receipt_id IS NULL AND handoff_line_id IS NULL AND adjustment_id IS NULL) OR
    (movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE') AND receipt_id IS NOT NULL AND commitment_id IS NULL AND distribution_line_id IS NULL AND handoff_line_id IS NULL AND adjustment_id IS NULL) OR
    (movement_type = 'RETURN' AND handoff_line_id IS NOT NULL AND receipt_id IS NULL AND commitment_id IS NULL AND distribution_line_id IS NULL AND adjustment_id IS NULL) OR
    (movement_type = 'ADJUSTMENT' AND adjustment_id IS NOT NULL AND receipt_id IS NULL AND commitment_id IS NULL AND distribution_line_id IS NULL AND handoff_line_id IS NULL) OR
    (movement_type = 'OPENING' AND num_nonnulls(receipt_id, commitment_id, distribution_line_id, handoff_line_id, adjustment_id) = 0)),
  CONSTRAINT no_self_compensation CHECK (compensates_movement_id IS NULL OR compensates_movement_id <> id)
);
CREATE UNIQUE INDEX movement_initial_receipt_uq ON stock_movement (receipt_id, balance_id) WHERE movement_type = 'RECEIPT';
CREATE UNIQUE INDEX movement_return_once_uq ON stock_movement (handoff_line_id) WHERE movement_type = 'RETURN';
CREATE UNIQUE INDEX movement_compensates_uq ON stock_movement (compensates_movement_id) WHERE compensates_movement_id IS NOT NULL;
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
  detected_mime text CHECK (detected_mime IN ('image/jpeg','image/png','video/mp4')), checksum text,
  uploader_user_id uuid, uploader_kind text NOT NULL CHECK (uploader_kind IN ('ACCOUNT','CAPABILITY','STAFF')),
  created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz,
  CONSTRAINT exactly_one_owner CHECK (num_nonnulls(delivery_id, dispute_id, handoff_id) = 1),
  CONSTRAINT ready_complete CHECK (state <> 'READY' OR (size_bytes IS NOT NULL AND detected_mime IS NOT NULL AND checksum IS NOT NULL)),
  CONSTRAINT ready_at_matches CHECK ((state = 'READY') = (ready_at IS NOT NULL)),
  CONSTRAINT size_within_declared CHECK (size_bytes IS NULL OR size_bytes <= declared_bytes),
  CONSTRAINT account_has_user CHECK ((uploader_kind IN ('ACCOUNT','STAFF')) = (uploader_user_id IS NOT NULL))
);
CREATE INDEX attachment_delivery_idx ON logistics_attachment (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX attachment_dispute_idx ON logistics_attachment (dispute_id) WHERE dispute_id IS NOT NULL;
CREATE INDEX attachment_handoff_idx ON logistics_attachment (handoff_id) WHERE handoff_id IS NOT NULL;
CREATE INDEX attachment_pending_idx ON logistics_attachment (created_at) WHERE state = 'PENDING';

-- ---------- cross-cutting ----------
CREATE TABLE notice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_user_id uuid NOT NULL,
  source_type text NOT NULL, source_id uuid NOT NULL, source_version int NOT NULL, notice_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  UNIQUE (source_id, source_version, recipient_user_id, notice_type)
) WITH (fillfactor = 85);
CREATE INDEX notice_unread_idx ON notice (recipient_user_id, created_at DESC, id DESC) WHERE read_at IS NULL;
CREATE INDEX notice_recipient_idx ON notice (recipient_user_id, created_at DESC, id DESC);
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_user_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  before_state jsonb, after_state jsonb, reason text, correlation_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC, id DESC);
CREATE TABLE idempotency_record (
  scope_key text NOT NULL, command text NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
  response_status int, response_body jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, command, idempotency_key)
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);
CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);

-- =====================  triggers  =====================
-- 1. Ledger -> balance: the only way stock changes. CHECKs on stock_balance fire inside the same statement.
CREATE FUNCTION apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_balance SET on_hand = on_hand + NEW.delta_on_hand, reserved = reserved + NEW.delta_reserved, updated_at = now() WHERE id = NEW.balance_id;
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
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_kind_guard BEFORE INSERT ON issued_line_settlement FOR EACH ROW EXECUTE FUNCTION check_settlement_kind();

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
  FOREACH t IN ARRAY ARRAY['stock_movement','issued_line_settlement','audit_log','receipt_count','receipt_count_line','donation_declaration','donation_line','receipt_review','handoff_record','handoff_line'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t||'_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t||'_no_truncate', t);
  END LOOP;
END $$;
