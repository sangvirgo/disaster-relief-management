import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { applyOpenApiDetails } from './openapi-details.mjs';

const serviceNames = ['identity', 'response', 'logistics'];
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const nestMethodNames = new Map([
  ['Get', 'get'], ['Post', 'post'], ['Put', 'put'], ['Patch', 'patch'],
  ['Delete', 'delete'], ['Options', 'options'], ['Head', 'head'],
]);
const httpStatusCodes = { OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204 };

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function decoratorCall(decorator) {
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return null;
  return { name: expression.expression.text, args: expression.arguments };
}

function routeArgument(args, sourceFile) {
  const argument = args[0];
  if (!argument) return '';
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text.replaceAll('\\:', ':');
  throw new Error(`Route decorators must use a static string in ${sourceFile.fileName}:${argument.getStart(sourceFile)}`);
}

function joinRoute(controllerPath, methodPath) {
  const segments = [controllerPath, methodPath]
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .map((part) => part.startsWith(':') ? `{${part.slice(1)}}` : part);
  return `/${segments.join('/')}`;
}

function successStatus(method, methodDecorators, sourceFile, node) {
  const httpCode = methodDecorators.map(decoratorCall).find((call) => call?.name === 'HttpCode');
  if (httpCode) {
    const value = httpCode.args[0];
    if (value && ts.isNumericLiteral(value)) return Number(value.text);
    if (value && ts.isPropertyAccessExpression(value) && value.expression.getText(sourceFile) === 'HttpStatus') {
      const status = httpStatusCodes[value.name.text];
      if (status) return status;
    }
    throw new Error(`Unsupported @HttpCode value in ${sourceFile.fileName}:${node.getStart(sourceFile)}`);
  }
  return method === 'post' ? 201 : 200;
}

