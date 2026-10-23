/**
 * Fresh Clinics — HubSpot → Webflow CMS Sync
 *
 * This script:
 * 1. Fetches published events (public and members-only) from the HubSpot proxy
 * 2. For each event, fetches full detail, speakers, sponsors, and agenda
 * 3. Upserts speakers and sponsors into their Webflow collections first
 * 4. Upserts agenda items into the Event Agendas collection
 * 5. Upserts events into the Events collection (with references)
 * 6. Publishes all created/updated items
 *
 * Runs on a schedule via GitHub Actions (.github/workflows/sync.yml).
 * A failure on one item is logged and the sync carries on; the run exits
 * non-zero at the end so GitHub flags it.
 */

import { config } from './config.js';
import {
  fetchEvents,
  fetchEventDetail,
  fetchSpeakers,
  fetchSponsors,
  fetchAgenda,
} from './hubspot.js';
import {
  getAllItems,
  createItem,
  updateItem,
  publishItems,
  buildHubSpotIdMap,
  deleteAllItems,
} from './webflow.js';
import {
  mapEvent,
  mapSpeaker,
  mapSponsor,
  mapAgenda,
  isMembersOnly,
} from './mappers.js';
import { sleep, hasChanges, uniqueSlug } from './sync-utils.js';

// Items that failed to create/update, reported at the end of the run.
const failures = [];

// ---------- Upsert a collection ----------

/**
 * Create or update items in a Webflow collection, then publish them.
 * `entries` is an array of { hsId, fieldData }.
 * Returns a refreshed HubSpot ID → Webflow item map for reference linking.
 */
