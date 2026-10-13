import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const string = (format) => ({ type: 'string', ...(format ? { format } : {}) });
const uuid = () => string('uuid');
const integer = () => ({ type: 'integer' });
const boolean = () => ({ type: 'boolean' });
const array = (items) => ({ type: 'array', items });
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const text = string();
const dateTime = string('date-time');
const id = uuid();
const version = integer();
const quantity = { type: 'string', description: 'Decimal quantity encoded as a string and validated against the unit scale.' };
const response = (schema, description = 'Documented response shape.') => ({ description, content: { 'application/json': { schema } } });
const request = (schema) => ({ required: true, content: { 'application/json': { schema } } });
const item = (properties, required = []) => array(object(properties, required));
const page = (rowProperties) => object({ items: item(rowProperties), more: boolean(), cursor: text });
const versionBody = (properties = {}, required = []) => object({ expected_version: version, ...properties }, ['expected_version', ...required]);
const point = object({
  type: { type: 'string', const: 'Point' },
  coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
}, ['type', 'coordinates']);
const teamViewSchema = object({
  id,
  name: text,
  kind: { type: 'string', enum: ['VOLUNTEER', 'MILITARY', 'GOVERNMENT', 'OTHER'] },
  reporting_mode: { type: 'string', enum: ['APP', 'COORDINATOR'] },
  availability: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
  skills: array(text),
  position: { anyOf: [
    { type: 'null' },
    object({
      age_s: integer(),
      accuracy_m: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      source: { type: 'string', enum: ['GPS', 'MANUAL_PIN', 'COORDINATOR_REPORTED'] },
      location: point,
    }, ['age_s', 'accuracy_m', 'source']),
  ] },
  version,
}, ['id', 'name', 'kind', 'reporting_mode', 'availability', 'status', 'skills', 'position', 'version']);
const teamPageSchema = object({ items: array(teamViewSchema), more: boolean(), cursor: text });
const identityDetails = {
  identityInternalTeamLeaderEligibility: {
    request: request(object({ user_id: id, organization_id: id }, ['user_id', 'organization_id'])),
    response: response({ oneOf: [object({ eligible: { type: 'boolean', const: true } }, ['eligible']), object({ eligible: { type: 'boolean', const: false }, reason: { type: 'string', enum: ['USER_NOT_FOUND', 'USER_INACTIVE', 'MEMBERSHIP_REQUIRED', 'VOLUNTEER_GRANT_REQUIRED'] } }, ['eligible', 'reason'])] }),
  },
};

const identityPaginationQueries = {
  listIdentityUsers: ['cursor', 'limit'],
  listIdentityUserGrants: ['cursor', 'limit'],
  listIdentityOrganizations: ['cursor', 'limit'],
  listIdentityRegions: ['cursor', 'limit'],
  listIdentityAuditLogs: ['cursor', 'limit'],
};

const responseDetails = {
  responseRequestOperationsEvidence: {
    response: response(object({ items: item({ id, state: text, size_bytes: integer(), detected_mime: text, checksum: text, created_at: dateTime }), more: boolean(), cursor: text })),
  },
  responseRequestResolutionInternalOperation: {
    response: response(object({ id, kind: text, state: text, request_id: id, work_cycle: integer(), request_status: text, organization_id: id, region_code: { anyOf: [text, { type: 'null' }] }, campaign_id: { anyOf: [id, { type: 'null' }] }, outcome_basis: { anyOf: [text, { type: 'null' }] } })),
  },
  responseRequestAdmissionAdmit: {
    noBody: true,
    response: response(object({ request_id: id, work_cycle: integer(), version, status: { type: 'string', enum: ['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'] }, organization_id: id, region_code: { anyOf: [text, { type: 'null' }] }, campaign_id: { anyOf: [id, { type: 'null' }] } })),
  },
  responseMissionsReviewFailure: {
    request: request(object({ expected_version: version, disposition: { type: 'string', enum: ['REPLACED', 'NO_FURTHER_ACTION', 'REFERRED'] }, reason: text, replacement_mission_id: id }, ['expected_version', 'disposition', 'reason'])),
    response: response(object({ mission_id: id, mission_version: version, request_version: version, disposition: text, reason: text, replacement_mission_id: id })),
  },
  responseRequestResolutionOperation: {
    response: response(object({ state: text, version })),
  },
  responseRequestResolutionAbortOperation: {
    request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])),
    response: response(object({ operation_id: id, state: text })),
  },
  responseRequestResolutionAdoptOperation: {
    request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])),
    response: response(object({ operation_id: id, state: text })),
  },
  responseRequestResolutionCancel: {
    request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])),
    response: response(object({ operation_id: id, state: text })),
  },
  responseRequestResolutionClose: {
    request: request(object({ expected_version: version }, ['expected_version'])),
    response: response(object({ id, status: text, version, work_cycle: integer() }, ['id', 'status', 'version', 'work_cycle'])),
  },
  responseRequestResolutionReopen: {
    request: request(object({ expected_version: version, reason: text, campaign_id: { anyOf: [id, { type: 'null' }] }, region_code: text }, ['expected_version', 'reason'])),
    response: response(object({ id, status: text, version, work_cycle: integer() }, ['id', 'status', 'version', 'work_cycle'])),
  },
  responseRequestResolutionResolve: {
    request: request(object({ expected_version: version, resolution_reason: text, outcome_basis: { type: 'string', enum: ['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED'] } }, ['expected_version', 'resolution_reason', 'outcome_basis'])),
    response: response(object({ operation_id: id, state: text })),
  },
  responseRequestResolutionAbortResolution: {
    request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])),
    response: response(object({ operation_id: id, state: text })),
  },
  responseTeamsSkills: {
    response: response(object({ items: item({ code: text, display_name: text }, ['code', 'display_name']) }, ['items'])),
  },
  responseTeamsList: {
    query: ['region_code', 'availability', 'status'].map((name) => ({ name, in: 'query', required: false, schema: text })),
    response: response(teamPageSchema),
  },
  responseTeamsCreate: {
    request: request(object({ name: text, organization_id: id, operating_region_code: text, team_kind: text, reporting_mode: { type: 'string', enum: ['APP', 'COORDINATOR'] }, leader_user_id: id, external_contact_note: text, skill_codes: array(text) }, ['name', 'organization_id', 'operating_region_code', 'team_kind', 'reporting_mode', 'skill_codes'])),
    response: response(teamViewSchema),
  },
  responseTeamsDetail: {
    response: response(teamViewSchema),
  },
  responseTeamsUpdate: {
    request: request(object({ expected_version: version, name: text, skill_codes: array(text), availability: text }, ['expected_version'])),
    response: response(teamViewSchema),
  },
};

const responsePaginationQueries = {
  listRequestQueue: ['cursor', 'limit'],
  listUnassignedRequests: ['cursor', 'limit'],
  listRequestContactAttempts: ['cursor', 'limit'],
  listRequestDuplicates: ['cursor', 'limit'],
  listRequestMissions: ['cursor', 'limit'],
  listReporterEvents: ['cursor', 'limit'],
  responseRequestOperationsEvidence: ['cursor', 'limit'],
  listMyRequests: ['cursor', 'limit'],
  listMyMissions: ['cursor', 'limit'],
  listOverdueMissionOffers: ['cursor', 'limit'],
  listNotices: ['cursor', 'limit'],
  responseTeamsList: ['cursor', 'limit'],
  listCampaigns: ['cursor', 'limit'],
  listPublicCampaigns: ['cursor', 'limit'],
};

