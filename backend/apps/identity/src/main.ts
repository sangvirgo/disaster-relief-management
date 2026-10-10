import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { ApiExceptionFilter, correlationMiddleware, createPinoLogger, loadErrorCatalog, PinoNestLogger, validateEnvironment } from '../../../packages/technical/src';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env, 'identity');
  const logger = new PinoNestLogger(createPinoLogger('identity', config.logLevel));
  const app = await NestFactory.create(AppModule, { logger });
  app.use(correlationMiddleware());
  app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'identity'));
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
