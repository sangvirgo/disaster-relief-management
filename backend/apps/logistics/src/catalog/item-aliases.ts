import { AppError } from '@c48/technical/errors/errors';

// Item aliases are alternative names that people type (for example "mì tôm" for "Mì gói"). They feed the AI extraction
// fallback and nothing else: aliases never set a quantity, a stock line or a need. Pure functions, no I/O.

export const ITEM_ALIAS_MAX_COUNT = 20;
export const ITEM_ALIAS_MAX_LENGTH = 60;

const combiningMarks = /[̀-ͯ]/gu;

/**
 * Normalizes text for alias matching: NFD, combining marks removed, đ/Đ mapped to d, lowercase, whitespace collapsed.
 * "Mì tôm" and "mi  tom" normalize to the same value.
 */
export function normalizeAlias(text: string): string {
  return text
    .normalize('NFD')
    .replace(combiningMarks, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'd')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Returns the ids of items whose aliases occur in the text as a whole-word phrase (after normalization).
 * "nuoc" does not match "nuocmam"; "mi tom" matches "cho toi 2 goi mi tom". Each id appears once, in input order.
 */
export function matchAliases(
  text: string,
  items: readonly { id: string; aliases: readonly string[] }[],
): string[] {
  const haystack = ` ${normalizeAlias(text)} `;
  if (haystack.trim() === '') return [];
  const matched: string[] = [];
  for (const item of items) {
    const hit = item.aliases.some((alias) => {
      const needle = normalizeAlias(alias);
      return needle !== '' && haystack.includes(` ${needle} `);
    });
    if (hit) matched.push(item.id);
  }
  return matched;
}

/**
 * Validates and cleans an alias list from a request: at most 20 entries, each 1..60 characters after trimming,
 * NFC-normalized, with exact duplicates removed. Returns the cleaned list; throws VALIDATION_FAILED otherwise.
 */
export function cleanItemAliases(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > ITEM_ALIAS_MAX_COUNT) throw new AppError('VALIDATION_FAILED', { status: 400 });
  const cleaned: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', { status: 400 });
    const trimmed = value.trim().normalize('NFC');
    const length = [...trimmed].length;
    if (length < 1 || length > ITEM_ALIAS_MAX_LENGTH) throw new AppError('VALIDATION_FAILED', { status: 400 });
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed);
  }
  return cleaned;
}
