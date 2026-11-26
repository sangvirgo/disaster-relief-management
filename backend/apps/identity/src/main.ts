import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter, correlationMiddleware, createPinoLogger, installMetrics, loadErrorCatalog, PinoNestLogger, validateEnvironment, validationExceptionFactory } from '@c48/technical';
import { setupOpenApiDocs } from '@c48/technical/openapi-docs';
import { AppModule } from './app.module';
import { loadIdentityAuthConfig } from './auth/auth-security';
import { AuthService } from './auth/auth.service';
import { registerEmailMetrics } from './auth/email-metrics';

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env, 'identity');
  const authConfig = loadIdentityAuthConfig(process.env);
  const logger = new PinoNestLogger(createPinoLogger('identity', config.logLevel));
  const app = await NestFactory.create(AppModule, { logger });
  app.use(correlationMiddleware());
  installMetrics(app, 'identity', {
    domain: (registry) => registerEmailMetrics(registry, app.get(DataSource), () => app.get(AuthService).emailDeliveryConfigured()),
  });
  app.use('/api/v1/identity', (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'identity'));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: validationExceptionFactory }));
  app.enableCors({
    origin: [...authConfig.webOrigins],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Correlation-Id', 'X-CSRF-Token'],
    exposedHeaders: ['Idempotent-Replay', 'Retry-After', 'X-Correlation-Id', 'X-CSRF-Token'],
  });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api/v1/identity', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  setupOpenApiDocs(app, 'identity');
  await app.listen(config.port, '0.0.0.0');
  const server = app.getHttpServer();
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 65_000;
}

void bootstrap();
