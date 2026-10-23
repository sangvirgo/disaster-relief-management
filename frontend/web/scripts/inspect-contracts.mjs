import { readFileSync } from 'node:fs';

for (const service of ['identity', 'response', 'logistics']) {
  const document = JSON.parse(readFileSync(new URL(`../../../contracts/openapi/${service}.json`, import.meta.url), 'utf8'));
  console.log(`\n## ${service}`);
  for (const [path, methods] of Object.entries(document.paths)) {
    if (path.includes('/internal/')) continue;
    const operation = methods.post;
    if (!operation) continue;
    const schema = operation.requestBody?.content?.['application/json']?.schema;
    const refName = schema?.$ref?.split('/').at(-1);
    const resolved = refName ? document.components.schemas[refName] : schema;
    console.log(path, refName || '', JSON.stringify({ required: resolved?.required, fields: Object.keys(resolved?.properties || {}) }));
  }
}
