/**
 * Field mappers: transform HubSpot proxy JSON → Webflow CMS fieldData.
 *
 * Each mapper returns an object whose keys match the Webflow collection
 * field slugs exactly. HubSpot field names are taken from the official
 * "HubSpot Event Platform Properties" spreadsheet.
 *
 * HubSpot internal names → Webflow slugs:
 *
 * EVENTS:
 *   event_name             → name, title
 *   hs_object_id           → hubspot-id
 *   description            → text-content-description, blurb (truncated)
 *   short_description__intro_content → intro-content (and the above when
 *                            description is empty)
 *   timezone               → duration (time zone used for the times)
 *   start_time             → event-date
 *   end_time               → event-end-date
 *   address                → location (composite)
 *   event_suburb           → event-suburb
 *   event_state            → event-state
 *   event_postcode         → event-postcode
 *   country                → country
 *   venue_name             → venue-name
 *   cover_image__file_link_      → cover-image
 *   cover_image__file_upload_    → cover-image (fallback)
 *   ticket_price           → ticket-price
 *   currency               → currency
 *   type                   → event-type
 *   event_category         → event-category
 *   event_tags             → event-tags
 *   event_ticket_type      → ticket-type
 *   event_payment_type     → payment-type
 *   available_capacity     → spots-remaining
 *   capacity_limit         → capacity-limit
 *   event_visibility       → members-only (on for "Private ..." events)
 *   virtual_event_platform → on-zoom (only when the platform or link is Zoom)
 *   webinar_url            → webinar-url    (cleared for members-only)
 *   event_registration_url → event-link     (cleared for members-only)
 *   recording_file_url     → recording-url  (cleared for members-only)
 *   agenda_breakdown_to_be_displayed → agenda-displayed
 *
 * SPEAKERS:
 *   hs_object_id           → hubspot-id
 *   event_table_record     → name, name-of-person (full name)
 *   speaker_first_name     → (used in fallback name)
 *   speaker_last_name      → (used in fallback name)
 *   speaker_role__job_title → role
 *   speaker_bio            → desc
 *   speaker_profile_image  → image
 *
 * SPONSORS:
 *   hs_object_id           → hubspot-id
 *   sponsor_name           → name
 *   sponsor_about_sponsor  → description
 *   sponsor_logo_image     → logo
 *   sponsor_website_url    → website
 *   sponsor_email          → email
 *   sponsor_instagram_url  → instagram-url
 *
 * AGENDAS:
 *   hs_id                  → hubspot-id
 *   session_title          → name, title
 *   session_description    → desc
 *   session_start_time     → time
 *   session_end_time       → end-time
 *   presenter_name         → presenter-name
 *   sort_order             → sort-order
 *   event_record_id        → event-record-id
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
 * Classify HubSpot's event_visibility, e.g.
 *   "Public (available to non-members)"    → 'public'
 *   "Private (restricted to members only)" → 'private'
 * Anything else (blank or a new option) → null, and the event is skipped.
 */
export function eventVisibility(event) {
  const v = String(event.event_visibility || '').trim().toLowerCase();
  if (v.startsWith('public')) return 'public';
  if (v.startsWith('private')) return 'private';
  return null;
}

export function isMembersOnly(event) {
  return eventVisibility(event) === 'private';
}

