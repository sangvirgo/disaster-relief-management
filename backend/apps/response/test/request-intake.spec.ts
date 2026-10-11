import { AppError } from '../../../packages/technical/src/errors/errors';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProxyRequestDto, RequestLocationDto } from '../src/requests/request-intake.dto';
import { generateTrackingCode, normalizeReporterPhone, validatePoint, validateProxyRequest } from '../src/requests/request-intake.service';

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

  it('requires proxy provenance while leaving the affected person accountless and contact optional', async () => {
    const value = {
      incident_category_code: 'FLOOD',
      location: { type: 'Point', coordinates: [108, 12], source: 'MANUAL_PIN' },
      relationship: 'Hàng xóm',
      information_source: 'Người dân báo tin',
      last_known_situation_at: '2026-10-11T08:30:00Z',
      contactability: 'UNKNOWN',
    };
    const dto = plainToInstance(CreateProxyRequestDto, value);
    expect(await validate(dto)).toHaveLength(0);
    expect(() => validateProxyRequest(dto)).not.toThrow();

    const missing = plainToInstance(CreateProxyRequestDto, { ...value, relationship: undefined, contactability: undefined });
    const fields = (await validate(missing)).map((error) => error.property);
    expect(fields).toContain('relationship');
    expect(fields).toContain('contactability');

    const timezoneMissing = plainToInstance(CreateProxyRequestDto, {
      ...value,
      last_known_situation_at: '2026-10-11T08:30:00',
    });
    expect((await validate(timezoneMissing)).map((error) => error.property)).toContain('last_known_situation_at');
    expect(() => validateProxyRequest(timezoneMissing)).toThrow(AppError);

    const impossibleDate = plainToInstance(CreateProxyRequestDto, {
      ...value,
      last_known_situation_at: '2026-02-30T08:30:00Z',
    });
    expect((await validate(impossibleDate)).map((error) => error.property)).toContain('last_known_situation_at');
    expect(() => validateProxyRequest(impossibleDate)).toThrow(AppError);
  });
});