const logisticsDetails = {
  logisticsCatalogCreateItemType: { request: request(object({ code: text, display_name: text }, ['code', 'display_name'])) },
  logisticsCatalogCreateUnit: { request: request(object({ code: text, display_name: text, scale: { type: 'integer', minimum: 0, maximum: 3 } }, ['code', 'display_name', 'scale'])) },
  logisticsCatalogCreateItem: { request: request(object({ item_type_code: text, unit_code: text, name: text }, ['item_type_code', 'unit_code', 'name'])) },
  logisticsCatalogDeactivateItem: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsAssetsCreateWarehouse: { request: request(object({ organization_id: id, region_code: text, name: text, address_note: text, location: object({ type: { type: 'string', const: 'Point' }, coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }), location_public: boolean() }, ['organization_id', 'region_code', 'name'])) },
  logisticsAssetsPatchWarehouse: { request: request(versionBody({ name: text, address_note: { anyOf: [text, { type: 'null' }] }, location: { anyOf: [object({ type: { type: 'string', const: 'Point' }, coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }), { type: 'null' }] }, location_public: boolean() })) },
  logisticsAssetsDeactivateWarehouse: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsAssetsCreateReliefPoint: { request: request(object({ organization_id: id, region_code: text, name: text, contact_note: text, operating_note: text, location: object({ type: { type: 'string', const: 'Point' }, coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }) }, ['organization_id', 'region_code', 'name', 'location'])) },
  logisticsAssetsPatchReliefPoint: { request: request(versionBody({ name: text, contact_note: text, operating_note: text, location: object({ type: { type: 'string', const: 'Point' }, coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } }) })) },
  logisticsAssetsDeactivateReliefPoint: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsAssetsCreateVehicle: { request: request(object({ organization_id: id, region_code: text, identifier: text, vehicle_type: text, capacity: { anyOf: [quantity, { type: 'null' }] }, capacity_unit: { anyOf: [text, { type: 'null' }] } }, ['organization_id', 'region_code', 'identifier', 'vehicle_type'])) },
  logisticsAssetsPatchVehicle: { request: request(versionBody({ identifier: text, vehicle_type: text, capacity: { anyOf: [quantity, { type: 'null' }] }, capacity_unit: { anyOf: [text, { type: 'null' }] } })) },
  logisticsAssetsDeactivateVehicle: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsStockOpening: { request: request(object({ warehouse_id: id, lines: item({ item_id: id, quantity }, ['item_id', 'quantity']), note: text }, ['warehouse_id', 'lines', 'note'])) },
  logisticsStockCreateAdjustment: { request: request(object({ balance_id: id, delta_on_hand: quantity, reason: text, compensates_movement_id: id }, ['balance_id', 'delta_on_hand', 'reason'])) },
  logisticsStockReviewAdjustment: { request: request(object({ decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, note: text }, ['decision'])) },
  logisticsDrivesCreate: { request: request(object({ title: text, description: text, intake_warehouse_id: id, campaign_id: id, opens_at: dateTime, closes_at: dateTime, items: item({ item_id: id, target_quantity: quantity, acceptance_note: text }, ['item_id', 'target_quantity']) }, ['title', 'description', 'intake_warehouse_id', 'items'])) },
  logisticsDrivesPatch: { request: request(versionBody({ title: text, description: text, intake_warehouse_id: id, campaign_id: id, opens_at: dateTime, closes_at: dateTime, items: item({ item_id: id, target_quantity: quantity, acceptance_note: text }, ['item_id', 'target_quantity']) })) },
  logisticsDrivesOpen: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDrivesPause: { request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])) },
  logisticsDrivesResume: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDrivesClose: { request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])) },
  logisticsDonationsCreateDelivery: {
    request: request(object({ donor_name: text, donor_phone: text, lines: item({ item_id: id, declared_quantity: quantity }, ['item_id', 'declared_quantity']) }, ['donor_name', 'donor_phone', 'lines'])),
    response: response(object({ id, public_code: text, status: { type: 'string', const: 'DECLARED' }, declaration_revision: { type: 'integer', const: 1 } }), 'Created donor declaration representation.'),
  },
  logisticsDonationsReviseDeclaration: { request: request(object({ expected_version: version, lines: item({ item_id: id, declared_quantity: quantity }, ['item_id', 'declared_quantity']) }, ['expected_version', 'lines'])) },
  logisticsDonationsOpenDispute: { request: request(object({ reason: text }, ['reason'])) },
  logisticsDonationsAssistedDeclaration: {
    request: request(object({ expected_version: version, lines: item({ item_id: id, declared_quantity: quantity }, ['item_id', 'declared_quantity']) }, ['expected_version', 'lines'])),
    response: response(object({ id, status: { type: 'string', const: 'DECLARED' }, declaration_revision: integer(), created_by_kind: { type: 'string', const: 'STAFF_ASSISTED' }, version })),
  },
  logisticsDonationsRevokeCapability: { noBody: true, response: response(object({ id, capability_revoked: boolean(), version })) },
  logisticsDonationsClaim: { noBody: true, response: response(object({ id, public_code: text, status: text, donor_user_id: id, version }, ['id', 'public_code', 'status', 'donor_user_id', 'version'])) },
  logisticsDistributionsPrepareFromCommitments: {
    request: request(object({ expected_version: version }, ['expected_version'])),
  },
  logisticsDonationReceiptsCreate: { request: request(object({ delivery_id: id, warehouse_id: id }, ['delivery_id', 'warehouse_id'])) },
  logisticsDonationReceiptsCount: { request: request(object({ expected_version: version, lines: item({ item_id: id, counted_quantity: quantity, accepted_quantity: quantity, held_quantity: quantity, rejected_quantity: quantity, condition_note: text, expiry_date: { type: 'string', format: 'date' } }, ['item_id', 'counted_quantity', 'accepted_quantity', 'held_quantity', 'rejected_quantity']), note: text }, ['expected_version', 'lines'])) },
  logisticsDonationReceiptsReview: { request: request(object({ expected_version: version, count_revision: integer(), declaration_revision: integer(), decision: { type: 'string', enum: ['APPROVE', 'REJECT', 'REQUEST_RECOUNT'] }, reason: text }, ['expected_version', 'count_revision', 'declaration_revision', 'decision'])) },
  logisticsDonationReceiptsPost: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDonationReceiptsReleaseHeld: { request: request(object({ expected_version: version, count_revision: integer(), declaration_revision: integer(), reason: text }, ['expected_version', 'count_revision', 'declaration_revision', 'reason'])) },
  logisticsDonationReceiptsResolveDispute: {
    request: request(object({ resolution_note: text }, ['resolution_note'])),
    response: response(object({ id, status: text, delivery_id: id, resolution_note: text, opened_at: dateTime, resolved_at: dateTime })),
  },
  logisticsNeedsCreate: {
    request: request(object({ request_id: id, work_cycle: integer(), item_id: id, quantity, delivery_target_kind: { type: 'string', enum: ['FINAL_RECIPIENT'] }, designated_point_id: id, reason: text }, ['request_id', 'work_cycle', 'item_id', 'quantity'])),
    response: response(object({
      id,
      cycle_id: id,
      request_id: id,
      work_cycle: integer(),
      organization_id: id,
      region_code: text,
      campaign_id: { anyOf: [id, { type: 'null' }] },
      item_id: id,
      item: object({
        id,
        name: text,
        unit: object({ code: text, display_name: text, scale: integer() }, ['code', 'display_name', 'scale']),
      }, ['id', 'name', 'unit']),
      original_quantity: quantity,
      requested_quantity: quantity,
      cancelled_remaining: { anyOf: [quantity, { type: 'null' }] },
      delivery_target_kind: { type: 'string', enum: ['FINAL_RECIPIENT', 'RELIEF_POINT'] },
      designated_point_id: { anyOf: [id, { type: 'null' }] },
      status: { type: 'string', enum: ['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED'] },
      version,
      created_at: dateTime,
    }, ['id', 'cycle_id', 'request_id', 'work_cycle', 'organization_id', 'region_code', 'campaign_id', 'item_id', 'item', 'original_quantity', 'requested_quantity', 'cancelled_remaining', 'delivery_target_kind', 'designated_point_id', 'status', 'version', 'created_at']), 'Created need projection returned by the needs query mapper.'),
  },
  logisticsNeedsIncrease: { request: request(object({ expected_version: version, quantity, reason: text }, ['expected_version', 'quantity', 'reason'])) },
  logisticsNeedsReduce: { request: request(object({ expected_version: version, quantity, reason: text }, ['expected_version', 'quantity', 'reason'])) },
  logisticsNeedsCancel: { request: request(object({ expected_version: version, reason: text }, ['expected_version', 'reason'])) },
  logisticsNeedsCreateCommitment: { request: request(object({ warehouse_id: id, quantity }, ['warehouse_id', 'quantity'])) },
  logisticsNeedsReleaseCommitment: { request: request(object({ expected_version: version, quantity, reason: text }, ['expected_version', 'quantity', 'reason'])) },
  logisticsFulfillmentCyclesFreeze: { request: request(object({ intent_id: id }, ['intent_id'])) },
  logisticsFulfillmentCyclesUnseal: { request: request(object({ intent_id: id }, ['intent_id'])) },
  logisticsFulfillmentCyclesSeal: { request: request(object({ intent_id: id, outcome_basis: { type: 'string', enum: ['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED'] } }, ['intent_id', 'outcome_basis'])) },
  logisticsDistributionsCreate: { request: request(object({ warehouse_id: id, relief_point_id: id, vehicle_id: id, campaign_id: id, purpose: { type: 'string', enum: ['REQUEST_AID', 'CAMPAIGN_DISTRIBUTION', 'POINT_REPLENISHMENT'] }, lines: item({ item_id: id, quantity, commitment_id: id }, ['item_id', 'quantity']) }, ['warehouse_id', 'purpose', 'lines'])) },
  logisticsDistributionsReplaceLines: { request: request(object({ expected_version: version, lines: item({ item_id: id, quantity, commitment_id: id }, ['item_id', 'quantity']) }, ['expected_version', 'lines'])) },
  logisticsDistributionsApprove: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDistributionsDispatch: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDistributionsCancel: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDistributionsReconcile: { request: request(object({ expected_version: version }, ['expected_version'])) },
  logisticsDistributionsCreateHandoff: { request: request(object({ handoff_kind: { type: 'string', enum: ['DIRECT_HOUSEHOLD', 'POINT_RECEIPT', 'HOUSEHOLD_HANDOUT', 'RETURN', 'LOSS'] }, source_stage: { type: 'string', enum: ['IN_TRANSIT', 'AT_POINT'] }, receiver_user_id: id, receiver_label: text, confirmation_basis: text, occurred_at: dateTime, lines: item({ distribution_line_id: id, quantity }, ['distribution_line_id', 'quantity']) }, ['handoff_kind', 'confirmation_basis', 'occurred_at', 'lines'])) },
  logisticsDistributionsReviewLoss: { request: request(object({ expected_version: version, decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, reason: text }, ['expected_version', 'decision', 'reason'])) },
};

