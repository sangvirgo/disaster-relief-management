import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectControllerRoutes, emptyOpenApiDocument, exportOpenApi, exportOpenApiSnapshotIfValid, mergeOpenApiText, openApiSnapshotsMatch, routesFromSourceText, validateOpenApi, writeOpenApiSnapshotIfValid } from '../contracts/openapi.mjs';
import { applyOpenApiDetails } from '../contracts/openapi-details.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceDocuments = {
  identity: 'docs/backend/02-identity-api.md',
  response: 'docs/backend/03-response-api.md',
  logistics: 'docs/backend/04-logistics-api.md',
};

function exportService(service) {
  const sourceRoot = fileURLToPath(new URL(`../../apps/${service}/src/`, import.meta.url));
  const routes = collectControllerRoutes(sourceRoot);
  const snapshot = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'contracts/openapi', `${service}.json`), 'utf8'));
  return { routes, document: exportOpenApi(snapshot, routes, service, sourceDocuments[service]) };
}

function operationAt(document, method, routePath) {
  return document.paths[routePath][method];
}

function operationById(document, operationId) {
  return Object.values(document.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .find((operation) => operation?.operationId === operationId);
}

function resolveSchema(document, schema) {
  if (!schema?.$ref?.startsWith('#/components/schemas/')) return schema;
  return document.components?.schemas?.[schema.$ref.split('/').at(-1)];
}

function objectSchema(document, schema) {
  const resolved = resolveSchema(document, schema);
  if (resolved?.properties) return resolved;
  for (const union of [resolved?.anyOf, resolved?.oneOf]) {
    const objectVariant = union?.find((variant) => resolveSchema(document, variant)?.properties);
    if (objectVariant) return objectSchema(document, objectVariant);
  }
  return resolved;
}

function schemaAt(document, schema, pathParts) {
  let current = schema;
  for (const part of pathParts) {
    if (part === '[]') {
      current = resolveSchema(document, current)?.items;
    } else {
      current = objectSchema(document, current)?.properties?.[part];
    }
  }
  return resolveSchema(document, current);
}

function successSchema(document, operation) {
  const success = Object.entries(operation.responses ?? {}).find(([status]) => status.startsWith('2'));
  assert.ok(success, `${operation.operationId} has a 2xx response`);
  const schema = success[1]?.content?.['application/json']?.schema;
  assert.ok(schema, `${operation.operationId} has a success response schema`);
  return resolveSchema(document, schema);
}

function assertSchemaFields(document, schema, pathParts, fields, label) {
  const target = objectSchema(document, schemaAt(document, schema, pathParts));
  assert.ok(target?.properties, `${label} has an object schema at ${pathParts.join('.') || '<root>'}`);
  for (const field of fields) assert.ok(target.properties[field], `${label} includes ${field} at ${pathParts.join('.') || '<root>'}`);
}

function catalogErrors() {
  const markdown = fs.readFileSync(path.join(repositoryRoot, 'docs/backend/07-error-catalog.md'), 'utf8');
  const entries = new Map();
  for (const [, code, status, message] of markdown.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*(\d{3})\s*\|\s*[^|]+\|\s*([^|]+?)\s*\|\s*$/gmu)) {
    entries.set(code, { status, message });
  }
  return entries;
}

function dereferenceParameter(document, parameter) {
  if (!parameter?.$ref?.startsWith('#/components/parameters/')) return parameter;
  return document.components?.parameters?.[parameter.$ref.split('/').at(-1)];
}

function parameterKeys(document, parameters) {
  return parameters.map((parameter) => {
    const resolved = dereferenceParameter(document, parameter);
    assert.ok(resolved, `parameter reference must resolve: ${parameter.$ref}`);
    return `${resolved.in}:${resolved.name}`;
  });
}

test('controller route export preserves literal colons and converts path parameters', () => {
  const source = String.raw`
    @Controller('internal')
    class InternalController {
      @Post('users\:lookup') lookup() {}
      @Get('users/:id') getUser() {}
    }
  `;

  assert.deepEqual(
    routesFromSourceText(source, 'internal.controller.ts'),
    [
      { method: 'post', path: '/internal/users:lookup', controller: 'InternalController', handler: 'lookup', sourceFile: 'internal.controller.ts', successStatus: 201 },
      { method: 'get', path: '/internal/users/{id}', controller: 'InternalController', handler: 'getUser', sourceFile: 'internal.controller.ts', successStatus: 200 },
    ],
  );
});

test('OpenAPI export adds missing routes without replacing curated operation details', () => {
  const curated = {
    openapi: '3.1.0',
    info: { title: 'C48 Logistics API', version: '1.0.0' },
    servers: [{ url: '/api/v1/logistics' }],
    paths: {
      '/items': {
        get: { operationId: 'listItems', summary: 'List items', responses: { 200: { description: 'Items' } } },
      },
    },
    components: { schemas: { Item: { type: 'object' } } },
  };
  const routes = [
    { method: 'get', path: '/items', controller: 'CatalogController', handler: 'list', sourceFile: 'catalog.controller.ts', successStatus: 200 },
    { method: 'post', path: '/items', controller: 'CatalogController', handler: 'create', sourceFile: 'catalog.controller.ts', successStatus: 201 },
  ];

  const exported = exportOpenApi(curated, routes, 'logistics', 'docs/backend/04-logistics-api.md');

  assert.equal(exported.paths['/items'].get.operationId, 'listItems');
  assert.deepEqual(exported.components.schemas.Item, curated.components.schemas.Item);
  assert.ok(exported.components.schemas.ErrorEnvelope);
  assert.equal(exported.paths['/items'].post.responses['201'].description.includes('04-logistics-api.md'), true);
  assert.deepEqual(exported.paths['/items'].post.parameters, undefined);
  assert.deepEqual(validateOpenApi(exported, routes, 'logistics'), []);
});

test('OpenAPI validation reports route drift and dangling local references', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Identity API', version: '1.0.0' },
    servers: [{ url: '/api/v1/identity' }],
    paths: {
      '/auth/login': {
        post: { operationId: 'login', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } } },
      },
    },
    components: { schemas: {} },
  };
  const routes = [
    { method: 'post', path: '/auth/login', controller: 'AuthController', handler: 'login', sourceFile: 'auth.controller.ts', successStatus: 200 },
    { method: 'get', path: '/me', controller: 'AuthController', handler: 'me', sourceFile: 'auth.controller.ts', successStatus: 200 },
  ];

  const errors = validateOpenApi(document, routes, 'identity');

  assert.equal(errors.some((error) => error.includes('GET /me')), true);
  assert.equal(errors.some((error) => error.includes('Missing')), true);
});

test('OpenAPI validation reports dangling references in path-level parameters', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Identity API', version: '1.0.0' },
    servers: [{ url: '/api/v1/identity' }],
    paths: {
      '/users': {
        parameters: [{ $ref: '#/components/parameters/Missing' }],
        get: { operationId: 'listUsers', security: [], responses: { 200: { description: 'Users' } } },
      },
    },
    components: { parameters: {} },
  };
  const routes = [{ method: 'get', path: '/users', controller: 'UsersController', handler: 'list', sourceFile: 'users.controller.ts', successStatus: 200 }];

  const errors = validateOpenApi(document, routes, 'identity');

  assert.ok(errors.some((error) => error.includes('unresolved local reference #/components/parameters/Missing')));
});

test('OpenAPI validation reports dangling references on Path Items', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Identity API', version: '1.0.0' },
    servers: [{ url: '/api/v1/identity' }],
    paths: { '/users': { $ref: '#/components/pathItems/Missing' } },
    components: { pathItems: {} },
  };

  const errors = validateOpenApi(document, [], 'identity');

  assert.ok(errors.some((error) => error.includes('unresolved local reference #/components/pathItems/Missing')));
});

test('OpenAPI export rejects Path Item refs before replacing curated operations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c48-openapi-path-item-'));
  const snapshotPath = path.join(directory, 'identity.json');
  const current = {
    openapi: '3.1.0',
    info: { title: 'C48 Identity API', version: '1.0.0' },
    servers: [{ url: '/api/v1/identity' }],
    paths: { '/users': { $ref: '#/components/pathItems/Users' } },
    components: {
      pathItems: {
        Users: {
          get: { operationId: 'curatedUsersList', summary: 'Curated user list', security: [], responses: { 200: { description: 'Curated users' } } },
        },
      },
    },
  };
  const currentRaw = `${JSON.stringify(current, null, 2)}\n`;
  const routes = [{ method: 'get', path: '/users', controller: 'UsersController', handler: 'list', sourceFile: 'users.controller.ts', successStatus: 200 }];

  try {
    const errors = exportOpenApiSnapshotIfValid(snapshotPath, currentRaw, current, routes, 'identity', 'docs/backend/02-identity-api.md');

    assert.ok(errors.some((error) => error.includes('Path Item $ref')));
    assert.equal(fs.existsSync(snapshotPath), false);
    assert.equal(current.paths['/users'].$ref, '#/components/pathItems/Users');
    assert.equal(current.components.pathItems.Users.get.operationId, 'curatedUsersList');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('OpenAPI validation rejects duplicate normalized controller routes', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Identity API', version: '1.0.0' },
    servers: [{ url: '/api/v1/identity' }],
    paths: {
      '/users': {
        get: { operationId: 'listUsers', security: [], responses: { 200: { description: 'Users' } } },
      },
    },
  };
  const routes = [
    { method: 'get', path: '/users', controller: 'UsersController', handler: 'list', sourceFile: 'users.controller.ts', successStatus: 200 },
    { method: 'get', path: '/users', controller: 'LegacyUsersController', handler: 'list', sourceFile: 'legacy-users.controller.ts', successStatus: 200 },
  ];

  const errors = validateOpenApi(document, routes, 'identity');

  assert.ok(errors.some((error) => error.includes('duplicate controller route') && error.includes('GET /users')));
});