export function routesFromSourceText(sourceText, sourceFileName) {
  const sourceFile = ts.createSourceFile(sourceFileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      const classDecorators = decoratorsOf(node);
      const controllerCall = classDecorators.map(decoratorCall).find((call) => call?.name === 'Controller');
      if (controllerCall) {
        const controllerPath = routeArgument(controllerCall.args, sourceFile);
        const controller = node.name?.text ?? path.basename(sourceFileName, '.ts');
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
          const methodDecorators = decoratorsOf(member);
          for (const decorator of methodDecorators) {
            const call = decoratorCall(decorator);
            const method = call && nestMethodNames.get(call.name);
            if (!method) continue;
            routes.push({
              method,
              path: joinRoute(controllerPath, routeArgument(call.args, sourceFile)),
              controller,
              handler: member.name.text,
              sourceFile: sourceFileName.replaceAll(path.sep, '/'),
              successStatus: successStatus(method, methodDecorators, sourceFile, member),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

function walkControllers(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkControllers(entryPath);
    return entry.isFile() && entry.name.endsWith('.controller.ts') ? [entryPath] : [];
  });
}

export function collectControllerRoutes(sourceRoot) {
  return walkControllers(sourceRoot)
    .flatMap((file) => routesFromSourceText(fs.readFileSync(file, 'utf8'), path.relative(sourceRoot, file)))
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

function pascalCase(value) {
  return value.replace(/(^|[-_./])([a-z0-9])/giu, (_match, _separator, letter) => letter.toUpperCase());
}

function operationId(service, route) {
  const controller = route.controller.replace(/Controller$/u, '');
  return `${service}${pascalCase(controller)}${pascalCase(route.handler)}`;
}

function pathParameters(routePath) {
  return [...routePath.matchAll(/\{([^}]+)\}/gu)].map(([, name]) => ({
    in: 'path',
    name,
    required: true,
    schema: { type: 'string' },
  }));
}

export function emptyOpenApiDocument(service) {
  const title = `${pascalCase(service)} API`;
  return {
    openapi: '3.1.0',
    info: {
      title: `C48 ${title}`,
      version: '1.0.0',
      description: `Route inventory exported from the ${title} NestJS controllers. Request, response, and error details are maintained in docs/backend/${service === 'identity' ? '02-identity' : service === 'response' ? '03-response' : '04-logistics'}-api.md.`,
    },
    servers: [{ url: `/api/v1/${service}` }],
    paths: {},
    components: { schemas: {} },
  };
}

function routeKey(method, routePath) {
  return `${method} ${routePath.replace(/\{[^}]+\}/gu, '{}')}`;
}

export function exportOpenApi(document, routes, service, contractSource) {
  const exported = structuredClone(document);
  exported.paths ??= {};
  const actual = new Set(routes.map((route) => routeKey(route.method, route.path)));

  for (const [routePath, pathItem] of Object.entries(exported.paths)) {
    for (const method of Object.keys(pathItem)) {
      if (httpMethods.has(method) && !actual.has(routeKey(method, routePath))) delete pathItem[method];
    }
    if (!Object.keys(pathItem).some((key) => httpMethods.has(key))) delete exported.paths[routePath];
  }

  for (const route of routes) {
    const existingPath = Object.keys(exported.paths).find((candidate) => routeKey(route.method, candidate) === routeKey(route.method, route.path));
    const pathItem = exported.paths[existingPath ?? route.path] ??= {};
    const source = `backend/apps/${service}/src/${route.sourceFile}#${route.controller}.${route.handler}`;
    if (!pathItem[route.method]) {
      pathItem[route.method] = {
        operationId: operationId(service, route),
        summary: `${route.controller}.${route.handler}`,
        description: `Route exported from ${source}. Detailed request, response, and error contract: ${contractSource}. This export does not infer payload schemas.`,
        ...(pathParameters(route.path).length ? { parameters: pathParameters(route.path) } : {}),
        responses: {
          [String(route.successStatus)]: {
            description: `Success response; see ${contractSource} for the documented response shape.`,
          },
        },
        'x-c48-contract-source': contractSource,
      };
    }
    pathItem[route.method]['x-c48-controller-source'] = source;
  }
  return applyOpenApiDetails(exported, service);
}

function resolveJsonPointer(document, ref) {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, document);
}

function pathItemReferenceErrors(document) {
  return Object.entries(document?.paths ?? {})
    .filter(([, pathItem]) => typeof pathItem?.$ref === 'string')
    .map(([routePath, pathItem]) => `unsupported Path Item $ref at ${routePath}: ${pathItem.$ref}`);
}

export function validateOpenApi(document, routes, service) {
  const errors = [];
  if (document?.openapi !== '3.1.0') errors.push('openapi must be 3.1.0');
  if (!document?.info?.title || !document?.info?.version) errors.push('info.title and info.version are required');
  if (!document?.servers?.some((server) => server.url === `/api/v1/${service}`)) errors.push(`server URL /api/v1/${service} is required`);
  if (!document?.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) {
    errors.push('paths must be an object');
    return errors;
  }

  errors.push(...pathItemReferenceErrors(document));
  const expected = new Set(routes.map((route) => routeKey(route.method, route.path)));
  const routeCounts = new Map();
  for (const route of routes) {
    const key = routeKey(route.method, route.path);
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of routeCounts) {
    if (count > 1) {
      const [method, routePath] = key.split(' ');
      errors.push(`duplicate controller route: ${method.toUpperCase()} ${routePath}`);
    }
  }
  const seenOperationIds = new Set();
  const actual = new Set();
  const visitRefs = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/') && resolveJsonPointer(document, value.$ref) === undefined) {
      errors.push(`unresolved local reference ${value.$ref}`);
    }
    for (const child of Object.values(value)) visitRefs(child);
  };
  const validateParameterSet = (parameters, owner) => {
    if (!Array.isArray(parameters)) return;
    const seenParameters = new Set();
    for (const parameter of parameters) {
      const resolved = parameter?.$ref ? resolveJsonPointer(document, parameter.$ref) : parameter;
      if (typeof resolved?.in !== 'string' || typeof resolved?.name !== 'string') continue;
      const key = `${resolved.in}:${resolved.name}`;
      if (seenParameters.has(key)) errors.push(`${owner} has duplicate parameter ${key}`);
      seenParameters.add(key);
    }
  };

  for (const [routePath, pathItem] of Object.entries(document.paths)) {
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) {
      errors.push(`${routePath} must be a path item`);
      continue;
    }
    validateParameterSet(pathItem.parameters, `${routePath} path parameters`);
    visitRefs(pathItem);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method)) continue;
      const key = `${method} ${routePath}`;
      const normalizedKey = routeKey(method, routePath);
      actual.add(normalizedKey);
      if (!operation || typeof operation !== 'object') {
        errors.push(`${key} must be an operation object`);
        continue;
      }
      if (typeof operation.operationId !== 'string' || !operation.operationId.trim()) errors.push(`${key} requires operationId`);
      else if (seenOperationIds.has(operation.operationId)) errors.push(`duplicate operationId ${operation.operationId}`);
      else seenOperationIds.add(operation.operationId);
      if (typeof operation['x-c48-controller-source'] !== 'string' || !operation['x-c48-controller-source'].trim()) errors.push(`${key} requires controller source provenance`);
      if (!Array.isArray(operation.security)) errors.push(`${key} requires an explicit security declaration`);
      else for (const requirement of operation.security) {
        for (const scheme of Object.keys(requirement ?? {})) {
          if (!document.components?.securitySchemes?.[scheme]) errors.push(`${key} references unknown security scheme ${scheme}`);
        }
      }
      if (!operation.responses || !Object.keys(operation.responses).length) errors.push(`${key} requires at least one response`);
      validateParameterSet(operation.parameters, key);
      for (const parameter of pathParameters(routePath)) {
        const defined = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
          .map((candidate) => candidate?.$ref ? resolveJsonPointer(document, candidate.$ref) : candidate)
          .some((candidate) => candidate?.in === 'path' && candidate.name === parameter.name && candidate.required === true);
        if (!defined) errors.push(`${key} is missing required path parameter ${parameter.name}`);
      }
    }
  }

  for (const key of expected) if (!actual.has(key)) {
    const [method, routePath] = key.split(' ');
    errors.push(`controller route missing from OpenAPI: ${method.toUpperCase()} ${routePath}`);
  }
  for (const key of actual) if (!expected.has(key)) {
    const [method, routePath] = key.split(' ');
    errors.push(`OpenAPI route missing from controllers: ${method.toUpperCase()} ${routePath}`);
  }
  visitRefs(document.components ?? {});
  return errors;
}

