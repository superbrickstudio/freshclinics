/**
 * Fresh Clinics — HubSpot → Webflow CMS Sync
 *
 * This script:
 * 1. Fetches published public events from the HubSpot proxy
 * 2. For each event, fetches speakers and sponsors
 * 3. Upserts speakers and sponsors into their Webflow collections first
 * 4. Upserts events into the Events collection (with references to speakers/sponsors)
 * 5. Publishes all created/updated items
 *
 * Designed to run on a schedule (daily or more frequently) via:
 * - GitHub Actions cron
 * - Vercel Cron
 * - Any serverless scheduler
 */

import { config } from './config.js';
import { fetchEvents, fetchSpeakers, fetchSponsors } from './hubspot.js';
import {
  getAllItems,
  createItem,
  updateItem,
  publishItems,
  buildHubSpotIdMap,
} from './webflow.js';
import { mapEvent, mapSpeaker, mapSponsor } from './mappers.js';

// ---------- Helpers ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasChanges(existing, incoming) {
  const existingData = existing.fieldData || {};
  for (const [key, val] of Object.entries(incoming)) {
    // Skip reference fields (handled separately) and slug
    if (key === 'slug' || key === 'event-speakers' || key === 'event-sponsors') continue;

    const existingVal = existingData[key];

    // Handle image/link objects
    if (val && typeof val === 'object' && val.url) {
      if (existingVal?.url !== val.url) return true;
      continue;
    }

    if (String(existingVal ?? '') !== String(val ?? '')) return true;
  }
  return false;
}

// ---------- Sync a child collection (speakers or sponsors) ----------

async function syncChildCollection(collectionId, hubspotItems, mapper, label) {
  console.log(`\n📦 Syncing ${label}...`);

  const existingItems = await getAllItems(collectionId);
  const hsIdMap = buildHubSpotIdMap(existingItems);

  const createdIds = [];
  const updatedIds = [];

  // De-duplicate by HubSpot ID (same speaker/sponsor may appear across events)
  const uniqueMap = new Map();
  for (const item of hubspotItems) {
    const hsId = item.hs_object_id || item.id;
    if (hsId && !uniqueMap.has(hsId)) {
      uniqueMap.set(hsId, item);
    }
  }

  for (const [hsId, hubspotItem] of uniqueMap) {
    const fieldData = mapper(hubspotItem);
    const existing = hsIdMap.get(hsId);

    if (existing) {
      // Check if anything actually changed
      if (hasChanges(existing, fieldData)) {
        if (config.dryRun) {
          console.log(`  [DRY RUN] Would update ${label}: ${fieldData.name}`);
        } else {
          console.log(`  ✏️  Updating ${label}: ${fieldData.name}`);
          await updateItem(collectionId, existing.id, fieldData);
          updatedIds.push(existing.id);
          await sleep(300);
        }
      } else {
        console.log(`  ⏭  No changes: ${fieldData.name}`);
      }
    } else {
      if (config.dryRun) {
        console.log(`  [DRY RUN] Would create ${label}: ${fieldData.name}`);
      } else {
        console.log(`  ➕ Creating ${label}: ${fieldData.name}`);
        const created = await createItem(collectionId, fieldData);
        createdIds.push(created.id);
        await sleep(300);
      }
    }
  }

  // Publish all created + updated
  const toPublish = [...createdIds, ...updatedIds];
  if (toPublish.length && !config.dryRun) {
    console.log(`  📤 Publishing ${toPublish.length} ${label}...`);
    await publishItems(collectionId, toPublish);
  }

  console.log(
    `  ✅ ${label} sync complete: ${createdIds.length} created, ${updatedIds.length} updated`
  );

  // Return refreshed map for reference linking
  if (toPublish.length) {
    const refreshed = await getAllItems(collectionId);
    return buildHubSpotIdMap(refreshed);
  }
  return hsIdMap;
}

// ---------- Main sync ----------