test('OpenAPI export leaves the existing snapshot untouched when validation fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'c48-openapi-export-'));
  const snapshotPath = path.join(directory, 'identity.json');
  const existingText = '{"openapi":"3.1.0"}\n';
  const current = JSON.parse(existingText);
  const routes = [
    { method: 'get', path: '/users', controller: 'UsersController', handler: 'list', sourceFile: 'users.controller.ts', successStatus: 200 },
    { method: 'get', path: '/users', controller: 'LegacyUsersController', handler: 'list', sourceFile: 'legacy-users.controller.ts', successStatus: 200 },
  ];
  const exported = exportOpenApi(current, routes, 'identity', 'docs/backend/02-identity-api.md');

  try {
    const errors = writeOpenApiSnapshotIfValid(snapshotPath, existingText, current, exported, routes, 'identity');

    assert.ok(errors.some((error) => error.includes('duplicate controller route')));
    assert.equal(fs.existsSync(snapshotPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('OpenAPI validation rejects duplicate parameters after resolving refs', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Identity API', version: '1.0.0' },
    servers: [{ url: '/api/v1/identity' }],
    components: { parameters: { Cursor: { name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 2048 } } } },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          'x-c48-controller-source': 'backend/apps/identity/src/users/users.controller.ts#UsersController.list',
          security: [],
          parameters: [
            { $ref: '#/components/parameters/Cursor' },
            { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Users' } },
        },
      },
    },
  };
  const routes = [{ method: 'get', path: '/users', controller: 'UsersController', handler: 'list', sourceFile: 'users/users.controller.ts', successStatus: 200 }];

  assert.ok(validateOpenApi(document, routes, 'identity').some((error) => error.includes('duplicate parameter query:cursor')));
});

test('snapshot comparison ignores object key order but catches exporter drift', () => {
  assert.equal(openApiSnapshotsMatch({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(openApiSnapshotsMatch({ b: 2, a: 1 }, { a: 1, b: 3 }), false);
});

test('route validation treats OpenAPI parameter names as template labels', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Response API', version: '1.0.0' },
    servers: [{ url: '/api/v1/response' }],
    paths: {
      '/requests/{id}': {
        get: {
          operationId: 'getRequest',
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Request' } },
        },
      },
    },
  };
  const routes = [
    { method: 'get', path: '/requests/{requestId}', controller: 'OperationsController', handler: 'getRequest', sourceFile: 'operations.controller.ts', successStatus: 200 },
  ];

  const exported = exportOpenApi(document, routes, 'response', 'docs/backend/03-response-api.md');

  assert.deepEqual(validateOpenApi(exported, routes, 'response'), []);
  assert.deepEqual(Object.keys(exported.paths), ['/requests/{id}']);
  assert.equal(exported.paths['/requests/{id}'].get.operationId, 'getRequest');
});

test('text export inserts new operations without reformatting curated JSON', () => {
  const raw = '{\n  "openapi": "3.1.0",\n  "paths": {\n    "/items": {\n      "get": { "operationId": "listItems", "summary": "List items", "responses": { "200": { "description": "Items" } } }\n    }\n  },\n  "components": {}\n}\n';
  const document = JSON.parse(raw);
  const route = { method: 'post', path: '/items', controller: 'CatalogController', handler: 'create', sourceFile: 'catalog.controller.ts', successStatus: 201 };
  const existingRoute = { method: 'get', path: '/items', controller: 'CatalogController', handler: 'list', sourceFile: 'catalog.controller.ts', successStatus: 200 };
  const exported = exportOpenApi(document, [existingRoute, route], 'logistics', 'docs/backend/04-logistics-api.md');

  const merged = mergeOpenApiText(raw, document, exported);
  const mergedDocument = JSON.parse(merged);

  assert.equal(mergedDocument.paths['/items'].get.operationId, 'listItems');
  assert.equal(mergedDocument.paths['/items'].get.summary, 'List items');
  assert.deepEqual(mergedDocument.paths['/items'].get.responses, exported.paths['/items'].get.responses);
  assert.equal(mergedDocument.paths['/items'].get['x-c48-controller-source'], 'backend/apps/logistics/src/catalog.controller.ts#CatalogController.list');
  assert.ok(mergedDocument.paths['/items'].post.responses['201'].description.includes('04-logistics-api.md'));
});

test('snapshot merger writes newly exported component parameters and headers', () => {
  const current = {
    openapi: '3.1.0',
    paths: {},
    components: { schemas: {}, securitySchemes: {} },
  };
  const raw = `${JSON.stringify(current, null, 2)}\n`;
  const exported = structuredClone(current);
  exported.components.parameters = {
    IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
  };
  exported.components.headers = {
    CacheControlNoStore: { description: 'No store.', schema: { type: 'string', enum: ['no-store'] } },
  };

  const merged = JSON.parse(mergeOpenApiText(raw, current, exported));

  assert.deepEqual(merged, exported);
});

test('text export replaces stale security, response, and source metadata on curated operations', () => {
  const raw = JSON.stringify({
    openapi: '3.1.0',
    paths: {
      '/auth/login': {
        post: {
          operationId: 'login',
          summary: 'Sign in',
          security: [{ StaleScheme: [] }],
          responses: { 200: { description: 'Login result' }, 401: { description: 'Stale auth response' } },
          'x-c48-controller-source': 'stale.controller.ts#Old.login',
        },
      },
    },
    components: {},
  }, null, 2) + '\n';
  const document = JSON.parse(raw);
  const route = { method: 'post', path: '/auth/login', controller: 'AuthController', handler: 'login', sourceFile: 'auth/auth.controller.ts', successStatus: 200 };
  const exported = exportOpenApi(document, [route], 'identity', 'docs/backend/02-identity-api.md');
  const merged = JSON.parse(mergeOpenApiText(raw, document, exported));
  const operation = merged.paths['/auth/login'].post;

  assert.deepEqual(operation.security, exported.paths['/auth/login'].post.security);
  assert.deepEqual(operation.responses, exported.paths['/auth/login'].post.responses);
  assert.deepEqual(operation['x-c48-conditional-security'], exported.paths['/auth/login'].post['x-c48-conditional-security']);
  assert.deepEqual(operation.responses['401'].content['application/json'].examples.INVALID_CREDENTIALS.value, {
    code: 'INVALID_CREDENTIALS',
    message: 'Tên đăng nhập hoặc mật khẩu không đúng.',
    correlation_id: '00000000-0000-4000-8000-000000000000',
  });
  assert.equal(operation['x-c48-controller-source'], 'backend/apps/identity/src/auth/auth.controller.ts#AuthController.login');
  assert.equal(operation.summary, 'Sign in');
});

test('text export refreshes only generated operations with documented schemas', () => {
  const raw = JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'C48 Logistics API', version: '1.0.0' },
    servers: [{ url: '/api/v1/logistics' }],
    paths: {
      '/distributions': {
        post: {
          operationId: 'logisticsDistributionsCreate',
          summary: 'DistributionsController.create',
          responses: { 201: { description: 'Success response' } },
          'x-c48-contract-source': 'docs/backend/04-logistics-api.md',
        },
      },
    },
  }, null, 2) + '\n';
  const document = JSON.parse(raw);
  const route = { method: 'post', path: '/distributions', controller: 'DistributionsController', handler: 'create', sourceFile: 'distributions/distributions.controller.ts', successStatus: 201 };
  const exported = exportOpenApi(document, [route], 'logistics', 'docs/backend/04-logistics-api.md');
  const merged = JSON.parse(mergeOpenApiText(raw, document, exported));

  assert.deepEqual(merged.paths['/distributions'].post.requestBody.content['application/json'].schema.required, ['warehouse_id', 'purpose', 'lines']);
  assert.equal(merged.paths['/distributions'].post.requestBody.content['application/json'].schema.properties.purpose.enum.includes('REQUEST_AID'), true);
  assert.equal(merged.paths['/distributions'].post['x-c48-contract-gap'], undefined);
  assert.ok(merged.paths['/distributions'].post.responses['201'].content['application/json'].schema.properties.organization_id);
});

test('OpenAPI detail application removes stale gaps after schemas are documented', () => {
  const curated = {
    openapi: '3.1.0',
    info: { title: 'C48 Logistics API', version: '1.0.0' },
    servers: [{ url: '/api/v1/logistics' }],
    paths: {
      '/public/donations/{id}/claim': {
        post: {
          operationId: 'logisticsDonationsClaim',
          responses: { 201: { description: 'Created' } },
          'x-c48-contract-source': 'docs/backend/04-logistics-api.md',
          'x-c48-contract-gap': 'Stale gap from an earlier export.',
        },
      },
    },
  };
  const routes = [
    { method: 'post', path: '/public/donations/{id}/claim', controller: 'DonationsController', handler: 'claim', sourceFile: 'donations.controller.ts', successStatus: 201 },
  ];

  const exported = exportOpenApi(curated, routes, 'logistics', 'docs/backend/04-logistics-api.md');
  const operation = exported.paths['/public/donations/{id}/claim'].post;

  assert.equal(operation['x-c48-contract-gap'], undefined);
  assert.equal(operation.requestBody, undefined);
  assert.deepEqual(operation.responses['201'].content['application/json'].schema.required, ['id', 'public_code', 'status', 'donor_user_id', 'version']);
});

