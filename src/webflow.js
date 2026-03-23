/**
 * Webflow CMS API helpers.
 * Handles reading existing items, creating, updating, and publishing.
 */

import { config } from './config.js';

const API_BASE = 'https://api.webflow.com/v2';
const headers = {
  Authorization: `Bearer ${config.webflow.apiToken}`,
  'Content-Type': 'application/json',
  accept: 'application/json',
};

// ---------- Generic helpers ----------

async function webflowRequest(method, path, body = null) {
  const url = `${API_BASE}${path}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  // Handle rate limiting (429) with retry
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10);
    console.log(`  ⏳ Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return webflowRequest(method, path, body);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow API ${res.status}: ${text}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Collection items ----------

/**
 * Fetch ALL items from a collection (handles pagination).
 * Returns a flat array of items.
 */
export async function getAllItems(collectionId) {
  const items = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await webflowRequest(
      'GET',
      `/collections/${collectionId}/items?limit=${limit}&offset=${offset}`
    );
    items.push(...(data.items || []));
    if (!data.items || data.items.length < limit) break;
    offset += limit;
    await sleep(200); // be kind to the API
  }

  return items;
}

/**
 * Create a new CMS item (as draft).
 */
export async function createItem(collectionId, fieldData) {
  return webflowRequest('POST', `/collections/${collectionId}/items`, {
    fieldData,
    isDraft: false,
  });
}

/**
 * Update an existing CMS item.
 */
export async function updateItem(collectionId, itemId, fieldData) {
  return webflowRequest(
    'PATCH',
    `/collections/${collectionId}/items/${itemId}`,
    { fieldData }
  );
}

/**
 * Publish an array of item IDs in a collection.
 */
export async function publishItems(collectionId, itemIds) {
  if (!itemIds.length) return;
  // Webflow allows max 100 items per publish call
  for (let i = 0; i < itemIds.length; i += 100) {
    const batch = itemIds.slice(i, i + 100);
    await webflowRequest('POST', `/collections/${collectionId}/items/publish`, {
      itemIds: batch,
    });
    await sleep(300);
  }
}

/**
 * Build a lookup map of existing items keyed by their HubSpot ID field.
 */
export function buildHubSpotIdMap(items) {
  const map = new Map();
  for (const item of items) {
    const hsId = item.fieldData?.['hubspot-id'];
    if (hsId) {
      map.set(hsId, item);
    }
  }
  return map;
}
