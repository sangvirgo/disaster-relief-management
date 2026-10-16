import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixture = readFileSync(new URL('../../../docs/backend/schema/explain-response.sql', import.meta.url), 'utf8');
const normalizeSql = (value) => value.replace(/\s+/gu, ' ').trim();

function querySql(number) {
  const match = fixture.match(new RegExp(`\\(${number},\\s*'[^']*',\\s*\\$q\\$([\\s\\S]*?)\\$q\\$\\)`));
  assert.ok(match, `T10 EXPLAIN query ${number} exists`);
  return match[1];
}

test('T10 heatmap EXPLAIN fixture includes the bounded confirmed map projection', () => {
  const heatmap = normalizeSql(querySql(2));

  for (const fragment of [
    'r.organization_id=@oid@',
    "r.region_code='R1'",
    'r.campaign_id=@cid@::uuid',
    'r.incident_category_code=@rcat@',
    'r.received_at>=@from@::timestamptz',
    'r.received_at<@to@::timestamptz',
    "r.status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING')",
    'r.canonical_request_id IS NULL',
    'ST_SnapToGrid(ST_Transform(s.location::geometry, 32648), 1000::float8)',
    'ST_AsGeoJSON(ST_ForcePolygonCCW(ST_Transform(ST_MakeEnvelope',
    'ST_AsGeoJSON(ST_Transform(center,4326)) AS center',
    'LIMIT 5001',
  ]) assert.ok(heatmap.includes(normalizeSql(fragment)), `heatmap query includes ${fragment}`);

  const normalizedFixture = normalizeSql(fixture);
  assert.ok(normalizedFixture.includes('FROM generate_series(1,200000)'));
  for (const fragment of [
    'WHEN s.i <= 10000 THEN (SELECT id FROM camp WHERE n=1)',
    "WHEN s.i <= 10000 THEN 'FLOOD'",
    "WHEN s.i <= 10000 THEN 'R1'",
    "WHEN s.i <= 10000 THEN '00000000-0000-0000-0000-0000000000d1'::uuid",
    "WHEN s.i <= 10000 THEN now() - (s.i % 30 + 1)*interval '1 day'",
    "ARRAY['VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING']",
    'INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,decided_at)',
    'Expected 10000 T10 VERIFIED benchmark decisions, found %',
    "SELECT id AS cid FROM camp WHERE n=1 \\gset",
    "('rcat','FLOOD')",
    "('from',(now()-interval '31 days')::text),('to',now()::text)",
  ]) assert.ok(normalizedFixture.includes(normalizeSql(fragment)), `fixture seeds ${fragment}`);
  assert.match(fixture, /Expected 10000 T10 confirmed benchmark requests/u);
});

test('T10 report summary EXPLAIN fixture includes the expected aggregates', () => {
  const summary = normalizeSql(querySql(10));

  for (const fragment of [
    'WITH filtered_requests AS MATERIALIZED',
    'r.organization_id=@oid@',
    "r.region_code='R1'",
    'r.campaign_id=@cid@::uuid',
    'r.received_at>=@from@::timestamptz',
    'r.received_at<@to@::timestamptz',
    "d.outcome='VERIFIED'",
    'first_mission_offer AS',
    'median_verified_seconds',
    'median_offered_seconds',
    'active_missions',
    'overdue_missions',
  ]) assert.ok(summary.includes(normalizeSql(fragment)), `summary query includes ${fragment}`);

  assert.match(fixture, /EXPLAIN \(ANALYZE, BUFFERS, COSTS OFF\)/u);
});

test('T10 clustered heatmap stays under the MapService cell cap and follows its filter order', () => {
  const normalizedFixture = normalizeSql(fixture);
  const heatmap = normalizeSql(querySql(2));
  const orderedPredicates = [
    'r.organization_id=@oid@',
    'r.received_at>=@from@::timestamptz',
    'r.received_at<@to@::timestamptz',
    "r.status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING')",
    'r.canonical_request_id IS NULL',
    "r.region_code='R1'",
    'r.campaign_id=@cid@::uuid',
    'r.incident_category_code=@rcat@',
  ].map((predicate) => heatmap.indexOf(normalizeSql(predicate)));

  assert.ok(normalizedFixture.includes('CASE WHEN i<=10000 THEN 106.1+random()*0.1 ELSE'));
  assert.ok(normalizedFixture.includes('CASE WHEN i<=10000 THEN 10.1+random()*0.1 ELSE'));
  assert.ok(orderedPredicates.every((position) => position >= 0));
  assert.deepEqual(orderedPredicates, [...orderedPredicates].sort((left, right) => left - right));
  assert.ok(normalizedFixture.includes('SELECT sql INTO stmt FROM q WHERE n=2;'));
  assert.ok(normalizedFixture.includes("EXECUTE 'SELECT count(*) FROM ('||stmt||') heatmap_cells' INTO heatmap_cell_count;"));
  assert.ok(normalizedFixture.includes('IF heatmap_cell_count>5000 THEN'));
  assert.ok(normalizedFixture.includes("set_config('statement_timeout','5s',true)"));
});
