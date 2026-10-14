import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { postgresOptions } from '../../../../packages/technical/src/persistence/postgres-options';
import { IDENTITY_SERVICE_TOKEN_CONFIG, issueServiceToken, ServiceName, ServiceTokenConfig } from '../auth/service-tokens';

interface IntrospectionRow {
  user_id: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  user_authz_version: number;
  family_authz_version: number;
  revoked_at: Date | null;
  absolute_expires_at: Date;
  grant_id: string | null;
  role_code: string | null;
  scope_type: string | null;
  organization_id: string | null;
  region_code: string | null;
  campaign_id: string | null;
}

type TeamLeaderEligibilityReason = 'USER_NOT_FOUND' | 'USER_INACTIVE' | 'MEMBERSHIP_REQUIRED' | 'VOLUNTEER_GRANT_REQUIRED';

type TeamLeaderEligibility = { eligible: true } | { eligible: false; reason: TeamLeaderEligibilityReason };
type ActiveUserCheck = { active: true } | { active: false; reason: 'USER_NOT_FOUND' | 'USER_INACTIVE' };

@Injectable()
export class InternalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InternalService.name);
  private readonly introspectionDataSource: DataSource;

  constructor(@Inject(IDENTITY_SERVICE_TOKEN_CONFIG) private readonly config: ServiceTokenConfig) {
    const options = postgresOptions([], 'identity');
    this.introspectionDataSource = new DataSource({
      ...options,
      extra: { ...options.extra, max: 4, statement_timeout: 500, application_name: 'c48_identity_introspect' },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.introspectionDataSource.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.introspectionDataSource.isInitialized) await this.introspectionDataSource.destroy();
  }

  issueToken(input: { client_id: string; client_secret: string; audience: ServiceName }): { access_token: string; expires_in: 300 } {
    const caller = (Object.keys(this.config.clients) as ServiceName[])
      .find((service) => this.config.clients[service]?.id === input.client_id);
    if (!caller) throw new AppError('UNAUTHENTICATED', { status: 401 });
    return {
      access_token: issueServiceToken(this.config, caller, input.client_secret, input.audience),
      expires_in: 300,
    };
  }

  async introspect(input: { sid: string; sub: string }): Promise<Record<string, unknown>> {
    const rows = await this.introspectionDataSource.query(
      `SELECT sf.user_id, u.display_name, u.status, u.authz_version AS user_authz_version,
              sf.authz_version AS family_authz_version, sf.revoked_at, sf.absolute_expires_at,
              g.id AS grant_id, g.role_code, g.scope_type, g.organization_id, g.region_code, g.campaign_id
         FROM session_family sf JOIN app_user u ON u.id = sf.user_id
         LEFT JOIN role_grant g ON g.user_id = u.id AND g.revoked_at IS NULL
        WHERE sf.id = $1 AND sf.user_id = $2
        ORDER BY g.created_at, g.id`,
      [input.sid, input.sub],
    ) as IntrospectionRow[];
    const first = rows[0];
    if (!first) return { active: false, user_id: input.sub, display_name: null, status: null, authz_version: null, grants: [] };
    const grants = rows.flatMap((row) => row.grant_id ? [{
      id: row.grant_id,
      role_code: row.role_code,
      scope_type: row.scope_type,
      organization_id: row.organization_id,
      region_code: row.region_code,
      campaign_id: row.campaign_id,
    }] : []);
    const active = first.status === 'ACTIVE' && !first.revoked_at &&
      Number(first.user_authz_version) === Number(first.family_authz_version) &&
      new Date(first.absolute_expires_at).getTime() > Date.now();
    return {
      active,
      user_id: first.user_id,
      display_name: first.display_name,
      status: first.status,
      authz_version: Number(first.user_authz_version),
      grants,
    };
  }

  async lookupUsers(ids: string[]): Promise<{ items: Array<{ id: string; display_name: string }> }> {
    this.logger.log(`IDENTITY_USERS_LOOKUP count=${ids.length}`);
    const items = await this.introspectionDataSource.query(
      'SELECT id, display_name FROM app_user WHERE id = ANY($1::uuid[]) ORDER BY id',
      [ids],
    ) as Array<{ id: string; display_name: string }>;
    return { items };
  }

  async activeUserCheck(userId: string): Promise<ActiveUserCheck> {
    const rows = await this.introspectionDataSource.query(
      'SELECT status FROM app_user WHERE id = $1',
      [userId],
    ) as Array<{ status: string }>;
    if (!rows[0]) return { active: false, reason: 'USER_NOT_FOUND' };
    return rows[0].status === 'ACTIVE' ? { active: true } : { active: false, reason: 'USER_INACTIVE' };
  }

  async lookupRegions(codes: string[]): Promise<{ items: Array<{ code: string; name: string }> }> {
    const items = await this.introspectionDataSource.query(
      'SELECT code, name FROM region WHERE code = ANY($1::text[]) ORDER BY code',
      [codes],
    ) as Array<{ code: string; name: string }>;
    return { items };
  }

  async teamLeaderEligibility(userId: string, organizationId: string): Promise<TeamLeaderEligibility> {
    const rows = await this.introspectionDataSource.query(
      `SELECT CASE
                WHEN u.id IS NULL THEN 'USER_NOT_FOUND'
                WHEN u.status <> 'ACTIVE' THEN 'USER_INACTIVE'
                WHEN o.id IS NULL OR m.user_id IS NULL THEN 'MEMBERSHIP_REQUIRED'
                WHEN NOT EXISTS (
                  SELECT 1 FROM role_grant g
                   WHERE g.user_id = u.id AND g.role_code = 'VOLUNTEER' AND g.revoked_at IS NULL
                     AND ((g.scope_type = 'SYSTEM' AND g.organization_id IS NULL AND g.region_code IS NULL AND g.campaign_id IS NULL)
                       OR (g.scope_type = 'ORGANIZATION' AND g.organization_id = o.id AND g.region_code IS NULL AND g.campaign_id IS NULL))
                ) THEN 'VOLUNTEER_GRANT_REQUIRED'
                ELSE NULL
              END AS reason
         FROM (SELECT $1::uuid AS user_id, $2::uuid AS organization_id) requested
         LEFT JOIN app_user u ON u.id = requested.user_id
         LEFT JOIN organization o ON o.id = requested.organization_id AND o.status = 'ACTIVE'
         LEFT JOIN membership m ON m.user_id = u.id AND m.organization_id = o.id AND m.status = 'ACTIVE'`,
      [userId, organizationId],
    ) as Array<{ reason: TeamLeaderEligibilityReason | null }>;
    const reason = rows[0]?.reason;
    return reason ? { eligible: false, reason } : { eligible: true };
  }

  async requestCoordinators(organizationId: string): Promise<{ items: Array<Record<string, unknown>> }> {
    const items = await this.introspectionDataSource.query(
      `SELECT g.user_id,g.role_code,g.scope_type,g.organization_id,g.region_code,g.campaign_id
         FROM role_grant g JOIN app_user u ON u.id=g.user_id
        WHERE g.organization_id=$1 AND g.revoked_at IS NULL AND u.status='ACTIVE'
          AND (g.role_code='COORDINATOR' OR (g.role_code='OPERATIONS_MANAGER' AND g.scope_type='ORGANIZATION'))
        ORDER BY g.user_id,g.role_code,g.scope_type,g.region_code,g.campaign_id`,
      [organizationId],
    ) as Array<Record<string, unknown>>;
    return { items };
  }

  async organization(id: string): Promise<{ id: string; organization_kind: string; status: string }> {
    const rows = await this.introspectionDataSource.query(
      'SELECT id, organization_kind, status FROM organization WHERE id = $1', [id],
    ) as Array<{ id: string; organization_kind: string; status: string }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }
}
