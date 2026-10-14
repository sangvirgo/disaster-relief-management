import assert from 'node:assert/strict';
import test from 'node:test';
import { seedMode } from '../db/seed-mode.mjs';

test('runs the full seed when all application databases are empty', () => {
  assert.equal(seedMode(false), 'full');
});

test('runs the additive campaign seed when application data already exists', () => {
  assert.equal(seedMode(true), 'campaigns');
});