export function openApiSnapshotsMatch(current, exported) {
  return isDeepStrictEqual(current, exported);
}

function jsonPropertyName(property, sourceFile) {
  if (!ts.isPropertyAssignment(property)) return null;
  const name = property.name;
  return ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : null;
}

function objectProperties(objectNode, sourceFile) {
  return objectNode.properties.filter(ts.isPropertyAssignment)
    .map((property) => [jsonPropertyName(property, sourceFile), property])
    .filter(([name]) => name !== null);
}

function propertyInsertion(raw, sourceFile, objectNode, values) {
  if (!values.length) return null;
  const properties = objectProperties(objectNode, sourceFile);
  const lastProperty = properties.at(-1)?.[1];
  const position = lastProperty ? lastProperty.end : objectNode.getStart(sourceFile) + 1;
  const indent = lastProperty
    ? lastProperty.getStart(sourceFile) - (raw.lastIndexOf('\n', lastProperty.getStart(sourceFile)) + 1)
    : objectNode.getStart(sourceFile) - (raw.lastIndexOf('\n', objectNode.getStart(sourceFile)) + 1) + 2;
  const serialized = JSON.stringify(Object.fromEntries(values), null, 2).split('\n').slice(1, -1);
  const content = serialized.map((line) => `${' '.repeat(Math.max(0, indent - 2))}${line}`).join('\n');
  return { position, text: `${lastProperty ? ',' : ''}\n${content}` };
}

function objectPropertyEdits(raw, sourceFile, objectNode, values) {
  const properties = new Map(objectProperties(objectNode, sourceFile));
  const insertions = [];
  const edits = [];
  for (const [name, value] of values) {
    const property = properties.get(name);
    if (!property) {
      insertions.push([name, value]);
      continue;
    }
    let current;
    try { current = JSON.parse(property.initializer.getText(sourceFile)); }
    catch { continue; }
    if (JSON.stringify(current) === JSON.stringify(value)) continue;
    const initializer = property.initializer;
    const position = initializer.getStart(sourceFile);
    const indent = position - (raw.lastIndexOf('\n', position) + 1);
    const serialized = JSON.stringify(value, null, 2).split('\n').map((line, index) => index ? `${' '.repeat(indent)}${line}` : line).join('\n');
    edits.push({ position, end: initializer.end, text: serialized });
  }
  const insertion = propertyInsertion(raw, sourceFile, objectNode, insertions);
  if (insertion) edits.push(insertion);
  return edits;
}