test('re-export replaces configured query parameters and stays idempotent', () => {
  const document = {
    openapi: '3.1.0',
    info: { title: 'C48 Logistics API', version: '1.0.0' },
    servers: [{ url: '/api/v1/logistics' }],
    paths: {
      '/reports/stock-summary': {
        get: {
          operationId: 'logisticsReportsStockSummary',
          parameters: [
            { in: 'query', name: 'warehouse_id', required: true, schema: { type: 'string' } },
            { in: 'query', name: 'manual_filter', required: false, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Report' } },
          'x-c48-contract-source': 'docs/backend/04-logistics-api.md',
        },
      },
    },
  };
  const routes = [{ method: 'get', path: '/reports/stock-summary', controller: 'ReportsController', handler: 'stockSummary', sourceFile: 'reports/reports.controller.ts', successStatus: 200 }];

  const first = exportOpenApi(document, routes, 'logistics', 'docs/backend/04-logistics-api.md');
  const second = exportOpenApi(first, routes, 'logistics', 'docs/backend/04-logistics-api.md');
  const parameters = second.paths['/reports/stock-summary'].get.parameters;
  const keys = parameters.map(({ in: location, name }) => `${location}:${name}`);

  assert.deepEqual(second, first);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('query:manual_filter'));
  assert.ok(keys.includes('query:warehouse_id'));
  assert.equal(parameters.find(({ name }) => name === 'limit').schema.maximum, 100);
});

test('snapshot merger writes newly exported pagination parameters', () => {
  for (const service of ['identity', 'response']) {
    const snapshotPath = path.join(repositoryRoot, 'contracts/openapi', `${service}.json`);
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const current = JSON.parse(raw);
    const { routes, document: exported } = exportService(service);
    const merged = JSON.parse(mergeOpenApiText(raw, current, exported));

    assert.deepEqual(merged, exported, `${service}: merged snapshot must equal controller-derived export`);
    assert.deepEqual(validateOpenApi(merged, routes, service), []);
  }
});

test('all controller operations retain source provenance and explicit auth metadata', () => {
  for (const service of ['identity', 'response', 'logistics']) {
    const { routes, document } = exportService(service);
    assert.deepEqual(validateOpenApi(document, routes, service), [], `${service}: route export validation`);
    assert.equal(document.security, undefined);
    const schemes = document.components?.securitySchemes ?? {};
    for (const route of routes) {
      const normalized = (value) => value.replace(/\{[^}]+\}/gu, '{}');
      const pathName = Object.keys(document.paths).find((candidate) => normalized(candidate) === normalized(route.path) && document.paths[candidate][route.method]);
      assert.ok(pathName, `${service}: missing ${route.method.toUpperCase()} ${route.path}`);
      const operation = document.paths[pathName][route.method];
      assert.equal(operation['x-c48-controller-source'], `backend/apps/${service}/src/${route.sourceFile}#${route.controller}.${route.handler}`);
      assert.ok(Object.hasOwn(operation, 'security'), `${service}: ${route.method.toUpperCase()} ${route.path} has no security declaration`);
      for (const requirement of operation.security) {
        for (const scheme of Object.keys(requirement)) assert.ok(schemes[scheme], `${service}: ${route.method.toUpperCase()} ${route.path} references unknown scheme ${scheme}`);
      }
    }
  }
  const identity = exportService('identity').document;
  const response = exportService('response').document;
  const logistics = exportService('logistics').document;
  assert.deepEqual(operationAt(identity, 'get', '/auth/csrf').security, []);
  assert.deepEqual(operationAt(logistics, 'get', '/public/donation-drives').security, []);
  assert.ok(operationAt(response, 'get', '/requests/track').security.some((requirement) =>
    Object.keys(requirement).includes('TrackingSecret') && Object.keys(requirement).includes('TrackingCode')));
  assert.ok(operationAt(logistics, 'post', '/public/donation-drives/{id}/deliveries').security.some((requirement) =>
    Object.hasOwn(requirement, 'DonationSecret')));
});

test('snapshots have unique dereferenced parameters and retain pagination constraints', () => {
  for (const service of ['identity', 'response', 'logistics']) {
    const document = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'contracts/openapi', `${service}.json`), 'utf8'));
    for (const [routePath, pathItem] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) continue;
        const keys = parameterKeys(document, operation.parameters ?? []);
        assert.equal(new Set(keys).size, keys.length, `${service} ${method.toUpperCase()} ${routePath} has duplicate parameters`);
      }
    }
  }

  const identity = exportService('identity').document;
  const response = exportService('response').document;
  for (const [document, path, operation] of [
    [identity, '/users', 'get'],
    [response, '/requests', 'get'],
  ]) {
    const params = operationAt(document, operation, path).parameters;
    assert.ok(params.some((parameter) => parameter.$ref === '#/components/parameters/Cursor'));
    const limit = params.map((parameter) => dereferenceParameter(document, parameter)).find((parameter) => parameter?.name === 'limit');
    assert.equal(limit.schema.minimum, 1);
    assert.equal(limit.schema.maximum, 100);
    assert.equal(limit.schema.default, 50);
    const cursor = params.map((parameter) => dereferenceParameter(document, parameter)).find((parameter) => parameter?.name === 'cursor');
    assert.ok(cursor.schema.maxLength >= 2000);
  }
});

test('T8 team membership writes declare the required Idempotency-Key header', () => {
  const response = exportService('response').document;
  for (const operationId of [
    'responseTeamsAddMember',
    'responseTeamsRemoveMember',
    'responseTeamsTransferLeader',
  ]) {
    const operation = operationById(response, operationId);
    assert.ok(operation, `${operationId} is present in the Response contract`);
    const parameter = operation.parameters?.find((candidate) => candidate.$ref === '#/components/parameters/IdempotencyKey');
    assert.ok(parameter, `${operationId} references the shared IdempotencyKey parameter`);
    const resolved = dereferenceParameter(response, parameter);
    assert.equal(resolved.in, 'header');
    assert.equal(resolved.name, 'Idempotency-Key');
    assert.equal(resolved.required, true);
  }
});

test('T8 leader transfer documents Identity unavailability and unchanged-version confirmation', () => {
  const response = exportService('response').document;
  const transfer = operationById(response, 'responseTeamsTransferLeader');
  assert.ok(transfer.responses?.['503']?.content?.['application/json']?.examples?.IDENTITY_UNAVAILABLE);

  const docs = fs.readFileSync(path.join(repositoryRoot, sourceDocuments.response), 'utf8');
  assert.match(docs, /Identity unavailable → `IDENTITY_UNAVAILABLE` 503\./);
  assert.ok(docs.includes('If `user_id` is already the leader, the request is an idempotent confirmation and returns the unchanged version.'));
});

test('T8 membership eligibility failures use state-transition errors while preserving leader-removal code', () => {
  const response = exportService('response').document;
  const add = operationById(response, 'responseTeamsAddMember');
  const remove = operationById(response, 'responseTeamsRemoveMember');
  const transfer = operationById(response, 'responseTeamsTransferLeader');
  const examples = (operation, status) => operation.responses[status].content['application/json'].examples;

  assert.ok(examples(add, '404').NOT_FOUND);
  assert.ok(examples(add, '409').STATE_TRANSITION_INVALID);
  assert.equal(examples(add, '409').TEAM_NOT_ELIGIBLE, undefined);
  assert.ok(examples(remove, '409').LEADER_REQUIRED);
  assert.ok(examples(transfer, '404').NOT_FOUND);
  assert.ok(examples(transfer, '409').STATE_TRANSITION_INVALID);
  assert.equal(examples(transfer, '409').TEAM_NOT_ELIGIBLE, undefined);
  assert.equal(examples(transfer, '409').LEADER_REQUIRED, undefined);

  const docs = fs.readFileSync(path.join(repositoryRoot, sourceDocuments.response), 'utf8');
  assert.ok(docs.includes('inactive Identity account → `STATE_TRANSITION_INVALID` 409'));
  assert.ok(docs.includes('`USER_INACTIVE`, `MEMBERSHIP_REQUIRED`, or `VOLUNTEER_GRANT_REQUIRED` → `STATE_TRANSITION_INVALID` 409'));
});

