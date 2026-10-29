import { AppError } from '@c48/technical/errors/errors';

export interface TeamRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  operating_region_code: string;
  name: string;
  team_kind: 'VOLUNTEER' | 'MILITARY' | 'GOVERNMENT' | 'OTHER';
  reporting_mode: 'APP' | 'COORDINATOR';
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  status: 'ACTIVE' | 'INACTIVE';
  readiness_required: boolean;
  version: number;
  created_at: Date | string;
  cursor_id?: string;
  skills: string[] | null;
  position_age_s: number | null;
  position_accuracy_m: string | number | null;
  position_source: 'GPS' | 'MANUAL_PIN' | 'COORDINATOR_REPORTED' | null;
  longitude: number | null;
  latitude: number | null;
}

export function teamView(row: TeamRow, includeCoordinates = false): Record<string, unknown> {
  const position = row.position_source === null ? null : {
    age_s: Number(row.position_age_s),
    accuracy_m: row.position_accuracy_m === null ? null : Number(row.position_accuracy_m),
    source: row.position_source,
    ...(includeCoordinates && row.longitude !== null && row.latitude !== null
      ? { location: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] } }
      : {}),
  };
  return {
    id: row.id,
    name: row.name,
    kind: row.team_kind,
    reporting_mode: row.reporting_mode,
    availability: row.availability,
    status: row.status,
    skills: row.skills ?? [],
    position,
    version: Number(row.version),
  };
}

export function validateExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: actual } });
  }
}
