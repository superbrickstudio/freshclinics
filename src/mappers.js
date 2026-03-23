/**
 * Field mappers: transform HubSpot proxy JSON â Webflow CMS fieldData.
 *
 * Each mapper returns an object whose keys match the Webflow collection
 * field slugs exactly. HubSpot field names are taken from the official
 * "HubSpot Event Platform Properties" spreadsheet.
 *
 * HubSpot internal names â Webflow slugs:
 *
 * EVENTS:
 *   event_name             â name, title
 *   hs_object_id           â hubspot-id
 *   description            â text-content-description, blurb (truncated)
 *   start_time             â event-date
 *   end_time               â event-end-date
 *   address                â location (composite)
 *   event_suburb           â event-suburb
 *   event_state            â event-state
 *   event_postcode         â event-postcode
 *   country                â country
 *   venue_name             â venue-name
 *   cover_image__file_link_      â cover-image
 *   cover_image__file_upload_    â cover-image (fallback)
 *   ticket_price           â ticket-price
 *   currency               â currency
 *   type                   â event-type
 *   event_category         â event-category
 *   event_tags             â event-tags
 *   event_ticket_type      â ticket-type
 *   event_payment_type     â payment-type
 *   available_capacity     â spots-remaining
 *   capacity_limit         â capacity-limit
 *   event_visibility       â members-only (inverted)
 *   event_location         â on-zoom (derived)
 *   virtual_event_platform â on-zoom (derived)
 *   webinar_url            â webinar-url
 *   event_registration_url â event-link
 *   recording_file_url     â recording-url
 *   agenda_breakdown_to_be_displayed â agenda-displayed
 *
 * SPEAKERS:
 *   hs_object_id           â hubspot-id
 *   event_table_record     â name, name-of-person (full name)
 *   speaker_first_name     â (used in fallback name)
 *   speaker_last_name      â (used in fallback name)
 *   speaker_role__job_title â role
 *   speaker_bio            â desc
 *   speaker_profile_image  â image
 *
 * SPONSORS:
 *   hs_object_id           â hubspot-id
 *   sponsor_name           â name
 *   sponsor_about_sponsor  â description
 *   sponsor_logo_image     â logo
 *   sponsor_website_url    â website
 *   sponsor_email          â email
 *   sponsor_instagram_url  â instagram-url
 *
 * AGENDAS:
 *   hs_id                  â hubspot-id
 *   session_title          â name, title
 *   session_description    â desc
 *   session_start_time     â time
 *   session_end_time       â end-time
 *   presenter_name         â presenter-name
 *   sort_order             â sort-order
 *   event_record_id        â event-record-id
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
    // NOTE: Confirm this URL pattern with the client â the file ID may need
    // a different base URL depending on their HubSpot portal configuration.
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

function stripNulls(obj) {
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

// ---------- Event mapper ----------

export function mapEvent(hubspotEvent) {
  const name = hubspotEvent.event_name || 'Untitled Event';

  const fieldData = {
    name,
    slug: slugify(name),
    'hubspot-id': String(hubspotEvent.hs_object_id),
    title: name,
    blurb: hubspotEvent.description
      ? hubspotEvent.description
          .replace(/<[^>]*>/g, '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200)
      : null,
    location: buildLocation(hubspotEvent),
    'text-content-description': hubspotEvent.description || null,
    'event-date': hubspotEvent.start_time || null,
    'event-end-date': hubspotEvent.end_time || null,
    duration: buildDuration(hubspotEvent),
    'event-state': hubspotEvent.event_state || null,
    'event-suburb': hubspotEvent.event_suburb || null,
    'event-postcode': hubspotEvent.event_postcode
      ? String(hubspotEvent.event_postcode)
      : null,
    country: hubspotEvent.country || null,
    'venue-name': hubspotEvent.venue_name || null,
    'ticket-price': hubspotEvent.ticket_price
      ? String(hubspotEvent.ticket_price)
      : null,
    currency: hubspotEvent.currency || null,
    'event-type': hubspotEvent.type || null,
    'event-category': hubspotEvent.event_category || null,
    'event-tags': hubspotEvent.event_tags || null,
    'ticket-type': hubspotEvent.event_ticket_type || null,
    'payment-type': hubspotEvent.event_payment_type || null,
    'spots-remaining': hubspotEvent.available_capacity
      ? parseInt(hubspotEvent.available_capacity, 10)
      : null,
    'capacity-limit': hubspotEvent.capacity_limit
      ? parseInt(hubspotEvent.capacity_limit, 10)
      : null,
    'members-only': hubspotEvent.event_visibility
      ?.toLowerCase()
      .includes('non-members')
      ? false
      : true,
    'on-zoom': !!(
      hubspotEvent.virtual_event_platform || hubspotEvent.webinar_url
    ),
    'agenda-displayed': hubspotEvent.agenda_breakdown_to_be_displayed === 'TRUE' ||
      hubspotEvent.agenda_breakdown_to_be_displayed === true,
  };

  // Cover image
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

  // Recording URL (event page endpoint only)
  if (hubspotEvent.recording_file_url) {
    fieldData['recording-url'] = { url: hubspotEvent.recording_file_url };
  }

  return stripNulls(fieldData);
}

// ---------- Speaker mapper ----------

export function mapSpeaker(hubspotSpeaker) {
  // Use event_table_record (full name) first, then construct from first/last
  const displayName =
    hubspotSpeaker.event_table_record ||
    [hubspotSpeaker.speaker_first_name, hubspotSpeaker.speaker_last_name]
      .filter(Boolean)
      .join(' ') ||
    hubspotSpeaker.name ||
    'Unknown Speaker';

  const fieldData = {
    name: displayName,
    slug: slugify(displayName),
    'hubspot-id': String(hubspotSpeaker.hs_object_id || hubspotSpeaker.id || ''),
    'name-of-person': displayName,
    role: hubspotSpeaker.speaker_role__job_title || null,
    company: hubspotSpeaker.company || null,
  };

  // Bio
  if (hubspotSpeaker.speaker_bio) {
    fieldData.desc = hubspotSpeaker.speaker_bio;
  }

  // Profile image
  if (hubspotSpeaker.speaker_profile_image) {
    fieldData.image = { url: hubspotSpeaker.speaker_profile_image };
  }

  return stripNulls(fieldData);
}

// ---------- Sponsor mapper ----------

export function mapSponsor(hubspotSponsor) {
  const displayName =
    hubspotSponsor.sponsor_name ||
    hubspotSponsor.name ||
    'Unknown Sponsor';

  const fieldData = {
    name: displayName,
    slug: slugify(displayName),
    'hubspot-id': String(hubspotSponsor.hs_object_id || hubspotSponsor.id || ''),
  };

  // About / description
  if (hubspotSponsor.sponsor_about_sponsor) {
    fieldData.description = hubspotSponsor.sponsor_about_sponsor;
  }

  // Logo image
  if (hubspotSponsor.sponsor_logo_image) {
    fieldData.logo = { url: hubspotSponsor.sponsor_logo_image };
  }

  // Website
  if (hubspotSponsor.sponsor_website_url) {
    fieldData.website = { url: hubspotSponsor.sponsor_website_url };
  }

  // Email
  if (hubspotSponsor.sponsor_email) {
    fieldData.email = hubspotSponsor.sponsor_email;
  }

  // Instagram
  if (hubspotSponsor.sponsor_instagram_url) {
    fieldData['instagram-url'] = { url: hubspotSponsor.sponsor_instagram_url };
  }

  return stripNulls(fieldData);
}

// ---------- Agenda mapper ----------

export function mapAgenda(hubspotAgenda) {
  const title = hubspotAgenda.session_title || 'Untitled Session';

  const fieldData = {
    name: title,
    slug: slugify(title),
    'hubspot-id': String(hubspotAgenda.hs_id || hubspotAgenda.id || ''),
    title,
    time: hubspotAgenda.session_start_time || null,
    'end-time': hubspotAgenda.session_end_time || null,
    'presenter-name': hubspotAgenda.presenter_name || null,
    'sort-order': hubspotAgenda.sort_order != null
      ? parseInt(hubspotAgenda.sort_order, 10)
      : null,
    'event-record-id': hubspotAgenda.event_record_id
      ? String(hubspotAgenda.event_record_id)
      : null,
  };

  // Session description
  if (hubspotAgenda.session_description) {
    fieldData.desc = hubspotAgenda.session_description;
  }

  return stripNulls(fieldData);
}