test('T10 campaign association contracts document validated requests, responses, headers, and errors', () => {
  const response = exportService('response').document;
  const attach = operationById(response, 'responseRequestOperationsAttachCampaign');
  const detach = operationById(response, 'responseRequestOperationsDetachCampaign');
  assert.ok(attach);
  assert.ok(detach);

  for (const operation of [attach, detach]) {
    assert.ok(operation.parameters.some((parameter) => parameter.$ref === '#/components/parameters/RequestId'));
    assert.ok(operation.parameters.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'));
    assert.ok(operation.responses['200'].headers['Cache-Control']);
    assert.ok(operation.responses['200'].headers['Idempotent-Replay']);
  }
  assert.deepEqual(attach.requestBody.content['application/json'].example, {
    campaign_id: '00000000-0000-4000-8000-000000000003', expected_version: 7,
  });
  assert.deepEqual(detach.requestBody.content['application/json'].example, { expected_version: 8 });
  assert.equal(attach.responses['200'].content['application/json'].example.campaign_id, '00000000-0000-4000-8000-000000000003');
  assert.equal(detach.responses['200'].content['application/json'].example.campaign_id, null);

  const docs = fs.readFileSync(path.join(repositoryRoot, sourceDocuments.response), 'utf8');
  assert.ok(docs.includes('DRAFT→ACTIVE/CLOSED, ACTIVE→PAUSED/CLOSED, PAUSED→ACTIVE/CLOSED'));
  assert.ok(docs.includes('DRAFT→CLOSED follows the campaign lifecycle in plan §8.4'));
});

test('OpenAPI details preserve shared response references when no examples are removed', () => {
  const response = { $ref: '#/components/responses/Conflict' };
  const document = {
    components: { schemas: {}, securitySchemes: {}, responses: { Conflict: { description: 'Conflict' } } },
    paths: { '/unrelated': { get: { operationId: 'unmappedRoute', security: [], responses: { 409: response } } } },
  };

  applyOpenApiDetails(document, 'identity');

  assert.deepEqual(document.paths['/unrelated'].get.responses['409'], response);
});

test('Identity auth transport security distinguishes Web CSRF and native refresh credentials', () => {
  const identity = exportService('identity').document;
  const register = operationAt(identity, 'post', '/auth/register');
  const login = operationAt(identity, 'post', '/auth/login');
  const refresh = operationAt(identity, 'post', '/auth/refresh');
  const hasRequirement = (operation, schemes) => operation.security.some((requirement) => schemes.every((scheme) => Object.hasOwn(requirement, scheme)));
  const hasAnonymousAlternative = (operation) => operation.security.some((requirement) => Object.keys(requirement).length === 0);
  const hasAccessTokenSecurity = (operation) => operation.security.some((requirement) =>
    Object.hasOwn(requirement, 'NativeBearer') || Object.hasOwn(requirement, 'WebAccessCookie'));

  for (const operation of [register, login]) {
    assert.ok(hasRequirement(operation, ['WebPreSessionCookie', 'CsrfToken']));
    assert.ok(hasAnonymousAlternative(operation));
    assert.equal(hasAccessTokenSecurity(operation), false);
    assert.equal(operation['x-c48-conditional-security'].access_token_required, false);
    assert.ok(operation['x-c48-conditional-security'].web.required.includes('header X-CSRF-Token'));
    assert.deepEqual(operation['x-c48-conditional-security'].native.forbidden, ['Cookie', 'Origin']);
  }

  assert.deepEqual(identity.components.securitySchemes.WebRefreshCookie, {
    type: 'apiKey', in: 'cookie', name: 'c48_refresh',
  });
  assert.ok(hasRequirement(refresh, ['WebRefreshCookie', 'WebPreSessionCookie', 'CsrfToken']));
  assert.ok(hasAnonymousAlternative(refresh));
  assert.equal(hasAccessTokenSecurity(refresh), false);
  assert.equal(refresh['x-c48-conditional-security'].native.required.includes('JSON body refresh_token'), true);
  assert.equal(identity.components.schemas.RefreshRequest.properties.refresh_token.type, 'string');
  assert.equal(refresh.responses['401'].content['application/json'].examples.UNAUTHENTICATED, undefined);
  assert.ok(refresh.responses['401'].content['application/json'].examples.SESSION_EXPIRED);
});

test('reporter capability routes require tracking code with secret or owner-session security', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'contracts/openapi/response.json'), 'utf8'));
  const response = exportService('response').document;
  const normalize = (operation) => operation.security
    .map((requirement) => Object.keys(requirement).sort().join('+'))
    .sort();

  const cases = [
    {
      method: 'get',
      routePath: '/requests/{id}/events',
      expected: ['TrackingCode+TrackingSecret', 'NativeBearer+TrackingCode', 'TrackingCode+WebAccessCookie'],
    },
    {
      method: 'post',
      routePath: '/requests/{id}/supplements',
      expected: ['TrackingCode+TrackingSecret', 'NativeBearer+TrackingCode', 'CsrfToken+TrackingCode+WebAccessCookie'],
    },
    {
      method: 'post',
      routePath: '/requests/{id}/evidence',
      expected: ['TrackingCode+TrackingSecret', 'NativeBearer+TrackingCode', 'CsrfToken+TrackingCode+WebAccessCookie'],
    },
  ];

  for (const { method, routePath, expected } of cases) {
    for (const [label, document] of [['committed snapshot', snapshot], ['fresh export', response]]) {
      const operation = operationAt(document, method, routePath);
      assert.deepEqual(normalize(operation), [...expected].sort(), `${label}: ${method.toUpperCase()} ${routePath} reporter auth alternatives`);
    }
  }
});

test('documented endpoint errors use catalog status and exact Vietnamese messages', () => {
  const catalog = catalogErrors();
  const documents = Object.fromEntries(['identity', 'response', 'logistics'].map((service) => [service, exportService(service).document]));
  for (const [service, document] of Object.entries(documents)) {
    for (const pathItem of Object.values(document.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (!operation?.operationId) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          for (const example of Object.values(response?.content?.['application/json']?.examples ?? {})) {
            const { code, message } = example.value ?? {};
            assert.ok(catalog.has(code), `${service} ${operation.operationId}: example has uncatalogued code ${code}`);
            assert.equal(status, catalog.get(code).status, `${service} ${operation.operationId}: ${code} status`);
            assert.equal(message, catalog.get(code).message, `${service} ${operation.operationId}: ${code} copy`);
          }
        }
      }
    }
  }
  const identity = documents.identity;
  const response = documents.response;
  const logistics = documents.logistics;
  assert.ok(operationAt(identity, 'post', '/internal/team-leader-eligibility').responses['403']);
  assert.ok(operationAt(response, 'post', '/missions/{id}/review-failure').responses['401']);
  assert.ok(operationAt(logistics, 'post', '/donation-drives').responses['409'].content['application/json'].examples.CAMPAIGN_NOT_ACTIVE);
  assert.ok(operationAt(logistics, 'post', '/donation-drives').responses['503'].content['application/json'].examples.RESPONSE_UNAVAILABLE);
  const receiptPost = operationAt(logistics, 'post', '/donation-receipts/{id}/post').responses['409'].content['application/json'].examples;
  assert.ok(receiptPost.RECEIPT_NOT_APPROVED);
  assert.ok(receiptPost.ALREADY_POSTED);
  assert.ok(operationAt(logistics, 'post', '/stock/adjustments/{id}/review').responses['409'].content['application/json'].examples.ADJUSTMENT_VIOLATES_RESERVED);
});

test('documented pagination, evidence, stock movement, and relief point projections are exported', () => {
  const documents = Object.fromEntries(['identity', 'response', 'logistics'].map((service) => [service, exportService(service).document]));
  const expectedQueries = {
    identity: {
      listIdentityUsers: ['cursor', 'limit'],
      listIdentityUserGrants: ['cursor', 'limit'],
      listIdentityOrganizations: ['cursor', 'limit'],
      listIdentityRegions: ['cursor', 'limit'],
      listIdentityAuditLogs: ['cursor', 'limit'],
    },
    response: {
      listRequestQueue: ['cursor', 'limit'],
      listUnassignedRequests: ['cursor', 'limit'],
      listRequestContactAttempts: ['cursor', 'limit'],
      listRequestDuplicates: ['cursor', 'limit'],
      listRequestMissions: ['cursor', 'limit'],
      listReporterEvents: ['cursor', 'limit'],
      responseRequestOperationsEvidence: ['cursor', 'limit'],
      listMyRequests: ['cursor', 'limit'],
      listMyMissions: ['cursor', 'limit'],
      listOverdueMissionOffers: ['cursor', 'limit'],
      listNotices: ['cursor', 'limit'],
      responseTeamsList: ['cursor', 'limit'],
    },
    logistics: {
      logisticsDrivesPublicList: ['cursor', 'limit'],
      logisticsStockMovements: ['cursor', 'limit'],
    },
  };
  const operationById = (document, operationId) => Object.values(document.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .find((operation) => operation?.operationId === operationId);
  const parameterName = (document, parameter) => parameter.name ??
    document.components?.parameters?.[parameter.$ref?.split('/').at(-1)]?.name;

  for (const [service, operations] of Object.entries(expectedQueries)) {
    const document = documents[service];
    for (const [operationId, expectedNames] of Object.entries(operations)) {
      const operation = operationById(document, operationId);
      assert.ok(operation, `${service} ${operationId} exists`);
      const parameters = operation.parameters ?? [];
      const names = parameters.map((parameter) => parameterName(document, parameter));
      for (const name of expectedNames) assert.ok(names.includes(name), `${service} ${operationId} has ${name}`);
      const limit = parameters.find((parameter) => parameterName(document, parameter) === 'limit');
      if (limit) {
        const resolved = limit.$ref
          ? document.components.parameters[limit.$ref.split('/').at(-1)]
          : limit;
        assert.equal(resolved.schema.default, 50, `${service} ${operationId} default page size`);
        assert.equal(resolved.schema.minimum, 1, `${service} ${operationId} minimum page size`);
        assert.equal(resolved.schema.maximum, 100, `${service} ${operationId} maximum page size`);
      }
    }
  }

  for (const [service, document] of Object.entries(documents)) {
    for (const pathItem of Object.values(document.paths)) {
      for (const operation of Object.values(pathItem)) {
        if (!operation?.operationId) continue;
        const names = (operation.parameters ?? []).map((parameter) => parameterName(document, parameter));
        const hasCursor = names.includes('cursor');
        if (hasCursor) {
          assert.ok(names.includes('limit'), `${service} ${operation.operationId} supports the universal page limit`);
          assert.ok(operation.responses['400']?.content?.['application/json']?.examples?.CURSOR_INVALID,
            `${service} ${operation.operationId} documents invalid cursors`);
        }
      }
    }
  }

  const response = documents.response;
  const evidence = operationAt(response, 'get', '/requests/{id}/evidence');
  const evidenceSchema = evidence.responses['200'].content['application/json'].schema;
  const evidenceFields = evidenceSchema.properties.items.items.properties;
  for (const field of ['id', 'state', 'size_bytes', 'detected_mime', 'checksum', 'created_at']) {
    assert.ok(evidenceFields[field], `evidence item includes ${field}`);
  }
  assert.ok(evidenceSchema.properties.more);
  assert.ok(evidenceSchema.properties.cursor);
  assert.equal(evidence['x-c48-contract-gap'], undefined);

  const logistics = documents.logistics;
  const movements = operationAt(logistics, 'get', '/stock/{balanceId}/movements').responses['200'].content['application/json'].schema;
  assert.ok(movements.properties.balance_id);
  const movementFields = movements.properties.items.items.properties;
  for (const field of ['id', 'movement_type', 'delta_on_hand', 'delta_reserved', 'created_at']) {
    assert.ok(movementFields[field], `stock movement includes ${field}`);
  }
  assert.ok(movements.properties.more);
  assert.ok(movements.properties.cursor);

  const reliefPoint = operationAt(logistics, 'get', '/relief-points/{id}');
  const reliefPointFields = reliefPoint.responses['200'].content['application/json'].schema.properties;
  for (const field of ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'contact_note', 'operating_note']) {
    assert.ok(reliefPointFields[field], `relief point includes ${field}`);
  }
  assert.equal(reliefPoint['x-c48-contract-gap'], undefined);
});

