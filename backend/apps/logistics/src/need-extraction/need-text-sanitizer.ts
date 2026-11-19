// Removes personal data from the citizen's relief text before it leaves Logistics (Gemini prompt) or is logged.
// Pure function; the caller already holds the text only for the duration of one sweep item.

export const RELIEF_TEXT_MAX_LENGTH = 500;

const urlPattern = /(?:https?:\/\/|www\.)\S+/giu;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
// Vietnamese mobile and landline numbers: 0xxxxxxxxx or +84xxxxxxxxx, with optional spaces, dots or brackets.
const phonePattern = /(?<![\p{N}])(?:\+?84|0)(?:[\s.()-]*\p{N}){8,10}(?![\p{N}])/gu;
const digitRunPattern = /\p{N}{6,}/gu;

/**
 * Returns the text with phone numbers, e-mail addresses, URLs and digit runs of six or more digits replaced by spaces,
 * NFC-normalized, whitespace collapsed and truncated to 500 characters (code points). Empty input gives an empty string.
 */
export function sanitizeReliefText(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  const cleaned = value
    .normalize('NFC')
    .replace(urlPattern, ' ')
    .replace(emailPattern, ' ')
    .replace(phonePattern, ' ')
    .replace(digitRunPattern, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return [...cleaned].slice(0, RELIEF_TEXT_MAX_LENGTH).join('').trim();
}