const nullableValue = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const catalogCodeSchema = object({ code: text, display_name: text });
const catalogUnitSchema = object({ code: text, display_name: text, scale: integer() });
const catalogItemSchema = object({
  id,
  item_type: catalogCodeSchema,
  unit: catalogUnitSchema,
  name: text,
  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
  version,
  created_at: dateTime,
});
const distributionLineSchema = object({
  id, item_id: id, item_name: text, unit: object({ code: text, scale: integer() }),
  commitment_id: nullableValue(id), delivery_target_kind: nullableValue(text),
  quantity, dispatched: quantity, received: quantity, handed_out: quantity, returned: quantity, lost: quantity,
  pending_loss_count: integer(), in_transit: quantity, at_point: quantity,
});
const distributionViewSchema = object({
  id, warehouse_id: id, organization_id: id,
  relief_point_id: nullableValue(id), vehicle_id: nullableValue(id), campaign_id: nullableValue(id),
  purpose: text, status: text, preparer_user_id: id, approver_user_id: nullableValue(id),
  approved_version: nullableValue(integer()), dispatch_actor_user_id: nullableValue(id),
  dispatched_at: nullableValue(dateTime), reconciled_at: nullableValue(dateTime), created_at: dateTime,
  version, vehicle_capacity_exceeded: boolean(), lines: array(distributionLineSchema),
});
const handoffViewSchema = object({
  id, distribution_id: id, handoff_kind: text, source_stage: nullableValue(text),
  receiver_user_id: nullableValue(id), receiver_label: nullableValue(text), recorder_user_id: id,
  confirmation_basis: text, occurred_at: dateTime, created_at: dateTime, version, status: text,
  review: nullableValue(object({ decision: text, reviewer_user_id: id, reason: nullableValue(text) })),
  lines: item({ id, distribution_line_id: id, commitment_id: nullableValue(id), quantity, unit_code: text }),
});
const commitmentValueSchema = object({
  id, relief_need_id: id, item_id: id, warehouse_id: id, quantity, released_quantity: quantity,
  issued_quantity: quantity, delivered_quantity: quantity, returned_quantity: quantity, lost_quantity: quantity,
  reserved_remaining: quantity, version,
});
const needItemSchema = object({ id, name: text, unit: catalogUnitSchema });
const needValueSchema = object({
  id, cycle_id: id, request_id: id, work_cycle: integer(), organization_id: id, region_code: text,
  campaign_id: nullableValue(id), item_id: id, item: needItemSchema, original_quantity: quantity,
  requested_quantity: quantity, cancelled_remaining: nullableValue(quantity),
  delivery_target_kind: { type: 'string', enum: ['FINAL_RECIPIENT', 'RELIEF_POINT'] },
  designated_point_id: nullableValue(id), status: text, version, created_at: dateTime,
});
const needSummarySchema = object({
  id, item: object({ id, name: text }), unit: catalogUnitSchema, original: quantity, requested: quantity,
  committed_reserved: quantity, issued_unsettled: quantity, delivered: quantity, returned: quantity, lost: quantity,
  outstanding: quantity, cancelled_remaining: quantity, status: text,
});
const contributionSchema = object({
  id, warehouse_id: id, warehouse_name: text, quantity, reserved_remaining: quantity, issued_unsettled: quantity,
  delivered: quantity, returned: quantity, lost: quantity, created_by_user_id: id, created_at: dateTime,
});
const driveItemSchema = object({
  item_id: id, item_name: text, item_type_name: text, unit_code: text, unit_name: text, scale: integer(),
  target_quantity: quantity, acceptance_note: nullableValue(text), accepted_total: quantity,
});
const driveCommandItemSchema = object({
  item_id: id, item_name: text, target_quantity: quantity, acceptance_note: nullableValue(text),
  item_type_name: text, unit_code: text, unit_name: text, scale: integer(),
});
const publicDriveViewSchema = object({
  id, title: text, description: nullableValue(text), status: text,
  campaign_status: nullableValue(text), campaign_status_at: nullableValue(dateTime),
  opens_at: nullableValue(dateTime), closes_at: nullableValue(dateTime),
  intake_location: object({ warehouse_name: text, address_note: nullableValue(text), location: nullableValue(point) }),
  items: array(driveItemSchema), created_at: dateTime,
});
const driveValueSchema = object({
  id, organization_id: id, intake_warehouse_id: id, campaign_id: nullableValue(id),
  campaign_status: nullableValue(text), campaign_status_at: nullableValue(dateTime), status: text,
  title: text, description: nullableValue(text), opens_at: nullableValue(dateTime), closes_at: nullableValue(dateTime),
  version, created_at: dateTime, items: array(driveCommandItemSchema),
});
const assetCommonProperties = {
  id, organization_id: id, region_code: text,
  status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }, version, created_at: dateTime,
};
const warehouseCommandSchema = object({
  ...assetCommonProperties, name: text, location: nullableValue(point), location_public: boolean(), address_note: nullableValue(text),
});
const reliefPointCommandSchema = object({
  ...assetCommonProperties, name: text, location: point, contact_note: nullableValue(text), operating_note: nullableValue(text),
});
const vehicleCommandSchema = object({
  ...assetCommonProperties, identifier: text, vehicle_type: text, capacity: nullableValue(quantity), capacity_unit: nullableValue(text),
});
const receiptLineSchema = object({
  item_id: id, item_name: text, unit_code: text, unit_name: text, declared_quantity: nullableValue(quantity),
  counted_quantity: quantity, accepted_quantity: quantity, held_quantity: quantity, rejected_quantity: quantity,
  condition_note: nullableValue(text), expiry_date: { type: 'string', format: 'date' }, flags: array(text),
});
const receiptViewSchema = object({
  id, delivery_id: id, warehouse_id: id, version, created_at: dateTime, public_code: text,
  donor_name: text, donor_phone: text, delivery_status: text, drive_id: id, drive_title: text, warehouse_name: text,
  delivery: object({ id, drive_id: id, drive_title: text, public_code: text, donor_name: text, donor_phone: text, status: text }),
  count: nullableValue(object({ revision: integer(), declaration_revision: integer(), note: nullableValue(text), lines: array(receiptLineSchema) })),
  review: nullableValue(object({ decision: text, reason: nullableValue(text), reviewed_at: dateTime })),
});