test('T12 Logistics recovery and attachment routes document one-use recovery and private evidence access', () => {
  const logistics = exportService('logistics').document;
  const issue = operationById(logistics, 'logisticsDonationsIssueRecovery');
  const redeem = operationById(logistics, 'logisticsDonationsRecover');
  const upload = operationById(logistics, 'logisticsDonationsUploadEvidence');
  const download = operationById(logistics, 'logisticsDonationsDownloadEvidence');

  assert.ok(issue && redeem && upload && download);
  assert.equal(logistics.components.securitySchemes.RecoveryCode.name, 'X-Recovery-Code');
  assert.deepEqual(issue.responses['201'].content['application/json'].schema.oneOf.map((shape) => shape.required), [
    ['issuance_id', 'recovery_code', 'expires_at'], ['issuance_id', 'expires_at'],
  ]);
  assert.ok(redeem.security.some((requirement) => requirement.RecoveryCode && requirement.NativeBearer));
  assert.equal(upload.requestBody.content['multipart/form-data'].schema.required.includes('file'), true);
  assert.ok(upload.parameters.some((parameter) => parameter.name === 'dispute_id' && parameter.in === 'query'));
  assert.ok(upload.responses['503'].content['application/json'].examples.STORAGE_UNAVAILABLE);
  assert.deepEqual(download.responses['200'].content['application/json'].schema.properties.expires_in, { type: 'integer', const: 60 });
  assert.ok(download.security.some((requirement) => requirement.DonationSecret));
});

test('T15 Logistics handoff detail documents kind-specific permissions and forbidden response', () => {
  const logistics = exportService('logistics').document;
  const detail = operationById(logistics, 'logisticsDistributionsHandoffDetail');

  assert.ok(detail);
  assert.match(detail.description, /matching warehouse scope/u);
  for (const permission of ['HANDOFF_RECORD', 'DONATION_INTAKE', 'DISTRIBUTION_DISPATCH', 'LOSS_APPROVE']) {
    assert.ok(detail.description.includes(permission), `handoff detail documents ${permission}`);
  }
  assert.ok(detail.responses['403'].content['application/json'].examples.FORBIDDEN);
  assert.ok(detail.responses['404'].content['application/json'].examples.NOT_FOUND);
});

test('T15 Logistics handoff evidence upload and download document scoped access rules', () => {
  const logistics = exportService('logistics').document;
  const upload = operationById(logistics, 'logisticsDistributionsUploadHandoffEvidence');
  const download = operationById(logistics, 'logisticsDonationsDownloadEvidence');

  assert.ok(upload && download);
  assert.equal(download.summary, 'EvidenceController.download');
  assert.match(upload.description, /authenticated session/u);
  assert.match(upload.description, /warehouse scope/u);
  for (const permission of ['HANDOFF_RECORD', 'DONATION_INTAKE', 'DISTRIBUTION_DISPATCH']) {
    assert.ok(upload.description.includes(permission), `handoff upload documents ${permission}`);
  }
  assert.match(upload.description, /LOSS_APPROVE alone does not permit upload/u);
  assert.match(download.description, /on every request/u);
  assert.match(download.description, /60 seconds/u);
  assert.match(download.description, /outside the required scope or without applicable permission returns 403 FORBIDDEN/u);
  assert.match(download.description, /missing or non-READY evidence returns 404 NOT_FOUND/u);
  for (const permission of ['HANDOFF_RECORD', 'DONATION_INTAKE', 'DISTRIBUTION_DISPATCH', 'LOSS_APPROVE', 'DONATION_REVIEW']) {
    assert.ok(download.description.includes(permission), `evidence download documents ${permission}`);
  }
  for (const operation of [upload, download]) {
    for (const [status, code] of [['401', 'UNAUTHENTICATED'], ['403', 'FORBIDDEN'], ['404', 'NOT_FOUND']]) {
      assert.ok(operation.responses[status]?.content?.['application/json']?.examples?.[code], `${operation.operationId} documents ${status} ${code}`);
    }
  }
});

