# Fresh Clinics — HubSpot → Webflow CMS Sync

Syncs event data from HubSpot (via a Vercel proxy in front of HubDB) into the
Webflow CMS collections behind the Event Calendar.

## How it works

1. Fetches events from `webflow-hubdb-proxy.vercel.app/api/events`
2. For each event, fetches its details, speakers, sponsors and agenda
3. Upserts speakers → Webflow **Event Speakers** collection
4. Upserts sponsors → Webflow **Event Sponsors** collection
5. Upserts agenda items → Webflow **Event Agendas** collection
6. Upserts events → Webflow **Events** collection (with references to the above)
7. Publishes all created/updated items, in every locale (US and AU)

Items are matched by a `hubspot-id` field to decide create vs. update.

### Which events sync

| HubSpot `event_visibility` | `event_status` | Synced? |
| --- | --- | --- |
| Public (available to non-members) | Published | Yes |
| Public (available to non-members) | Expired (Past Event) | Yes, unless `on_demand_approved` is `false` |
| Private (restricted to members only) | Published | Yes, with **Members Only** on |
| Private (restricted to members only) | Expired (Past Event) | No |

For members-only events, **Event Link**, **Webinar URL** and **Recording URL**
are left empty in Webflow. Everything in the CMS is visible in the page source
even when the Designer hides it, and some registration links include member
discount codes.

Events that drop out of the HubSpot feed are **not** removed from Webflow;
filter them in the Designer.

## Where it runs

GitHub Actions, `.github/workflows/sync.yml`:

- Twice daily, 6am and 6pm AEST. GitHub can start scheduled runs late.
- **Run manually:** Actions → *Sync HubSpot Events to Webflow CMS* → *Run workflow*.
  - `dry_run: true` logs what would change without writing to Webflow.
  - `reset: true` deletes **every** item in all four collections and rebuilds
    them. Only use this if the collections are badly out of step.

If one item fails (e.g. Webflow rejects a field), the rest still sync and the
run is marked failed with a list of what didn't go through.

## Secrets

Stored in the repo's `secrets` environment (Settings → Environments):

| Secret | What it is |
| --- | --- |
| `WEBFLOW_API_TOKEN` | Webflow site API token with CMS read/write |
| `WEBFLOW_SITE_ID` | Webflow site ID |
| `EVENTS_COLLECTION_ID`, `SPEAKERS_COLLECTION_ID`, `SPONSORS_COLLECTION_ID`, `AGENDAS_COLLECTION_ID` | Webflow collection IDs |
| `HUBSPOT_PROXY_BASE_URL` | Base URL of the HubSpot proxy |

This repo does not hold a HubSpot token. The proxy does, wherever it is hosted.

## Running locally

Requires Node 22+. No dependencies to install.

```bash
npm test
WEBFLOW_API_TOKEN=... npm run sync:dry-run
```
