import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiExceptionFilter, correlationMiddleware, createPinoLogger, loadErrorCatalog, PinoNestLogger, validateEnvironment } from '../../../packages/technical/src';
import { AppModule } from './app.module';
import { loadIdentityAuthConfig } from './auth/auth-security';

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env, 'identity');
  const authConfig = loadIdentityAuthConfig(process.env);
  const logger = new PinoNestLogger(createPinoLogger('identity', config.logLevel));
  const app = await NestFactory.create(AppModule, { logger });
  app.use(correlationMiddleware());
  app.use('/api/v1/identity', (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'identity'));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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
  await app.listen(config.port, '0.0.0.0');
  const server = app.getHttpServer();
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 65_000;
}

void bootstrap();
