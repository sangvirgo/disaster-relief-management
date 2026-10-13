import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { cleanupT17TestUsers, registerAndLoginT17User } from './t17-test-users.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const { finalDistributionHandoffPredicate } = require('../../dist/apps/logistics/src/reports/donation-report.helpers.js');
const { physicalHandoffsLateralSql } = require('../../dist/apps/logistics/src/reports/reconciliation-report.helpers.js');
const logisticsUrl = (process.env.C48_LOGISTICS_BASE_URL ?? 'http://127.0.0.1:3003/api/v1/logistics').replace(/\/+$/u, '');
const identityUrl = (process.env.C48_IDENTITY_BASE_URL ?? 'http://127.0.0.1:3001/api/v1/identity').replace(/\/+$/u, '');
const logisticsDb = new Client({ connectionString: databaseUrl('C48_LOGISTICS_DATABASE_URL', 'LOGISTICS_MIGRATOR_PASSWORD', 'logistics_migrator', 'c48_logistics') });
const identityDb = new Client({ connectionString: databaseUrl('C48_IDENTITY_DATABASE_URL', 'IDENTITY_MIGRATOR_PASSWORD', 'identity_migrator', 'c48_identity') });

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function databaseUrl(urlVariable, passwordVariable, username, database) {
  if (process.env[urlVariable]) return process.env[urlVariable];
  const url = new URL(`postgresql://127.0.0.1:55432/${database}`);
  url.username = username;
  url.password = requiredEnv(passwordVariable);
  return url.toString();
}

