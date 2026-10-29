import { toIso } from '../operations/request-operations.helpers';
import type { ReporterRequestRow } from './reporter-access.service';
import type { SupplementRequestDto } from './tracking.dto';

export interface SqlAssignments {
  sets: string[];
  values: unknown[];
}

/** The reporter's earlier answers for exactly the fields this supplement touches, kept in the event payload. */
export function previouslyReportedFacts(
  dto: SupplementRequestDto, row: ReporterRequestRow, before: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.keys(dto).filter((field) => field !== 'expected_version').map((field) => {
    if (field === 'description') return [field, row.description];
    if (field === 'reporter_declared_danger') return [field, row.reporter_declared_danger];
    if (field === 'needs_rescue') return [field, row.needs_rescue];
    if (field === 'needs_relief_supplies') return [field, row.needs_relief_supplies];
    if (field === 'location') return [field, {
      coordinates: [before.longitude, before.latitude],
      source: before.location_source,
      accuracy_m: before.location_accuracy_m,
      captured_at: before.location_captured_at == null ? null : toIso(before.location_captured_at as Date | string),
    }];
    return [field, before[field] ?? null];
  }));
}

/**
 * Column assignments for `assistance_request` while the request is still unverified.
 * `values` starts with `[requestId, expectedVersion]`, so the first placeholder is `$3`.
 */
export function unverifiedRequestAssignments(
  dto: SupplementRequestDto, mode: 'SUPPLEMENT' | 'PUT', requestId: string, regionCode: string | null,
): SqlAssignments {
  const values: unknown[] = [requestId, dto.expected_version];
  const sets: string[] = [];
  const set = (column: string, value: unknown, cast = '') => {
    values.push(value);
    sets.push(`${column}=$${values.length}${cast}`);
  };
  if (Object.hasOwn(dto, 'description')) set('description', dto.description ?? null, '::text');
  if (Object.hasOwn(dto, 'reporter_declared_danger')) {
    if (mode === 'PUT') set('reporter_declared_danger', dto.reporter_declared_danger, '::boolean');
    else if (dto.reporter_declared_danger) sets.push('reporter_declared_danger=true');
  }
  if (Object.hasOwn(dto, 'needs_rescue')) set('needs_rescue', dto.needs_rescue, '::boolean');
  if (Object.hasOwn(dto, 'needs_relief_supplies')) set('needs_relief_supplies', dto.needs_relief_supplies, '::boolean');
  if (dto.location) set('region_code', regionCode, '::text');
  return { sets, values };
}

/** Column assignments for `request_subject` while the request is still unverified. `values` starts with `[requestId]`. */
export function unverifiedSubjectAssignments(dto: SupplementRequestDto, requestId: string): SqlAssignments {
  const values: unknown[] = [requestId];
  const sets: string[] = [];
  const add = (column: string, value: unknown, cast = '') => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (Object.hasOwn(dto, 'people_affected')) add('people_affected', dto.people_affected ?? null, '::integer');
  if (Object.hasOwn(dto, 'children_count')) add('children_count', dto.children_count ?? null, '::integer');
  if (Object.hasOwn(dto, 'elderly_count')) add('elderly_count', dto.elderly_count ?? null, '::integer');
  if (Object.hasOwn(dto, 'household_reference_note')) add('household_reference_note', dto.household_reference_note ?? null, '::text');
  if (dto.location) {
    const location = dto.location;
    values.push(location.coordinates[0], location.coordinates[1]);
    sets.push(`location = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}),4326)::geography`);
    add('location_source', location.source, '::text');
    add('location_accuracy_m', location.accuracy_m ?? null, '::numeric');
    add('location_captured_at', location.captured_at ?? null, '::timestamptz');
  }
  return { sets, values };
}
