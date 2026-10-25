import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { ChangePasswordDto, GoogleLinkDto, GoogleLoginDto, LoginDto, RefreshDto, RegisterDto, ResendEmailOtpDto, VerifyEmailDto } from './auth.dto';
import { AuthTransportGuard, IDENTITY_AUTH_CONFIG, IdentityRequest, IdentitySessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { createCsrfToken, IdentityAuthConfig, parseCookies } from './auth-security';

const accessPath = '/api/v1';
const authPath = '/api/v1/identity/auth';
const csrfMaxAgeMs = 30 * 60_000;
const sessionCookieOptions = {
  secure: true,
  sameSite: 'strict' as const,
  path: authPath,
};
const csrfCookieOptions = { ...sessionCookieOptions, path: accessPath };

function cachePrivate(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function setCsrfCookies(response: Response, config: IdentityAuthConfig): void {
  const preSessionId = randomBytes(32).toString('base64url');
  const token = createCsrfToken(config, preSessionId);
  response.cookie('c48_pre', preSessionId, { ...csrfCookieOptions, httpOnly: true, maxAge: csrfMaxAgeMs });
  response.cookie('c48_csrf', token, { ...csrfCookieOptions, httpOnly: false, maxAge: csrfMaxAgeMs });
  response.setHeader('X-CSRF-Token', token);
}

function setSessionCookies(response: Response, config: IdentityAuthConfig, accessToken: string, refreshToken: string, expiresIn: number, absoluteExpiresAt: Date): void {
  response.cookie('c48_access', accessToken, {
    ...sessionCookieOptions,
    path: accessPath,
    httpOnly: true,
    maxAge: expiresIn * 1_000,
  });
  response.cookie('c48_refresh', refreshToken, {
    ...sessionCookieOptions,
    httpOnly: true,
    maxAge: Math.max(0, absoluteExpiresAt.getTime() - Date.now()),
  });
  setCsrfCookies(response, config);
}

function clearSessionCookies(response: Response): void {
  response.clearCookie('c48_access', { ...sessionCookieOptions, path: accessPath, httpOnly: true });
  response.clearCookie('c48_refresh', { ...sessionCookieOptions, httpOnly: true });
  response.clearCookie('c48_pre', { ...csrfCookieOptions, httpOnly: true });
  response.clearCookie('c48_csrf', { ...csrfCookieOptions, httpOnly: false });
}

function requestIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(IDENTITY_AUTH_CONFIG) private readonly config: IdentityAuthConfig,
  ) {}

  @Get('auth/csrf')
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response): { csrf_token: string } {
    cachePrivate(response);
    const origin = request.headers.origin;
    if (origin && !this.config.webOrigins.has(origin)) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    setCsrfCookies(response, this.config);
    return { csrf_token: response.getHeader('X-CSRF-Token') as string };
  }

  @Post('auth/register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthTransportGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async register(
    @Body() dto: RegisterDto,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: { id: string; username: string; display_name: string }; verification: { challenge_id: string }; email_sent: boolean }> {
    cachePrivate(response);
    const result = await this.authService.register(dto, request.idempotencyKey!, requestIp(request));
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('auth/email/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTransportGuard)
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    cachePrivate(response);
    return this.authService.verifyEmail(dto.challenge_id, dto.code, requestIp(request));
  }

  @Post('auth/email/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTransportGuard)
  async resendEmailOtp(@Body() dto: ResendEmailOtpDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    cachePrivate(response);
    return this.authService.resendEmailOtp(dto.challenge_id, requestIp(request));
  }

  @Post('auth/google')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTransportGuard)
  async googleLogin(@Body() dto: GoogleLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    cachePrivate(response);
    const session = await this.authService.googleLogin(dto, requestIp(request));
    if (dto.client_kind === 'WEB') {
      setSessionCookies(response, this.config, session.accessToken, session.refreshToken, session.accessExpiresIn, session.absoluteExpiresAt);
      return { user: session.user, session: { expires_at: session.absoluteExpiresAt.toISOString() }, must_change_password: false };
    }
    return { user: session.user, access_token: session.accessToken, refresh_token: session.refreshToken, expires_in: session.accessExpiresIn, must_change_password: false };
  }

  @Post('auth/google/link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard)
  async linkGoogle(@Body() dto: GoogleLinkDto, @Req() request: IdentityRequest, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    cachePrivate(response);
    return this.authService.linkGoogleIdentity(request.auth!, dto.id_token);
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTransportGuard)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    cachePrivate(response);
    const session = await this.authService.login(dto, requestIp(request));
    if (dto.client_kind === 'WEB') {
      setSessionCookies(response, this.config, session.accessToken, session.refreshToken, session.accessExpiresIn, session.absoluteExpiresAt);
      return {
        user: session.user,
        session: { expires_at: session.absoluteExpiresAt.toISOString() },
        must_change_password: session.mustChangePassword,
      };
    }
    return {
      user: session.user,
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: session.accessExpiresIn,
      must_change_password: session.mustChangePassword,
    };
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthTransportGuard)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    cachePrivate(response);
    const cookies = parseCookies(request.headers.cookie);
    const clientKind = cookies.has('c48_refresh') ? 'WEB' : 'NATIVE';
    const session = await this.authService.refresh(cookies.get('c48_refresh') ?? dto.refresh_token, clientKind);
    if (clientKind === 'WEB') {
      setSessionCookies(response, this.config, session.accessToken, session.refreshToken, session.accessExpiresIn, session.absoluteExpiresAt);
      return { session: { expires_at: session.absoluteExpiresAt.toISOString() }, must_change_password: session.mustChangePassword };
    }
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: session.accessExpiresIn,
      must_change_password: session.mustChangePassword,
    };
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard)
  async logout(
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    cachePrivate(response);
    await this.authService.logout(request.auth!);
    if (request.auth!.clientKind === 'WEB') clearSessionCookies(response);
  }

  @Post('auth/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    cachePrivate(response);
    await this.authService.changePassword(request.auth!, dto, request.idempotencyKey!);
  }

  @Get('me')
  @UseGuards(IdentitySessionGuard)
  async me(@Req() request: IdentityRequest, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    cachePrivate(response);
    return this.authService.me(request.auth!.userId);
  }
}