export function mergeOpenApiText(raw, current, exported) {
  const sourceFile = ts.parseJsonText('openapi.json', raw);
  if (sourceFile.parseDiagnostics.length) throw new Error('Cannot insert OpenAPI operations into invalid JSON');
  const root = sourceFile.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error('OpenAPI root must be an object');
  const rootProperties = objectProperties(root, sourceFile);
  const pathsProperty = rootProperties.find(([name]) => name === 'paths')?.[1];
  const pathsNode = pathsProperty?.initializer;
  if (!pathsNode || !ts.isObjectLiteralExpression(pathsNode)) throw new Error('OpenAPI paths must be an object');

  const currentPathProperties = new Map(objectProperties(pathsNode, sourceFile));
  const exportedPaths = exported.paths ?? {};
  const exportedPathNames = new Set(Object.keys(exportedPaths));
  const edits = [];

  for (const [routePath, property] of currentPathProperties) {
    if (!exportedPathNames.has(routePath)) return `${JSON.stringify(exported, null, 2)}\n`;
    const originalItem = property.initializer;
    const newItem = exportedPaths[routePath];
    if (!ts.isObjectLiteralExpression(originalItem) || !newItem || typeof newItem !== 'object') continue;
    const originalMethodProperties = new Map(objectProperties(originalItem, sourceFile));
    const originalMethods = new Set(originalMethodProperties.keys());
    const addedOperations = Object.entries(newItem).filter(([name]) => httpMethods.has(name) && !originalMethods.has(name));
    for (const [method, operation] of Object.entries(newItem)) {
      const operationProperty = originalMethodProperties.get(method);
      if (!httpMethods.has(method) || !operationProperty || !operation || typeof operation !== 'object') continue;
      let priorOperation;
      try { priorOperation = JSON.parse(operationProperty.initializer.getText(sourceFile)); }
      catch { continue; }
      if (JSON.stringify(priorOperation) === JSON.stringify(operation)) continue;
      if (priorOperation?.['x-c48-contract-source']) {
        const position = operationProperty.getStart(sourceFile);
        const indent = position - (raw.lastIndexOf('\n', position) + 1);
        const serialized = JSON.stringify(operation, null, 2).split('\n').map((line, index) => index ? `${' '.repeat(indent + 2)}${line}` : line).join('\n');
        edits.push({ position, end: operationProperty.end, text: `${JSON.stringify(method)}: ${serialized}` });
      } else {
        const operationNode = operationProperty.initializer;
        if (ts.isObjectLiteralExpression(operationNode)) {
          edits.push(...objectPropertyEdits(raw, sourceFile, operationNode, [
            ['x-c48-controller-source', operation['x-c48-controller-source']],
            ['security', operation.security],
            ['parameters', operation.parameters],
            ['responses', operation.responses],
            ['x-c48-conditional-security', operation['x-c48-conditional-security']],
          ].filter(([, value]) => value !== undefined)));
        }
      }
    }
    const removedOperations = [...originalMethods].some((name) => httpMethods.has(name) && !Object.hasOwn(newItem, name));
    if (removedOperations) return `${JSON.stringify(exported, null, 2)}\n`;
    const insertion = propertyInsertion(raw, sourceFile, originalItem, addedOperations);
    if (insertion) edits.push(insertion);
  }

  const newPaths = Object.entries(exportedPaths).filter(([routePath]) => !currentPathProperties.has(routePath));
  const pathInsertion = propertyInsertion(raw, sourceFile, pathsNode, newPaths);
  if (pathInsertion) edits.push(pathInsertion);

  const componentsProperty = rootProperties.find(([name]) => name === 'components')?.[1];
  if (!componentsProperty) {
    edits.push(...objectPropertyEdits(raw, sourceFile, root, [['components', exported.components ?? {}]]));
  } else if (ts.isObjectLiteralExpression(componentsProperty.initializer)) {
    const componentsNode = componentsProperty.initializer;
    const componentProperties = new Map(objectProperties(componentsNode, sourceFile));
    const schemasNode = componentProperties.get('schemas')?.initializer;
    const componentInsertions = [];
    if (exported.components?.schemas?.ErrorEnvelope) {
      if (schemasNode && ts.isObjectLiteralExpression(schemasNode)) {
        edits.push(...objectPropertyEdits(raw, sourceFile, schemasNode, [['ErrorEnvelope', exported.components.schemas.ErrorEnvelope]]));
      } else {
        componentInsertions.push(['schemas', exported.components.schemas]);
      }
    }
    const schemes = exported.components?.securitySchemes ?? {};
    if (Object.keys(schemes).length) {
      const schemesNode = componentProperties.get('securitySchemes')?.initializer;
      if (schemesNode && ts.isObjectLiteralExpression(schemesNode)) {
        edits.push(...objectPropertyEdits(raw, sourceFile, schemesNode, Object.entries(schemes)));
      } else {
        componentInsertions.push(['securitySchemes', schemes]);
      }
    }
    edits.push(...objectPropertyEdits(raw, sourceFile, componentsNode, componentInsertions));
  }
  let merged = raw;
  for (const edit of edits.sort((left, right) => right.position - left.position)) {
    merged = `${merged.slice(0, edit.position)}${edit.text}${merged.slice(edit.end ?? edit.position)}`;
  }
  return merged;
}

