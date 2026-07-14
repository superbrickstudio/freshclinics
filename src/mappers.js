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

/** HubSpot booleans come back as the lowercase strings 'true' / 'false'. */
function isTrue(v) {
  return v === true || String(v).toLowerCase() === 'true';
}

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
  // Only cover_image__file_link_ is a usable public URL that Webflow can fetch.
  // cover_image__file_upload_ is just a HubSpot file ID and does NOT resolve to
  // a fetchable URL, so we skip it rather than feed Webflow a dead link (which
  // would show a broken-image icon). Proper fix: have the proxy resolve the
  // file ID to a real CDN URL via HubSpot's Files API.
  if (event.cover_image__file_link_) {
    return { url: event.cover_image__file_link_ };
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

/**
 * Build a short blurb. Prefers the dedicated intro content, falls back to the
 * full description. Strips HTML, collapses whitespace, and trims to a word
 * boundary (~200 chars) so it never ends mid-word.
 */
function buildBlurb(event) {
  const source = event.short_description__intro_content || event.description || '';
  const text = source
    .replace(/<[^>]*>/g, ' ') // tags -> space so sentences don't run together
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length <= 200) return text;
  const cut = text.slice(0, 200);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[.,;:!?\-\s]+$/, '') + '\u2026';
}

/**
 * Escape bare HTML-significant chars in plain text.
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Normalise a rich-text value for Webflow.
 * - If the source is already HTML (has block tags), keep it.
 * - If it's plain text (as HubSpot often sends), split on line breaks and wrap
 *   each line in <p> so Webflow renders real paragraphs instead of one blob.
 * - Strip inline style="" attributes so the Designer's styling isn't overridden.
 * - Drop empty paragraphs.
 */
function toRichHtml(raw) {
  if (!raw) return null;
  const hasBlockHtml = /<(p|ul|ol|li|h[1-6]|div|br|blockquote|hr)\b/i.test(raw);
  let html;
  if (hasBlockHtml) {
    html = raw;
  } else {
    // Plain text. Group consecutive bullet lines (-, *, •) into a real <ul>,
    // everything else becomes a <p>.
    const lines = raw
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const bulletRe = /^[-*•]\s+/;
    const parts = [];
    let bullets = [];
    const flush = () => {
      if (bullets.length) {
        parts.push(
          '<ul>' + bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('') + '</ul>'
        );
        bullets = [];
      }
    };
    for (const line of lines) {
      if (bulletRe.test(line)) {
        bullets.push(line.replace(bulletRe, ''));
      } else {
        flush();
        parts.push(`<p>${escapeHtml(line)}</p>`);
      }
    }
    flush();
    html = parts.join('');
  }
  html = html
    .replace(/\sstyle="[^"]*"/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .trim();
  return html || null;
}

// ---------- Event mapper ----------

export function mapEvent(hubspotEvent) {
  const name = hubspotEvent.event_name || 'Untitled Event';

  const fieldData = {
    name,
    slug: slugify(name),
    'hubspot-id': String(hubspotEvent.hs_object_id),
    title: name,
    blurb: buildBlurb(hubspotEvent),
    location: buildLocation(hubspotEvent),
    'text-content-description': toRichHtml(hubspotEvent.description),
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
    'event-type': hubspotEvent.event_type_ || hubspotEvent.type || null,
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
      hubspotEvent.virtual_event_platform ||
      hubspotEvent.webinar_url ||
      hubspotEvent.meeting_url
    ),
    'agenda-displayed': isTrue(hubspotEvent.agenda_breakdown_to_be_displayed),
    featured: isTrue(hubspotEvent.featured_event),
    'event-series': hubspotEvent.event_series || null,
    'intro-content': toRichHtml(hubspotEvent.short_description__intro_content),
  };

  // Cover image
  const coverImg = resolveCoverImage(hubspotEvent);
  if (coverImg) {
    fieldData['cover-image'] = coverImg;
  }

  // Event link — the registration URL, falling back to the webinar/meeting
  // link so the CTA always has somewhere to go.
  const eventLink =
    hubspotEvent.event_registration_url ||
    hubspotEvent.webinar_url ||
    hubspotEvent.meeting_url;
  if (eventLink) {
    fieldData['event-link'] = eventLink;
  }

  // Webinar / virtual meeting URL (meeting_url is the newer field)
  const meetingLink = hubspotEvent.webinar_url || hubspotEvent.meeting_url;
  if (meetingLink) {
    fieldData['webinar-url'] = meetingLink;
  }

  // Recording URL (event page endpoint only)
  if (hubspotEvent.recording_file_url) {
    fieldData['recording-url'] = hubspotEvent.recording_file_url;
  }

  return stripNulls(fieldData);
}

// ---------- Speaker mapper ----------

export function mapSpeaker(hubspotSpeaker) {
  // Prefer the structured first/last name fields. The proxy's
  // `event_table_record` is a composite key like
  // "57268958361::Speaker::Megan Reid", NOT a clean name — so only fall
  // back to it after stripping the "eventId::Speaker::" prefix.
  const fromParts = [
    hubspotSpeaker.speaker_first_name,
    hubspotSpeaker.speaker_last_name,
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  const fromRecord = (hubspotSpeaker.event_table_record || '')
    .split('::')
    .pop()
    .trim();

  const displayName = (
    fromParts ||
    fromRecord ||
    hubspotSpeaker.name ||
    'Unknown Speaker'
  ).replace(/\s+/g, ' ').trim();

  const fieldData = {
    name: displayName,
    slug: slugify(displayName),
    'hubspot-id': String(hubspotSpeaker.hs_object_id || hubspotSpeaker.id || ''),
    'name-of-person': displayName,
    role: hubspotSpeaker.speaker_role__job_title || null,
    company:
      hubspotSpeaker.speaker_company_name ||
      hubspotSpeaker.company_name ||
      hubspotSpeaker.company ||
      null,
  };

  // Bio
  const speakerDesc = toRichHtml(hubspotSpeaker.speaker_bio);
  if (speakerDesc) {
    fieldData.desc = speakerDesc;
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
  const sponsorDesc = toRichHtml(hubspotSponsor.sponsor_about_sponsor);
  if (sponsorDesc) {
    fieldData.description = sponsorDesc;
  }

  // Logo image (the *_file_link variant is the public URL)
  const sponsorLogo =
    hubspotSponsor.sponsor_logo_image_file_link || hubspotSponsor.sponsor_logo_image;
  if (sponsorLogo) {
    fieldData.logo = { url: sponsorLogo };
  }

  // Website
  if (hubspotSponsor.sponsor_website_url) {
    fieldData.website = hubspotSponsor.sponsor_website_url;
  }

  // Email
  if (hubspotSponsor.sponsor_email) {
    fieldData.email = hubspotSponsor.sponsor_email;
  }

  // Instagram (renamed from sponsor_instagram_url to instagram_profile)
  const sponsorIg = hubspotSponsor.instagram_profile || hubspotSponsor.sponsor_instagram_url;
  if (sponsorIg) {
    fieldData['instagram-url'] = sponsorIg;
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
  const agendaDesc = toRichHtml(hubspotAgenda.session_description);
  if (agendaDesc) {
    fieldData.desc = agendaDesc;
  }

  return stripNulls(fieldData);
}
