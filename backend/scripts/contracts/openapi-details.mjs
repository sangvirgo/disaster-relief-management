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
const response = (schema, description = 'Documented response shape.', example, headers) => ({
  description,
  ...(headers ? { headers } : {}),
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
});
const request = (schema, example) => ({
  required: true,
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
});
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
const idempotentCommandResponseHeaders = {
  'Cache-Control': { $ref: '#/components/headers/CacheControlNoStore' },
  'Idempotent-Replay': { $ref: '#/components/headers/IdempotentReplay' },
};
const logisticsCommandResponseHeaders = {
  'Cache-Control': { description: 'Prevents storage of the Logistics API result.', schema: { type: 'string', enum: ['no-store'] } },
  'Idempotent-Replay': { description: 'Present as true when this response replays the original command result.', schema: { type: 'string', enum: ['true'] } },
};
const requestCampaignAssociationViewSchema = object({
  id, status: text, version, region_code: { anyOf: [text, { type: 'null' }] },
  campaign_id: { anyOf: [id, { type: 'null' }] },
}, ['id', 'status', 'version', 'region_code', 'campaign_id']);
const identityDetails = {
  registerCitizen: {
    summary: 'Start a citizen registration and send an email verification code.',
    description: 'Creates a pending registration request valid for ten minutes, without creating an account or reserving its username/email. The user object previews the prospective account UUID. A valid six-digit OTP creates the account and its CITIZEN grant atomically. Codes last five minutes, capped by the fixed registration deadline; resend never extends that deadline. Replaying an expired registration key returns REGISTRATION_EXPIRED; start again with a new key. WEB requests require the pre-session cookie and CSRF token; NATIVE requests send no cookies or Origin.',
  },
  identityAuthVerifyEmail: {
    summary: 'Verify a citizen email address.',
    description: 'A valid unconsumed code creates the account and CITIZEN grant in one transaction. Expired registration requests and expired, wrong or consumed codes never activate an account. Username/email conflicts are checked against existing accounts at verification time.',
    request: request(object({ challenge_id: id, code: { type: 'string', pattern: '^\\d{6}$' } }, ['challenge_id', 'code'])),
    response: response(object({ verified: { type: 'boolean', const: true }, user: object({ id, username: text, display_name: text }, ['id', 'username', 'display_name']) }, ['verified', 'user'])),
  },
  identityAuthResendEmailOtp: {
    summary: 'Resend the email verification code.',
    description: 'Rotates the challenge after the resend cooldown while the registration is still live. The new code expires after five minutes or at the original ten-minute registration deadline, whichever comes first. Unknown or expired requests return no usable challenge.',
    request: request(object({ challenge_id: id }, ['challenge_id'])),
    response: response(object({ challenge_id: { anyOf: [id, { type: 'null' }] }, email_sent: boolean() }, ['challenge_id', 'email_sent'])),
  },
  identityAuthGoogleLogin: {
    summary: 'Create a session using a verified Google identity.',
    description: 'The server verifies the Google ID token against configured client IDs. Accounts are matched by the stable Google subject; an existing account is never linked by email alone. WEB sessions use secure cookies; NATIVE sessions return tokens in JSON.',
    request: request(object({
      id_token: { type: 'string', minLength: 20, maxLength: 8192 },
      client_kind: { type: 'string', enum: ['WEB', 'NATIVE'] },
      first_time_username: { type: 'string', minLength: 3, maxLength: 64, pattern: '^[A-Za-z0-9._-]+$' },
    }, ['id_token', 'client_kind'])),
    response: response({ oneOf: [
      object({ user: { $ref: '#/components/schemas/AuthUser' }, session: object({ expires_at: dateTime }, ['expires_at']), must_change_password: { type: 'boolean', const: false } }, ['user', 'session', 'must_change_password']),
      object({ user: { $ref: '#/components/schemas/AuthUser' }, access_token: text, refresh_token: text, expires_in: integer(), must_change_password: { type: 'boolean', const: false } }, ['user', 'access_token', 'refresh_token', 'expires_in', 'must_change_password']),
    ] }, 'Verified Google login response; WEB returns cookies and NATIVE returns bearer tokens.'),
  },
  identityAuthLinkGoogle: {
    summary: 'Link a verified Google identity to the signed-in account.',
    request: request(object({ id_token: { type: 'string', minLength: 20, maxLength: 8192 } }, ['id_token'])),
    response: response(object({ linked: { type: 'boolean', const: true } }, ['linked'])),
  },
  identityInternalActiveUserCheck: {
    request: request(object({ user_id: id }, ['user_id'])),
    response: response({ oneOf: [
      object({ active: { type: 'boolean', const: true } }, ['active']),
      object({ active: { type: 'boolean', const: false }, reason: { type: 'string', enum: ['USER_NOT_FOUND', 'USER_INACTIVE'] } }, ['active', 'reason']),
    ] }),
  },
  identityInternalSearchActiveUsers: {
    summary: 'Search active accounts for Response team membership.',
    description: 'Restricted to the Response service token. Searches active accounts by username or display-name prefix and returns only the fields needed by the team member picker. Results use a filter-bound keyset cursor and are not cached.',
    request: request(object({
      query: { type: 'string', minLength: 2, maxLength: 64 },
      cursor: { type: 'string', maxLength: 2048 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    }, ['query'])),
    response: response(object({
      items: item({ id, username: text, display_name: text }, ['id', 'username', 'display_name']),
      more: boolean(), cursor: text,
    }, ['items', 'more']), 'Active account search results.', undefined, {
      'Cache-Control': { $ref: '#/components/headers/CacheControlNoStore' },
    }),
  },
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
  getStaffRequestDetail: {
    summary: 'Get scoped SOS details, coordinator timeline, mission history and separate rules and Gemini advisories.',
    description: 'Returns exact contacts and coordinates only to staff authorized for this request. Backend and Gemini risk advisories are untrusted human-reviewed aids; neither sets official priority, reorders the queue, or dispatches a team. Seeder examples are labeled DEMO_FIXTURE.',
  },
  listTeamCandidates: {
    summary: 'Suggest eligible teams using distance bands and recent workload.',
    description: 'Active-mission teams are excluded. The nearest eligible team defines a priority-dependent safety band; inside that band, the lowest weighted workload over 24 hours and 7 days wins, then distance and team ID break ties. Teams outside the band remain distance-ranked. The response includes each team’s recent mission history; suggestions never assign or dispatch a team.',
  },
  responseRequestOperationsReviewAiAdvisory: {
    summary: 'Record a human decision on an AI advisory.',
    description: 'Accepts, adjusts or rejects a completed advisory and appends a staff timeline event. The advisory must still match the current SOS facts and expected_version; stale decisions return VERSION_CONFLICT. It does not modify SOS facts, official priority, or team assignment. An ADJUSTED decision requires a note.',
    parameters: [
      { $ref: '#/components/parameters/RequestId' },
      { name: 'advisoryId', in: 'path', required: true, schema: id },
      { $ref: '#/components/parameters/IdempotencyKey' },
    ],
    request: request(object({ expected_version: { type: 'integer', minimum: 1 }, decision: { type: 'string', enum: ['ACCEPTED', 'ADJUSTED', 'REJECTED'] }, note: { type: 'string', maxLength: 1000 } }, ['expected_version', 'decision'])),
    response: response(object({ request_id: id, advisory_id: id, decision: { type: 'string', enum: ['ACCEPTED', 'ADJUSTED', 'REJECTED'] } }, ['request_id', 'advisory_id', 'decision'])),
  },
  responseRequestOperationsRetryAiAdvisory: {
    summary: 'Queue a coordinator-requested retry for a failed AI advisory.',
    description: 'Requires REQUEST_VERIFY scope, the current request expected_version, an idempotency key, a configured Gemini API key, and the latest advisory to be FAILED and fresh for current SOS facts. Resets that advisory retry budget, appends a staff timeline event, and returns 202. A stale or superseded advisory is not retried. This does not change request facts, official priority, or team assignment.',
    parameters: [
      { $ref: '#/components/parameters/RequestId' },
      { name: 'advisoryId', in: 'path', required: true, schema: id },
      { $ref: '#/components/parameters/IdempotencyKey' },
    ],
    request: request(versionBody()),
    response: response(object({ request_id: id, advisory_id: id, status: { type: 'string', const: 'QUEUED' } }, ['request_id', 'advisory_id', 'status']), 'AI advisory queued for a coordinator-requested retry.', undefined, idempotentCommandResponseHeaders),
  },
  responseTrackingUpdateReport: {
    summary: 'Update editable facts on an SOS report before verification.',
    description: 'Uses expected_version for concurrency control. Omitted facts retain their current values. The request must be owned by the signed-in reporter or accompanied by valid tracking credentials.',
    parameters: [
      { $ref: '#/components/parameters/RequestId' },
      { $ref: '#/components/parameters/IdempotencyKey' },
    ],
    request: request(object({
      expected_version: { type: 'integer', minimum: 1 },
      description: { type: ['string', 'null'], maxLength: 2000 },
      household_reference_note: { type: ['string', 'null'], maxLength: 500 },
      people_affected: { type: ['integer', 'null'], minimum: 1, maximum: 10000 },
      children_count: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
      elderly_count: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
      location: { $ref: '#/components/schemas/RequestLocation' },
      reporter_declared_danger: boolean(),
      needs_rescue: boolean(),
      needs_relief_supplies: boolean(),
    }, ['expected_version'])),
    response: response(object({ id, version }, ['id', 'version']), 'Updated SOS request identifier and new version.'),
  },
  responseRequestOperationsEvidence: {
    response: response(object({ items: item({ id, state: text, size_bytes: integer(), detected_mime: text, checksum: text, created_at: dateTime }), more: boolean(), cursor: text })),
  },
  responseRequestOperationsAttachCampaign: {
    parameters: [
      { $ref: '#/components/parameters/RequestId' },
      { $ref: '#/components/parameters/IdempotencyKey' },
    ],
    request: request(versionBody({ campaign_id: id }, ['campaign_id']), {
      campaign_id: '00000000-0000-4000-8000-000000000003', expected_version: 7,
    }),
    response: response(requestCampaignAssociationViewSchema, 'Request after campaign attachment.', {
      id: '00000000-0000-4000-8000-000000000001', status: 'TRIAGED', version: 8,
      region_code: 'NORTH-01', campaign_id: '00000000-0000-4000-8000-000000000003',
    }, idempotentCommandResponseHeaders),
  },
  responseRequestOperationsDetachCampaign: {
    parameters: [
      { $ref: '#/components/parameters/RequestId' },
      { $ref: '#/components/parameters/IdempotencyKey' },
    ],
    request: request(versionBody(), { expected_version: 8 }),
    response: response(requestCampaignAssociationViewSchema, 'Request after campaign detachment.', {
      id: '00000000-0000-4000-8000-000000000001', status: 'TRIAGED', version: 9,
      region_code: 'NORTH-01', campaign_id: null,
    }, idempotentCommandResponseHeaders),
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
  responseTeamsListMembers: {
    summary: 'List active members of a rescue team.',
    description: 'Accessible to active team members, scoped TEAM_READ callers, and team managers. Returns display names resolved through Identity and a keyset page ordered by user ID.',
    response: response(object({
      team_id: id,
      can_manage_members: boolean(),
      items: item({ user_id: id, display_name: text, member_role: { type: 'string', enum: ['LEADER', 'MEMBER'] }, joined_at: dateTime }, ['user_id', 'display_name', 'member_role', 'joined_at']),
      more: boolean(), cursor: text,
    }, ['team_id', 'can_manage_members', 'items', 'more']), 'Active team member page.', undefined, {
      'Cache-Control': { $ref: '#/components/headers/CacheControlNoStore' },
    }),
  },
  responseTeamsListMemberCandidates: {
    summary: 'Search accounts that can be added to a rescue team.',
    description: 'Available only to the active team leader or a scoped TEAM_MANAGE_ANY caller. Searches ACTIVE Identity accounts by username or display-name prefix and excludes accounts already assigned to any active team. Any ACTIVE account remains eligible; the add command rechecks status and the one-active-team invariant.',
    query: [{ name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 64 } }],
    response: response(object({
      items: item({ user_id: id, username: text, display_name: text }, ['user_id', 'username', 'display_name']),
      more: boolean(), cursor: text,
    }, ['items', 'more']), 'Search results eligible for a team membership attempt.', undefined, {
      'Cache-Control': { $ref: '#/components/headers/CacheControlNoStore' },
    }),
  },
  responseTeamsAddMember: {
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    request: request(object({ user_id: id }, ['user_id'])),
    response: response(object({ team_id: id, user_id: id, member_role: { type: 'string', enum: ['LEADER', 'MEMBER'] }, joined_at: dateTime }, ['team_id', 'user_id', 'member_role', 'joined_at'])),
  },
  responseTeamsRemoveMember: {
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    noBody: true,
  },
  responseTeamsTransferLeader: {
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    request: request(object({ user_id: id, expected_version: version }, ['user_id', 'expected_version'])),
    response: response(object({ team_id: id, leader_user_id: id, version }, ['team_id', 'leader_user_id', 'version'])),
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
  responseTeamsListMembers: ['cursor', 'limit'],
  responseTeamsListMemberCandidates: ['cursor', 'limit'],
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
  logisticsDonationsIssueRecovery: {
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }],
    request: request(object({ expected_version: version, reason: { type: 'string', maxLength: 1000 }, confirmation_basis: { type: 'string', maxLength: 1000 }, source_note: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] } }, ['expected_version', 'reason', 'confirmation_basis']), {
      expected_version: 3, reason: 'Đã xác minh qua số điện thoại', confirmation_basis: 'Đối chiếu với người quyên góp',
    }),
    response: response({ oneOf: [
      object({ issuance_id: id, recovery_code: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', description: 'One-use code shown only in the first issuance response.' }, expires_at: dateTime }, ['issuance_id', 'recovery_code', 'expires_at']),
      object({ issuance_id: id, expires_at: dateTime }, ['issuance_id', 'expires_at']),
    ] }, 'The code is valid for 30 minutes; an idempotent replay returns issuance metadata without the code.', {
      issuance_id: '00000000-0000-4000-8000-000000000001', recovery_code: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', expires_at: '2026-10-15T12:30:00.000Z',
    }, logisticsCommandResponseHeaders),
  },
  logisticsDonationsRecover: {
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }],
    request: request(object({ public_code: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{8,16}$' } }, ['public_code']), { public_code: 'ABCDEFGH' }),
    response: response(object({ id, public_code: text, status: text, donor_user_id: id, capability_revoked: { type: 'boolean', const: true }, version }, ['id', 'public_code', 'status', 'donor_user_id', 'capability_revoked', 'version']), 'Delivery bound to the authenticated donor account.', {
      id: '00000000-0000-4000-8000-000000000002', public_code: 'ABCDEFGH', status: 'DECLARED',
      donor_user_id: '00000000-0000-4000-8000-000000000003', capability_revoked: true, version: 4,
    }, logisticsCommandResponseHeaders),
  },
  logisticsDonationsUploadEvidence: {
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }],
    request: {
      required: true,
      content: { 'multipart/form-data': { schema: object({ file: { type: 'string', format: 'binary' } }, ['file']) } },
    },
    response: response(object({ id, state: { type: 'string', const: 'READY' }, size_bytes: integer(), detected_mime: { type: 'string', enum: ['image/jpeg', 'image/png', 'video/mp4'] }, checksum: text, created_at: dateTime }, ['id', 'state', 'size_bytes', 'detected_mime', 'checksum', 'created_at']), 'Stored private Logistics evidence metadata.', undefined, logisticsCommandResponseHeaders),
  },
  logisticsDonationsDownloadEvidence: {
    summary: 'EvidenceController.download',
    description: 'Rechecks the current evidence owner and authorization on every request before issuing a private-storage signed URL valid for 60 seconds. Donation/dispute evidence is readable by the delivery owner, a valid donation capability, or scoped DONATION_INTAKE/DONATION_REVIEW staff. Handoff evidence requires current warehouse scope: HANDOFF_RECORD for normal handoffs, DONATION_INTAKE or DISTRIBUTION_DISPATCH for RETURN, and HANDOFF_RECORD or LOSS_APPROVE for LOSS. Missing authentication for handoff evidence returns 401 UNAUTHENTICATED; an authenticated caller outside the required scope or without applicable permission returns 403 FORBIDDEN; missing or non-READY evidence returns 404 NOT_FOUND. Invalid or missing donation capability without owner or staff access returns 400 DONATION_SECRET_INVALID.',
    response: response(object({ url: { type: 'string', format: 'uri' }, expires_in: { type: 'integer', const: 60 } }, ['url', 'expires_in']), 'Short-lived signed URL issued after each access check.', undefined, {
      'Cache-Control': { description: 'Prevents storage of the Logistics API result.', schema: { type: 'string', enum: ['no-store'] } },
    }),
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
  logisticsDistributionsHandoffDetail: {
    description: 'Requires an authenticated session and matching warehouse scope. DIRECT_HOUSEHOLD, POINT_RECEIPT, and HOUSEHOLD_HANDOUT require HANDOFF_RECORD; RETURN requires DONATION_INTAKE or DISTRIBUTION_DISPATCH; LOSS requires HANDOFF_RECORD or LOSS_APPROVE. Missing permission returns 403 FORBIDDEN; out-of-scope access returns 404 NOT_FOUND. See docs/backend/04-logistics-api.md for the response shape.',
  },
  logisticsDistributionsUploadHandoffEvidence: {
    description: 'Requires an authenticated session. The handoff must belong to the path distribution and be in the caller\'s current warehouse scope; missing, mismatched, or out-of-scope records return 404 NOT_FOUND. DIRECT_HOUSEHOLD, POINT_RECEIPT, HOUSEHOLD_HANDOUT, and LOSS require HANDOFF_RECORD; RETURN requires DONATION_INTAKE or DISTRIBUTION_DISPATCH. Missing authentication returns 401 UNAUTHENTICATED; an in-scope caller without the required permission returns 403 FORBIDDEN. LOSS_APPROVE alone does not permit upload. Accepts one multipart file named file and requires Idempotency-Key; returns READY private evidence metadata.',
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }],
    request: {
      required: true,
      content: { 'multipart/form-data': { schema: object({ file: { type: 'string', format: 'binary' } }, ['file']) } },
    },
    response: response(object({
      id,
      state: { type: 'string', const: 'READY' },
      size_bytes: integer(),
      detected_mime: { type: 'string', enum: ['image/jpeg', 'image/png', 'video/mp4'] },
      checksum: text,
      created_at: dateTime,
    }, ['id', 'state', 'size_bytes', 'detected_mime', 'checksum', 'created_at']), 'Stored private handoff evidence metadata.', undefined, logisticsCommandResponseHeaders),
  },
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
  version,
  vehicle_capacity_exceeded: { type: 'boolean', description: 'Warning only; exceeding capacity does not block preparation or dispatch.' },
  lines: array(distributionLineSchema),
});
const handoffViewSchema = object({
  id, distribution_id: id, handoff_kind: text, source_stage: nullableValue(text),
  receiver_user_id: nullableValue(id), receiver_label: nullableValue(text), recorder_user_id: id,
  confirmation_basis: text, occurred_at: dateTime, created_at: dateTime, version, status: text,
  review: nullableValue(object({ decision: text, reviewer_user_id: id, reason: nullableValue(text) })),
  lines: item({ id, distribution_line_id: id, commitment_id: nullableValue(id), quantity, unit_code: text }),
});
const handoffEvidenceMetadataSchema = object({
  id,
  state: { type: 'string', const: 'READY' },
  size_bytes: integer(),
  detected_mime: { type: 'string', enum: ['image/jpeg', 'image/png', 'video/mp4'] },
  created_at: dateTime,
}, ['id', 'state', 'size_bytes', 'detected_mime', 'created_at']);
const handoffDetailSchema = object({
  ...handoffViewSchema.properties,
  evidence: array(handoffEvidenceMetadataSchema),
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
  logisticsAuditList: object({
    items: item({
      id: text, actor_user_id: nullableValue(id), action: text, entity_type: text, entity_id: text,
      before_state: nullableValue({ type: 'object', additionalProperties: true }),
      after_state: nullableValue({ type: 'object', additionalProperties: true }),
      reason: nullableValue(text), correlation_id: nullableValue(id), created_at: dateTime,
    }, ['id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'before_state', 'after_state', 'reason', 'correlation_id', 'created_at']),
    next_cursor: nullableValue(text),
  }, ['items', 'next_cursor']),
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
  logisticsDistributionsHandoffDetail: handoffDetailSchema,
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
  logisticsDonationsUploadEvidence: ['dispute_id'],
  logisticsAuditList: ['entity_type', 'entity_id', 'cursor', 'limit'],
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
  logisticsAuditList: ['entity_type'],
  logisticsReportsReconciliationSummary: ['warehouse_id'],
  logisticsReportsFulfillmentSummary: ['from', 'to'],
};

const logisticsQueryConstraints = {
  logisticsReportsFulfillmentSummary: 'At least one of campaign_id or region_code is required; from is inclusive and to is exclusive.',
  logisticsReportsPublicDonationSummary: 'Exactly one of drive_id, campaign_id, or warehouse_id is required.',
};

const logisticsQuerySchemas = {
  logisticsAuditList: {
    entity_type: { type: 'string', minLength: 2, maxLength: 64, pattern: '^[a-z][a-z0-9_]{1,63}$' },
    entity_id: { type: 'string', maxLength: 200 },
    cursor: { type: 'string', maxLength: 2048 },
  },
};

const errorCatalogPath = fileURLToPath(new URL('../../../docs/backend/07-error-catalog.md', import.meta.url));
const errorCatalog = new Map([...fs.readFileSync(errorCatalogPath, 'utf8').matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|\s*[^|]+\|\s*([^|]+?)\s*\|\s*$/gmu)]
  .map(([, code, status, message]) => [code, { status, message }]));

const routeErrorCodes = {
  identityInternalActiveUserCheck: ['FORBIDDEN'],
  identityInternalSearchActiveUsers: ['FORBIDDEN', 'CURSOR_INVALID', 'VALIDATION_FAILED'],
  identityInternalTeamLeaderEligibility: ['FORBIDDEN'],
  registerCitizen: ['USERNAME_TAKEN', 'EMAIL_TAKEN', 'PASSWORD_WEAK', 'EMAIL_OTP_UNAVAILABLE', 'REGISTRATION_EXPIRED', 'RATE_LIMITED', 'CSRF_INVALID'],
  login: ['INVALID_CREDENTIALS', 'RATE_LIMITED', 'CSRF_INVALID'],
  identityAuthVerifyEmail: ['EMAIL_OTP_INVALID', 'EMAIL_OTP_UNAVAILABLE', 'USERNAME_TAKEN', 'EMAIL_TAKEN', 'RATE_LIMITED', 'CSRF_INVALID'],
  identityAuthResendEmailOtp: ['EMAIL_OTP_INVALID', 'EMAIL_OTP_UNAVAILABLE', 'RATE_LIMITED', 'CSRF_INVALID'],
  identityAuthGoogleLogin: ['GOOGLE_TOKEN_INVALID', 'GOOGLE_LOGIN_UNAVAILABLE', 'GOOGLE_ACCOUNT_LINK_REQUIRED', 'USERNAME_TAKEN', 'RATE_LIMITED', 'CSRF_INVALID'],
  identityAuthLinkGoogle: ['GOOGLE_TOKEN_INVALID', 'GOOGLE_LOGIN_UNAVAILABLE', 'GOOGLE_IDENTITY_IN_USE', 'GOOGLE_ALREADY_LINKED', 'SESSION_REAUTH_REQUIRED', 'CSRF_INVALID'],
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
  responseTrackingUpdateReport: ['NOT_FOUND', 'VALIDATION_FAILED', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED'],
  responseRequestOperationsReviewAiAdvisory: ['NOT_FOUND', 'VALIDATION_FAILED', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED'],
  responseRequestOperationsRetryAiAdvisory: ['NOT_FOUND', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'FORBIDDEN', 'IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED'],
  claimSelfRequest: ['ALREADY_CLAIMED', 'SESSION_EXPIRED'],
  issueRequestRecoveryCode: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  redeemRequestRecoveryCode: ['NOT_FOUND', 'SESSION_EXPIRED'],
  uploadRequestEvidence: ['EVIDENCE_LIMIT_REACHED', 'PAYLOAD_TOO_LARGE', 'LENGTH_REQUIRED', 'UNSUPPORTED_MEDIA', 'STORAGE_UNAVAILABLE'],
  uploadMissionEvidence: ['EVIDENCE_LIMIT_REACHED', 'PAYLOAD_TOO_LARGE', 'LENGTH_REQUIRED', 'UNSUPPORTED_MEDIA', 'STORAGE_UNAVAILABLE'],
  acceptMission: ['TEAM_BUSY', 'TEAM_NOT_ELIGIBLE', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'CAMPAIGN_PAUSED'],
  verifyRequest: ['VERIFICATION_BASIS_REQUIRED', 'SECOND_COORDINATOR_REQUIRED', 'PENDING_SUPPLEMENT_REVIEW'],
  rejectRequest: ['REJECT_THRESHOLD_NOT_MET'],
  markRequestDuplicate: ['CANONICAL_INVALID', 'CANONICAL_HAS_DUPLICATES'],
  createMissionOffer: ['TEAM_BUSY', 'TEAM_NOT_ELIGIBLE', 'OVERRIDE_REASON_REQUIRED', 'REGION_REQUIRED', 'CAMPAIGN_PAUSED', 'TEAM_HAS_ACTIVE_MISSION', 'CAMPAIGN_NOT_ACTIVE'],
  recordMissionOnBehalf: ['RECORDED_BASIS_REQUIRED', 'MISSION_NOT_LEADER', 'STATE_TRANSITION_INVALID'],
  createCampaign: ['FORBIDDEN', 'VERSION_CONFLICT'],
  closeCampaign: ['CAMPAIGN_HAS_OPEN_REQUESTS', 'VERSION_CONFLICT'],
  responseRequestOperationsAttachCampaign: ['NOT_FOUND', 'CAMPAIGN_NOT_ACTIVE', 'ATTRIBUTION_LOCKED', 'VERSION_CONFLICT', 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID'],
  responseRequestOperationsDetachCampaign: ['NOT_FOUND', 'ATTRIBUTION_LOCKED', 'VERSION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID'],
  getRequestHeatmap: ['TOO_MANY_CELLS', 'VALIDATION_FAILED'],
  responseRequestAdmissionAdmit: ['ATTRIBUTION_LOCKED', 'REGION_REQUIRED', 'PENDING_SUPPLEMENT_REVIEW', 'REQUEST_NOT_VERIFIED'],
  responseMissionsReviewFailure: ['REASON_REQUIRED', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  responseRequestResolutionResolve: ['RESOLUTION_BLOCKED', 'RESOLUTION_BASIS_INVALID', 'PENDING_SUPPLEMENT_REVIEW', 'LOGISTICS_UNAVAILABLE'],
  responseRequestResolutionClose: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  responseRequestResolutionReopen: ['CAMPAIGN_NOT_ACTIVE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  responseTeamsListMembers: ['NOT_FOUND', 'CURSOR_INVALID', 'IDENTITY_UNAVAILABLE', 'VALIDATION_FAILED'],
  responseTeamsListMemberCandidates: ['NOT_FOUND', 'CURSOR_INVALID', 'IDENTITY_UNAVAILABLE', 'VALIDATION_FAILED'],
  responseTeamsAddMember: ['NOT_FOUND', 'IDENTITY_UNAVAILABLE', 'USER_IN_OTHER_TEAM', 'STATE_TRANSITION_INVALID'],
  responseTeamsRemoveMember: ['NOT_FOUND', 'LEADER_REQUIRED'],
  responseTeamsTransferLeader: ['NOT_FOUND', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'IDENTITY_UNAVAILABLE'],
  logisticsAuditList: ['CURSOR_INVALID', 'VALIDATION_FAILED'],
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
  logisticsDonationsIssueRecovery: ['NOT_FOUND', 'FORBIDDEN', 'VERSION_CONFLICT', 'ALREADY_CLAIMED', 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_INVALID'],
  logisticsDonationsRecover: ['NOT_FOUND', 'ALREADY_CLAIMED', 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_INVALID'],
  logisticsDonationsUploadEvidence: ['NOT_FOUND', 'DONATION_SECRET_INVALID', 'EVIDENCE_LIMIT_REACHED', 'LENGTH_REQUIRED', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA', 'STORAGE_UNAVAILABLE', 'RATE_LIMITED', 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_INVALID'],
  logisticsDonationsDownloadEvidence: ['NOT_FOUND', 'UNAUTHENTICATED', 'DONATION_SECRET_INVALID', 'FORBIDDEN', 'STORAGE_UNAVAILABLE', 'VALIDATION_FAILED'],
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
  logisticsDistributionsHandoffDetail: ['NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN'],
  logisticsDistributionsUploadHandoffEvidence: ['NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN', 'EVIDENCE_LIMIT_REACHED', 'LENGTH_REQUIRED', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA', 'STORAGE_UNAVAILABLE', 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_INVALID'],
  logisticsDistributionsReviewLoss: ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'HANDOFF_KIND_INVALID'],
  logisticsDistributionsReconcile: ['LOSS_REVIEW_REQUIRED', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'],
  logisticsDistributionsPrepareFromCommitments: ['TOO_MANY_LINES', 'STATE_TRANSITION_INVALID', 'VERSION_CONFLICT', 'ALREADY_DISPATCHED'],
  logisticsReportsPublicDonationSummary: ['VALIDATION_FAILED'],
  logisticsDrivesPublicDetail: ['NOT_FOUND'],
  logisticsStockCreateAdjustment: ['QUANTITY_SCALE_INVALID'],
  logisticsStockOpening: ['QUANTITY_SCALE_INVALID'],
};

const routeErrorCodesToRemove = {
  responseTeamsAddMember: ['TEAM_NOT_ELIGIBLE'],
  responseTeamsTransferLeader: ['TEAM_NOT_ELIGIBLE', 'LEADER_REQUIRED'],
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
    RecoveryCode: { type: 'apiKey', in: 'header', name: 'X-Recovery-Code' },
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
    if (['/auth/register', '/auth/login', '/auth/google', '/auth/email/verify', '/auth/email/resend'].includes(routePath)) {
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
    if (operationId === 'listReporterEvents' || operationId === 'supplementSelfRequest' || operationId === 'responseTrackingUpdateReport' || operationId === 'uploadRequestEvidence') {
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
  if (operationId === 'logisticsDonationsRecover') return sessionSecurity(service, true).map((requirement) => ({ ...requirement, RecoveryCode: [] }));
  if (operationId === 'logisticsDonationsDownloadEvidence') return capabilitySecurity('DonationSecret', true, false);
  if (routePath.startsWith('/internal/')) return [{ ServiceToken: [] }];
  return sessionSecurity(service, write);
}

function requiresExactSecurity(service, routePath, operationId) {
  if (service === 'identity') return routePath.startsWith('/internal/') || ['/auth/csrf', '/auth/register', '/auth/login', '/auth/refresh', '/auth/google', '/auth/email/verify', '/auth/email/resend'].includes(routePath);
  if (service === 'response') {
    return routePath.startsWith('/internal/') || routePath === '/public/campaigns' || [
      'createSelfRequest', 'trackSelfRequest', 'listReporterEvents', 'supplementSelfRequest',
      'responseTrackingUpdateReport', 'uploadRequestEvidence', 'claimSelfRequest', 'redeemRequestRecoveryCode',
    ].includes(operationId);
  }
  return routePath.startsWith('/internal/') || [
    'logisticsDrivesPublicList', 'logisticsDrivesPublicDetail', 'logisticsReportsPublicDonationSummary',
    'logisticsDonationsCreateDelivery', 'logisticsDonationsTrack', 'logisticsDonationsReviseDeclaration',
    'logisticsDonationsClaim', 'logisticsDonationsOpenDispute', 'logisticsDonationsUploadEvidence',
    'logisticsDonationsIssueRecovery', 'logisticsDonationsRecover', 'logisticsDonationsDownloadEvidence',
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
  identityAuthVerifyEmail: {
    access_token_required: false,
    web: { required: ['Origin allowed by Identity', 'cookie c48_pre', 'header X-CSRF-Token'] },
    native: { required: [], forbidden: ['Cookie', 'Origin'] },
  },
  identityAuthResendEmailOtp: {
    access_token_required: false,
    web: { required: ['Origin allowed by Identity', 'cookie c48_pre', 'header X-CSRF-Token'] },
    native: { required: [], forbidden: ['Cookie', 'Origin'] },
  },
  identityAuthGoogleLogin: {
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
  if (!codesToRemove.length) return;
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
  removeErrorExamples(document, operation, routeErrorCodesToRemove[operation.operationId] ?? []);
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
  if (service === 'identity') {
    const registerRequest = document.components.schemas.RegisterRequest;
    if (registerRequest) {
      registerRequest.required = [...new Set([...(registerRequest.required ?? []), 'email'])];
      registerRequest.properties = {
        ...registerRequest.properties,
        email: { type: 'string', format: 'email', maxLength: 254 },
      };
    }
    const registerResponse = document.components.schemas.RegisterResponse;
    if (registerResponse) {
      registerResponse.required = [...new Set([...(registerResponse.required ?? []), 'verification', 'email_sent'])];
      registerResponse.properties = {
        ...registerResponse.properties,
        verification: object({ challenge_id: id }, ['challenge_id']),
        email_sent: boolean(),
      };
    }
  }
  if (service === 'response') {
    const countFields = {
      children_count: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
      elderly_count: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
    };
    const needsFields = {
      needs_rescue: { type: 'boolean', default: true },
      needs_relief_supplies: { type: 'boolean', default: false },
    };
    for (const name of ['CreateSelfRequest', 'CreateProxyRequest']) {
      const schema = document.components.schemas[name];
      if (schema) schema.properties = { ...schema.properties, ...countFields, ...needsFields };
    }
    const nullableAdvisory = (schema) => ({ anyOf: [schema, { type: 'null' }] });
    const priorityAdvisory = object({
      outcome: { type: 'string', enum: ['SUGGESTION', 'INSUFFICIENT_DATA'] },
      score: nullableAdvisory({ type: 'integer', minimum: 0, maximum: 100 }),
      level: nullableAdvisory({ type: 'string', enum: ['CRITICAL', 'HIGH', 'ELEVATED', 'STANDARD'] }),
      reason_codes: array(text),
      source: { type: 'string', const: 'BACKEND_RULES' },
      rules_version: text,
    }, ['outcome', 'score', 'level', 'reason_codes', 'source', 'rules_version']);
    const aiPriorityAdvisory = object({
      status: { type: 'string', enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED', 'STALE', 'UNKNOWN'] },
      score: { anyOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }] },
      level: { anyOf: [{ type: 'string', enum: ['CRITICAL', 'HIGH', 'ELEVATED', 'STANDARD'] }, { type: 'null' }] },
      reasons: array(text),
      confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
      source: { type: 'string', enum: ['GEMINI', 'DEMO_FIXTURE'] },
      human_review_required: { type: 'boolean', const: true },
      review_status: { anyOf: [{ type: 'string', enum: ['ACCEPTED', 'ADJUSTED', 'REJECTED'] }, { type: 'null' }] },
    }, ['status', 'score', 'level', 'reasons', 'confidence', 'source', 'human_review_required', 'review_status']);
    const queueItem = document.components.schemas.RequestQueueItem;
    if (queueItem) {
      queueItem.required = [...new Set([...(queueItem.required ?? []), 'priority_advisory', 'ai_priority_advisory'])];
      queueItem.properties = {
        ...queueItem.properties,
        priority_advisory: priorityAdvisory,
        ai_priority_advisory: nullableAdvisory(aiPriorityAdvisory),
      };
    }
    const staffDetail = document.components.schemas.StaffRequestDetail;
    if (staffDetail) {
      staffDetail.required = [...new Set([...(staffDetail.required ?? []), 'priority_advisory', 'ai_priority_advisory'])];
      staffDetail.properties = {
        ...staffDetail.properties,
        report_mode: text,
        category: text,
        description: { anyOf: [text, { type: 'null' }] },
        received_at: dateTime,
        declared_danger: boolean(),
        needs_rescue: boolean(),
        needs_relief_supplies: boolean(),
        priority_advisory: priorityAdvisory,
        ai_priority_advisory: nullableAdvisory(aiPriorityAdvisory),
        mission_history: object({
          items: array(object({
            id, status: text, mission_kind: { type: 'string', enum: ['RESCUE', 'DELIVERY', 'COMBINED'] },
            created_at: dateTime, team_id: id, team_name: text,
            suggested_team_id: { anyOf: [id, { type: 'null' }] },
            override_reason: { anyOf: [text, { type: 'null' }] },
            last_status: { anyOf: [text, { type: 'null' }] },
            last_occurred_at: { anyOf: [dateTime, { type: 'null' }] },
            recorded_basis: { anyOf: [text, { type: 'null' }] },
            reported_by: { anyOf: [text, { type: 'null' }] },
          })), more: boolean(),
        }, ['items', 'more']),
        ai_advisory: { anyOf: [
          { type: 'null' },
          object({
            id, model: text, status: { type: 'string', enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED', 'STALE'] },
            risk_score: { anyOf: [integer(), { type: 'null' }] }, reason_codes: array(text),
            extracted_json: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
            review_status: { anyOf: [{ type: 'string', enum: ['ACCEPTED', 'ADJUSTED', 'REJECTED'] }, { type: 'null' }] },
            review_note: { anyOf: [text, { type: 'null' }] }, error_code: { anyOf: [text, { type: 'null' }] },
            human_review_required: { type: 'boolean', const: true },
          }, ['id', 'model', 'status', 'reason_codes', 'human_review_required']),
        ] },
      };
      staffDetail.properties.subject = {
        ...staffDetail.properties.subject,
        properties: {
          ...staffDetail.properties.subject?.properties,
          people_affected: { anyOf: [integer(), { type: 'null' }] },
          ...countFields,
          reporter_relationship: { anyOf: [text, { type: 'null' }] },
          beneficiary_contact_phone: { anyOf: [text, { type: 'null' }] },
          alternate_contact: object({ name: { anyOf: [text, { type: 'null' }] }, phone: { anyOf: [text, { type: 'null' }] } }),
          information_source: { anyOf: [text, { type: 'null' }] },
          last_known_situation_at: { anyOf: [dateTime, { type: 'null' }] },
          contactability: { anyOf: [text, { type: 'null' }] },
          household_reference_note: { anyOf: [text, { type: 'null' }] },
        },
        additionalProperties: true,
      };
    }
    const recentHistory = array(object({
      id, status: text, mission_kind: { type: 'string', enum: ['RESCUE', 'DELIVERY', 'COMBINED'] }, created_at: dateTime,
      last_status: { anyOf: [text, { type: 'null' }] }, last_occurred_at: { anyOf: [dateTime, { type: 'null' }] },
      recorded_basis: { anyOf: [text, { type: 'null' }] }, reported_by: { anyOf: [text, { type: 'null' }] },
    }));
    for (const name of ['TeamCandidate', 'UnknownPositionTeamCandidate']) {
      const schema = document.components.schemas[name];
      if (schema) {
        schema.required = [...new Set([...(schema.required ?? []), 'recent_missions_7d', 'recent_history'])];
        schema.properties = {
          ...schema.properties,
          recent_missions_7d: { type: 'integer', minimum: 0 },
          recent_history: recentHistory,
        };
      }
    }
  }
  if (service === 'logistics') {
    document.components.parameters ??= {};
    document.components.parameters.IdempotencyKey ??= {
      name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' },
    };
    document.components.headers ??= {};
    document.components.headers.IdempotentReplay ??= {
      description: 'Present as true when this response replays the original command result.',
      schema: { type: 'string', enum: ['true'] },
    };
    document.components.headers.CacheControlNoStore ??= {
      description: 'Prevents storage of the Logistics API result.',
      schema: { type: 'string', enum: ['no-store'] },
    };
  }
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
        ...(detail.query ?? []).map((parameter) => ({
          ...parameter,
          required: parameter.required ?? false,
          schema: parameter.schema ?? { type: 'string' },
        })),
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
            schema: logisticsQuerySchemas[operation.operationId]?.[name] ?? (name === 'limit' ? { type: 'integer', minimum: 1, maximum: 100, default: 50 } :
              name === 'work_cycle' ? { type: 'integer', minimum: 1 } :
              ['from', 'to'].includes(name) ? dateTime :
                ['drive_id', 'campaign_id', 'warehouse_id', 'item_id', 'request_id', 'dispute_id'].includes(name) ? id : text),
          };
        }) : []),
      ];
      const configuredParameters = detail.parameters ?? [];
      const originalParameters = operation.parameters ?? [];
      const configuredParameterKeys = new Set(configuredParameters.flatMap((parameter) => {
        const resolved = resolveParameter(document, parameter);
        return resolved?.in && resolved?.name ? [`${resolved.in}:${resolved.name}`] : [];
      }));
      const existingManagedRefs = new Set(originalParameters.flatMap((parameter) => {
        const resolved = resolveParameter(document, parameter);
        return parameter?.$ref && resolved?.in === 'query' && managedQueryNames.has(resolved.name) ? [resolved.name] : [];
      }));
      const parameters = originalParameters.filter((parameter) => {
        const resolved = resolveParameter(document, parameter);
        const key = resolved?.in && resolved?.name ? `${resolved.in}:${resolved.name}` : null;
        if (key && configuredParameterKeys.has(key)) return false;
        if (resolved?.in !== 'query' || !managedQueryNames.has(resolved.name)) return true;
        return Boolean(parameter?.$ref);
      });
      const seenParameters = new Set();
      operation.parameters = [...parameters, ...configuredParameters, ...configuredQueries.filter((parameter) => !existingManagedRefs.has(parameter.name))].filter((parameter) => {
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
      if (detail.summary) operation.summary = detail.summary;
      if (detail.description) operation.description = detail.description;
      delete operation['x-c48-contract-gap'];
      if (detail.request) operation.requestBody = detail.request;
      if (logisticsQueryConstraints[operation.operationId]) operation['x-c48-query-constraints'] = logisticsQueryConstraints[operation.operationId];
      const responseSchema = detail.response?.content?.['application/json']?.schema ?? sharedLogisticsResponses[operation.operationId];
      const success = Object.keys(operation.responses ?? {}).find((status) => status.startsWith('2'));
      if (responseSchema && success) {
        const description = detail.response?.description ?? 'Documented response projection; see the source API specification for visibility and pagination rules.';
        const documentedResponse = detail.response ?? response(responseSchema, description);
        operation.responses[success] = {
          ...documentedResponse,
          description: documentedResponse.description ?? description,
          content: {
            ...(documentedResponse.content ?? {}),
            'application/json': {
              ...(documentedResponse.content?.['application/json'] ?? {}),
              schema: responseSchema,
            },
          },
        };
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
