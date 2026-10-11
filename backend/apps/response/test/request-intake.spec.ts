import { AppError } from '../../../packages/technical/src/errors';
import { plainToInstance } from 'class-transformer';
import { RequestLocationDto } from '../src/requests/request-intake.dto';
import { generateTrackingCode, normalizeReporterPhone, validatePoint } from '../src/requests/request-intake.service';

describe('Response SELF intake validation helpers', () => {
  it('generates public Crockford codes with at least 40 random bits', () => {
    const codes = Array.from({ length: 1_000 }, generateTrackingCode);
    expect(codes.every((code) => /^[0-9A-HJKMNP-TV-Z]{10}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('normalizes punctuation in supplied phones and rejects malformed values', () => {
    expect(normalizeReporterPhone(' (0912) 345-678 ')).toBe('0912345678');
    expect(normalizeReporterPhone('+84 912-345-678')).toBe('+84912345678');
    expect(() => normalizeReporterPhone('phone')).toThrow(AppError);
    try {
      normalizeReporterPhone('phone');
    } catch (error) {
      expect((error as AppError).fieldErrors?.reporter_contact_phone).toContain('PHONE_INVALID');
    }
  });

  it('rejects out-of-range coordinates without rounding them into range', () => {
    expect(() => validatePoint([181, 10])).toThrow(AppError);
    expect(() => validatePoint([106.7, 90.1])).toThrow(AppError);
    expect(() => validatePoint([106.7, 10.77])).not.toThrow();
  });

  it('preserves whether manual-pin accuracy was omitted through DTO transformation', () => {
    const location = { type: 'Point', coordinates: [108, 12], source: 'MANUAL_PIN' };
    expect(Object.hasOwn(plainToInstance(RequestLocationDto, location), 'accuracy_m')).toBe(false);
    expect(Object.hasOwn(plainToInstance(RequestLocationDto, { ...location, accuracy_m: null }), 'accuracy_m')).toBe(true);
  });
});
