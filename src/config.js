/**
 * Configuration for the HubSpot → Webflow CMS sync.
 * All values are read from environment variables.
 */

export const config = {
  webflow: {
    apiToken: process.env.WEBFLOW_API_TOKEN,
    siteId: process.env.WEBFLOW_SITE_ID || '68e725899c75627784514073',
    collections: {
      events: process.env.EVENTS_COLLECTION_ID || '6948c04079dba6a26e10b9b7',
      speakers: process.env.SPEAKERS_COLLECTION_ID || '6948c082e6e5e80d355f771b',
      sponsors: process.env.SPONSORS_COLLECTION_ID || '69c0c7eda05e2a7fec0d2d83',
      agendas: process.env.AGENDAS_COLLECTION_ID || '6948c08beeb9a8d638c29a95',
    },
  },
  hubspot: {
    proxyBaseUrl: process.env.HUBSPOT_PROXY_BASE_URL || 'https://webflow-hubdb-proxy.vercel.app/api',
  },
  dryRun: process.env.DRY_RUN === 'true',
};
