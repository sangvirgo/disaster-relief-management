import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const collection = JSON.parse(readFileSync(new URL('../../postman/C48-backend-demo.postman_collection.json', import.meta.url), 'utf8'));
const items = [];

function collect(children) {
  for (const item of children) {
    if (item.item) collect(item.item);
    else items.push(item);
  }
}

collect(collection.item);

function itemNamed(name) {
  const item = items.find((entry) => entry.name.includes(name));
  assert.ok(item, `Postman request containing "${name}" exists`);
  return item;
}

function operation(operationId) {
  const item = items.find((entry) => entry.event?.some((event) =>
    event.listen === 'prerequest' && event.script.exec.some((line) => line.includes(`\\"operationId\\":\\"${operationId}\\"`))));
  assert.ok(item, `Postman request for ${operationId} exists`);
  return item;
}

test('public donation smoke uses a quantity valid for every unit precision', () => {
  const body = JSON.parse(operation('logisticsDonationsCreateDelivery').request.body.raw);
  assert.equal(body.lines[0].declared_quantity, '1');
});

test('request supplement includes at least one reported fact', () => {
  const body = JSON.parse(operation('supplementSelfRequest').request.body.raw.replace('{{requestVersion}}', '1'));
  assert.ok(Object.keys(body).some((field) => field !== 'expected_version'));
});

test('catalog item uses the type and unit created by earlier requests', () => {
  const body = JSON.parse(operation('logisticsCatalogCreateItem').request.body.raw);
  assert.equal(body.item_type_code, '{{itemTypeCode}}');
  assert.equal(body.unit_code, '{{unitCode}}');
  assert.ok(items.indexOf(operation('logisticsCatalogCreateUnit')) < items.indexOf(operation('logisticsCatalogCreateItem')));
});

test('stock adjustment review uses the ID returned by adjustment creation', () => {
  const script = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  const requestUrl = operation('logisticsStockReviewAdjustment').request.url;
  const reviewUrl = typeof requestUrl === 'string' ? requestUrl : requestUrl.raw;

  assert.match(script, /logisticsStockCreateAdjustment[\s\S]*pm\.collectionVariables\.set\('adjustmentId', body\.id\)/);
  assert.match(reviewUrl, /\/stock\/adjustments\/\{\{adjustmentId\}\}\/review$/);
  assert.ok(collection.variable.some((variable) => variable.key === 'adjustmentId'));
});

test('quick queue smoke uses a coordinator session', () => {
  const header = itemNamed('Queue điều phối theo quyền cán bộ').request.header.find((entry) => entry.key === 'Authorization');
  assert.equal(header?.value, 'Bearer {{coordinatorAccessToken}}');
});

test('native CSRF probe clears cookies before other local API requests', () => {
  const script = collection.event.find((event) => event.listen === 'test').script.exec.join('\n');
  assert.match(script, /getAuthCsrf[\s\S]*cookies\.jar\(\)\.clear/);
});

test('WEB refresh probe skips when no browser refresh cookie exists', () => {
  const refresh = itemNamed('session WEB không body');
  const script = refresh.event.find((event) => event.listen === 'prerequest').script.exec.join('\n');
  assert.match(script, /c48_refresh/);
  assert.match(script, /pm\.execution\.skipRequest\(\)/);
});
