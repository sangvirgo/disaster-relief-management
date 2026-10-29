import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ApiExceptionFilter, correlationMiddleware, createPinoLogger, loadErrorCatalog, PinoNestLogger, validateEnvironment } from '@c48/technical';
import { setupOpenApiDocs } from '@c48/technical/openapi-docs';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = validateEnvironment(process.env, 'response');
  const logger = new PinoNestLogger(createPinoLogger('response', config.logLevel));
  const app = await NestFactory.create(AppModule, { logger });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(correlationMiddleware());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'response'));
  app.setGlobalPrefix('api/v1/response', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  setupOpenApiDocs(app, 'response');
  await app.listen(config.port, '0.0.0.0');
  const server = app.getHttpServer();
  server.requestTimeout = 90_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 65_000;
}

void bootstrap();
