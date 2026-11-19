import { describe, expect, it } from '@jest/globals';
import {
  cleanItemAliases, ITEM_ALIAS_MAX_COUNT, ITEM_ALIAS_MAX_LENGTH, matchAliases, normalizeAlias,
} from '../src/catalog/item-aliases';

function expectCode(action: () => unknown, code: string, status?: number): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject(status === undefined ? { code } : { code, status });
}

describe('normalizeAlias', () => {
  it('removes Vietnamese diacritics, maps đ to d and lowercases', () => {
    expect(normalizeAlias('Mì tôm')).toBe('mi tom');
    expect(normalizeAlias('Nước suối')).toBe('nuoc suoi');
    expect(normalizeAlias('Thuốc')).toBe('thuoc');
    expect(normalizeAlias('Đèn pin')).toBe('den pin');
    expect(normalizeAlias('ĐÁ')).toBe('da');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeAlias('  nước   uống  ')).toBe('nuoc uong');
    expect(normalizeAlias('mi\ttom')).toBe('mi tom');
  });

  it('gives the same value for typed text with and without diacritics', () => {
    expect(normalizeAlias('mi tom')).toBe(normalizeAlias('Mì tôm'));
    expect(normalizeAlias('nuoc uong')).toBe(normalizeAlias('nước uống'));
    expect(normalizeAlias('thuoc')).toBe(normalizeAlias('thuốc'));
  });

  it('handles decomposed input the same as precomposed input', () => {
    expect(normalizeAlias('Mì tôm')).toBe('mi tom');
  });
});

describe('matchAliases', () => {
  const items = [
    { id: 'noodle', aliases: ['mì tôm', 'mì ăn liền'] },
    { id: 'water', aliases: ['nước suối', 'nước lọc', 'nuoc'] },
    { id: 'medicine', aliases: ['thuốc', 'thuốc men'] },
    { id: 'blanket', aliases: ['chăn'] },
  ];

  it('matches a whole-word phrase typed without diacritics', () => {
    expect(matchAliases('cho toi 2 goi mi tom', items)).toEqual(['noodle']);
    expect(matchAliases('can nuoc uong', items)).toEqual(['water']);
    expect(matchAliases('can thuoc', items)).toEqual(['medicine']);
  });

  it('matches with the original diacritics too', () => {
    expect(matchAliases('Cần Mì tôm và Chăn', items)).toEqual(['noodle', 'blanket']);
  });

  it('does not match a word that only contains the alias', () => {
    expect(matchAliases('nuocmam', items)).toEqual([]);
    expect(matchAliases('thuocla', items)).toEqual([]);
  });

  it('returns each matching item once, in input order, for several aliases of one item', () => {
    expect(matchAliases('thuoc men va thuoc', items)).toEqual(['medicine']);
  });

  it('can return several items when several aliases match', () => {
    expect(matchAliases('nuoc loc, mi tom', items)).toEqual(['noodle', 'water']);
  });

  it('returns nothing for empty text or text with no alias', () => {
    expect(matchAliases('', items)).toEqual([]);
    expect(matchAliases('   ', items)).toEqual([]);
    expect(matchAliases('xe tai', items)).toEqual([]);
  });

  it('ignores empty aliases', () => {
    expect(matchAliases('abc', [{ id: 'x', aliases: ['  '] }])).toEqual([]);
  });
});

describe('cleanItemAliases', () => {
  it('trims, NFC-normalizes and removes exact duplicates', () => {
    expect(cleanItemAliases([' mì tôm ', 'mì tôm', 'nước lọc'].map((value) => value)))
      .toEqual(['mì tôm', 'nước lọc']);
  });

  it('accepts an empty list', () => {
    expect(cleanItemAliases([])).toEqual([]);
  });

  it('rejects more than 20 aliases', () => {
    const many = Array.from({ length: ITEM_ALIAS_MAX_COUNT + 1 }, (_value, index) => `alias ${index}`);
    expectCode(() => cleanItemAliases(many), 'VALIDATION_FAILED', 400);
  });

  it('rejects an empty or whitespace-only alias', () => {
    expectCode(() => cleanItemAliases(['   ']), 'VALIDATION_FAILED');
    expectCode(() => cleanItemAliases(['']), 'VALIDATION_FAILED');
  });

  it('rejects an alias longer than 60 characters and accepts exactly 60', () => {
    expect(cleanItemAliases(['a'.repeat(ITEM_ALIAS_MAX_LENGTH)])).toEqual(['a'.repeat(ITEM_ALIAS_MAX_LENGTH)]);
    expectCode(() => cleanItemAliases(['a'.repeat(ITEM_ALIAS_MAX_LENGTH + 1)]), 'VALIDATION_FAILED');
  });

  it('rejects non-array input and non-string entries', () => {
    expectCode(() => cleanItemAliases('mì tôm'), 'VALIDATION_FAILED');
    expectCode(() => cleanItemAliases([42]), 'VALIDATION_FAILED');
  });
});
