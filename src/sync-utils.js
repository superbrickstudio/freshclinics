/**
 * Pure helpers used by the sync (kept separate from index.js so they can be
 * unit tested without running the sync).
 */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compare incoming fieldData with an existing Webflow item.
 * Returns true if any field would change.
 */
export function hasChanges(existing, incoming) {
  const existingData = existing.fieldData || {};
  for (const [key, val] of Object.entries(incoming)) {
    // Slug is only set on create (see updateItem)
    if (key === 'slug') continue;

    const existingVal = existingData[key];

    // Multi-reference fields (speakers, sponsors, agenda): compare as sets
    if (Array.isArray(val)) {
      const a = [...val].sort().join(',');
      const b = [...(Array.isArray(existingVal) ? existingVal : [])].sort().join(',');
      if (a !== b) return true;
      continue;
    }

    // Handle image/link objects
    if (val && typeof val === 'object' && val.url) {
      if (existingVal?.url !== val.url) return true;
      continue;
    }

    // Handle booleans
    if (typeof val === 'boolean') {
      if (existingVal !== val) return true;
      continue;
    }

    if (String(existingVal ?? '') !== String(val ?? '')) return true;
  }
  return false;
}

/**
 * Webflow rejects a new item whose slug is already used in the collection.
 * Different HubSpot records can share a name (recurring events, the same
 * speaker added twice), so add the HubSpot ID when the plain slug is taken.
 */
export function uniqueSlug(slug, hsId, takenSlugs) {
  if (!takenSlugs.has(slug)) return slug;
  return `${slug}-${hsId}`;
}
