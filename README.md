# Fresh Clinics — HubSpot → Webflow CMS Sync

Syncs event data from HubSpot (via Vercel proxy) into Webflow CMS collections.

## How it works

1. Fetches published public events from `webflow-hubdb-proxy.vercel.app/api/events`
2. For each event, fetches associated speakers and sponsors
3. Upserts speakers → Webflow **Event Speakers** collection
4. Upserts sponsors → Webflow **Event Sponsors** collection
5. Upserts events → Webflow **Events** collection (with multi-references to speakers/sponsors)
6. Publishes all created/updated items

Items are matched by a `hubspot-id` field to determine create vs. update.