async function upsertCollection(collectionId, entries, label) {
  console.log(`\n📦 Syncing ${label}...`);

  const existingItems = await getAllItems(collectionId);
  const hsIdMap = buildHubSpotIdMap(existingItems);
  const takenSlugs = new Set(
    existingItems.map((i) => i.fieldData?.slug).filter(Boolean)
  );

  const createdIds = [];
  const updatedIds = [];

  for (const { hsId, fieldData } of entries) {
    const existing = hsIdMap.get(hsId);

    try {
      if (existing) {
        if (!hasChanges(existing, fieldData)) {
          console.log(`  ⏭  No changes: ${fieldData.name}`);
          continue;
        }
        if (config.dryRun) {
          console.log(`  [DRY RUN] Would update ${label}: ${fieldData.name}`);
          continue;
        }
        console.log(`  ✏️  Updating ${label}: ${fieldData.name}`);
        await updateItem(collectionId, existing.id, fieldData);
        updatedIds.push(existing.id);
      } else {
        const slug = uniqueSlug(fieldData.slug, hsId, takenSlugs);
        takenSlugs.add(slug);
        if (config.dryRun) {
          console.log(`  [DRY RUN] Would create ${label}: ${fieldData.name} (/${slug})`);
          continue;
        }
        console.log(`  ➕ Creating ${label}: ${fieldData.name}`);
        const created = await createItem(collectionId, { ...fieldData, slug });
        createdIds.push(created.id);
      }
      await sleep(300);
    } catch (err) {
      console.error(`  ❌ ${label} "${fieldData.name}" (HubSpot ${hsId}): ${err.message}`);
      failures.push(`${label}: ${fieldData.name} (HubSpot ${hsId})`);
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
    return { hsIdMap: buildHubSpotIdMap(refreshed), createdIds, updatedIds };
  }
  return { hsIdMap, createdIds, updatedIds };
}

/**
 * Map child items (speakers, sponsors, agendas) and de-duplicate by HubSpot
 * ID — the same speaker or sponsor can appear on several events.
 */
function childEntries(hubspotItems, mapper) {
  const entries = new Map();
  for (const item of hubspotItems) {
    const hsId = String(item.hs_object_id || item.hs_id || item.id || '');
    if (hsId && !entries.has(hsId)) {
      entries.set(hsId, { hsId, fieldData: mapper(item) });
    }
  }
  return [...entries.values()];
}

/** HubSpot IDs → Webflow item IDs, dropping any that aren't in Webflow. */
function resolveRefs(hsIds, hsIdMap) {
  return (hsIds || []).map((hsId) => hsIdMap.get(hsId)?.id).filter(Boolean);
}

// ---------- Main sync ----------

async function main() {
  console.log('🚀 Starting HubSpot → Webflow CMS sync');
  console.log(`   Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Proxy: ${config.hubspot.proxyBaseUrl}`);
  console.log('');

  if (!config.webflow.apiToken) {
    throw new Error('WEBFLOW_API_TOKEN is not set');
  }

  // One-time rebuild: wipe every collection so items are recreated cleanly
  // (e.g. across all locales). Order doesn't matter here — the sync below
  // recreates children (speakers/sponsors) before events that reference them.
  if (config.reset && !config.dryRun) {
    console.log('🧨 RESET enabled — deleting ALL items in every collection...');
    for (const [label, collectionId] of Object.entries(
      config.webflow.collections
    )) {
      const removed = await deleteAllItems(collectionId);
      console.log(`   🗑  ${label}: deleted ${removed} item(s)`);
    }
    console.log('   Reset complete — rebuilding from scratch.\n');
  }

  // ──────────────────────────────────────────────
  // 1. Fetch all published events from HubSpot
  // ──────────────────────────────────────────────
  console.log('📡 Fetching events from HubSpot proxy...');
  const hubspotEvents = await fetchEvents();
  const membersOnlyCount = hubspotEvents.filter(isMembersOnly).length;
  console.log(
    `   Found ${hubspotEvents.length} event(s) to sync ` +
      `(${hubspotEvents.length - membersOnlyCount} public, ${membersOnlyCount} members-only)`
  );

  if (!hubspotEvents.length) {
    console.log('   No events to sync. Done.');
    return;
  }

  // ──────────────────────────────────────────────
  // 2. Fetch full details, speakers, sponsors, and agenda for each event
  // ──────────────────────────────────────────────
  console.log('\n📡 Fetching details, speakers, sponsors, and agendas...');
  const allSpeakers = [];
  const allSponsors = [];
  const allAgendas = [];
  const eventSpeakerMap = new Map();   // eventHsId → [speakerHsIds]
  const eventSponsorMap = new Map();   // eventHsId → [sponsorHsIds]
  const eventAgendaMap = new Map();    // eventHsId → [agendaHsIds]
  const eventDetailMap = new Map();    // eventHsId → merged detail object

  for (const event of hubspotEvents) {
    const eventId = String(event.hs_object_id);
    console.log(`   Event: ${event.event_name} (${eventId})`);

    // Fetch full event detail (has extra fields like recording_file_url, agenda toggle)
    const detail = await fetchEventDetail(eventId);
    // The detail endpoint returns { updatedAt, event }, so unwrap .event
    // before merging — otherwise its richer fields get buried and ignored.
    const detailEvent = detail && detail.event ? detail.event : detail;
    if (detailEvent) {
      eventDetailMap.set(eventId, { ...event, ...detailEvent });
    } else {
      eventDetailMap.set(eventId, event);
    }

    const mergedEvent = eventDetailMap.get(eventId);

    // Speakers & sponsors
    const speakers = await fetchSpeakers(eventId);
    const sponsors = await fetchSponsors(eventId);

    allSpeakers.push(...speakers);
    allSponsors.push(...sponsors);

    eventSpeakerMap.set(
      eventId,
      speakers
        .map((s) => String(s.hs_object_id || s.id || ''))
        .filter(Boolean)
    );
    eventSponsorMap.set(
      eventId,
      sponsors
        .map((s) => String(s.hs_object_id || s.id || ''))
        .filter(Boolean)
    );

    // Agenda — only fetch if the event says to display it
    const agendaFlag = mergedEvent.agenda_breakdown_to_be_displayed;
    const showAgenda =
      agendaFlag === true || String(agendaFlag).toLowerCase() === 'true';

    if (showAgenda) {
      const agendaItems = await fetchAgenda(eventId);
      allAgendas.push(...agendaItems);
      eventAgendaMap.set(
        eventId,
        agendaItems
          .map((a) => String(a.hs_id || a.id || ''))
          .filter(Boolean)
      );
      console.log(
        `     → ${speakers.length} speaker(s), ${sponsors.length} sponsor(s), ${agendaItems.length} agenda item(s)`
      );
    } else {
      eventAgendaMap.set(eventId, []);
      console.log(
        `     → ${speakers.length} speaker(s), ${sponsors.length} sponsor(s), agenda not displayed`
      );
    }

    await sleep(200);
  }

  // ──────────────────────────────────────────────
  // 3–5. Sync speakers, sponsors and agendas (so we have Webflow IDs for references)
  // ──────────────────────────────────────────────
  const { hsIdMap: speakerHsMap } = await upsertCollection(
    config.webflow.collections.speakers,
    childEntries(allSpeakers, mapSpeaker),
    'Speakers'
  );
  const { hsIdMap: sponsorHsMap } = await upsertCollection(
    config.webflow.collections.sponsors,
    childEntries(allSponsors, mapSponsor),
    'Sponsors'
  );
  const { hsIdMap: agendaHsMap } = await upsertCollection(
    config.webflow.collections.agendas,
    childEntries(allAgendas, mapAgenda),
    'Agendas'
  );

  // ──────────────────────────────────────────────
  // 6. Sync events (with references to speakers, sponsors, agendas)
  // ──────────────────────────────────────────────
  const eventEntries = [];
  for (const [eventHsId, mergedEvent] of eventDetailMap) {
    const fieldData = mapEvent(mergedEvent);

    // References are only sent when there is at least one, so a speaker fetch
    // that failed (returns []) never wipes an event's existing speakers.
    const refs = {
      'event-speakers': resolveRefs(eventSpeakerMap.get(eventHsId), speakerHsMap),
      'event-sponsors': resolveRefs(eventSponsorMap.get(eventHsId), sponsorHsMap),
      agenda: resolveRefs(eventAgendaMap.get(eventHsId), agendaHsMap),
    };
    for (const [key, ids] of Object.entries(refs)) {
      if (ids.length) fieldData[key] = ids;
    }

    eventEntries.push({ hsId: eventHsId, fieldData });
  }

  const { createdIds, updatedIds } = await upsertCollection(
    config.webflow.collections.events,
    eventEntries,
    'Events'
  );

  // ──────────────────────────────────────────────
  // 7. Summary
  // ──────────────────────────────────────────────
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Sync complete!');
  console.log(
    `   Events:   ${createdIds.length} new, ${updatedIds.length} updated`
  );
  if (failures.length) {
    console.log(`   ❌ ${failures.length} item(s) failed:`);
    for (const f of failures) console.log(`      - ${f}`);
    process.exitCode = 1;
  }
  console.log('='.repeat(50));
}

// ---------- Entry point ----------

main().catch((err) => {
  console.error('❌ Sync failed:', err);
  process.exit(1);
});
