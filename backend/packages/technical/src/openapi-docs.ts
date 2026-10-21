import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

type ApiService = 'identity' | 'response' | 'logistics';

export function setupOpenApiDocs(app: INestApplication, service: ApiService): void {
  if (process.env.NODE_ENV === 'production') return;

  const document = JSON.parse(readFileSync(join(process.cwd(), 'contracts/openapi', `${service}.json`), 'utf8')) as OpenAPIObject;
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
}
