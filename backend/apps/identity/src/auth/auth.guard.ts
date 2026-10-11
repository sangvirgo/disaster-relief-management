import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { parseCookies, verifyAccessToken, verifyCsrfToken, IdentityAuthConfig } from './auth-security';

export const IDENTITY_AUTH_CONFIG = Symbol('IDENTITY_AUTH_CONFIG');

export interface AuthContext {
  userId: string;
  sessionId: string;
  clientKind: 'WEB' | 'NATIVE';
}

export interface IdentityRequest extends Request {
  auth?: AuthContext;
  idempotencyKey?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hasAnyCookie(request: IdentityRequest): boolean {
  return Boolean(headerValue(request.headers.cookie));
}

@Injectable()
export class IdentitySessionGuard implements CanActivate {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const cookies = parseCookies(headerValue(request.headers.cookie));
    const cookieToken = cookies.get('c48_access');
    const authorization = headerValue(request.headers.authorization);
    const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
    if (cookieToken && authorization) throw new AppError('FORBIDDEN', { status: 403 });

    let token: string | undefined;
    let clientKind: AuthContext['clientKind'];
    if (cookieToken) {
      token = cookieToken;
      clientKind = 'WEB';
      const origin = headerValue(request.headers.origin);
      if (origin && !this.config.webOrigins.has(origin)) throw new AppError('FORBIDDEN', { status: 403 });
    } else if (bearer) {
      if (hasAnyCookie(request) || headerValue(request.headers.origin)) throw new AppError('FORBIDDEN', { status: 403 });
      token = bearer;
      clientKind = 'NATIVE';
    } else {
      throw new AppError('UNAUTHENTICATED', { status: 401 });
    }

    const claims = verifyAccessToken(token, this.config);
    let rows: Array<{ user_id: string; user_status: string; user_authz_version: number; family_authz_version: number; revoked_at: Date | null; absolute_expires_at: Date }>;
    try {
      rows = await this.dataSource.query(
        `SELECT sf.user_id, u.status AS user_status, u.authz_version AS user_authz_version,
                sf.authz_version AS family_authz_version, sf.revoked_at, sf.absolute_expires_at
           FROM session_family sf JOIN app_user u ON u.id = sf.user_id
          WHERE sf.id = $1 AND sf.user_id = $2`,
        [claims.sid, claims.sub],
      ) as typeof rows;
    } catch (error) {
      throw new AppError('IDENTITY_UNAVAILABLE', { status: 503, retryAfterSeconds: 1, cause: error });
    }
    const session = rows[0];
    if (!session || session.user_status !== 'ACTIVE' || session.revoked_at ||
        Number(session.user_authz_version) !== Number(session.family_authz_version) ||
        new Date(session.absolute_expires_at).getTime() <= Date.now()) {
      throw new AppError('SESSION_EXPIRED', { status: 401 });
    }
    request.auth = { userId: session.user_id, sessionId: claims.sid, clientKind };
    return true;
  }
}

@Injectable()
export class AuthTransportGuard implements CanActivate {
  constructor(@Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<IdentityRequest & { body: Record<string, unknown> }>();
    const cookies = parseCookies(headerValue(request.headers.cookie));
    const origin = headerValue(request.headers.origin);
    const explicitlyNative = request.body?.client_kind === 'NATIVE' ||
      (request.path?.endsWith('/refresh') && typeof request.body?.refresh_token === 'string' && !cookies.has('c48_refresh'));
    const explicitlyWeb = request.body?.client_kind === 'WEB' || cookies.has('c48_refresh') || request.auth?.clientKind === 'WEB';

    if (explicitlyNative) {
      if (hasAnyCookie(request) || origin) throw new AppError('FORBIDDEN', { status: 403 });
      return true;
    }
    if (explicitlyWeb || origin || hasAnyCookie(request)) {
      if (!origin || !this.config.webOrigins.has(origin)) throw new AppError('FORBIDDEN', { status: 403 });
      const preSessionId = cookies.get('c48_pre');
      const csrfToken = headerValue(request.headers['x-csrf-token']);
      if (!preSessionId || !csrfToken || !verifyCsrfToken(this.config, preSessionId, csrfToken)) {
        throw new AppError('CSRF_INVALID', { status: 403 });
      }
    }
    return true;
  }
}
