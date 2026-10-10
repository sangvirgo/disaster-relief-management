import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthTransportGuard, IDENTITY_AUTH_CONFIG, IdentitySessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency';
import { loadIdentityAuthConfig } from './auth-security';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: IDENTITY_AUTH_CONFIG, useFactory: () => loadIdentityAuthConfig() },
    AuthService,
    AuthTransportGuard,
    IdentitySessionGuard,
    IdempotencyService,
  ],
})
export class AuthModule {}
