import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALIAS_MAX_COUNT,
  ALIAS_MAX_LENGTH,
  addAlias,
  aliasListChanged,
  aliasLength,
  normalizeAlias,
  removeAlias,
  validateAliasList,
} from '../src/features/catalog/itemAliasModel.ts';

test('aliases are trimmed and NFC-normalized before they are compared or stored', () => {
  assert.equal(normalizeAlias('  mì tôm  '), 'mì tôm');
  // Decomposed "ì" (i + combining grave) becomes the composed character.
  assert.equal(normalizeAlias('mì gói'), 'mì gói');
  const result = addAlias([], '  mì gói ');
  assert.deepEqual(result, { aliases: ['mì gói'], error: null });
});

test('an empty alias or one longer than 60 characters is refused in Vietnamese', () => {
  assert.equal(addAlias([], '   ').error, 'Hãy nhập từ khóa trước khi thêm.');
  const atLimit = 'a'.repeat(ALIAS_MAX_LENGTH);
  assert.equal(addAlias([], atLimit).error, null);
  const over = addAlias([], `${atLimit}b`);
  assert.equal(over.error, 'Từ khóa không được vượt quá 60 ký tự.');
  assert.deepEqual(over.aliases, []);
});

test('length counts code points, so Vietnamese letters count once', () => {
  assert.equal(aliasLength('mì tôm'), 6);
  assert.equal(aliasLength('😀'), 1);
});

test('duplicates are refused and the list holds at most 20 aliases', () => {
  const first = addAlias([], 'mì tôm').aliases;
  assert.equal(addAlias(first, 'mì tôm').error, 'Từ khóa này đã có trong danh sách.');
  const full = Array.from({ length: ALIAS_MAX_COUNT }, (_, index) => `từ khóa ${index}`);
  const refused = addAlias(full, 'thêm một');
  assert.equal(refused.error, 'Mỗi vật phẩm có tối đa 20 từ khóa.');
  assert.equal(refused.aliases.length, ALIAS_MAX_COUNT);
});

test('validateAliasList accepts the limits and rejects anything outside them', () => {
  assert.equal(validateAliasList([]), null);
  assert.equal(validateAliasList(['a'.repeat(60)]), null);
  assert.equal(validateAliasList(['a'.repeat(61)]), 'Mỗi từ khóa phải có từ 1 đến 60 ký tự.');
  assert.equal(validateAliasList(['']), 'Mỗi từ khóa phải có từ 1 đến 60 ký tự.');
  assert.equal(validateAliasList(Array.from({ length: 21 }, (_, index) => `t${index}`)), 'Mỗi vật phẩm có tối đa 20 từ khóa.');
});

test('removing an alias and detecting a change are exact', () => {
  assert.deepEqual(removeAlias(['mì tôm', 'mì gói'], 'mì tôm'), ['mì gói']);
  assert.equal(aliasListChanged(['mì tôm'], ['mì tôm']), false);
  assert.equal(aliasListChanged(['mì tôm'], []), true);
  assert.equal(aliasListChanged(['a', 'b'], ['b', 'a']), true);
});