test('documented route errors include verification, mission, donation, and quantity conflicts', () => {
  const documents = Object.fromEntries(['identity', 'response', 'logistics'].map((service) => [service, exportService(service).document]));
  const catalog = catalogErrors();
  const operationById = (document, operationId) => Object.values(document.paths)
    .flatMap((pathItem) => Object.values(pathItem))
    .find((operation) => operation?.operationId === operationId);
  const expectErrors = (service, operationId, codes) => {
    const operation = operationById(documents[service], operationId);
    assert.ok(operation, `${service} ${operationId} exists`);
    for (const code of codes) {
      const { status, message } = catalog.get(code) ?? {};
      assert.ok(status, `${code} is in the error catalog`);
      const example = operation.responses[status]?.content?.['application/json']?.examples?.[code];
      assert.ok(example, `${service} ${operationId} documents ${code}`);
      assert.equal(example.value.message, message);
    }
  };

  expectErrors('response', 'verifyRequest', ['VERIFICATION_BASIS_REQUIRED', 'SECOND_COORDINATOR_REQUIRED', 'NO_CONTACT_ATTEMPT', 'PENDING_SUPPLEMENT_REVIEW']);
  expectErrors('response', 'rejectRequest', ['REJECT_THRESHOLD_NOT_MET']);
  expectErrors('response', 'markRequestDuplicate', ['CANONICAL_INVALID', 'CANONICAL_HAS_DUPLICATES']);
  expectErrors('response', 'createMissionOffer', ['REGION_REQUIRED', 'TEAM_BUSY', 'TEAM_NOT_ELIGIBLE', 'CAMPAIGN_PAUSED', 'TEAM_HAS_ACTIVE_MISSION', 'OVERRIDE_REASON_REQUIRED', 'CAMPAIGN_NOT_ACTIVE']);
  expectErrors('response', 'acceptMission', ['CAMPAIGN_PAUSED']);
  assert.equal(operationById(documents.response, 'createMissionOffer').responses['409'].content['application/json'].examples.PENDING_SUPPLEMENT_REVIEW, undefined);
  expectErrors('response', 'responseRequestAdmissionAdmit', ['REQUEST_NOT_VERIFIED', 'PENDING_SUPPLEMENT_REVIEW']);
  expectErrors('response', 'responseRequestResolutionReopen', ['CAMPAIGN_NOT_ACTIVE']);
  expectErrors('response', 'responseRequestResolutionClose', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID']);
  expectErrors('response', 'responseRequestResolutionReopen', ['CAMPAIGN_NOT_ACTIVE', 'VERSION_CONFLICT', 'STATE_TRANSITION_INVALID']);
  expectErrors('response', 'responseRequestOperationsAttachCampaign', ['NOT_FOUND', 'CAMPAIGN_NOT_ACTIVE', 'ATTRIBUTION_LOCKED', 'VERSION_CONFLICT', 'VALIDATION_FAILED', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID']);
  expectErrors('response', 'responseRequestOperationsDetachCampaign', ['NOT_FOUND', 'ATTRIBUTION_LOCKED', 'VERSION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID']);
  expectErrors('response', 'responseRequestResolutionResolve', ['LOGISTICS_UNAVAILABLE']);
  expectErrors('logistics', 'logisticsDrivesPublicList', ['CURSOR_INVALID']);
  expectErrors('logistics', 'logisticsDrivesPublicDetail', ['NOT_FOUND']);
  expectErrors('logistics', 'logisticsDrivesPatch', ['STATE_TRANSITION_INVALID', 'CAMPAIGN_NOT_ACTIVE', 'VALIDATION_FAILED', 'RESPONSE_UNAVAILABLE']);
  expectErrors('logistics', 'logisticsNeedsIncrease', ['CYCLE_FROZEN', 'CYCLE_SEALED']);
  expectErrors('logistics', 'logisticsNeedsReduce', ['CYCLE_FROZEN', 'CYCLE_SEALED']);
  expectErrors('logistics', 'logisticsNeedsCancel', ['CYCLE_SEALED', 'STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsNeedsCreateCommitment', ['CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsNeedsCreate', ['VALIDATION_FAILED']);
  expectErrors('logistics', 'logisticsFulfillmentCyclesFreeze', ['STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsFulfillmentCyclesSeal', ['CYCLE_FROZEN', 'CYCLE_SEALED', 'STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsFulfillmentCyclesUnseal', ['STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsDistributionsCreate', ['VALIDATION_FAILED', 'RESPONSE_UNAVAILABLE', 'CAMPAIGN_PAUSED', 'CAMPAIGN_NOT_ACTIVE']);
  expectErrors('logistics', 'logisticsDonationsCreateDelivery', ['DRIVE_WINDOW_CLOSED']);
  expectErrors('logistics', 'logisticsDonationReceiptsCreate', ['STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsDonationReceiptsReview', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsDistributionsApprove', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID']);
  expectErrors('logistics', 'logisticsDistributionsCancel', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'ALREADY_DISPATCHED']);
  expectErrors('logistics', 'logisticsDistributionsDispatch', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'APPROVAL_STALE']);
  expectErrors('logistics', 'logisticsDistributionsReviewLoss', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'HANDOFF_KIND_INVALID']);
  assert.equal(operationById(documents.logistics, 'logisticsDistributionsReviewLoss').responses['409'].content['application/json'].examples.LOSS_REVIEW_REQUIRED, undefined, 'LOSS_REVIEW_REQUIRED belongs to reconcile');
  expectErrors('logistics', 'logisticsDistributionsCreateHandoff', ['STATE_TRANSITION_INVALID', 'HANDOFF_KIND_INVALID']);
  expectErrors('logistics', 'logisticsDistributionsReplaceLines', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'ALREADY_DISPATCHED']);
  expectErrors('logistics', 'logisticsDistributionsPrepareFromCommitments', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'ALREADY_DISPATCHED']);
  expectErrors('logistics', 'logisticsDistributionsReconcile', ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'LOSS_REVIEW_REQUIRED']);
  expectErrors('logistics', 'logisticsStockReviewAdjustment', ['STATE_TRANSITION_INVALID']);
  for (const operationId of [
    'logisticsNeedsCreate', 'logisticsNeedsIncrease', 'logisticsNeedsReduce', 'logisticsNeedsCreateCommitment',
    'logisticsNeedsReleaseCommitment', 'logisticsDrivesCreate', 'logisticsDrivesPatch',
    'logisticsDonationsCreateDelivery', 'logisticsDonationsReviseDeclaration', 'logisticsDonationsAssistedDeclaration',
    'logisticsDonationReceiptsCount', 'logisticsDistributionsCreate', 'logisticsDistributionsReplaceLines',
    'logisticsDistributionsCreateHandoff', 'logisticsStockCreateAdjustment', 'logisticsStockOpening',
  ]) expectErrors('logistics', operationId, ['QUANTITY_SCALE_INVALID']);
  for (const operationId of [
    'logisticsNeedsReleaseCommitment',
    'logisticsDistributionsApprove', 'logisticsDistributionsCancel', 'logisticsDistributionsDispatch',
    'logisticsDistributionsReviewLoss', 'logisticsDistributionsPrepareFromCommitments',
    'logisticsDistributionsReconcile', 'logisticsDistributionsReplaceLines',
    'logisticsDonationsAssistedDeclaration', 'logisticsDrivesPatch', 'logisticsDrivesClose',
    'logisticsDrivesOpen', 'logisticsDrivesPause', 'logisticsDrivesResume',
    'logisticsDonationReceiptsCount', 'logisticsDonationReceiptsPost', 'logisticsDonationReceiptsReleaseHeld',
    'logisticsDonationReceiptsReview', 'logisticsCatalogDeactivateItem', 'logisticsNeedsCancel',
    'logisticsNeedsIncrease', 'logisticsNeedsReduce', 'logisticsDonationsReviseDeclaration',
    'logisticsAssetsPatchReliefPoint', 'logisticsAssetsDeactivateReliefPoint',
    'logisticsAssetsPatchVehicle', 'logisticsAssetsDeactivateVehicle',
    'logisticsAssetsPatchWarehouse', 'logisticsAssetsDeactivateWarehouse',
  ]) expectErrors('logistics', operationId, ['VERSION_CONFLICT']);
  for (const operationId of ['logisticsDrivesPatch', 'logisticsDrivesClose', 'logisticsDrivesOpen', 'logisticsDrivesPause', 'logisticsDrivesResume', 'logisticsStockReviewAdjustment']) {
    expectErrors('logistics', operationId, ['STATE_TRANSITION_INVALID']);
  }
});

test('documented request and report fields are carried in the per-service contracts', () => {
  const logistics = exportService('logistics').document;
  const response = exportService('response').document;
  const needs = operationAt(logistics, 'post', '/needs');
  const requestSchema = needs.requestBody.content['application/json'].schema;
  const responseSchema = needs.responses['201'].content['application/json'].schema;
  assert.deepEqual(requestSchema.properties.delivery_target_kind.enum, ['FINAL_RECIPIENT']);
  assert.equal(requestSchema.required?.includes('delivery_target_kind') ?? false, false, 'delivery_target_kind is optional');
  assert.ok(responseSchema.properties.delivery_target_kind);
  assert.equal(needs['x-c48-contract-gap'], undefined);
  for (const field of ['id', 'cycle_id', 'request_id', 'work_cycle', 'organization_id', 'region_code', 'campaign_id', 'item_id', 'item', 'original_quantity', 'requested_quantity', 'cancelled_remaining', 'delivery_target_kind', 'designated_point_id', 'status', 'version', 'created_at']) {
    assert.ok(responseSchema.properties[field], `created need includes ${field}`);
  }

  const reconciliation = operationAt(logistics, 'get', '/reconciliation').responses['200'].content['application/json'].schema.properties.items.items.properties;
  assert.ok(reconciliation.item);
  assert.ok(reconciliation.unit);
  assert.ok(reconciliation.flags.properties.balance_mismatch);
  assert.ok(reconciliation.flags.properties.commitment_counter_mismatch);
  const stock = operationAt(logistics, 'get', '/reports/stock-summary').responses['200'].content['application/json'].schema.properties.items.items.properties;
  assert.ok(stock.warehouse_id);
  assert.ok(stock.item);
  assert.ok(stock.unit);
  assert.ok(stock.held);
  assert.ok(stock.in_transit);
  const publicDonation = operationAt(logistics, 'get', '/public/donation-reports/summary').responses['200'].content['application/json'].schema.properties.items.items.oneOf;
  assert.ok(publicDonation.every((variant) => variant.properties.item && variant.properties.unit));
  const teamDetail = operationAt(response, 'get', '/teams/{id}');
  const teamProperties = teamDetail.responses['200'].content['application/json'].schema.properties;
  assert.ok(teamProperties.name);
  assert.ok(teamProperties.skills);
  assert.ok(teamProperties.availability);

  for (const pathItem of Object.values(logistics.paths)) {
    for (const operation of Object.values(pathItem)) {
      for (const parameter of operation?.parameters ?? []) {
        if (parameter.in === 'query' && parameter.name === 'limit') assert.equal(parameter.schema.maximum, 100);
      }
    }
  }

  const fulfillment = operationById(logistics, 'logisticsReportsFulfillmentSummary').responses['200'].content['application/json'].schema;
  const fulfillmentRow = fulfillment.properties.items.items;
  for (const field of ['id', 'request_id', 'cycle_id', 'work_cycle', 'region_code', 'campaign_id', 'item', 'unit', 'original', 'reduced', 'cancelled_remaining', 'active_requested', 'delivered', 'active_outstanding', 'status']) {
    assert.ok(fulfillmentRow.properties[field], `fulfillment report row includes ${field}`);
  }
  assert.ok(fulfillmentRow.properties.item.properties.id);
  assert.ok(fulfillmentRow.properties.unit.properties.display_name);
  assert.equal(fulfillmentRow.properties.cancelled_remainder, undefined);

  const reconciliationRow = operationAt(logistics, 'get', '/reconciliation').responses['200'].content['application/json'].schema.properties.items.items;
  for (const field of ['item', 'unit', 'intake_accepted', 'posted_movements', 'posted_reserved_movements', 'reserved', 'issued_in_transit', 'at_point', 'delivered', 'returned', 'lost', 'flags']) {
    assert.ok(reconciliationRow.properties[field], `reconciliation row includes ${field}`);
  }
  assert.ok(reconciliationRow.properties.item.properties.id);
  assert.ok(reconciliationRow.properties.unit.properties.display_name);
  assert.ok(reconciliationRow.properties.flags.properties.balance_mismatch);
  assert.ok(reconciliationRow.properties.flags.properties.commitment_counter_mismatch);
});

test('source-defined resolution, team, and asset projections have complete schemas', () => {
  const response = exportService('response').document;
  const logistics = exportService('logistics').document;
  const schema = (document, method, routePath, status = '200') => operationAt(document, method, routePath).responses[status].content['application/json'].schema;

  for (const routePath of ['/requests/{requestId}/close', '/requests/{requestId}/reopen']) {
    const operation = operationAt(response, 'post', routePath);
    assert.equal(operation['x-c48-contract-gap'], undefined);
    const properties = schema(response, 'post', routePath).properties;
    for (const field of ['id', 'status', 'version', 'work_cycle']) assert.ok(properties[field], `${routePath} returns ${field}`);
  }

  const skills = schema(response, 'get', '/skills').properties.items.items.properties;
  assert.ok(skills.code);
  assert.ok(skills.display_name);

  const teamFields = ['id', 'name', 'kind', 'reporting_mode', 'availability', 'status', 'skills', 'position', 'version'];
  const listOperation = operationAt(response, 'get', '/teams');
  assert.equal(listOperation['x-c48-contract-gap'], undefined);
  const listSchema = schema(response, 'get', '/teams');
  assert.ok(listSchema.properties.more);
  assert.ok(listSchema.properties.cursor);
  for (const field of teamFields) assert.ok(listSchema.properties.items.items.properties[field], `team list returns ${field}`);
  const teamViewOperations = [
    operationAt(response, 'post', '/teams'),
    operationAt(response, 'get', '/teams/{id}'),
    operationAt(response, 'patch', '/teams/{id}'),
  ];
  for (const operation of teamViewOperations) {
    assert.equal(operation['x-c48-contract-gap'], undefined);
    const properties = operation.responses[operation === teamViewOperations[0] ? '201' : '200'].content['application/json'].schema.properties;
    for (const field of teamFields) assert.ok(properties[field], `team response returns ${field}`);
    assert.deepEqual(properties.availability.enum, ['AVAILABLE', 'UNAVAILABLE']);
    const position = properties.position.anyOf.find((variant) => variant.type === 'object');
    assert.deepEqual(position.properties.source.enum, ['GPS', 'MANUAL_PIN', 'COORDINATOR_REPORTED']);
  }

  const assetFields = {
    '/warehouses': ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'location_public'],
    '/relief-points': ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location'],
    '/vehicles': ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'identifier', 'vehicle_type', 'capacity', 'capacity_unit'],
  };
  for (const [routePath, fields] of Object.entries(assetFields)) {
    const operation = operationAt(logistics, 'get', routePath);
    assert.equal(operation['x-c48-contract-gap'], undefined);
    const properties = schema(logistics, 'get', routePath).properties.items.items.properties;
    for (const field of fields) assert.ok(properties[field], `${routePath} item includes ${field}`);
  }
});

