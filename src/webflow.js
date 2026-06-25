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
  // Some endpoints (e.g. bulk delete) return 204 No Content with an empty body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Collection items ----------

/**
 * Delete EVERY item in a collection (used by reset/rebuild).
 * Locale variants share an item id, so de-duplicate before deleting.
 */
export async function deleteAllItems(collectionId) {
  const items = await getAllItems(collectionId);
  const ids = [...new Set(items.map((i) => i.id).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    await webflowRequest('DELETE', `/collections/${collectionId}/items`, {
      items: batch.map((id) => ({ id })),
    });
    await sleep(300);
  }
  return ids.length;
}

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
  const localeIds = config.webflow.cmsLocaleIds || [];
  if (localeIds.length > 1) {
    // Create the item across ALL locales in one shot via the /items/bulk
    // endpoint. fieldData is an OBJECT here and cmsLocaleIds lists every locale
    // — without cmsLocaleIds the item is created in the primary locale only.
    return webflowRequest('POST', `/collections/${collectionId}/items/bulk`, {
      fieldData,
      cmsLocaleIds: localeIds,
      isArchived: false,
      isDraft: false,
    });
  }
  // Single-locale (primary only) create.
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
