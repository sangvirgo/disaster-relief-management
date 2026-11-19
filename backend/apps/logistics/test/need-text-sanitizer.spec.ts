import { describe, expect, it } from '@jest/globals';
import { RELIEF_TEXT_MAX_LENGTH, sanitizeReliefText } from '../src/need-extraction/need-text-sanitizer';

describe('sanitizeReliefText', () => {
  it('returns an empty string for missing or blank input', () => {
    expect(sanitizeReliefText(null)).toBe('');
    expect(sanitizeReliefText(undefined)).toBe('');
    expect(sanitizeReliefText('')).toBe('');
    expect(sanitizeReliefText('   \n\t  ')).toBe('');
  });

  it('removes a phone number written with separators', () => {
    expect(sanitizeReliefText('Cần nước, gọi 0912 345 678 gấp')).toBe('Cần nước, gọi gấp');
    expect(sanitizeReliefText('Liên hệ +84 912.345.678 hỗ trợ')).toBe('Liên hệ hỗ trợ');
    expect(sanitizeReliefText('số 0901234567')).toBe('số');
  });

  it('removes an e-mail address', () => {
    expect(sanitizeReliefText('Gửi tới nguoi.dan@example.com nhé')).toBe('Gửi tới nhé');
  });

  it('removes a URL', () => {
    expect(sanitizeReliefText('Xem https://example.com/a?b=1 rồi cần mì gói')).toBe('Xem rồi cần mì gói');
    expect(sanitizeReliefText('www.example.vn cần gạo')).toBe('cần gạo');
  });

  it('removes digit runs of six or more digits but keeps short quantities', () => {
    expect(sanitizeReliefText('Cần 2 thùng nước cho 123456 người')).toBe('Cần 2 thùng nước cho người');
    expect(sanitizeReliefText('Cần 3 thùng nước cho 12345 người')).toBe('Cần 3 thùng nước cho 12345 người');
  });

  it('normalizes to NFC and collapses whitespace', () => {
    const decomposed = 'Cần mì gói   và\n\nnước';
    expect(sanitizeReliefText(decomposed)).toBe('Cần mì gói và nước');
  });

  it('truncates to 500 characters', () => {
    const long = 'a'.repeat(900);
    expect([...sanitizeReliefText(long)]).toHaveLength(RELIEF_TEXT_MAX_LENGTH);
  });

  it('keeps Vietnamese text and item names intact', () => {
    expect(sanitizeReliefText('Cần nước uống và mì tôm cho gia đình')).toBe('Cần nước uống và mì tôm cho gia đình');
  });
});
