import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schemaDir = new URL('../../../docs/backend/schema/', import.meta.url);
const proof = readFileSync(new URL('test-logistics.sql', schemaDir), 'utf8');
const helpers = readFileSync(new URL('constraint-tests.sql', schemaDir), 'utf8');

function mutationStatements(source) {
  return source
    .replace(/^[ \t]*--.*(?:\r?\n|$)/gmu, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => /^(?:UPDATE\b|DELETE\s+FROM\b)/iu.test(statement));
}

function assertKeyedMutation(statement) {
  assert.match(statement, /\bWHERE\b/iu, `mutation is scoped: ${statement}`);
  const whereClause = statement.split(/\bWHERE\b/iu).at(-1);
  assert.doesNotMatch(whereClause, /\bOR\b/iu, `mutation WHERE clause must not widen through OR: ${statement}`);
  assert.match(
    statement,
    /\bWHERE\b[\s\S]*?\b(?:id|intent_id|operation_ref|scope_key|recipient_user_id|source_id|receipt_id|delivery_id|item_id|handoff_id|handoff_line_id|reviewer_user_id)\s*=\s*(?:'[^']+'|\d+)/iu,
    `mutation targets a keyed fixture row: ${statement}`,
  );
}

test('mutation parser sees statements after SQL line comments and rejects OR widening', () => {
  const statements = mutationStatements('-- fixture note\nUPDATE stock_balance SET reserved=6 WHERE TRUE OR id=\'fixture\';');

  assert.deepEqual(statements, ["UPDATE stock_balance SET reserved=6 WHERE TRUE OR id='fixture'"]);
  assert.throws(() => assertKeyedMutation(statements[0]), /mutation WHERE clause must not widen through OR/u);
});

test('Logistics schema proof writes only to explicitly keyed rows', () => {
  const statements = [
    ...mutationStatements(proof),
    ...[...proof.matchAll(/\$\$([\s\S]*?)\$\$/gu)].flatMap(([, sql]) => mutationStatements(sql)),
  ];

  assert.ok(statements.length > 0, 'schema proof contains mutation assertions');
  statements.forEach(assertKeyedMutation);

  assert.match(proof, /UPDATE stock_adjustment SET status='APPROVED',[\s\S]*?WHERE id='00000000-0000-0000-0000-000000000aa1'/u);
  assert.match(proof, /DELETE FROM idempotency_record WHERE scope_key='s' AND command='c' AND idempotency_key='00000000-0000-0000-0000-0000000000f9'/u);
  assert.match(proof, /DELETE FROM notice WHERE recipient_user_id='00000000-0000-0000-0000-0000000000f8' AND source_id='00000000-0000-0000-0000-0000000000f7' AND source_version=1 AND notice_type='T'/u);
});

test('schema proof has no transaction escape and privilege probes use rollback helpers', () => {
  assert.doesNotMatch(proof, /^\s*(?:COMMIT\b|\\connect\b)/imu);
  assert.match(helpers, /CREATE OR REPLACE FUNCTION expect_sqlstate[\s\S]*?\nBEGIN\n  BEGIN EXECUTE stmt; RAISE EXCEPTION[\s\S]*?\n  EXCEPTION WHEN OTHERS THEN[\s\S]*?\n  END;\nEND \$\$;/u);

  const truncates = [...proof.matchAll(/\$\$(TRUNCATE\b[^$]*)\$\$/giu)].map(([, sql]) => sql.trim());
  const truncateChecks = [...proof.matchAll(/SELECT\s+(expect_fail|expect_sqlstate)\('([^']+)'[^;]*?\$\$(TRUNCATE\b[^$]*)\$\$/giu)];
  assert.ok(truncates.length > 0, 'the schema proof still checks TRUNCATE restrictions');
  assert.equal(truncateChecks.length, truncates.length, 'every TRUNCATE is wrapped by an expected-error helper');
  for (const [, helper, label, statement] of truncateChecks) {
    assert.match(statement, /^TRUNCATE\b/iu, `TRUNCATE runs as one guarded statement: ${statement}`);
    assert.equal(helper, label.startsWith('app:') ? 'expect_sqlstate' : 'expect_fail', `${label} uses the rollback helper`);
  }
  assert.doesNotMatch(proof, /^\s*TRUNCATE\b/imu, 'no unguarded top-level TRUNCATE');
});
