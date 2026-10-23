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

    // Handle image objects
    if (val && typeof val === 'object' && val.url) {
      if (!sameImage(existingVal?.url, val.url)) return true;
      continue;
    }

    // Handle booleans
    if (typeof val === 'boolean') {
      if (existingVal !== val) return true;
      continue;
    }

    if (sameDate(existingVal, val)) continue;

    if (String(existingVal ?? '') !== String(val ?? '')) return true;
  }
  return false;
}

function fullyDecode(text) {
  let prev;
  let cur = text;
  do {
    prev = cur;
    try {
      cur = decodeURIComponent(prev);
    } catch {
      return prev;
    }
  } while (cur !== prev);
  return cur;
}

/**
 * Webflow copies images to its own CDN, so the stored URL never equals the
 * HubSpot URL we send. The CDN copy keeps the original file name after an
 * underscore ("<fileId>_Kiss_and_Glow_banner_v2.webp"), sometimes
 * double-encoded and converted to another format (.webp → .png,
 * .jpg → .jpeg), so compare file names without the extension. A different
 * file name means a new image.
 */
export function sameImage(existingUrl, incomingUrl) {
  if (!existingUrl || !incomingUrl) return false;
  if (existingUrl === incomingUrl) return true;
  const stem = (url) =>
    fullyDecode(String(url).split('?')[0].split('/').pop() || '')
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase();
  const incoming = stem(incomingUrl);
  return !!incoming && stem(existingUrl).endsWith('_' + incoming);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Same instant, whatever the formatting ("…00Z" vs "…00.000Z"). */
function sameDate(a, b) {
  if (!ISO_DATE.test(String(a ?? '')) || !ISO_DATE.test(String(b ?? ''))) return false;
  return new Date(a).getTime() === new Date(b).getTime();
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