async function call(base, path, { method = 'GET', body, actor, headers: extraHeaders = {} } = {}) {
  const headers = {
    ...extraHeaders,
    ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
  const response = await fetch(`${base}/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : undefined; } catch { value = text; }
  return { status: response.status, headers: response.headers, value };
}

function expectSuccess(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.value));
  assert.equal(result.headers.get('cache-control'), 'no-store');
}

function expectVietnameseError(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result.value));
  assert.equal(result.value?.code, code);
  assert.match(result.value?.message ?? '', /[\u0102-\u01b0\u1ea0-\u1ef9]/u, 'expected Vietnamese user-facing copy');
}

async function loginSmokeActor(organizationId, cleanupUserIds, roleCode) {
  const suffix = randomBytes(6).toString('hex');
  const username = `t17report${suffix}`;
  const password = `Logistics T17 report ${suffix}!`;
  const sourceIp = `198.51.100.${50 + Number.parseInt(suffix.slice(0, 2), 16) % 150}`;
  return registerAndLoginT17User({
    cleanupUserIds,
    register: () => call(identityUrl, 'auth/register', {
      method: 'POST',
      body: { username, display_name: `Người dùng báo cáo T17 ${suffix}`, password },
      headers: { 'Idempotency-Key': randomUUID(), 'X-Forwarded-For': sourceIp },
    }),
    grant: async (userId) => {
      if (!roleCode) return;
      await identityDb.query(
        `INSERT INTO role_grant (user_id,role_code,scope_type,organization_id)
         VALUES ($1,$2,'ORGANIZATION',$3)`,
        [userId, roleCode, organizationId],
      );
    },
    login: () => call(identityUrl, 'auth/login', {
      method: 'POST', body: { username, password, client_kind: 'NATIVE' },
      headers: { 'X-Forwarded-For': sourceIp },
    }),
  });
}

async function verifyFinalHandoffAttribution() {
  const commitmentId = randomUUID();
  const pointId = randomUUID();
  const cases = [
    ['point receipt for its designated relief point is not final distribution', 'POINT_RECEIPT', commitmentId, pointId, false],
    ['point receipt without a designated relief point', 'POINT_RECEIPT', commitmentId, null, false],
    ['household handoff for a point-designated need', 'DIRECT_HOUSEHOLD', commitmentId, pointId, false],
    ['household handoff for a non-point need', 'DIRECT_HOUSEHOLD', commitmentId, null, true],
    ['final household handout for a point-designated need', 'HOUSEHOLD_HANDOUT', commitmentId, pointId, true],
    ['unlinked household handout', 'HOUSEHOLD_HANDOUT', null, null, true],
    ['return handoff', 'RETURN', commitmentId, null, false],
    ['loss handoff', 'LOSS', commitmentId, null, false],
  ];
  const values = [];
  const valueRows = cases.map(([label, kind, linkedCommitmentId, designatedPointId, expected], index) => {
    const first = index * 5 + 1;
    values.push(label, kind, linkedCommitmentId, designatedPointId, expected);
    return `($${first}::text,$${first + 1}::text,$${first + 2}::uuid,$${first + 3}::uuid,$${first + 4}::boolean)`;
  });
  const result = await logisticsDb.query(
    `WITH cases(label,handoff_kind,commitment_id,designated_point_id,expected) AS (
       VALUES ${valueRows.join(',')}
     )
     SELECT handoff.label,${finalDistributionHandoffPredicate} AS included,handoff.expected
       FROM cases handoff
       LEFT JOIN LATERAL (SELECT handoff.commitment_id AS id) commitment ON TRUE
       LEFT JOIN LATERAL (SELECT handoff.designated_point_id) need ON TRUE
      ORDER BY handoff.label`,
    values,
  );
  for (const row of result.rows) assert.equal(row.included, row.expected, row.label);
}

async function verifyPrimaryDatabaseReportFixture() {
  const result = await logisticsDb.query(`
    WITH relief_point(id) AS (
      VALUES ('00000000-0000-4000-8000-000000000003'::uuid)
    ),
    relief_need(id,designated_point_id) AS (
      SELECT '00000000-0000-4000-8000-000000000005'::uuid,NULL::uuid
      UNION ALL
      SELECT '00000000-0000-4000-8000-000000000006'::uuid,id FROM relief_point
    ),
    commitment(id,relief_need_id,warehouse_id,item_id,delivered_quantity,returned_quantity,lost_quantity) AS (
      VALUES
        ('00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000005'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,3.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000012'::uuid,'00000000-0000-4000-8000-000000000006'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,3.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000013'::uuid,'00000000-0000-4000-8000-000000000005'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,1.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000014'::uuid,'00000000-0000-4000-8000-000000000005'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,0.000::numeric,1.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000015'::uuid,'00000000-0000-4000-8000-000000000005'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,0.000::numeric,0.000::numeric,1.000::numeric)
    ),
    distribution(id,warehouse_id,campaign_id,relief_point_id) AS (
      SELECT '00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000004'::uuid,NULL::uuid
      UNION ALL
      SELECT '00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000004'::uuid,id FROM relief_point
    ),
    distribution_line(id,distribution_id,warehouse_id,item_id,commitment_id,quantity,in_transit_quantity,at_point_quantity) AS (
      VALUES
        ('00000000-0000-4000-8000-000000000031'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000011'::uuid,2.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000032'::uuid,'00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000012'::uuid,3.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000033'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000013'::uuid,1.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000034'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000014'::uuid,1.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000035'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,'00000000-0000-4000-8000-000000000015'::uuid,1.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000036'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,NULL::uuid,2.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000037'::uuid,'00000000-0000-4000-8000-000000000022'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,NULL::uuid,3.000::numeric,0.000::numeric,2.000::numeric),
        ('00000000-0000-4000-8000-000000000038'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,NULL::uuid,1.000::numeric,0.000::numeric,0.000::numeric),
        ('00000000-0000-4000-8000-000000000039'::uuid,'00000000-0000-4000-8000-000000000021'::uuid,'00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid,NULL::uuid,1.000::numeric,0.000::numeric,0.000::numeric)
    ),
    handoff_record(id,handoff_kind,source_stage) AS (
      VALUES
        ('00000000-0000-4000-8000-000000000041'::uuid,'DIRECT_HOUSEHOLD'::text,NULL::text),
        ('00000000-0000-4000-8000-000000000042'::uuid,'POINT_RECEIPT'::text,'IN_TRANSIT'::text),
        ('00000000-0000-4000-8000-000000000043'::uuid,'DIRECT_HOUSEHOLD'::text,NULL::text),
        ('00000000-0000-4000-8000-000000000044'::uuid,'RETURN'::text,'IN_TRANSIT'::text),
        ('00000000-0000-4000-8000-000000000045'::uuid,'LOSS'::text,'IN_TRANSIT'::text),
        ('00000000-0000-4000-8000-000000000046'::uuid,'HOUSEHOLD_HANDOUT'::text,'AT_POINT'::text),
        ('00000000-0000-4000-8000-000000000047'::uuid,'RETURN'::text,'AT_POINT'::text),
        ('00000000-0000-4000-8000-000000000048'::uuid,'LOSS'::text,'AT_POINT'::text),
        ('00000000-0000-4000-8000-000000000049'::uuid,'DIRECT_HOUSEHOLD'::text,NULL::text),
        ('00000000-0000-4000-8000-000000000050'::uuid,'POINT_RECEIPT'::text,'IN_TRANSIT'::text),
        ('00000000-0000-4000-8000-000000000051'::uuid,'HOUSEHOLD_HANDOUT'::text,'AT_POINT'::text),
        ('00000000-0000-4000-8000-000000000052'::uuid,'RETURN'::text,'IN_TRANSIT'::text),
        ('00000000-0000-4000-8000-000000000053'::uuid,'LOSS'::text,'IN_TRANSIT'::text)
    ),
    handoff_line(id,handoff_id,distribution_line_id,quantity) AS (
      VALUES
        ('00000000-0000-4000-8000-000000000061'::uuid,'00000000-0000-4000-8000-000000000041'::uuid,'00000000-0000-4000-8000-000000000031'::uuid,2.000::numeric),
        ('00000000-0000-4000-8000-000000000062'::uuid,'00000000-0000-4000-8000-000000000042'::uuid,'00000000-0000-4000-8000-000000000032'::uuid,3.000::numeric),
        ('00000000-0000-4000-8000-000000000063'::uuid,'00000000-0000-4000-8000-000000000043'::uuid,'00000000-0000-4000-8000-000000000033'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000064'::uuid,'00000000-0000-4000-8000-000000000044'::uuid,'00000000-0000-4000-8000-000000000034'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000065'::uuid,'00000000-0000-4000-8000-000000000045'::uuid,'00000000-0000-4000-8000-000000000035'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000066'::uuid,'00000000-0000-4000-8000-000000000046'::uuid,'00000000-0000-4000-8000-000000000032'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000067'::uuid,'00000000-0000-4000-8000-000000000047'::uuid,'00000000-0000-4000-8000-000000000032'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000068'::uuid,'00000000-0000-4000-8000-000000000048'::uuid,'00000000-0000-4000-8000-000000000032'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000069'::uuid,'00000000-0000-4000-8000-000000000049'::uuid,'00000000-0000-4000-8000-000000000036'::uuid,2.000::numeric),
        ('00000000-0000-4000-8000-000000000070'::uuid,'00000000-0000-4000-8000-000000000050'::uuid,'00000000-0000-4000-8000-000000000037'::uuid,3.000::numeric),
        ('00000000-0000-4000-8000-000000000071'::uuid,'00000000-0000-4000-8000-000000000051'::uuid,'00000000-0000-4000-8000-000000000037'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000072'::uuid,'00000000-0000-4000-8000-000000000052'::uuid,'00000000-0000-4000-8000-000000000038'::uuid,1.000::numeric),
        ('00000000-0000-4000-8000-000000000073'::uuid,'00000000-0000-4000-8000-000000000053'::uuid,'00000000-0000-4000-8000-000000000039'::uuid,1.000::numeric)
    ),
    issued_line_settlement(commitment_id,handoff_line_id,settlement_type) AS (
      VALUES
        ('00000000-0000-4000-8000-000000000011'::uuid,'00000000-0000-4000-8000-000000000061'::uuid,'DELIVERED'::text),
        ('00000000-0000-4000-8000-000000000012'::uuid,'00000000-0000-4000-8000-000000000062'::uuid,'DELIVERED'::text),
        ('00000000-0000-4000-8000-000000000013'::uuid,'00000000-0000-4000-8000-000000000063'::uuid,'DELIVERED'::text),
        ('00000000-0000-4000-8000-000000000014'::uuid,'00000000-0000-4000-8000-000000000064'::uuid,'RETURNED'::text),
        ('00000000-0000-4000-8000-000000000015'::uuid,'00000000-0000-4000-8000-000000000065'::uuid,'LOST'::text)
    ),
    handoff_loss_review(handoff_id,decision) AS (
      VALUES
        ('00000000-0000-4000-8000-000000000045'::uuid,'APPROVE'::text),
        ('00000000-0000-4000-8000-000000000048'::uuid,'APPROVE'::text),
        ('00000000-0000-4000-8000-000000000053'::uuid,'APPROVE'::text)
    ),
    final_distribution AS (
      SELECT COALESCE(SUM(line.quantity) FILTER (WHERE ${finalDistributionHandoffPredicate}),0) AS warehouse_distributed,
             COALESCE(SUM(line.quantity) FILTER (
               WHERE distribution.campaign_id='00000000-0000-4000-8000-000000000004'::uuid
                 AND ${finalDistributionHandoffPredicate}
             ),0) AS campaign_distributed,
             COALESCE(SUM(line.quantity) FILTER (
               WHERE handoff.handoff_kind='POINT_RECEIPT' AND ${finalDistributionHandoffPredicate}
             ),0) AS point_receipt_final,
             COALESCE(SUM(line.quantity) FILTER (
               WHERE handoff.handoff_kind='HOUSEHOLD_HANDOUT' AND ${finalDistributionHandoffPredicate}
             ),0) AS household_handout_final
        FROM handoff_line line
        JOIN handoff_record handoff ON handoff.id=line.handoff_id
        JOIN distribution_line distributionLine ON distributionLine.id=line.distribution_line_id
        JOIN distribution ON distribution.id=distributionLine.distribution_id
        LEFT JOIN commitment ON commitment.id=distributionLine.commitment_id
        LEFT JOIN relief_need need ON need.id=commitment.relief_need_id
    )
    SELECT (COALESCE((SELECT SUM(delivered_quantity) FROM commitment),0)+COALESCE(physical_handoffs.delivered,0))::text AS delivered,
           (COALESCE((SELECT SUM(returned_quantity) FROM commitment),0)+COALESCE(physical_handoffs.returned,0))::text AS returned,
           (COALESCE((SELECT SUM(lost_quantity) FROM commitment),0)+COALESCE(physical_handoffs.lost,0))::text AS lost,
           COALESCE(physical_handoffs.delivered,0)::text AS physical_delivered,
           COALESCE(physical_handoffs.returned,0)::text AS physical_returned,
           COALESCE(physical_handoffs.lost,0)::text AS physical_lost,
           (SELECT COALESCE(SUM(at_point_quantity),0) FROM distribution_line
             WHERE warehouse_id='00000000-0000-4000-8000-000000000001'::uuid
               AND item_id='00000000-0000-4000-8000-000000000002'::uuid)::text AS at_point,
           final_distribution.warehouse_distributed::text AS warehouse_distributed,
           final_distribution.campaign_distributed::text AS campaign_distributed,
           final_distribution.point_receipt_final::text AS point_receipt_final,
           final_distribution.household_handout_final::text AS household_handout_final
      FROM (VALUES ('00000000-0000-4000-8000-000000000001'::uuid,'00000000-0000-4000-8000-000000000002'::uuid)) b(warehouse_id,item_id)
      ${physicalHandoffsLateralSql}
      CROSS JOIN final_distribution
  `);

  assert.deepEqual(result.rows, [{
    delivered: '10.000', returned: '3.000', lost: '3.000',
    physical_delivered: '3.000', physical_returned: '2.000', physical_lost: '2.000',
    at_point: '2.000', warehouse_distributed: '7.000', campaign_distributed: '7.000',
    point_receipt_final: '0', household_handout_final: '2.000',
  }]);
}
async function main() {
  await Promise.all([logisticsDb.connect(), identityDb.connect()]);
  const cleanupUserIds = new Set();
  let createdWarehouseId;
  try {
    await verifyFinalHandoffAttribution();
    await verifyPrimaryDatabaseReportFixture();
    const warehouses = await logisticsDb.query(
      `SELECT w.id,w.organization_id,w.region_code FROM warehouse w
        WHERE EXISTS (SELECT 1 FROM stock_balance b WHERE b.warehouse_id=w.id)
        ORDER BY w.id LIMIT 1`,
    );
    let warehouse = warehouses.rows[0];
    let organizationId = warehouse?.organization_id;
    let regionCode = warehouse?.region_code;
    if (!warehouse) {
      const configuredOrganizationId = process.env.DEMO_INTAKE_ORGANIZATION_ID;
      const organizations = configuredOrganizationId
        ? await identityDb.query('SELECT id FROM organization WHERE id=$1', [configuredOrganizationId])
        : await identityDb.query('SELECT id FROM organization ORDER BY id LIMIT 1');
      organizationId = organizations.rows[0]?.id;
      assert.ok(organizationId, 'T17 smoke requires an existing organization in the primary Identity database');
      const regions = await identityDb.query("SELECT code FROM region WHERE status='ACTIVE' ORDER BY code LIMIT 1");
      regionCode = regions.rows[0]?.code;
      assert.ok(regionCode, 'T17 smoke requires an active region in the primary Identity database');
    }

    const actor = await loginSmokeActor(organizationId, cleanupUserIds, 'OPERATIONS_MANAGER');
    if (!warehouse) {
      const created = await call(logisticsUrl, 'warehouses', {
        method: 'POST', actor, headers: { 'Idempotency-Key': randomUUID() },
        body: { organization_id: organizationId, region_code: regionCode, name: `Kho báo cáo T17 ${randomBytes(4).toString('hex')}` },
      });
      createdWarehouseId = created.value?.id;
      expectSuccess(created, 201);
      warehouse = { id: created.value.id, organization_id: organizationId, region_code: regionCode };
    }

    const deniedActor = await loginSmokeActor(organizationId, cleanupUserIds);
    const deniedReport = await call(logisticsUrl, `reports/stock-summary?warehouse_id=${warehouse.id}`, { actor: deniedActor });
    expectVietnameseError(deniedReport, 403, 'FORBIDDEN');

    const noSession = await call(logisticsUrl, `reports/stock-summary?warehouse_id=${warehouse.id}`);
    expectVietnameseError(noSession, 401, 'UNAUTHENTICATED');

    const stock = await call(logisticsUrl, `stock?warehouse_id=${warehouse.id}&limit=100`, { actor });
    expectSuccess(stock);
    const stockReport = await call(logisticsUrl, `reports/stock-summary?warehouse_id=${warehouse.id}&limit=100`, { actor });
    expectSuccess(stockReport);
    assert.equal(typeof stockReport.value.generated_at, 'string');
    const stockByItem = new Map(stock.value.items.map((row) => [row.item_id, row]));
    for (const row of stockReport.value.items) {
      const source = stockByItem.get(row.item.id);
      assert.ok(source, `stock summary returned unknown item ${row.item.id}`);
      assert.equal(row.on_hand, source.on_hand);
      assert.equal(row.reserved, source.reserved);
      assert.equal(row.available, source.available);
      assert.equal(typeof row.held, 'string');
      assert.equal(typeof row.in_transit, 'string');
    }

    const reconciliation = await call(logisticsUrl, `reconciliation?warehouse_id=${warehouse.id}&limit=100`, { actor });
    expectSuccess(reconciliation);
    assert.equal(typeof reconciliation.value.generated_at, 'string');
    const reconciliationOracle = await logisticsDb.query(
      `SELECT b.id AS balance_id,b.item_id,i.name AS item_name,i.unit_code,
              unit.display_name AS unit_name,unit.scale AS unit_scale,
              COALESCE(movements.intake_accepted,0)::text AS intake_accepted,
              COALESCE(movements.posted_movements,0)::text AS posted_movements,
              COALESCE(movements.posted_reserved_movements,0)::text AS posted_reserved_movements,
              b.reserved::text AS reserved,
              COALESCE(custody.issued_in_transit,0)::text AS issued_in_transit,
              COALESCE(custody.at_point,0)::text AS at_point,
              (COALESCE(commitments.delivered,0)+COALESCE(physical.delivered,0))::text AS delivered,
              (COALESCE(commitments.returned,0)+COALESCE(physical.returned,0))::text AS returned,
              (COALESCE(commitments.lost,0)+COALESCE(physical.lost,0))::text AS lost,
              (b.on_hand<>COALESCE(movements.posted_movements,0) OR
               b.reserved<>COALESCE(movements.posted_reserved_movements,0)) AS balance_mismatch,
              COALESCE(commitments.counter_mismatch,false) AS commitment_counter_mismatch
         FROM stock_balance b
         JOIN item i ON i.id=b.item_id
         JOIN unit ON unit.code=i.unit_code
         LEFT JOIN LATERAL (
           SELECT SUM(m.delta_on_hand) AS posted_movements,
                  SUM(m.delta_reserved) AS posted_reserved_movements,
                  SUM(m.delta_on_hand) FILTER (WHERE m.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')) AS intake_accepted
             FROM stock_movement m WHERE m.balance_id=b.id
         ) movements ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(line.in_transit_quantity) AS issued_in_transit,
                  SUM(line.at_point_quantity) AS at_point
             FROM distribution_line line
            WHERE line.warehouse_id=b.warehouse_id AND line.item_id=b.item_id
         ) custody ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(cm.delivered_quantity) AS delivered,
                  SUM(cm.returned_quantity) AS returned,
                  SUM(cm.lost_quantity) AS lost,
                  BOOL_OR(
                    cm.delivered_quantity<>COALESCE(settlements.delivered,0) OR
                    cm.returned_quantity<>COALESCE(settlements.returned,0) OR
                    cm.lost_quantity<>COALESCE(settlements.lost,0)
                  ) AS counter_mismatch
             FROM commitment cm
             LEFT JOIN LATERAL (
               SELECT SUM(hl.quantity) FILTER (WHERE ils.settlement_type='DELIVERED') AS delivered,
                      SUM(hl.quantity) FILTER (WHERE ils.settlement_type='RETURNED') AS returned,
                      SUM(hl.quantity) FILTER (WHERE ils.settlement_type='LOST') AS lost
                 FROM issued_line_settlement ils
                 JOIN handoff_line hl ON hl.id=ils.handoff_line_id
                WHERE ils.commitment_id=cm.id
             ) settlements ON TRUE
            WHERE cm.warehouse_id=b.warehouse_id AND cm.item_id=b.item_id
         ) commitments ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(hl.quantity) FILTER (
                    WHERE dl.commitment_id IS NULL AND (
                      (d.relief_point_id IS NULL AND hr.handoff_kind='DIRECT_HOUSEHOLD') OR
                      (d.relief_point_id IS NOT NULL AND hr.handoff_kind='HOUSEHOLD_HANDOUT')
                    )
                  ) AS delivered,
                  SUM(hl.quantity) FILTER (
                    WHERE hr.handoff_kind='RETURN' AND NOT EXISTS (
                      SELECT 1 FROM issued_line_settlement ils WHERE ils.handoff_line_id=hl.id
                    )
                  ) AS returned,
                  SUM(hl.quantity) FILTER (
                    WHERE hr.handoff_kind='LOSS' AND loss_review.decision='APPROVE' AND NOT EXISTS (
                      SELECT 1 FROM issued_line_settlement ils WHERE ils.handoff_line_id=hl.id
                    )
                  ) AS lost
             FROM handoff_line hl
             JOIN handoff_record hr ON hr.id=hl.handoff_id
             JOIN distribution_line dl ON dl.id=hl.distribution_line_id
             JOIN distribution d ON d.id=dl.distribution_id
             LEFT JOIN handoff_loss_review loss_review ON loss_review.handoff_id=hr.id
            WHERE dl.warehouse_id=b.warehouse_id AND dl.item_id=b.item_id
         ) physical ON TRUE
        WHERE b.warehouse_id=$1::uuid
        ORDER BY b.id ASC LIMIT 101`,
      [warehouse.id],
    );
    if (reconciliationOracle.rows.length === 0) {
      console.log('SKIP TC-REC-01 populated main-API evidence pending: no stock_balance rows in the primary logistics database; verified the empty reconciliation page.');
      assert.deepEqual(reconciliation.value.items, []);
      assert.equal(reconciliation.value.more, false);
    } else {
      const expectedReconciliationItems = reconciliationOracle.rows.slice(0, 100).map((row) => ({
        item: { id: row.item_id, name: row.item_name },
        unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
        intake_accepted: row.intake_accepted,
        posted_movements: row.posted_movements,
        posted_reserved_movements: row.posted_reserved_movements,
        reserved: row.reserved,
        issued_in_transit: row.issued_in_transit,
        at_point: row.at_point,
        delivered: row.delivered,
        returned: row.returned,
        lost: row.lost,
        flags: {
          balance_mismatch: row.balance_mismatch,
          commitment_counter_mismatch: row.commitment_counter_mismatch,
        },
      }));
      assert.deepEqual(reconciliation.value.items, expectedReconciliationItems);
      assert.equal(reconciliation.value.more, reconciliationOracle.rows.length > 100);
    }

    const now = new Date();
    const to = now.toISOString();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const fulfillment = await call(
      logisticsUrl,
      `reports/fulfillment?region_code=${encodeURIComponent(warehouse.region_code)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=5`,
      { actor },
    );
    expectSuccess(fulfillment);
    assert.equal(typeof fulfillment.value.generated_at, 'string');
    for (const need of fulfillment.value.items) {
      for (const key of ['original', 'reduced', 'cancelled_remaining', 'active_requested', 'delivered', 'active_outstanding']) {
        assert.equal(typeof need[key], 'string');
      }
    }

    const publicSummaryPath = `public/donation-reports/summary?warehouse_id=${warehouse.id}&limit=5`;
    const publicSummary = await call(logisticsUrl, publicSummaryPath);
    expectSuccess(publicSummary);
    const cachedSummary = await call(logisticsUrl, publicSummaryPath);
    expectSuccess(cachedSummary);
    assert.equal(cachedSummary.value.generated_at, publicSummary.value.generated_at);
    for (const row of publicSummary.value.items) {
      assert.equal(typeof row.distributed, 'string');
      assert.equal(Object.hasOwn(row, 'donor_name'), false);
      assert.equal(Object.hasOwn(row, 'donor_phone'), false);
    }

    const driveSummary = await call(logisticsUrl, `public/donation-reports/summary?drive_id=${randomUUID()}&limit=5`);
    expectSuccess(driveSummary);
    assert.equal(driveSummary.value.view, 'DRIVE_ACCEPTED');
    const campaignSummary = await call(logisticsUrl, `public/donation-reports/summary?campaign_id=${randomUUID()}&limit=5`);
    expectSuccess(campaignSummary);
    assert.equal(campaignSummary.value.view, 'CAMPAIGN_DISTRIBUTED');

    const invalidWindow = await call(
      logisticsUrl,
      `reports/fulfillment?region_code=${encodeURIComponent(warehouse.region_code)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(now.getTime() + 367 * 24 * 60 * 60 * 1_000).toISOString())}`,
      { actor },
    );
    expectVietnameseError(invalidWindow, 400, 'VALIDATION_FAILED');

    const unknownFilter = await call(logisticsUrl, `reports/stock-summary?unexpected=${randomUUID()}`, { actor });
    expectVietnameseError(unknownFilter, 400, 'VALIDATION_FAILED');

    const invalidView = await call(logisticsUrl, `public/donation-reports/summary?warehouse_id=${warehouse.id}&drive_id=${randomUUID()}`);
    expectVietnameseError(invalidView, 400, 'VALIDATION_FAILED');
  } finally {
    try {
      if (createdWarehouseId) await logisticsDb.query('DELETE FROM warehouse WHERE id=$1', [createdWarehouseId]);
    } finally {
      try {
        await cleanupT17TestUsers(identityDb, cleanupUserIds);
      } finally {
        await Promise.all([logisticsDb.end(), identityDb.end()]);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