test('source-defined Logistics projections and collection envelopes match their query mappers', () => {
  const logistics = exportService('logistics').document;
  const expectFields = (operationId, pathParts, fields) => {
    const operation = operationById(logistics, operationId);
    assert.ok(operation, `${operationId} exists`);
    assert.equal(operation['x-c48-contract-gap'], undefined, `${operationId} has no false projection gap`);
    assertSchemaFields(logistics, successSchema(logistics, operation), pathParts, fields, operationId);
  };
  const expectCollectionEnvelope = (operationId, rowFields, cursorField = 'cursor') => {
    expectFields(operationId, [], ['items', 'more', cursorField]);
    expectFields(operationId, ['items', '[]'], rowFields);
  };

  const distributionFields = [
    'id', 'warehouse_id', 'organization_id', 'relief_point_id', 'vehicle_id', 'campaign_id', 'purpose', 'status',
    'preparer_user_id', 'approver_user_id', 'approved_version', 'dispatch_actor_user_id', 'dispatched_at',
    'reconciled_at', 'created_at', 'version', 'vehicle_capacity_exceeded', 'lines',
  ];
  const distributionLineFields = [
    'id', 'item_id', 'item_name', 'unit', 'commitment_id', 'delivery_target_kind', 'quantity', 'dispatched',
    'received', 'handed_out', 'returned', 'lost', 'pending_loss_count', 'in_transit', 'at_point',
  ];
  expectFields('logisticsDistributionsList', ['items', '[]'], distributionFields);
  expectFields('logisticsDistributionsList', ['items', '[]', 'lines', '[]'], distributionLineFields);
  expectFields('logisticsDistributionsList', ['items', '[]', 'lines', '[]', 'unit'], ['code', 'scale']);
  for (const operationId of [
    'logisticsDistributionsDetail', 'logisticsDistributionsCreate', 'logisticsDistributionsApprove',
    'logisticsDistributionsCancel', 'logisticsDistributionsDispatch', 'logisticsDistributionsReplaceLines',
    'logisticsDistributionsPrepareFromCommitments', 'logisticsDistributionsReconcile',
  ]) {
    expectFields(operationId, [], distributionFields);
    expectFields(operationId, ['lines', '[]'], distributionLineFields);
    expectFields(operationId, ['lines', '[]', 'unit'], ['code', 'scale']);
  }

  const handoffFields = [
    'id', 'distribution_id', 'handoff_kind', 'source_stage', 'receiver_user_id', 'receiver_label',
    'recorder_user_id', 'confirmation_basis', 'occurred_at', 'created_at', 'version', 'status', 'review', 'lines',
  ];
  for (const operationId of ['logisticsDistributionsCreateHandoff', 'logisticsDistributionsReviewLoss']) {
    expectFields(operationId, [], handoffFields);
    expectFields(operationId, ['lines', '[]'], ['id', 'distribution_line_id', 'commitment_id', 'quantity', 'unit_code']);
  }

  for (const [operationId, rowFields] of [
    ['logisticsCatalogItemTypes', ['code', 'display_name']],
    ['logisticsCatalogUnits', ['code', 'display_name', 'scale']],
    ['logisticsCatalogItems', ['id', 'item_type', 'unit', 'name', 'status', 'version', 'created_at']],
  ]) {
    expectFields(operationId, [], ['items', 'next_cursor']);
    expectFields(operationId, ['items', '[]'], rowFields);
    const schema = successSchema(logistics, operationById(logistics, operationId));
    assert.equal(schema.properties.more, undefined, `${operationId} does not use a more page envelope`);
    assert.equal(schema.properties.cursor, undefined, `${operationId} uses next_cursor`);
  }
  expectFields('logisticsCatalogItems', ['items', '[]', 'item_type'], ['code', 'display_name']);
  expectFields('logisticsCatalogItems', ['items', '[]', 'unit'], ['code', 'display_name', 'scale']);
  for (const operationId of ['logisticsCatalogCreateItemType', 'logisticsCatalogCreateUnit']) {
    expectFields(operationId, [], ['code', 'display_name']);
  }
  expectFields('logisticsCatalogCreateUnit', [], ['scale']);
  for (const operationId of ['logisticsCatalogCreateItem', 'logisticsCatalogDeactivateItem']) {
    expectFields(operationId, [], ['id', 'item_type', 'unit', 'name', 'status', 'version', 'created_at']);
  }

  expectCollectionEnvelope('logisticsStockBalances', [
    'balance_id', 'warehouse_id', 'item_id', 'item_name', 'item_type', 'unit_code', 'unit', 'scale', 'on_hand', 'reserved', 'available',
  ]);
  assert.equal(schemaAt(logistics, successSchema(logistics, operationById(logistics, 'logisticsStockBalances')), ['items', '[]', 'unit']).type, 'string');
  expectCollectionEnvelope('logisticsStockAdjustments', [
    'id', 'balance_id', 'warehouse_id', 'item_id', 'item_name', 'unit_code', 'delta_on_hand', 'status', 'requested_at', 'reviewed_at',
  ]);
  assert.equal(schemaAt(logistics, successSchema(logistics, operationById(logistics, 'logisticsStockAdjustments')), ['items', '[]']).properties.reason, undefined);

  expectCollectionEnvelope('logisticsDonationReceiptsDeliveries', [
    'id', 'drive_id', 'drive_title', 'public_code', 'donor_name', 'donor_phone', 'status', 'version', 'receipt_id', 'created_at',
  ]);
  expectCollectionEnvelope('logisticsDonationReceiptsDisputes', [
    'id', 'delivery_id', 'status', 'opened_by_kind', 'reason', 'resolution_note', 'opened_at', 'resolved_at',
    'public_code', 'drive_id', 'drive_title', 'donor_phone',
  ]);

  const receiptFields = ['id', 'delivery_id', 'warehouse_id', 'version', 'created_at', 'public_code', 'donor_name', 'donor_phone', 'delivery_status', 'drive_id', 'drive_title', 'warehouse_name', 'delivery', 'count', 'review'];
  const receiptLineFields = ['item_id', 'item_name', 'unit_code', 'unit_name', 'declared_quantity', 'counted_quantity', 'accepted_quantity', 'held_quantity', 'rejected_quantity', 'condition_note', 'flags'];
  for (const operationId of [
    'logisticsDonationReceiptsReceipt', 'logisticsDonationReceiptsCreate', 'logisticsDonationReceiptsCount', 'logisticsDonationReceiptsPost',
    'logisticsDonationReceiptsReleaseHeld', 'logisticsDonationReceiptsReview',
  ]) {
    expectFields(operationId, [], receiptFields);
    expectFields(operationId, ['delivery'], ['id', 'drive_id', 'drive_title', 'public_code', 'donor_name', 'donor_phone', 'status']);
    expectFields(operationId, ['count', 'lines', '[]'], receiptLineFields);
  }
  const receiptLine = schemaAt(logistics, successSchema(logistics, operationById(logistics, 'logisticsDonationReceiptsReceipt')), ['count', 'lines', '[]']);
  assert.ok(schemaAt(logistics, receiptLine, ['declared_quantity']).anyOf?.some((variant) => variant.type === 'null'), 'unexpected receipt items may have no declared quantity');
  assert.equal(receiptLine.required?.includes('expiry_date') ?? false, false, 'receipt expiry date is omitted when absent');
  expectFields('logisticsDonationReceiptsReceipt', [], ['generated_at']);

  for (const operationId of ['logisticsFulfillmentCyclesFreeze', 'logisticsFulfillmentCyclesSeal', 'logisticsFulfillmentCyclesUnseal']) {
    expectFields(operationId, [], ['intent_id', 'request_id', 'work_cycle', 'cycle_state']);
  }

  const needFields = [
    'id', 'cycle_id', 'request_id', 'work_cycle', 'organization_id', 'region_code', 'campaign_id', 'item_id', 'item',
    'original_quantity', 'requested_quantity', 'cancelled_remaining', 'delivery_target_kind', 'designated_point_id', 'status', 'version', 'created_at',
  ];
  for (const operationId of ['logisticsNeedsCancel', 'logisticsNeedsIncrease', 'logisticsNeedsReduce']) {
    expectFields(operationId, [], needFields);
    expectFields(operationId, ['item'], ['id', 'name', 'unit']);
    expectFields(operationId, ['item', 'unit'], ['code', 'display_name', 'scale']);
  }
  expectFields('logisticsNeedsCreateCommitment', [], [
    'id', 'relief_need_id', 'item_id', 'warehouse_id', 'quantity', 'released_quantity', 'issued_quantity',
    'delivered_quantity', 'returned_quantity', 'lost_quantity', 'reserved_remaining', 'version',
  ]);
  expectFields('logisticsNeedsReleaseCommitment', [], [
    'id', 'relief_need_id', 'item_id', 'warehouse_id', 'quantity', 'released_quantity', 'issued_quantity',
    'delivered_quantity', 'returned_quantity', 'lost_quantity', 'reserved_remaining', 'version',
  ]);

  for (const operationId of ['logisticsNeedsList', 'logisticsNeedsFulfillment', 'logisticsNeedsInternalFulfillment']) {
    const operation = operationById(logistics, operationId);
    const needsPath = operationId === 'logisticsNeedsList' ? ['items', '[]'] : ['needs', '[]'];
    expectFields(operationId, [...needsPath, 'unit'], ['code', 'display_name', 'scale']);
  }
  expectFields('logisticsNeedsList', ['items', '[]'], [
    'cycle_id', 'request_id', 'work_cycle', 'version', 'created_at', 'item', 'unit', 'original', 'requested',
    'committed_reserved', 'issued_unsettled', 'delivered', 'returned', 'lost', 'outstanding', 'cancelled_remaining', 'status',
  ]);

  expectFields('logisticsDonationsReviseDeclaration', [], ['id', 'status', 'declaration_revision', 'version']);
  expectFields('logisticsDonationsOpenDispute', [], ['id', 'status', 'reason', 'opened_at']);
  expectFields('logisticsDonationsTrack', [], ['id', 'public_code', 'status', 'declaration', 'receipt', 'disputes', 'progress']);
  expectFields('logisticsDonationsTrack', ['declaration'], ['revision', 'created_by_kind', 'lines']);
  expectFields('logisticsDonationsTrack', ['declaration', 'lines', '[]'], ['item_id', 'item_name', 'unit_name', 'declared_quantity']);
  expectFields('logisticsDonationsTrack', ['receipt'], ['count_revision', 'lines']);
  expectFields('logisticsDonationsTrack', ['receipt', 'lines', '[]'], ['item_id', 'declared_quantity', 'counted_quantity', 'accepted_quantity', 'held_quantity', 'rejected_quantity', 'condition_note']);
  const trackedReceiptLine = schemaAt(logistics, successSchema(logistics, operationById(logistics, 'logisticsDonationsTrack')), ['receipt', 'lines', '[]']);
  assert.ok(schemaAt(logistics, trackedReceiptLine, ['declared_quantity']).anyOf?.some((variant) => variant.type === 'null'), 'tracked unexpected receipt items may have no declared quantity');
  expectFields('logisticsDonationsTrack', ['disputes', '[]'], ['id', 'status', 'reason', 'opened_at', 'resolution_note']);
  expectFields('logisticsDonationsTrack', ['progress'], ['status']);

  const assetCommandFields = {
    logisticsAssetsCreateWarehouse: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'location_public', 'address_note'],
    logisticsAssetsPatchWarehouse: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'location_public', 'address_note'],
    logisticsAssetsDeactivateWarehouse: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'location_public', 'address_note'],
    logisticsAssetsCreateReliefPoint: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'contact_note', 'operating_note'],
    logisticsAssetsPatchReliefPoint: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'contact_note', 'operating_note'],
    logisticsAssetsDeactivateReliefPoint: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'name', 'location', 'contact_note', 'operating_note'],
    logisticsAssetsCreateVehicle: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'identifier', 'vehicle_type', 'capacity', 'capacity_unit'],
    logisticsAssetsPatchVehicle: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'identifier', 'vehicle_type', 'capacity', 'capacity_unit'],
    logisticsAssetsDeactivateVehicle: ['id', 'organization_id', 'region_code', 'status', 'version', 'created_at', 'identifier', 'vehicle_type', 'capacity', 'capacity_unit'],
  };
  for (const [operationId, fields] of Object.entries(assetCommandFields)) expectFields(operationId, [], fields);

  expectFields('logisticsStockCreateAdjustment', [], ['id', 'balance_id', 'delta_on_hand', 'reason', 'status', 'review_note', 'requested_at', 'reviewed_at']);
  expectFields('logisticsStockReviewAdjustment', [], ['id', 'balance_id', 'delta_on_hand', 'reason', 'status', 'review_note', 'requested_at', 'reviewed_at']);
  expectFields('logisticsStockOpening', [], ['warehouse_id', 'items']);
  expectFields('logisticsStockOpening', ['items', '[]'], ['balance_id', 'item_id', 'on_hand', 'reserved', 'available']);

  expectCollectionEnvelope('logisticsDrivesPublicList', [
    'id', 'title', 'description', 'status', 'campaign_status', 'campaign_status_at', 'opens_at', 'closes_at',
    'intake_location', 'items', 'created_at',
  ]);
  expectFields('logisticsDrivesPublicList', ['items', '[]', 'intake_location'], ['warehouse_name', 'address_note', 'location']);
  expectFields('logisticsDrivesPublicList', ['items', '[]', 'items', '[]'], [
    'item_id', 'item_name', 'item_type_name', 'unit_code', 'unit_name', 'scale', 'target_quantity', 'acceptance_note', 'accepted_total',
  ]);
  expectFields('logisticsDrivesPublicDetail', [], [
    'id', 'title', 'description', 'status', 'campaign_status', 'campaign_status_at', 'opens_at', 'closes_at',
    'intake_location', 'items', 'created_at', 'generated_at',
  ]);
  expectFields('logisticsDrivesList', [], ['items', 'more', 'cursor']);
  expectFields('logisticsDrivesList', ['items', '[]'], [
    'id', 'organization_id', 'intake_warehouse_id', 'campaign_id', 'campaign_status', 'campaign_status_at', 'status',
    'title', 'description', 'opens_at', 'closes_at', 'version', 'created_at', 'cursor_created_at', 'items',
  ]);
  expectFields('logisticsDrivesList', ['items', '[]', 'items', '[]'], ['drive_id', 'item_id', 'item_name', 'item_type_name', 'unit_code', 'unit_name', 'scale', 'target_quantity', 'acceptance_note', 'accepted_total']);
  for (const operationId of ['logisticsDrivesCreate', 'logisticsDrivesPatch', 'logisticsDrivesOpen', 'logisticsDrivesPause', 'logisticsDrivesResume', 'logisticsDrivesClose']) {
    expectFields(operationId, [], [
      'id', 'organization_id', 'intake_warehouse_id', 'campaign_id', 'campaign_status', 'campaign_status_at', 'status',
      'title', 'description', 'opens_at', 'closes_at', 'version', 'created_at', 'items',
    ]);
    expectFields(operationId, ['items', '[]'], ['item_id', 'item_name', 'target_quantity', 'acceptance_note', 'item_type_name', 'unit_code', 'unit_name', 'scale']);
  }

  const needsRows = schemaAt(logistics, successSchema(logistics, operationById(logistics, 'logisticsNeedsList')), ['items', '[]']).properties;
  assert.equal(needsRows.unit.properties.name, undefined, 'needs use unit.display_name');
});