function projectPaths() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDirectory, '../..');
  const repositoryRoot = path.resolve(backendRoot, '..');
  return { backendRoot, repositoryRoot };
}

function sourceDocument(service) {
  return `docs/backend/${service === 'identity' ? '02-identity' : service === 'response' ? '03-response' : '04-logistics'}-api.md`;
}

export function writeOpenApiSnapshotIfValid(snapshotPath, currentRaw, current, exported, routes, service) {
  const errors = validateOpenApi(exported, routes, service);
  if (errors.length) return errors;

  const content = currentRaw ? mergeOpenApiText(currentRaw, current, exported) : `${JSON.stringify(exported, null, 2)}\n`;
  fs.writeFileSync(snapshotPath, content);
  return errors;
}

export function exportOpenApiSnapshotIfValid(snapshotPath, currentRaw, current, routes, service, contractSource) {
  const sourceReferenceErrors = pathItemReferenceErrors(current);
  if (sourceReferenceErrors.length) return sourceReferenceErrors;

  const exported = exportOpenApi(current, routes, service, contractSource);
  return writeOpenApiSnapshotIfValid(snapshotPath, currentRaw, current, exported, routes, service);
}

function run() {
  const mode = process.argv[2];
  if (!['--export', '--check'].includes(mode)) throw new Error('Usage: node scripts/contracts/openapi.mjs --export|--check');
  const { backendRoot, repositoryRoot } = projectPaths();
  let failed = false;
  for (const service of serviceNames) {
    const sourceRoot = path.join(backendRoot, 'apps', service, 'src');
    const routes = collectControllerRoutes(sourceRoot);
    const snapshot = path.join(repositoryRoot, 'contracts', 'openapi', `${service}.json`);
    const currentRaw = fs.existsSync(snapshot) ? fs.readFileSync(snapshot, 'utf8') : null;
    const current = currentRaw ? JSON.parse(currentRaw) : emptyOpenApiDocument(service);
    let errors;
    if (mode === '--export') {
      errors = exportOpenApiSnapshotIfValid(snapshot, currentRaw, current, routes, service, sourceDocument(service));
    } else {
      const exported = exportOpenApi(current, routes, service, sourceDocument(service));
      errors = validateOpenApi(current, routes, service);
      if (!openApiSnapshotsMatch(current, exported)) {
        errors.push('snapshot differs from controller-derived export; run npm run contracts:export');
      }
    }
    if (errors.length) {
      failed = true;
      process.stderr.write(`${service}: ${errors.join('; ')}\n`);
    } else {
      process.stdout.write(`${service}: ${routes.length} controller operations; export ${mode === '--export' ? 'written' : 'validated'}\n`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
