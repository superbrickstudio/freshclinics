import assert from 'node:assert/strict';
import test from 'node:test';

import { updateItem } from '../src/webflow.js';

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
