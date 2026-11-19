// Pure alias rules for catalog items. Mirrors backend cleanItemAliases: at most 20 aliases, each 1..60 characters
// after trimming and NFC normalization, no exact duplicates. No React imports (tests load this file directly).

export const ALIAS_MAX_COUNT = 20;
export const ALIAS_MAX_LENGTH = 60;

/** Trims and NFC-normalizes one alias, as the backend does before it stores or compares it. */
export function normalizeAlias(value: string): string {
  return value.trim().normalize('NFC');
}

/** Length counts Unicode code points, the same way the backend counts them. */
export function aliasLength(value: string): number {
  return [...value].length;
}

export interface AliasAddResult {
  aliases: string[];
  error: string | null;
}

/** Adds one alias to the draft list. Returns the list unchanged with a Vietnamese error when the alias is not allowed. */
export function addAlias(aliases: readonly string[], candidate: string): AliasAddResult {
  const value = normalizeAlias(candidate);
  if (!value) return { aliases: [...aliases], error: 'Hãy nhập từ khóa trước khi thêm.' };
  if (aliasLength(value) > ALIAS_MAX_LENGTH) {
    return { aliases: [...aliases], error: `Từ khóa không được vượt quá ${ALIAS_MAX_LENGTH} ký tự.` };
  }
  if (aliases.includes(value)) return { aliases: [...aliases], error: 'Từ khóa này đã có trong danh sách.' };
  if (aliases.length >= ALIAS_MAX_COUNT) {
    return { aliases: [...aliases], error: `Mỗi vật phẩm có tối đa ${ALIAS_MAX_COUNT} từ khóa.` };
  }
  return { aliases: [...aliases, value], error: null };
}

export function removeAlias(aliases: readonly string[], alias: string): string[] {
  return aliases.filter((entry) => entry !== alias);
}

/** Checks a whole list before it is sent. Returns a Vietnamese message, or null when the list is valid. */
export function validateAliasList(aliases: readonly string[]): string | null {
  if (aliases.length > ALIAS_MAX_COUNT) return `Mỗi vật phẩm có tối đa ${ALIAS_MAX_COUNT} từ khóa.`;
  for (const alias of aliases) {
    const length = aliasLength(alias);
    if (length < 1 || length > ALIAS_MAX_LENGTH) return `Mỗi từ khóa phải có từ 1 đến ${ALIAS_MAX_LENGTH} ký tự.`;
  }
  return null;
}

/** True when the saved list and the draft differ (order matters for display, so it is compared in order). */
export function aliasListChanged(saved: readonly string[], draft: readonly string[]): boolean {
  return saved.length !== draft.length || saved.some((alias, index) => alias !== draft[index]);
}

/** Splits the aliases textarea (one per line or comma-separated) into a clean, de-duplicated list. */
export function parseAliasText(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of text.split(/[\n,;]/u)) {
    const alias = normalizeAlias(part);
    if (!alias || seen.has(alias.toLocaleLowerCase('vi-VN'))) continue;
    seen.add(alias.toLocaleLowerCase('vi-VN'));
    result.push(alias);
  }
  return result;
}