async function main() {
  console.log('🚀 Starting HubSpot → Webflow CMS sync');
  console.log(`   Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Proxy: ${config.hubspot.proxyBaseUrl}`);
  console.log('');

  // 1. Fetch all published events from HubSpot
  console.log('📡 Fetching events from HubSpot proxy...');
  const hubspotEvents = await fetchEvents();
  console.log(`   Found ${hubspotEvents.length} published public event(s)`);

  if (!hubspotEvents.length) {
    console.log('   No events to sync. Done.');
    return;
  }

  // 2. Fetch speakers and sponsors for each event
  console.log('\n📡 Fetching speakers and sponsors for each event...');
  const allSpeakers = [];
  const allSponsors = [];
  const eventSpeakerMap = new Map(); // eventHsId → [speakerHsIds]
  const eventSponsorMap = new Map(); // eventHsId → [sponsorHsIds]

  for (const event of hubspotEvents) {
    const eventId = event.hs_object_id;
    console.log(`   Event: ${event.event_name} (${eventId})`);

    const speakers = await fetchSpeakers(eventId);
    const sponsors = await fetchSponsors(eventId);

    allSpeakers.push(...speakers);
    allSponsors.push(...sponsors);

    eventSpeakerMap.set(
      eventId,
      speakers.map((s) => s.hs_object_id || s.id).filter(Boolean)
    );
    eventSponsorMap.set(
      eventId,
      sponsors.map((s) => s.hs_object_id || s.id).filter(Boolean)
    );

    console.log(`     → ${speakers.length} speaker(s), ${sponsors.length} sponsor(s)`);
    await sleep(200);
  }

  // 3. Sync speakers first (so we have Webflow IDs for references)
  const speakerHsMap = await syncChildCollection(
    config.webflow.collections.speakers,
    allSpeakers,
    mapSpeaker,
    'Speakers'
  );

  // 4. Sync sponsors
  const sponsorHsMap = await syncChildCollection(
    config.webflow.collections.sponsors,
    allSponsors,
    mapSponsor,
    'Sponsors'
  );

  // 5. Sync events (with references)
  console.log('\n📦 Syncing Events...');
  const existingEvents = await getAllItems(config.webflow.collections.events);
  const eventHsMap = buildHubSpotIdMap(existingEvents);

  const createdEventIds = [];
  const updatedEventIds = [];

  for (const hubspotEvent of hubspotEvents) {
    const eventHsId = hubspotEvent.hs_object_id;
    const fieldData = mapEvent(hubspotEvent);

    // Resolve speaker references (HubSpot IDs → Webflow item IDs)
    const speakerHsIds = eventSpeakerMap.get(eventHsId) || [];
    const speakerWebflowIds = speakerHsIds
      .map((hsId) => speakerHsMap.get(hsId)?.id)
      .filter(Boolean);

    if (speakerWebflowIds.length) {
      fieldData['event-speakers'] = speakerWebflowIds;
    }

    // Resolve sponsor references
    const sponsorHsIds = eventSponsorMap.get(eventHsId) || [];
    const sponsorWebflowIds = sponsorHsIds
      .map((hsId) => sponsorHsMap.get(hsId)?.id)
      .filter(Boolean);

    if (sponsorWebflowIds.length) {
      fieldData['event-sponsors'] = sponsorWebflowIds;
    }

    const existing = eventHsMap.get(eventHsId);

    if (existing) {
      if (hasChanges(existing, fieldData)) {
        if (config.dryRun) {
          console.log(`  [DRY RUN] Would update event: ${fieldData.name}`);
        } else {
          console.log(`  ✏️  Updating event: ${fieldData.name}`);
          await updateItem(config.webflow.collections.events, existing.id, fieldData);
          updatedEventIds.push(existing.id);
          await sleep(300);
        }
      } else {
        console.log(`  ⏭  No changes: ${fieldData.name}`);
      }
    } else {
      if (config.dryRun) {
        console.log(`  [DRY RUN] Would create event: ${fieldData.name}`);
      } else {
        console.log(`  ➕ Creating event: ${fieldData.name}`);
        const created = await createItem(config.webflow.collections.events, fieldData);
        createdEventIds.push(created.id);
        await sleep(300);
      }
    }
  }

  // 6. Publish events
  const toPublish = [...createdEventIds, ...updatedEventIds];
  if (toPublish.length && !config.dryRun) {
    console.log(`\n  📤 Publishing ${toPublish.length} event(s)...`);
    await publishItems(config.webflow.collections.events, toPublish);
  }

  console.log(
    `\n  ✅ Events sync complete: ${createdEventIds.length} created, ${updatedEventIds.length} updated`
  );

  // 7. Summary
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Sync complete!');
  console.log(`   Events:   ${createdEventIds.length} new, ${updatedEventIds.length} updated`);
  console.log('='.repeat(50));
}

// ---------- Entry point ----------

main().catch((err) => {
  console.error('❌ Sync failed:', err);
  process.exit(1);
});
