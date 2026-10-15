import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hasPermission, Permission, Grant } from '../../../../packages/technical/src/security/permissions';

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
export type CampaignAction = 'activate' | 'pause' | 'resume' | 'close';

export interface CampaignRow extends Record<string, unknown> {
  id: string;
  organization_id: string;
  region_code: string | null;
  name: string;
  objective: string | null;
  status: CampaignStatus;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  version: number | string;
  created_at: Date | string;
  cursor_created_at?: string;
}

export function campaignView(row: CampaignRow): Record<string, unknown> {
  return {
    id: row.id,
    organization_id: row.organization_id,
    region_code: row.region_code,
    name: row.name,
    objective: row.objective,
    status: row.status,
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    version: Number(row.version),
    created_at: iso(row.created_at),
  };
}

export function publicCampaignView(row: CampaignRow, regionName: string | null): Record<string, unknown> {
  return {
    id: row.id,
    title: row.name,
    objective: row.objective,
    region_name: regionName,
    starts_at: iso(row.starts_at),
    ends_at: iso(row.ends_at),
    status: row.status,
  };
}

export function campaignNextStatus(status: CampaignStatus, action: CampaignAction): CampaignStatus {
  const transitions: Record<CampaignAction, Partial<Record<CampaignStatus, CampaignStatus>>> = {
    activate: { DRAFT: 'ACTIVE' },
    pause: { ACTIVE: 'PAUSED' },
    resume: { PAUSED: 'ACTIVE' },
    close: { DRAFT: 'CLOSED', ACTIVE: 'CLOSED', PAUSED: 'CLOSED' },
  };
  const target = transitions[action][status];
  if (!target) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  return target;
}

export function campaignScopePredicate(grants: readonly Grant[], permission: Permission, values: unknown[]): string {
  const branches = new Set<string>();
  for (const grant of grants) {
    const organizationId = grant.organization_id;
    if (!organizationId) continue;
    if (grant.scope_type === 'ORGANIZATION' && hasPermission([grant], permission, { organizationId })) {
      values.push(organizationId);
      branches.add(`organization_id = $${values.length}`);
    } else if (grant.scope_type === 'REGION' && grant.region_code && hasPermission([grant], permission, {
      organizationId, regionCode: grant.region_code,
    })) {
      values.push(organizationId, grant.region_code);
      branches.add(`(organization_id = $${values.length - 1} AND region_code = $${values.length})`);
    } else if (grant.scope_type === 'CAMPAIGN' && grant.campaign_id && hasPermission([grant], permission, {
      organizationId, campaignId: grant.campaign_id,
    })) {
      values.push(organizationId, grant.campaign_id);
      branches.add(`(organization_id = $${values.length - 1} AND id = $${values.length})`);
    }
  }
  return branches.size ? `(${[...branches].join(' OR ')})` : 'FALSE';
}

export function cleanCampaignName(value: string): string {
  if (!value.trim() || value !== value.normalize('NFC')) {
    throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { name: ['VALIDATION_FAILED'] } });
  }
  return value;
}

export function validateCampaignDates(startsAt: Date | string | null | undefined, endsAt: Date | string | null | undefined): void {
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { ends_at: ['VALIDATION_FAILED'] } });
  }
}

export function validCampaignCursor(sort: unknown[], id: string): sort is [string] {
  return sort.length === 1 && typeof sort[0] === 'string' && Number.isFinite(Date.parse(sort[0])) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
