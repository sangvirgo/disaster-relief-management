import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter, correlationMiddleware, createPinoLogger, loadErrorCatalog, PinoNestLogger, validateEnvironment } from '../../../packages/technical/src';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env, 'logistics');
  const logger = new PinoNestLogger(createPinoLogger('logistics', config.logLevel));
  const app = await NestFactory.create(AppModule, { logger });
  app.use(correlationMiddleware());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'logistics'));
  app.setGlobalPrefix('api/v1/logistics', {
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