const sharedLogisticsResponses = {
  logisticsCatalogItemTypes: object({ items: array(catalogCodeSchema), next_cursor: nullableValue(text) }),
  logisticsCatalogUnits: object({ items: array(catalogUnitSchema), next_cursor: nullableValue(text) }),
  logisticsCatalogItems: object({ items: array(catalogItemSchema), next_cursor: nullableValue(text) }),
  logisticsCatalogCreateItemType: catalogCodeSchema,
  logisticsCatalogCreateUnit: catalogUnitSchema,
  logisticsCatalogCreateItem: catalogItemSchema,
  logisticsCatalogDeactivateItem: catalogItemSchema,
  logisticsDrivesList: object({
    items: item({ ...driveValueSchema.properties, cursor_created_at: text, items: array(object({ drive_id: id, ...driveCommandItemSchema.properties, accepted_total: quantity })) }),
    more: boolean(), cursor: text,
  }),
  logisticsDrivesPublicList: object({ items: array(publicDriveViewSchema), more: boolean(), cursor: text, generated_at: dateTime }),
  logisticsDrivesPublicDetail: object({ ...publicDriveViewSchema.properties, generated_at: dateTime }),
  logisticsDrivesCreate: driveValueSchema,
  logisticsDrivesPatch: driveValueSchema,
  logisticsDrivesOpen: driveValueSchema,
  logisticsDrivesPause: driveValueSchema,
  logisticsDrivesResume: driveValueSchema,
  logisticsDrivesClose: driveValueSchema,
  logisticsAssetsReliefPointDetail: object({
    id,
    organization_id: id,
    region_code: text,
    status: text,
    version,
    created_at: dateTime,
    name: text,
    location: object({ type: { type: 'string', const: 'Point' }, coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, ['type', 'coordinates']),
    contact_note: { anyOf: [text, { type: 'null' }] },
    operating_note: { anyOf: [text, { type: 'null' }] },
  }),
  logisticsAssetsWarehouses: page({
    id,
    organization_id: id,
    region_code: text,
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    version,
    created_at: dateTime,
    name: text,
    location: { anyOf: [point, { type: 'null' }] },
    location_public: boolean(),
  }),
  logisticsAssetsReliefPoints: page({
    id,
    organization_id: id,
    region_code: text,
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    version,
    created_at: dateTime,
    name: text,
    location: point,
  }),
  logisticsAssetsVehicles: page({
    id,
    organization_id: id,
    region_code: text,
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    version,
    created_at: dateTime,
    identifier: text,
    vehicle_type: text,
    capacity: { anyOf: [text, { type: 'null' }] },
    capacity_unit: { anyOf: [text, { type: 'null' }] },
  }),
  logisticsAssetsCreateWarehouse: warehouseCommandSchema,
  logisticsAssetsPatchWarehouse: warehouseCommandSchema,
  logisticsAssetsDeactivateWarehouse: warehouseCommandSchema,
  logisticsAssetsCreateReliefPoint: reliefPointCommandSchema,
  logisticsAssetsPatchReliefPoint: reliefPointCommandSchema,
  logisticsAssetsDeactivateReliefPoint: reliefPointCommandSchema,
  logisticsAssetsCreateVehicle: vehicleCommandSchema,
  logisticsAssetsPatchVehicle: vehicleCommandSchema,
  logisticsAssetsDeactivateVehicle: vehicleCommandSchema,
  logisticsDonationsTrack: object({
    id,
    public_code: text,
    status: text,
    declaration: object({
      revision: nullableValue(integer()),
      created_by_kind: nullableValue(text),
      lines: item({ item_id: id, item_name: text, unit_name: text, declared_quantity: quantity }),
    }),
    receipt: nullableValue(object({
      count_revision: integer(),
      lines: item({
        item_id: id, declared_quantity: nullableValue(quantity), counted_quantity: quantity, accepted_quantity: quantity,
        held_quantity: quantity, rejected_quantity: quantity, condition_note: nullableValue(text),
      }),
    })),
    disputes: item({ id, status: text, reason: text, opened_at: dateTime, resolution_note: nullableValue(text) }),
    progress: object({ status: text }),
  }),
  logisticsDonationsReviseDeclaration: object({ id, status: text, declaration_revision: integer(), version }),
  logisticsDonationsOpenDispute: object({ id, status: text, reason: text, opened_at: dateTime }),
  logisticsDonationReceiptsDeliveries: page({
    id, drive_id: id, drive_title: text, public_code: text, donor_name: text, donor_phone: text,
    status: text, version, receipt_id: nullableValue(id), created_at: dateTime,
  }),
  logisticsDonationReceiptsReceipt: object({ ...receiptViewSchema.properties, generated_at: dateTime }),
  logisticsDonationReceiptsDisputes: page({
    id, delivery_id: id, status: text, opened_by_kind: text, reason: text, resolution_note: nullableValue(text),
    opened_at: dateTime, resolved_at: nullableValue(dateTime), public_code: text, drive_id: id, drive_title: text, donor_phone: text,
  }),
  logisticsDonationReceiptsCreate: receiptViewSchema,
  logisticsDonationReceiptsCount: receiptViewSchema,
  logisticsDonationReceiptsPost: receiptViewSchema,
  logisticsDonationReceiptsReleaseHeld: receiptViewSchema,
  logisticsDonationReceiptsReview: receiptViewSchema,
  logisticsNeedsList: page({
    ...needSummarySchema.properties, cycle_id: id, request_id: id, work_cycle: integer(), version, created_at: dateTime,
  }),
  logisticsNeedsFulfillment: object({
    needs: array(object({ ...needSummarySchema.properties, contributions: object({ items: array(contributionSchema), more: boolean() }) })),
    cycle_state: text, generated_at: dateTime,
  }),
  logisticsNeedsContributions: page({ id, warehouse_id: id, warehouse_name: text, quantity, reserved_remaining: quantity, issued_unsettled: quantity, delivered: quantity, returned: quantity, lost: quantity, created_by_user_id: id, created_at: dateTime }),
  logisticsNeedsInternalFulfillment: object({ needs: array(needSummarySchema), cycle_state: text, generated_at: dateTime }),
  logisticsNeedsIncrease: needValueSchema,
  logisticsNeedsReduce: needValueSchema,
  logisticsNeedsCancel: needValueSchema,
  logisticsNeedsCreateCommitment: commitmentValueSchema,
  logisticsNeedsReleaseCommitment: commitmentValueSchema,
  logisticsFulfillmentCyclesFreeze: object({ intent_id: id, request_id: id, work_cycle: integer(), cycle_state: text }),
  logisticsFulfillmentCyclesSeal: object({ intent_id: id, request_id: id, work_cycle: integer(), cycle_state: text }),
  logisticsFulfillmentCyclesUnseal: object({ intent_id: id, request_id: id, work_cycle: integer(), cycle_state: text }),
  logisticsDistributionsList: page({ ...distributionViewSchema.properties }),
  logisticsDistributionsDetail: distributionViewSchema,
  logisticsDistributionsCreate: distributionViewSchema,
  logisticsDistributionsApprove: distributionViewSchema,
  logisticsDistributionsCancel: distributionViewSchema,
  logisticsDistributionsDispatch: distributionViewSchema,
  logisticsDistributionsReplaceLines: distributionViewSchema,
  logisticsDistributionsPrepareFromCommitments: distributionViewSchema,
  logisticsDistributionsReconcile: distributionViewSchema,
  logisticsDistributionsCreateHandoff: handoffViewSchema,
  logisticsDistributionsReviewLoss: handoffViewSchema,
  logisticsStockBalances: page({
    balance_id: id, warehouse_id: id, item_id: id, item_name: text, item_type: text, unit_code: text,
    unit: text, scale: integer(), on_hand: quantity, reserved: quantity, available: quantity,
  }),
  logisticsStockMovements: object({
    balance_id: id,
    items: item({ id, movement_type: text, delta_on_hand: quantity, delta_reserved: quantity, created_at: dateTime }),
    more: boolean(),
    cursor: text,
  }),
  logisticsStockAdjustments: page({
    id, balance_id: id, warehouse_id: id, item_id: id, item_name: text, unit_code: text,
    delta_on_hand: quantity, status: text, requested_at: dateTime, reviewed_at: nullableValue(dateTime),
  }),
  logisticsStockCreateAdjustment: object({ id, balance_id: id, delta_on_hand: quantity, reason: text, status: text, review_note: nullableValue(text), requested_at: dateTime, reviewed_at: nullableValue(dateTime) }),
  logisticsStockReviewAdjustment: object({ id, balance_id: id, delta_on_hand: quantity, reason: text, status: text, review_note: nullableValue(text), requested_at: dateTime, reviewed_at: nullableValue(dateTime) }),
  logisticsStockOpening: object({ warehouse_id: id, items: item({ balance_id: id, item_id: id, on_hand: quantity, reserved: quantity, available: quantity }) }),
  logisticsReportsStockSummary: page({ warehouse_id: id, item: object({ id, name: text }), unit: object({ code: text, display_name: text, scale: integer() }), on_hand: quantity, reserved: quantity, available: quantity, held: quantity, in_transit: quantity }),
  logisticsReportsFulfillmentSummary: page({
    id, request_id: id, cycle_id: id, work_cycle: integer(), region_code: nullableValue(text), campaign_id: nullableValue(id),
    item: object({ id, name: text }), unit: catalogUnitSchema, original: quantity, reduced: quantity,
    cancelled_remaining: quantity, active_requested: quantity, delivered: quantity, active_outstanding: quantity, status: text,
  }),
  logisticsReportsReconciliationSummary: page({
    item: object({ id, name: text }), unit: catalogUnitSchema, intake_accepted: quantity, posted_movements: quantity,
    posted_reserved_movements: quantity, reserved: quantity, issued_in_transit: quantity, at_point: quantity,
    delivered: quantity, returned: quantity, lost: quantity,
    flags: object({ balance_mismatch: boolean(), commitment_counter_mismatch: boolean() }),
  }),
  logisticsReportsPublicDonationSummary: object({ view: text, filter_id: text, items: array({ oneOf: [object({ item: object({ id, name: text }), unit: object({ code: text, display_name: text, scale: integer() }), accepted: quantity }), object({ item: object({ id, name: text }), unit: object({ code: text, display_name: text, scale: integer() }), distributed: quantity })] }), more: boolean(), cursor: text, generated_at: dateTime }),
};

const logisticsQueries = {
  logisticsCatalogItemTypes: ['cursor', 'limit'], logisticsCatalogUnits: ['cursor', 'limit'],
  logisticsCatalogItems: ['type', 'status', 'query', 'cursor', 'limit'], logisticsAssetsWarehouses: ['status', 'cursor', 'limit'],
  logisticsAssetsVehicles: ['status', 'cursor', 'limit'], logisticsAssetsReliefPoints: ['status', 'cursor', 'limit'],
  logisticsDrivesList: ['status', 'cursor', 'limit'], logisticsDrivesPublicList: ['cursor', 'limit'],
  logisticsDonationReceiptsDeliveries: ['drive_id', 'status', 'cursor', 'limit'], logisticsDonationReceiptsDisputes: ['status', 'cursor', 'limit'],
  logisticsNeedsList: ['request_id', 'work_cycle', 'cursor', 'limit'], logisticsNeedsContributions: ['cursor', 'limit'],
  logisticsNeedsFulfillment: ['work_cycle'], logisticsNeedsInternalFulfillment: ['work_cycle'], logisticsRequestsFulfillment: ['work_cycle'],
  logisticsDistributionsList: ['status', 'cursor', 'limit'], logisticsStockBalances: ['warehouse_id', 'item_id', 'cursor', 'limit'],
  logisticsStockMovements: ['cursor', 'limit'], logisticsStockAdjustments: ['status', 'cursor', 'limit'],
  logisticsReportsStockSummary: ['warehouse_id', 'cursor', 'limit'], logisticsReportsFulfillmentSummary: ['campaign_id', 'region_code', 'from', 'to', 'cursor', 'limit'],
  logisticsReportsReconciliationSummary: ['warehouse_id', 'item_id', 'cursor', 'limit'],
  logisticsReportsPublicDonationSummary: ['drive_id', 'campaign_id', 'warehouse_id', 'cursor', 'limit'],
};

const logisticsRequiredQueries = {
  logisticsReportsReconciliationSummary: ['warehouse_id'],
  logisticsReportsFulfillmentSummary: ['from', 'to'],
};

const logisticsQueryConstraints = {
  logisticsReportsFulfillmentSummary: 'At least one of campaign_id or region_code is required; from is inclusive and to is exclusive.',
  logisticsReportsPublicDonationSummary: 'Exactly one of drive_id, campaign_id, or warehouse_id is required.',
};

const errorCatalogPath = fileURLToPath(new URL('../../../docs/backend/07-error-catalog.md', import.meta.url));
const errorCatalog = new Map([...fs.readFileSync(errorCatalogPath, 'utf8').matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|\s*[^|]+\|\s*([^|]+?)\s*\|\s*$/gmu)]
  .map(([, code, status, message]) => [code, { status, message }]));

