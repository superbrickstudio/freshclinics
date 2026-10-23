import assert from 'node:assert/strict';
import test from 'node:test';

import { publishItems, updateItem } from '../src/webflow.js';

test('updateItem preserves existing Webflow slugs by omitting slug from updates', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'webflow-item-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const fieldData = {
    name: 'Duplicate Event Name',
    slug: 'duplicate-event-name',
    'hubspot-id': '12345',
  };

  await updateItem('events-collection', 'webflow-item-id', fieldData);

  assert.equal(requestBody.items.length, 2);
  for (const item of requestBody.items) {
    assert.deepEqual(item.fieldData, {
      name: 'Duplicate Event Name',
      'hubspot-id': '12345',
    });
  }
  assert.equal(fieldData.slug, 'duplicate-event-name');
});

test('publishItems publishes every locale, not just the primary one', async (t) => {
  const originalFetch = globalThis.fetch;
  const bodies = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({}), { status: 202 });
  };

  const ids = Array.from({ length: 60 }, (_, i) => `item-${i}`);
  await publishItems('events-collection', ids);

  // 2 locales → at most 50 items (100 variants) per call
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].items.length, 50);
  assert.equal(bodies[1].items.length, 10);
  for (const item of bodies[0].items) {
    assert.deepEqual(item.cmsLocaleIds, [
      '69378d6ff1c1ced8fb14e11d',
      '6992c7be788739ecba1341da',
    ]);
  }
  assert.equal(bodies[0].itemIds, undefined);
});
