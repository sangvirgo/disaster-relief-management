import { AppError } from '@c48/technical/errors/errors';
import type { SupplementRequestDto } from './tracking.dto';

export function supplementAllowed(status: string, reviewLane: string): boolean {
  return reviewLane === 'NORMAL' && ['SUBMITTED', 'VERIFYING', 'VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(status);
}

export function invalidField(field: string, code: string): AppError {
  return new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { [field]: [code] } });
}

export function validateSupplement(dto: SupplementRequestDto): void {
  const hasValue = ['description', 'household_reference_note', 'people_affected', 'children_count', 'elderly_count', 'location', 'reporter_declared_danger', 'needs_rescue', 'needs_relief_supplies']
    .some((field) => Object.hasOwn(dto, field));
  if (!hasValue) throw invalidField('body', 'VALIDATION_FAILED');
  if (Object.hasOwn(dto, 'description')) {
    if (typeof dto.description !== 'string' || !dto.description.trim() || dto.description !== dto.description.normalize('NFC')) {
      throw invalidField('description', 'VALIDATION_FAILED');
    }
  }
  if (Object.hasOwn(dto, 'household_reference_note')) {
    if (typeof dto.household_reference_note !== 'string' || !dto.household_reference_note.trim() || dto.household_reference_note !== dto.household_reference_note.normalize('NFC')) {
      throw invalidField('household_reference_note', 'VALIDATION_FAILED');
    }
  }
  if (dto.people_affected !== undefined && dto.people_affected !== null && (!Number.isInteger(dto.people_affected) || dto.people_affected < 1 || dto.people_affected > 10_000)) {
    throw invalidField('people_affected', 'PEOPLE_AFFECTED_OUT_OF_RANGE');
  }
  for (const [field, value] of [['children_count', dto.children_count], ['elderly_count', dto.elderly_count]] as const) {
    if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0 || value > 10_000)) throw invalidField(field, 'VULNERABLE_COUNT_OUT_OF_RANGE');
  }
  if (Object.hasOwn(dto, 'location')) {
    const location = dto.location;
    if (!location) throw invalidField('location', 'VALIDATION_FAILED');
    const [longitude, latitude] = location.coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw invalidField('location.coordinates', 'COORDINATES_OUT_OF_RANGE');
    }
    if (location.source === 'GPS' && (location.accuracy_m == null || location.captured_at == null)) {
      throw invalidField('location', 'ACCURACY_REQUIRED');
    }
    if (location.accuracy_m != null && (!Number.isFinite(location.accuracy_m) || location.accuracy_m < 0 || location.accuracy_m > 9_999_999.9)) {
      throw invalidField('location.accuracy_m', 'VALIDATION_FAILED');
    }
    if (location.source === 'MANUAL_PIN' && Object.hasOwn(location, 'accuracy_m')) {
      throw invalidField('location.accuracy_m', 'VALIDATION_FAILED');
    }
  }
  if (Object.hasOwn(dto, 'reporter_declared_danger') && typeof dto.reporter_declared_danger !== 'boolean') {
    throw invalidField('reporter_declared_danger', 'VALIDATION_FAILED');
  }
  if (Object.hasOwn(dto, 'needs_rescue') && typeof dto.needs_rescue !== 'boolean') throw invalidField('needs_rescue', 'VALIDATION_FAILED');
  if (Object.hasOwn(dto, 'needs_relief_supplies') && typeof dto.needs_relief_supplies !== 'boolean') throw invalidField('needs_relief_supplies', 'VALIDATION_FAILED');
  if (dto.needs_rescue === false && dto.needs_relief_supplies === false) throw invalidField('needs_rescue', 'AT_LEAST_ONE_NEED_REQUIRED');
}
