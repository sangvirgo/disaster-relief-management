import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { hasPermission, Permission, Grant } from '../../../../packages/technical/src/permissions';
import { AppError } from '../../../../packages/technical/src/errors';
import { IDENTITY_SERVICE_TOKEN_CONFIG, ServiceTokenConfig, ServiceTokenClaims, verifyServiceToken } from '../auth/service-tokens';
import { AuthContext } from '../auth/auth.guard';
import { getCorrelationId } from '../../../../packages/technical/src/correlation';

export const IDENTITY_PERMISSION = 'identity.permission';
export const RequireIdentityPermission = (permission: Permission) => SetMetadata(IDENTITY_PERMISSION, permission);

export interface AdminRequest extends Request {
  auth?: AuthContext;
  serviceCaller?: ServiceTokenClaims['sub'];
  idempotencyKey?: string;
}

@Injectable()
export class IdentityPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission>(IDENTITY_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!permission) return true;
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!request.auth) throw new AppError('UNAUTHENTICATED', { status: 401 });
    const grants = await this.dataSource.query(
      `SELECT role_code, scope_type, organization_id, region_code, campaign_id
         FROM role_grant WHERE user_id = $1 AND revoked_at IS NULL`,
      [request.auth.userId],
    ) as Grant[];
    if (!hasPermission(grants, permission, { systemAction: permission })) throw new AppError('FORBIDDEN', { status: 403 });
    return true;
  }
}

@Injectable()
export class IdentityServiceGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_SERVICE_TOKEN_CONFIG) private readonly config: ServiceTokenConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED', { status: 401 });
    const claims = verifyServiceToken(token, this.config, 'identity', ['response', 'logistics']);
    request.serviceCaller = claims.sub;
    return true;
  }
}

@Injectable()
export class IdentityAdminSupport {
  async audit(
    manager: Pick<EntityManager, 'query'>,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reason: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before_state, after_state, reason, correlation_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [actorId, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason, getCorrelationId() ?? null],
    );
  }

  async bumpAuthzVersion(manager: Pick<EntityManager, 'query'>, userId: string): Promise<void> {
    const [rows] = await manager.query(
      'UPDATE app_user SET authz_version = authz_version + 1, version = version + 1 WHERE id = $1 RETURNING id',
      [userId],
    ) as [Array<{ id: string }>, number];
    if (rows.length !== 1) throw new AppError('NOT_FOUND', { status: 404 });
  }

  async revokeSessions(manager: Pick<EntityManager, 'query'>, userId: string, reason: 'ROLE_CHANGE' | 'DISABLED' | 'PASSWORD_RESET'): Promise<void> {
    await manager.query(
      'UPDATE session_family SET revoked_at = now(), revoke_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [userId, reason],
    );
  }

  async lockAdminChanges(manager: Pick<EntityManager, 'query'>): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(480003)');
  }

  async assertAnotherActiveAdmin(manager: Pick<EntityManager, 'query'>, excludedUserId: string): Promise<void> {
    const rows = await manager.query(
      `SELECT count(*)::int AS count
         FROM app_user u JOIN role_grant g ON g.user_id = u.id
        WHERE u.status = 'ACTIVE' AND g.role_code = 'ADMIN' AND g.scope_type = 'SYSTEM'
          AND g.revoked_at IS NULL AND u.id <> $1`,
      [excludedUserId],
    ) as Array<{ count: number }>;
    if (Number(rows[0]?.count ?? 0) < 1) throw new AppError('LAST_ADMIN', { status: 409 });
  }

  async getUser(manager: Pick<EntityManager, 'query'>, userId: string, lock = false): Promise<Record<string, unknown>> {
    const rows = await manager.query(
      `SELECT id, username, display_name, status, must_change_password, authz_version, version, created_at
         FROM app_user WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }
}
