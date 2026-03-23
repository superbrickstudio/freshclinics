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

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### 3. Run locally

```bash
# Dry run (no writes)
npm run sync:dry-run

# Live sync
npm run sync
```

### 4. GitHub Actions (automated)

Add the following secrets to your GitHub repository:

| Secret | Value |
|--------|-------|
| `WEBFLOW_API_TOKEN` | Your Webflow API token |
| `WEBFLOW_SITE_ID` | `68e725899c75627784514073` |
| `EVENTS_COLLECTION_ID` | `6948c04079dba6a26e10b9b7` |
| `SPEAKERS_COLLECTION_ID` | `6948c082e6e5e80d355f771b` |
| `SPONSORS_COLLECTION_ID` | `69c0c7eda05e2a7fec0d2d83` |
| `AGENDAS_COLLECTION_ID` | `6948c08beeb9a8d638c29a95` |
| `HUBSPOT_PROXY_BASE_URL` | `https://webflow-hubdb-proxy.vercel.app/api` |

The workflow runs twice daily (6 AM and 6 PM AEST) and can be triggered manually.

## Collections

| Collection | Fields synced |
|-----------|--------------|
| **Events** | Name, description, dates, location, venue, state, suburb, country, cover image, pricing, capacity, type, category, tags, visibility, speaker refs, sponsor refs |
| **Event Speakers** | Name, role, company, bio, headshot |
| **Event Sponsors** | Name, logo, description, website |
| **Event Agendas** | *(future — pending agenda endpoint)* |
