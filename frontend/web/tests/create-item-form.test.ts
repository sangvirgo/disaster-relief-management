import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAliasText } from '../src/features/catalog/itemAliasModel.ts';

test('alias text splits on lines and commas and drops blanks and duplicates', () => {
  assert.deepEqual(parseAliasText('nước lọc, Nước suối\n\nnước lọc;nước đóng chai'), ['nước lọc', 'Nước suối', 'nước đóng chai']);
  assert.deepEqual(parseAliasText('  \n , '), []);
});