const routeErrorCodes = {
  identityInternalTeamLeaderEligibility: ['FORBIDDEN'],
  registerCitizen: ['USERNAME_TAKEN', 'PASSWORD_WEAK', 'RATE_LIMITED', 'CSRF_INVALID'],
  login: ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'CSRF_INVALID'],
  refreshSession: ['SESSION_EXPIRED', 'REFRESH_REUSED', 'REFRESH_RACE', 'CSRF_INVALID'],
  changePassword: ['INVALID_CREDENTIALS', 'PASSWORD_WEAK', 'CSRF_INVALID'],
  createIdentityUser: ['USERNAME_TAKEN', 'PASSWORD_WEAK'],
  disableIdentityUser: ['LAST_ADMIN'],
  enableIdentityUser: ['LAST_ADMIN'],
  resetIdentityPassword: ['LAST_ADMIN', 'PASSWORD_WEAK'],
  createIdentityUserGrant: ['GRANT_EXISTS', 'SCOPE_INVALID', 'RESPONSE_UNAVAILABLE'],
  revokeIdentityGrant: ['LAST_ADMIN'],
  createIdentityOrganization: ['ORGANIZATION_NAME_TAKEN'],
  deactivateIdentityOrganization: ['ORGANIZATION_IN_USE'],
  createIdentityRegion: ['SCOPE_INVALID'],
  createSelfRequest: ['VALIDATION_FAILED', 'TRACKING_SECRET_INVALID', 'TRACKING_SECRET_IN_USE', 'IDEMPOTENCY_KEY_REUSED', 'SOS_RATE_CEILING'],
  createProxyRequest: ['VALIDATION_FAILED', 'IDENTITY_UNAVAILABLE', 'SESSION_EXPIRED'],
  trackSelfRequest: ['NOT_FOUND', 'RATE_LIMITED'],
  listReporterEvents: ['NOT_FOUND'],
  supplementSelfRequest: ['STATE_TRANSITION_INVALID', 'VERSION_CONFLICT'],
  claimSelfRequest: ['ALREADY_CLAIMED', 'SESSION_EXPIRED'],
  issueRequestRecoveryCode: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  redeemRequestRecoveryCode: ['NOT_FOUND', 'SESSION_EXPIRED'],
  uploadRequestEvidence: ['EVIDENCE_LIMIT_REACHED', 'PAYLOAD_TOO_LARGE', 'LENGTH_REQUIRED', 'UNSUPPORTED_MEDIA', 'STORAGE_UNAVAILABLE'],
  uploadMissionEvidence: ['EVIDENCE_LIMIT_REACHED', 'PAYLOAD_TOO_LARGE', 'LENGTH_REQUIRED', 'UNSUPPORTED_MEDIA', 'STORAGE_UNAVAILABLE'],
  acceptMission: ['TEAM_BUSY', 'TEAM_NOT_ELIGIBLE', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT'],
  verifyRequest: ['VERIFICATION_BASIS_REQUIRED', 'SECOND_COORDINATOR_REQUIRED', 'NO_CONTACT_ATTEMPT', 'PENDING_SUPPLEMENT_REVIEW'],
  rejectRequest: ['REJECT_THRESHOLD_NOT_MET'],
  markRequestDuplicate: ['CANONICAL_INVALID', 'CANONICAL_HAS_DUPLICATES'],
  createMissionOffer: ['TEAM_BUSY', 'TEAM_NOT_ELIGIBLE', 'OVERRIDE_REASON_REQUIRED', 'REGION_REQUIRED', 'CAMPAIGN_PAUSED', 'TEAM_HAS_ACTIVE_MISSION', 'CAMPAIGN_NOT_ACTIVE'],
  recordMissionOnBehalf: ['RECORDED_BASIS_REQUIRED', 'MISSION_NOT_LEADER', 'STATE_TRANSITION_INVALID'],
  createCampaign: ['FORBIDDEN', 'VERSION_CONFLICT'],
  closeCampaign: ['CAMPAIGN_HAS_OPEN_REQUESTS', 'VERSION_CONFLICT'],
  getRequestHeatmap: ['TOO_MANY_CELLS', 'VALIDATION_FAILED'],
  responseRequestAdmissionAdmit: ['ATTRIBUTION_LOCKED', 'REGION_REQUIRED', 'PENDING_SUPPLEMENT_REVIEW', 'REQUEST_NOT_VERIFIED'],
  responseMissionsReviewFailure: ['REASON_REQUIRED', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  responseRequestResolutionResolve: ['RESOLUTION_BLOCKED', 'RESOLUTION_BASIS_INVALID', 'PENDING_SUPPLEMENT_REVIEW', 'LOGISTICS_UNAVAILABLE'],
  responseRequestResolutionClose: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  responseRequestResolutionReopen: ['CAMPAIGN_NOT_ACTIVE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsCatalogCreateItem: ['ITEM_NAME_TAKEN'],
  logisticsAssetsCreateVehicle: ['VEHICLE_IDENTIFIER_TAKEN'],
  logisticsNeedsCreate: ['QUANTITY_SCALE_INVALID', 'CYCLE_FROZEN', 'CYCLE_SEALED', 'VALIDATION_FAILED', 'NEED_EXISTS', 'POINT_INACTIVE'],
  logisticsNeedsIncrease: ['QUANTITY_SCALE_INVALID', 'CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT'],
  logisticsNeedsReduce: ['QUANTITY_SCALE_INVALID', 'CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID', 'BELOW_PROTECTED_QUANTITY', 'VERSION_CONFLICT'],
  logisticsNeedsCancel: ['CYCLE_SEALED', 'STATE_TRANSITION_INVALID', 'UNSETTLED_ISSUED_GOODS', 'VERSION_CONFLICT'],
  logisticsNeedsCreateCommitment: ['QUANTITY_SCALE_INVALID', 'CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID', 'INSUFFICIENT_STOCK', 'NEED_OVER_COMMITTED', 'CAMPAIGN_PAUSED'],
  logisticsNeedsReleaseCommitment: ['QUANTITY_SCALE_INVALID', 'CYCLE_SEALED', 'VERSION_CONFLICT'],
  logisticsFulfillmentCyclesFreeze: ['CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID'],
  logisticsFulfillmentCyclesSeal: ['CYCLE_NOT_SETTLED', 'UNSETTLED_ISSUED_GOODS', 'CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID'],
  logisticsFulfillmentCyclesUnseal: ['CYCLE_SEALED', 'STATE_TRANSITION_INVALID'],
  logisticsDrivesCreate: ['QUANTITY_SCALE_INVALID', 'CAMPAIGN_NOT_ACTIVE', 'RESPONSE_UNAVAILABLE'],
  logisticsDrivesPatch: ['QUANTITY_SCALE_INVALID', 'CAMPAIGN_NOT_ACTIVE', 'VALIDATION_FAILED', 'RESPONSE_UNAVAILABLE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDrivesOpen: ['CAMPAIGN_NOT_ACTIVE', 'RESPONSE_UNAVAILABLE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDrivesPause: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDrivesResume: ['CAMPAIGN_NOT_ACTIVE', 'RESPONSE_UNAVAILABLE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDrivesClose: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDonationsCreateDelivery: ['QUANTITY_SCALE_INVALID', 'DRIVE_NOT_OPEN', 'DRIVE_WINDOW_CLOSED', 'ITEM_NOT_ON_DRIVE', 'DONATION_SECRET_INVALID', 'DONATION_SECRET_IN_USE', 'RATE_LIMITED'],
  logisticsDonationsTrack: ['DONATION_SECRET_INVALID'],
  logisticsDonationsReviseDeclaration: ['QUANTITY_SCALE_INVALID', 'DONATION_SECRET_INVALID', 'DECLARATION_LOCKED', 'STALE_REVISION', 'VERSION_CONFLICT'],
  logisticsDonationsAssistedDeclaration: ['QUANTITY_SCALE_INVALID', 'VERSION_CONFLICT'],
  logisticsDonationsClaim: ['ALREADY_CLAIMED', 'DONATION_SECRET_INVALID'],
  logisticsDonationsOpenDispute: ['DONATION_SECRET_INVALID'],
  logisticsDonationReceiptsCreate: ['STATE_TRANSITION_INVALID'],
  logisticsDonationReceiptsCount: ['QUANTITY_SCALE_INVALID', 'COUNT_SPLIT_MISMATCH', 'STALE_REVISION', 'VERSION_CONFLICT'],
  logisticsDonationReceiptsReview: ['SELF_REVIEW_FORBIDDEN', 'STALE_REVISION', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDonationReceiptsPost: ['RECEIPT_NOT_APPROVED', 'ALREADY_POSTED', 'VERSION_CONFLICT'],
  logisticsDonationReceiptsReleaseHeld: ['STALE_REVISION', 'RECEIPT_NOT_APPROVED', 'VERSION_CONFLICT'],
  logisticsCatalogDeactivateItem: ['VERSION_CONFLICT'],
  logisticsStockReviewAdjustment: ['ADJUSTMENT_VIOLATES_RESERVED', 'STATE_TRANSITION_INVALID'],
  logisticsAssetsCreateReliefPoint: ['POINT_INACTIVE'],
  logisticsAssetsPatchReliefPoint: ['VERSION_CONFLICT'],
  logisticsAssetsDeactivateReliefPoint: ['VERSION_CONFLICT'],
  logisticsAssetsPatchVehicle: ['VERSION_CONFLICT'],
  logisticsAssetsDeactivateVehicle: ['VERSION_CONFLICT'],
  logisticsAssetsPatchWarehouse: ['VERSION_CONFLICT'],
  logisticsAssetsDeactivateWarehouse: ['VERSION_CONFLICT'],
  logisticsDistributionsCreate: ['QUANTITY_SCALE_INVALID', 'POINT_INACTIVE', 'VEHICLE_INACTIVE', 'LINE_ITEM_MISMATCH', 'VALIDATION_FAILED', 'RESPONSE_UNAVAILABLE', 'CAMPAIGN_PAUSED', 'CAMPAIGN_NOT_ACTIVE'],
  logisticsDistributionsReplaceLines: ['QUANTITY_SCALE_INVALID', 'VERSION_CONFLICT', 'ALREADY_DISPATCHED', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsApprove: ['SELF_APPROVAL_FORBIDDEN', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsDispatch: ['APPROVAL_STALE', 'INSUFFICIENT_STOCK', 'POINT_INACTIVE', 'VEHICLE_INACTIVE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsCancel: ['ALREADY_DISPATCHED', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsCreateHandoff: ['QUANTITY_SCALE_INVALID', 'HANDOFF_EXCEEDS_BALANCE', 'HANDOFF_KIND_INVALID', 'SETTLEMENT_EXCEEDS_ISSUED', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsReviewLoss: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'HANDOFF_KIND_INVALID'],
  logisticsDistributionsReconcile: ['LOSS_REVIEW_REQUIRED', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsPrepareFromCommitments: ['TOO_MANY_LINES', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'ALREADY_DISPATCHED'],
  logisticsReportsPublicDonationSummary: ['VALIDATION_FAILED'],
  logisticsDrivesPublicDetail: ['NOT_FOUND'],
  logisticsStockCreateAdjustment: ['QUANTITY_SCALE_INVALID'],
  logisticsStockOpening: ['QUANTITY_SCALE_INVALID'],
};

const serviceSecuritySchemes = {
  identity: {
    WebAccessCookie: { type: 'apiKey', in: 'cookie', name: 'c48_access' },
    WebRefreshCookie: { type: 'apiKey', in: 'cookie', name: 'c48_refresh' },
    WebPreSessionCookie: { type: 'apiKey', in: 'cookie', name: 'c48_pre' },
    NativeBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    IdentityServiceBearer: { type: 'http', scheme: 'bearer', bearerFormat: '5-minute RS256 service JWT' },
    CsrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
  },
  response: {
    WebAccessCookie: { type: 'apiKey', in: 'cookie', name: 'c48_access' },
    NativeBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    ServiceToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    CsrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    TrackingSecret: { type: 'apiKey', in: 'header', name: 'X-Tracking-Secret' },
    TrackingCode: { type: 'apiKey', in: 'header', name: 'X-Tracking-Code' },
    RecoveryCode: { type: 'apiKey', in: 'header', name: 'X-Recovery-Code' },
    ActorAuthorization: { type: 'apiKey', in: 'header', name: 'X-Actor-Authorization', description: 'Bearer token issued by Identity for the acting user.' },
  },
  logistics: {
    WebAccessCookie: { type: 'apiKey', in: 'cookie', name: 'c48_access' },
    NativeBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    ServiceToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    CsrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
    DonationSecret: { type: 'apiKey', in: 'header', name: 'X-Donation-Secret' },
  },
};

function sessionSecurity(service, write) {
  const bearer = service === 'identity' ? 'NativeBearer' : service === 'logistics' ? 'NativeBearer' : 'NativeBearer';
  const cookie = { WebAccessCookie: [] };
  if (write) cookie.CsrfToken = [];
  return [{ [bearer]: [] }, cookie];
}

function capabilitySecurity(capability, session = true, write = false) {
  const requirements = [{ [capability]: [] }];
  if (session) requirements.push(...sessionSecurity('response', write));
  return requirements;
}

function routeSecurity(service, routePath, method, operationId) {
  const write = method !== 'get';
  if (service === 'identity') {
    if (routePath === '/auth/csrf') return [];
    if (['/auth/register', '/auth/login'].includes(routePath)) {
      return [{ WebPreSessionCookie: [], CsrfToken: [] }, {}];
    }
    if (routePath === '/auth/refresh') {
      return [{ WebRefreshCookie: [], WebPreSessionCookie: [], CsrfToken: [] }, {}];
    }
    if (routePath.startsWith('/internal/')) return [{ IdentityServiceBearer: [] }];
    return sessionSecurity(service, write);
  }
  if (service === 'response') {
    if (routePath === '/public/campaigns') return [];
    if (operationId === 'createSelfRequest') return [
      { TrackingSecret: [] }, ...sessionSecurity(service, true),
    ];
    if (operationId === 'trackSelfRequest') return [
      { TrackingSecret: [], TrackingCode: [] },
      ...sessionSecurity(service, false).map((requirement) => ({ ...requirement, TrackingCode: [] })),
    ];
    if (operationId === 'listReporterEvents' || operationId === 'supplementSelfRequest' || operationId === 'uploadRequestEvidence') {
      return [
        { TrackingSecret: [], TrackingCode: [] },
        ...sessionSecurity(service, write).map((requirement) => ({ ...requirement, TrackingCode: [] })),
      ];
    }
    if (operationId === 'claimSelfRequest') return sessionSecurity(service, true).map((requirement) => ({ ...requirement, TrackingSecret: [] }));
    if (operationId === 'redeemRequestRecoveryCode') return sessionSecurity(service, true).map((requirement) => ({ ...requirement, RecoveryCode: [] }));
    if (routePath.startsWith('/internal/')) {
      return operationId === 'responseRequestAdmissionAdmit'
        ? [{ ServiceToken: [], ActorAuthorization: [] }]
        : [{ ServiceToken: [] }];
    }
    return sessionSecurity(service, write);
  }

  if (operationId === 'logisticsDrivesPublicList' || operationId === 'logisticsDrivesPublicDetail' || operationId === 'logisticsReportsPublicDonationSummary') return [];
  if (operationId === 'logisticsDonationsCreateDelivery') return [
    { DonationSecret: [] }, ...sessionSecurity(service, true),
  ];
  if (operationId === 'logisticsDonationsTrack' || operationId === 'logisticsDonationsReviseDeclaration' || operationId === 'logisticsDonationsOpenDispute') {
    return capabilitySecurity('DonationSecret', true, write);
  }
  if (operationId === 'logisticsDonationsClaim') return sessionSecurity(service, true).map((requirement) => ({ ...requirement, DonationSecret: [] }));
  if (operationId === 'logisticsDonationsUploadEvidence') return capabilitySecurity('DonationSecret', true, true);
  if (routePath.startsWith('/internal/')) return [{ ServiceToken: [] }];
  return sessionSecurity(service, write);
}

function requiresExactSecurity(service, routePath, operationId) {
  if (service === 'identity') return routePath.startsWith('/internal/') || ['/auth/csrf', '/auth/register', '/auth/login', '/auth/refresh'].includes(routePath);
  if (service === 'response') {
    return routePath.startsWith('/internal/') || routePath === '/public/campaigns' || [
      'createSelfRequest', 'trackSelfRequest', 'listReporterEvents', 'supplementSelfRequest',
      'uploadRequestEvidence', 'claimSelfRequest', 'redeemRequestRecoveryCode',
    ].includes(operationId);
  }
  return routePath.startsWith('/internal/') || [
    'logisticsDrivesPublicList', 'logisticsDrivesPublicDetail', 'logisticsReportsPublicDonationSummary',
    'logisticsDonationsCreateDelivery', 'logisticsDonationsTrack', 'logisticsDonationsReviseDeclaration',
    'logisticsDonationsClaim', 'logisticsDonationsOpenDispute', 'logisticsDonationsUploadEvidence',
  ].includes(operationId);
}

function responseForCode(document, operation, code) {
  const catalogEntry = errorCatalog.get(code);
  if (!catalogEntry) throw new Error(`Undocumented OpenAPI error code: ${code}`);
  const status = catalogEntry.status;
  let errorResponse = operation.responses[status];
  if (errorResponse?.$ref?.startsWith('#/components/responses/')) {
    const componentName = errorResponse.$ref.split('/').at(-1);
    errorResponse = structuredClone(document.components?.responses?.[componentName] ?? {});
    operation.responses[status] = errorResponse;
  }
  if (!errorResponse) {
    errorResponse = {
      description: 'Documented error response; clients branch on the stable code.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
    };
    operation.responses[status] = errorResponse;
  }
  errorResponse.content ??= {};
  errorResponse.content['application/json'] ??= { schema: { $ref: '#/components/schemas/ErrorEnvelope' } };
  const json = errorResponse.content['application/json'];
  json.examples ??= {};
  json.examples[code] = {
    summary: code,
    value: { code, message: catalogEntry.message, correlation_id: '00000000-0000-4000-8000-000000000000' },
  };
}

const identityConditionalSecurity = {
  registerCitizen: {
    access_token_required: false,
    web: { required: ['Origin allowed by Identity', 'cookie c48_pre', 'header X-CSRF-Token'] },
    native: { required: [], forbidden: ['Cookie', 'Origin'] },
  },
  login: {
    access_token_required: false,
    web: { required: ['Origin allowed by Identity', 'cookie c48_pre', 'header X-CSRF-Token'] },
    native: { required: ['JSON body client_kind=NATIVE'], forbidden: ['Cookie', 'Origin'] },
  },
  refreshSession: {
    access_token_required: false,
    web: { required: ['Origin allowed by Identity', 'cookie c48_refresh', 'cookie c48_pre', 'header X-CSRF-Token'] },
    native: { required: ['JSON body refresh_token'], forbidden: ['Cookie', 'Origin'] },
  },
};

function removeErrorExamples(document, operation, codesToRemove) {
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    let target = response;
    if (target?.$ref?.startsWith('#/components/responses/')) {
      const name = target.$ref.split('/').at(-1);
      target = structuredClone(document.components?.responses?.[name] ?? {});
      operation.responses[status] = target;
    }
    const examples = target?.content?.['application/json']?.examples;
    if (!examples) continue;
    for (const code of codesToRemove) delete examples[code];
    if (!Object.keys(examples).length) delete target.content['application/json'].examples;
  }
}

function resolveParameter(document, parameter) {
  if (!parameter?.$ref?.startsWith('#/components/parameters/')) return parameter;
  return document.components?.parameters?.[parameter.$ref.split('/').at(-1)];
}

function applyErrorDetails(document, operation, service, method) {
  const codes = new Set(routeErrorCodes[operation.operationId] ?? []);
  const identityTransportRoute = service === 'identity' && Object.hasOwn(identityConditionalSecurity, operation.operationId);
  if (!identityTransportRoute && operation.security.some((requirement) => Object.keys(requirement).length > 0)) {
    codes.add('UNAUTHENTICATED');
    codes.add('SESSION_EXPIRED');
    codes.add('FORBIDDEN');
  }
  if (method === 'get' && (operation.parameters ?? []).some((parameter) => {
    const resolved = resolveParameter(document, parameter);
    return resolved?.in === 'query' && resolved.name === 'cursor';
  })) codes.add('CURSOR_INVALID');
  if (operation.security.some((requirement) => Object.hasOwn(requirement, 'CsrfToken'))) codes.add('CSRF_INVALID');
  for (const code of codes) responseForCode(document, operation, code);
  if (identityTransportRoute) removeErrorExamples(document, operation, ['UNAUTHENTICATED']);
  if (service === 'logistics' && operation.operationId === 'logisticsDistributionsReviewLoss') {
    removeErrorExamples(document, operation, ['LOSS_REVIEW_REQUIRED']);
  }
}

export function applyOpenApiDetails(document, service) {
  const details = service === 'identity' ? identityDetails : service === 'response' ? responseDetails : service === 'logistics' ? logisticsDetails : {};
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.securitySchemes ??= {};
  document.components.schemas.ErrorEnvelope ??= {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Stable machine-readable error code.' },
      message: { type: 'string', description: 'Vietnamese human-readable error message.' },
      field_errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
      details: { type: 'object', additionalProperties: true },
      correlation_id: { type: 'string', format: 'uuid' },
    },
    required: ['code', 'message', 'correlation_id'],
    additionalProperties: false,
  };
  Object.assign(document.components.securitySchemes, serviceSecuritySchemes[service] ?? {});
  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== 'object' || !operation.operationId) continue;
      if (requiresExactSecurity(service, routePath, operation.operationId) || !Array.isArray(operation.security)) {
        operation.security = routeSecurity(service, routePath, method, operation.operationId);
      }
      if (service === 'identity' && identityConditionalSecurity[operation.operationId]) {
        operation['x-c48-conditional-security'] = identityConditionalSecurity[operation.operationId];
      }
      const detail = details[operation.operationId] ?? {};
      const paginationQueries = [
        ...(identityPaginationQueries[operation.operationId] ?? []),
        ...(responsePaginationQueries[operation.operationId] ?? []),
      ];
      const managedQueryNames = new Set([
        ...(detail.query ?? []).map((parameter) => parameter.name),
        ...paginationQueries,
        ...(logisticsQueries[operation.operationId] ?? []),
      ]);
      const configuredQueries = [
        ...(detail.query ?? []).map((parameter) => ({ ...parameter, required: false, schema: { type: 'string' } })),
        ...paginationQueries.map((name) => ({
          name,
          in: 'query',
          required: false,
          schema: name === 'limit' ? { type: 'integer', minimum: 1, maximum: 100, default: 50 } : text,
        })),
        ...(service === 'logistics' ? (logisticsQueries[operation.operationId] ?? []).map((name) => {
          const required = logisticsRequiredQueries[operation.operationId] ?? [];
          return {
            name,
            in: 'query',
            required: required.includes(name),
            schema: name === 'limit' ? { type: 'integer', minimum: 1, maximum: 100, default: 50 } :
              name === 'work_cycle' ? { type: 'integer', minimum: 1 } :
              ['from', 'to'].includes(name) ? dateTime :
                ['drive_id', 'campaign_id', 'warehouse_id', 'item_id', 'request_id'].includes(name) ? id : text,
          };
        }) : []),
      ];
      const originalParameters = operation.parameters ?? [];
      const existingManagedRefs = new Set(originalParameters.flatMap((parameter) => {
        const resolved = resolveParameter(document, parameter);
        return parameter?.$ref && resolved?.in === 'query' && managedQueryNames.has(resolved.name) ? [resolved.name] : [];
      }));
      const parameters = originalParameters.filter((parameter) => {
        const resolved = resolveParameter(document, parameter);
        if (resolved?.in !== 'query' || !managedQueryNames.has(resolved.name)) return true;
        return Boolean(parameter?.$ref);
      });
      const seenParameters = new Set();
      operation.parameters = [...parameters, ...configuredQueries.filter((parameter) => !existingManagedRefs.has(parameter.name))].filter((parameter) => {
        const resolved = resolveParameter(document, parameter);
        const key = resolved?.in && resolved?.name ? `${resolved.in}:${resolved.name}` : `$ref:${parameter?.$ref}`;
        if (seenParameters.has(key)) return false;
        seenParameters.add(key);
        return true;
      });
      if (!operation.parameters.length) delete operation.parameters;
      if (service === 'logistics') {
        for (const parameter of operation.parameters ?? []) {
          const resolved = resolveParameter(document, parameter);
          if (resolved?.in === 'query' && resolved.name === 'limit') {
            resolved.schema = { ...resolved.schema, minimum: 1, maximum: 100, default: 50 };
          }
        }
      }
      applyErrorDetails(document, operation, service, method);
      if (!operation['x-c48-contract-source']) continue;
      delete operation['x-c48-contract-gap'];
      if (detail.request) operation.requestBody = detail.request;
      if (logisticsQueryConstraints[operation.operationId]) operation['x-c48-query-constraints'] = logisticsQueryConstraints[operation.operationId];
      const responseSchema = detail.response?.content?.['application/json']?.schema ?? sharedLogisticsResponses[operation.operationId];
      const success = Object.keys(operation.responses ?? {}).find((status) => status.startsWith('2'));
      if (responseSchema && success) {
        const description = detail.response?.description ?? 'Documented response projection; see the source API specification for visibility and pagination rules.';
        operation.responses[success] = response(responseSchema, description);
      }
      const gaps = detail.gap ? [detail.gap] : [];
      if (!detail.request && !detail.noBody && method !== 'get' && !['post'].includes(method)) gaps.push('The API specification does not define this operation’s JSON request body.');
      if (method === 'post' && !detail.request && !detail.noBody && !['identityInternalTeamLeaderEligibility'].includes(operation.operationId)) {
        gaps.push('The API specification does not define this operation’s JSON request body.');
      }
      if (!responseSchema && success !== '204') gaps.push('The API specification does not define this operation’s success response body.');
      if (gaps.length) operation['x-c48-contract-gap'] = gaps.join(' ');
    }
  }
  return document;
}
