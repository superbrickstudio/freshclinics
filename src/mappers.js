/**
 * Field mappers: transform HubSpot proxy JSON → Webflow CMS fieldData.
 *
 * Each mapper returns an object whose keys match the Webflow collection
 * field slugs exactly.
 */

// ---------- Helpers ----------

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 256);
}

/**
 * Resolve the cover image URL.
 * Prioritises the direct link field; falls back to the HubSpot file ID.
 */
function resolveCoverImage(event) {
  if (event.cover_image__file_link_) {
    return { url: event.cover_image__file_link_ };
  }
  if (event.cover_image__file_upload_) {
    // HubSpot file manager public URL pattern
    return {
      url: `https://www.freshclinics.com/hubfs/${event.cover_image__file_upload_}`,
    };
  }
  return null;
}

/**
 * Build a human-readable location string from granular fields.
 */
function buildLocation(event) {
  const parts = [
    event.venue_name,
    event.address,
    event.event_suburb,
    event.event_state,
    event.country,
  ].filter(Boolean);
  return parts.join(', ') || null;
}

/**
 * Build a duration string from start/end times.
 */
function buildDuration(event) {
  if (!event.start_time || !event.end_time) return null;
  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Australia/Sydney',
    });
  };
  return `${fmt(event.start_time)} - ${fmt(event.end_time)}`;
}

// ---------- Event mapper ----------

export function mapEvent(hubspotEvent) {
  const name = hubspotEvent.event_name || 'Untitled Event';

  const fieldData = {
    name,
    slug: slugify(name),
    'hubspot-id': hubspotEvent.hs_object_id,
    title: name,
    blurb: hubspotEvent.description
      ? hubspotEvent.description.replace(/<[^>]*>/g, '').slice(0, 200)
      : null,
    location: buildLocation(hubspotEvent),
    'text-content-description': hubspotEvent.description || null,
    'event-date': hubspotEvent.start_time || null,
    'event-end-date': hubspotEvent.end_time || null,
    duration: buildDuration(hubspotEvent),
    'event-state': hubspotEvent.event_state || null,
    'event-suburb': hubspotEvent.event_suburb || null,
    country: hubspotEvent.country || null,
    'venue-name': hubspotEvent.venue_name || null,
    'ticket-price': hubspotEvent.ticket_price || null,
    currency: hubspotEvent.currency || null,
    'event-type': hubspotEvent.type || null,
    'event-category': hubspotEvent.event_category || null,
    'event-tags': hubspotEvent.event_tags || null,
    'ticket-type': hubspotEvent.event_ticket_type || null,
    'spots-remaining': hubspotEvent.available_capacity
      ? parseInt(hubspotEvent.available_capacity, 10)
      : null,
    'capacity-limit': hubspotEvent.capacity_limit
      ? parseInt(hubspotEvent.capacity_limit, 10)
      : null,
    'members-only': hubspotEvent.event_visibility?.toLowerCase().includes('non-members')
      ? false
      : true,
    'on-zoom': !!(
      hubspotEvent.virtual_event_platform || hubspotEvent.webinar_url
    ),
  };

  // Cover image — only include if we have a URL
  const coverImg = resolveCoverImage(hubspotEvent);
  if (coverImg) {
    fieldData['cover-image'] = coverImg;
  }

  // Registration / event link
  if (hubspotEvent.event_registration_url) {
    fieldData['event-link'] = { url: hubspotEvent.event_registration_url };
  }

  // Webinar URL
  if (hubspotEvent.webinar_url) {
    fieldData['webinar-url'] = { url: hubspotEvent.webinar_url };
  }

  // Strip out null values — Webflow doesn't like explicit nulls on some field types
  for (const [key, val] of Object.entries(fieldData)) {
    if (val === null || val === undefined) {
      delete fieldData[key];
    }
  }

  return fieldData;
}

// ---------- Speaker mapper ----------

export function mapSpeaker(hubspotSpeaker) {
  const displayName =
    hubspotSpeaker.name ||
    hubspotSpeaker.speaker_name ||
    hubspotSpeaker.full_name ||
    'Unknown Speaker';

  const fieldData = {
    name: displayName,
    slug: slugify(displayName),
    'hubspot-id': hubspotSpeaker.hs_object_id || hubspotSpeaker.id || null,
    'name-of-person': displayName,
    role: hubspotSpeaker.role || hubspotSpeaker.title || null,
    company: hubspotSpeaker.company || hubspotSpeaker.organization || null,
  };

  if (hubspotSpeaker.bio || hubspotSpeaker.description) {
    fieldData.desc = hubspotSpeaker.bio || hubspotSpeaker.description;
  }

  if (hubspotSpeaker.image || hubspotSpeaker.headshot || hubspotSpeaker.photo) {
    fieldData.image = {
      url: hubspotSpeaker.image || hubspotSpeaker.headshot || hubspotSpeaker.photo,
    };
  }

  // Strip nulls
  for (const [key, val] of Object.entries(fieldData)) {
    if (val === null || val === undefined) {
      delete fieldData[key];
    }
  }

  return fieldData;
}

// ---------- Sponsor mapper ----------

export function mapSponsor(hubspotSponsor) {
  const displayName =
    hubspotSponsor.name ||
    hubspotSponsor.sponsor_name ||
    hubspotSponsor.company_name ||
    'Unknown Sponsor';

  const fieldData = {
    name: displayName,
    slug: slugify(displayName),
    'hubspot-id': hubspotSponsor.hs_object_id || hubspotSponsor.id || null,
  };

  if (hubspotSponsor.description || hubspotSponsor.bio) {
    fieldData.description = hubspotSponsor.description || hubspotSponsor.bio;
  }

  if (hubspotSponsor.logo || hubspotSponsor.image) {
    fieldData.logo = {
      url: hubspotSponsor.logo || hubspotSponsor.image,
    };
  }

  if (hubspotSponsor.website || hubspotSponsor.url) {
    fieldData.website = {
      url: hubspotSponsor.website || hubspotSponsor.url,
    };
  }

  // Strip nulls
  for (const [key, val] of Object.entries(fieldData)) {
    if (val === null || val === undefined) {
      delete fieldData[key];
    }
  }

  return fieldData;
}