test('Logistics audit OpenAPI records its DTO constraints and validation error', () => {
  const logistics = exportService('logistics').document;
  const operation = operationById(logistics, 'logisticsAuditList');
  const parameters = Object.fromEntries(operation.parameters.map((parameter) => {
    const resolved = dereferenceParameter(logistics, parameter);
    return [resolved.name, resolved];
  }));

  assert.deepEqual(parameters.entity_type.schema, {
    type: 'string', minLength: 2, maxLength: 64, pattern: '^[a-z][a-z0-9_]{1,63}$',
  });
  assert.deepEqual(parameters.entity_id.schema, { type: 'string', maxLength: 200 });
  assert.deepEqual(parameters.cursor.schema, { type: 'string', maxLength: 2048 });
  assert.equal(parameters.entity_type.required, true);
  assert.deepEqual(successSchema(logistics, operation).required, ['items', 'next_cursor']);
  assert.equal(operation.responses['400'].content['application/json'].examples.VALIDATION_FAILED.value.code, 'VALIDATION_FAILED');
});

test('Response advisory contracts allow insufficient evidence and reject stale reviews', () => {
  const response = exportService('response').document;
  const detail = response.components.schemas.StaffRequestDetail.properties;
  const rules = detail.priority_advisory;
  const aiPriority = detail.ai_priority_advisory.anyOf.find((variant) => variant.type === 'object');
  const aiRecord = detail.ai_advisory.anyOf.find((variant) => variant.type === 'object');

  assert.deepEqual(rules.properties.outcome.enum, ['SUGGESTION', 'INSUFFICIENT_DATA']);
  assert.ok(rules.properties.score.anyOf.some((variant) => variant.type === 'null'));
  assert.ok(rules.properties.level.anyOf.some((variant) => variant.type === 'null'));
  assert.ok(aiPriority.properties.status.enum.includes('STALE'));
  assert.ok(aiRecord.properties.status.enum.includes('STALE'));

  const review = operationById(response, 'responseRequestOperationsReviewAiAdvisory');
  const body = review.requestBody.content['application/json'].schema;
  assert.ok(body.required.includes('expected_version'));
  assert.equal(body.properties.expected_version.minimum, 1);
  assert.ok(review.responses['409']?.content?.['application/json']?.examples?.VERSION_CONFLICT);
});
