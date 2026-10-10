import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthTransportGuard, IDENTITY_AUTH_CONFIG, IdentitySessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency';
import { loadIdentityAuthConfig } from './auth-security';
import { IDENTITY_SERVICE_TOKEN_CONFIG, loadServiceTokenConfig } from './service-tokens';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: IDENTITY_AUTH_CONFIG, useFactory: () => loadIdentityAuthConfig() },
    { provide: IDENTITY_SERVICE_TOKEN_CONFIG, useFactory: () => loadServiceTokenConfig(loadIdentityAuthConfig()) },
    AuthService,
    AuthTransportGuard,
    IdentitySessionGuard,
    IdempotencyService,
  ],
  exports: [IDENTITY_AUTH_CONFIG, IDENTITY_SERVICE_TOKEN_CONFIG, AuthTransportGuard, IdentitySessionGuard, IdempotencyService, AuthService],
})
export class AuthModule {}
