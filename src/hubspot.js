/**
 * HubSpot Proxy API client.
 * Fetches event data from the Vercel proxy that sits in front of HubDB.
 */

import { config } from './config.js';

const BASE = config.hubspot.proxyBaseUrl;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HubSpot proxy error: ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

/**
 * Fetch all events from the proxy.
 * Returns only Published + Public events.
 */
export async function fetchEvents() {
  const data = await fetchJson(`${BASE}/events`);
  const events = data.events || [];

  // Safety filter — only sync published public events
  return events.filter(
    (e) =>
      e.event_status === 'Published' &&
      e.event_visibility?.toLowerCase().includes('public')
  );
}

/**
 * Fetch speakers for a specific event.
 */
export async function fetchSpeakers(eventId) {
  try {
    const data = await fetchJson(`${BASE}/events/${eventId}/speakers`);
    return Array.isArray(data) ? data : data.speakers || [];
  } catch (err) {
    console.warn(`  ⚠ Could not fetch speakers for event ${eventId}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch sponsors for a specific event.
 */
export async function fetchSponsors(eventId) {
  try {
    const data = await fetchJson(`${BASE}/events/${eventId}/sponsors`);
    return Array.isArray(data) ? data : data.sponsors || [];
  } catch (err) {
    console.warn(`  ⚠ Could not fetch sponsors for event ${eventId}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch a single event's full details (event page properties).
 * This endpoint returns additional fields like agenda_breakdown_to_be_displayed
 * and recording_file_url that aren't in the list endpoint.
 */
export async function fetchEventDetail(eventId) {
  try {
    const data = await fetchJson(`${BASE}/events/${eventId}`);
    return data;
  } catch (err) {
    console.warn(`  ⚠ Could not fetch detail for event ${eventId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch agenda items for a specific event.
 * Only call this when agenda_breakdown_to_be_displayed is TRUE.
 */
export async function fetchAgenda(eventId) {
  try {
    const data = await fetchJson(`${BASE}/events/${eventId}/agenda`);
    // The API may return 'Agenda breakdown not required' as a string
    if (typeof data === 'string') return [];
    return Array.isArray(data) ? data : data.agenda || data.sessions || [];
  } catch (err) {
    console.warn(`  ⚠ Could not fetch agenda for event ${eventId}: ${err.message}`);
    return [];
  }
}