// HubSpot sends US states as full names; abbreviations are accepted too.
const US_STATE_TIME_ZONES = {
  'America/New_York': [
    'connecticut', 'ct', 'delaware', 'de', 'district of columbia', 'dc',
    'florida', 'fl', 'georgia', 'ga', 'indiana', 'in', 'kentucky', 'ky',
    'maine', 'me', 'maryland', 'md', 'massachusetts', 'ma', 'michigan', 'mi',
    'new hampshire', 'nh', 'new jersey', 'nj', 'new york', 'ny',
    'north carolina', 'nc', 'ohio', 'oh', 'pennsylvania', 'pa',
    'rhode island', 'ri', 'south carolina', 'sc', 'vermont', 'vt',
    'virginia', 'va', 'west virginia', 'wv',
  ],
  'America/Chicago': [
    'alabama', 'al', 'arkansas', 'ar', 'illinois', 'il', 'iowa', 'ia',
    'kansas', 'ks', 'louisiana', 'la', 'minnesota', 'mn', 'mississippi', 'ms',
    'missouri', 'mo', 'nebraska', 'ne', 'north dakota', 'nd', 'oklahoma', 'ok',
    'south dakota', 'sd', 'tennessee', 'tn', 'texas', 'tx', 'wisconsin', 'wi',
  ],
  'America/Denver': [
    'colorado', 'co', 'idaho', 'id', 'montana', 'mt', 'new mexico', 'nm',
    'utah', 'ut', 'wyoming', 'wy',
  ],
  'America/Phoenix': ['arizona', 'az'],
  'America/Los_Angeles': [
    'california', 'ca', 'nevada', 'nv', 'oregon', 'or', 'washington', 'wa',
  ],
  'America/Anchorage': ['alaska', 'ak'],
  'Pacific/Honolulu': ['hawaii', 'hi'],
};

const AU_STATE_TIME_ZONES = {
  nsw: 'Australia/Sydney',
  act: 'Australia/Sydney',
  vic: 'Australia/Melbourne',
  tas: 'Australia/Hobart',
  qld: 'Australia/Brisbane',
  sa: 'Australia/Adelaide',
  wa: 'Australia/Perth',
  nt: 'Australia/Darwin',
};

function isValidTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the time zone an event's times should be shown in. Uses HubSpot's
 * `timezone` (event detail endpoint) when set; otherwise guesses from country
 * and state, with online events falling back to Eastern (US) or Sydney (AU).
 */
export function eventTimeZone(event) {
  if (event.timezone && isValidTimeZone(event.timezone)) return event.timezone;

  const country = String(event.country || '').trim().toLowerCase();
  const state = String(event.event_state || '').trim().toLowerCase();

  if (country === 'united states' || country === 'usa' || country === 'us') {
    for (const [zone, states] of Object.entries(US_STATE_TIME_ZONES)) {
      if (states.includes(state)) return zone;
    }
    return 'America/New_York';
  }
  return AU_STATE_TIME_ZONES[state] || 'Australia/Sydney';
}

/**
 * True only for events actually run on Zoom. The site labels these "Zoom", so
 * other platforms ("Other", "External (Sponsor-Provided)") must not count.
 */
export function isOnZoom(event) {
  if (/zoom/i.test(event.virtual_event_platform || '')) return true;
  return [event.webinar_url, event.meeting_url].some((url) =>
    /^https?:\/\/([^/]+\.)?zoom\.us\//i.test(url || '')
  );
}

/**
 * Build a duration string from start/end times, in the event's local time.
 */
function buildDuration(event) {
  if (!event.start_time || !event.end_time) return null;
  const timeZone = eventTimeZone(event);
  const fmt = (iso) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
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
    // Newer HubSpot events only fill in the intro content, which would leave
    // the page's "About this event" section empty.
    'text-content-description': toRichHtml(
      hubspotEvent.description || hubspotEvent.short_description__intro_content
    ),
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
    'members-only': isMembersOnly(hubspotEvent),
    'on-zoom': isOnZoom(hubspotEvent),
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

  stripNulls(fieldData);

  // Members-only events: everything in the CMS ends up in the public page
  // source, even when the Designer hides it. Registration links can carry
  // member discount codes, so send explicit nulls — this also clears any link
  // left over from when an event was public. The site shows a Join Fresh CTA.
  if (fieldData['members-only']) {
    fieldData['event-link'] = null;
    fieldData['webinar-url'] = null;
    fieldData['recording-url'] = null;
  }

  return fieldData;
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
