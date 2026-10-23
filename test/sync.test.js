import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSync } from '../src/hubspot.js';
import { mapEvent, eventTimeZone, isOnZoom } from '../src/mappers.js';
import { hasChanges, uniqueSlug } from '../src/sync-utils.js';

const PUBLIC = 'Public (available to non-members)';
const PRIVATE = 'Private (restricted to members only)';

test('shouldSync includes published public and members-only events', () => {
  assert.equal(shouldSync({ event_visibility: PUBLIC, event_status: 'Published' }), true);
  assert.equal(shouldSync({ event_visibility: PRIVATE, event_status: 'Published' }), true);
  assert.equal(shouldSync({ event_visibility: '', event_status: 'Published' }), false);
  assert.equal(shouldSync({ event_visibility: PUBLIC, event_status: 'Draft' }), false);
});

test('shouldSync only keeps past events that are public and on-demand approved', () => {
  const past = { event_status: 'Expired (Past Event)' };
  assert.equal(shouldSync({ ...past, event_visibility: PUBLIC }), true);
  assert.equal(
    shouldSync({ ...past, event_visibility: PUBLIC, on_demand_approved: 'false' }),
    false
  );
  assert.equal(shouldSync({ ...past, event_visibility: PRIVATE }), false);
});

test('mapEvent sets members-only from visibility', () => {
  const base = { hs_object_id: '1', event_name: 'Test' };
  assert.equal(mapEvent({ ...base, event_visibility: PUBLIC })['members-only'], false);
  assert.equal(mapEvent({ ...base, event_visibility: PRIVATE })['members-only'], true);
});

test('mapEvent clears links on members-only events and keeps them on public ones', () => {
  const event = {
    hs_object_id: '1',
    event_name: 'Test',
    event_registration_url: 'https://example.com/checkout?coupon_code=MEMBERS',
    webinar_url: 'https://zoom.us/j/1',
    recording_file_url: 'https://example.com/recording',
  };

  const priv = mapEvent({ ...event, event_visibility: PRIVATE });
  assert.equal(priv['event-link'], null);
  assert.equal(priv['webinar-url'], null);
  assert.equal(priv['recording-url'], null);

  const pub = mapEvent({ ...event, event_visibility: PUBLIC });
  assert.equal(pub['event-link'], event.event_registration_url);
  assert.equal(pub['webinar-url'], event.webinar_url);
  assert.equal(pub['recording-url'], event.recording_file_url);
});

test('event times are shown in the local time of the event', () => {
  assert.equal(eventTimeZone({ country: 'United States', event_state: 'Texas' }), 'America/Chicago');
  assert.equal(eventTimeZone({ country: 'United States', event_state: 'Pennsylvania' }), 'America/New_York');
  assert.equal(eventTimeZone({ country: 'United States' }), 'America/New_York');
  assert.equal(eventTimeZone({ country: 'Australia', event_state: 'WA' }), 'Australia/Perth');
  assert.equal(eventTimeZone({ country: 'Australia', event_state: 'QLD' }), 'Australia/Brisbane');
  assert.equal(eventTimeZone({ country: 'Australia' }), 'Australia/Sydney');

  // 1pm–3pm in San Antonio (CST, UTC-6)
  const { duration } = mapEvent({
    hs_object_id: '1',
    event_name: 'San Antonio',
    country: 'United States',
    event_state: 'Texas',
    start_time: '2026-11-09T19:00:00Z',
    end_time: '2026-11-09T21:00:00Z',
  });
  assert.equal(duration, '1:00 pm - 3:00 pm');
});

test('uniqueSlug adds the HubSpot ID only when the slug is taken', () => {
  const taken = new Set(['tech-office-hours-meeting']);
  assert.equal(uniqueSlug('new-event', '42', taken), 'new-event');
  assert.equal(uniqueSlug('tech-office-hours-meeting', '42', taken), 'tech-office-hours-meeting-42');
});

test('hasChanges notices reference changes and cleared links', () => {
  const existing = {
    fieldData: {
      name: 'Event',
      'event-speakers': ['a', 'b'],
      'event-link': 'https://example.com',
    },
  };
  assert.equal(
    hasChanges(existing, { name: 'Event', 'event-speakers': ['b', 'a'], 'event-link': 'https://example.com' }),
    false
  );
  assert.equal(hasChanges(existing, { name: 'Event', 'event-speakers': ['a', 'b', 'c'] }), true);
  assert.equal(hasChanges(existing, { name: 'Event', 'event-link': null }), true);
  assert.equal(hasChanges({ fieldData: { name: 'Event' } }, { name: 'Event', 'event-link': null }), false);
});

test('About section falls back to intro content when description is empty', () => {
  const intro = '<p>Join us for an exclusive webinar.</p>';
  const base = { hs_object_id: '1', event_name: 'Test', short_description__intro_content: intro };
  assert.equal(mapEvent(base)['text-content-description'], intro);
  assert.equal(
    mapEvent({ ...base, description: '<p>Full description</p>' })['text-content-description'],
    '<p>Full description</p>'
  );
});

test('only Zoom events are flagged on-zoom', () => {
  assert.equal(isOnZoom({ virtual_event_platform: 'Zoom (Fresh Clinics)' }), true);
  assert.equal(isOnZoom({ meeting_url: 'https://us06web.zoom.us/j/123' }), true);
  assert.equal(isOnZoom({ virtual_event_platform: 'Other' }), false);
  assert.equal(
    isOnZoom({
      virtual_event_platform: 'External (Sponsor-Provided)',
      meeting_url: 'https://events.teoxane.com/event/kissandglow/register',
    }),
    false
  );
  assert.equal(isOnZoom({}), false);
});

test("HubSpot's timezone wins over the country/state guess", () => {
  // Online Texas event with no state: the guess would be Eastern
  assert.equal(
    eventTimeZone({ country: 'United States', timezone: 'America/Chicago' }),
    'America/Chicago'
  );
  assert.equal(
    eventTimeZone({ country: 'United States', event_state: 'Texas', timezone: 'Not/AZone' }),
    'America/Chicago'
  );
});
