/**
 * Sentinel-2 L2A NDVI overlay via the CDSE Sentinel Hub Process API.
 *
 * Live vegetation state for the map (government mode): NDVI from 10 m
 * Sentinel-2 bands B04/B08 over the Plzeň city bbox, mosaicked to the MOST
 * RECENT reasonably clear acquisition of the last 30 days (maxCloudCoverage
 * 30). Water pixels (SCL class 6) are painted teal; clouds + nodata are
 * transparent. The PNG (340×260, ~40 KB) is returned as a data URI and
 * rendered as a Leaflet ImageOverlay with exact bounds.
 *
 * Colour ramp is the standard NDVI ramp (brown → yellow → green) — every
 * stop documented in the map legend.
 *
 * Cached in memory 6 h + negative cache 30 min. All failures carry an EXACT
 * reason — surfaced by /api/copernicus/ndvi.
 */

import { cdseCredsConfigured, cdseEnvWarning, cdsePostRaw } from '@/lib/copernicus/auth';

const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

/** Plzeň city bbox (W, S, E, N) — same extents as the live LST layer. */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
const WIDTH = 340;
const HEIGHT = 260;

const CACHE_TTL_MS = 6 * 3600 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;

export interface NdviOverlay {
  source: 'sentinel-2-ndvi';
  observedFrom: string;
  observedTo: string;
  bounds: { south: number; west: number; north: number; east: number };
  image: string; // data:image/png;base64,...
  pixels: { width: number; height: number };
}

interface CacheEntry {
  at: number;
  result?: NdviOverlay;
  error?: string;
}

let cache: CacheEntry | null = null;

const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "SCL", "dataMask"],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
function ramp(ndvi) {
  if (ndvi < 0) return [92, 81, 60];
  if (ndvi < 0.1) return [166, 142, 85];
  if (ndvi < 0.2) return [196, 178, 105];
  if (ndvi < 0.3) return [211, 196, 118];
  if (ndvi < 0.4) return [188, 201, 101];
  if (ndvi < 0.5) return [135, 184, 77];
  if (ndvi < 0.6) return [85, 166, 48];
  return [34, 120, 30];
}
function evaluatePixel(s) {
  if (s.dataMask === 0) return [0, 0, 0, 0];
  if (s.SCL === 0 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10) return [0, 0, 0, 0];
  if (s.SCL === 6) return [70, 130, 140, 170];
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  const c = ramp(ndvi);
  return [c[0], c[1], c[2], 190];
}`;

/** Sync read of the cached overlay — null until a fetch has succeeded. */
export function cachedNdvi(): NdviOverlay | null {
  return cache?.result ?? null;
}

export async function fetchNdvi(): Promise<{ ok: true; result: NdviOverlay } | { ok: false; reason: string }> {
  if (!cdseCredsConfigured()) {
    return { ok: false, reason: cdseEnvWarning() ?? 'env-missing' };
  }
  if (cache) {
    const ttl = cache.result ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - cache.at < ttl) {
      return cache.result ? { ok: true, result: cache.result } : { ok: false, reason: cache.error ?? 'unknown' };
    }
  }
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000).toISOString();
  try {
    const png = await cdsePostRaw(
      PROCESS_URL,
      {
        input: {
          bounds: {
            bbox: [...BBOX],
            properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
          },
          data: [
            {
              type: 'S2L2A',
              dataFilter: {
                timeRange: { from, to: now.toISOString() },
                maxCloudCoverage: 30,
                mosaickingOrder: 'mostRecent',
              },
            },
          ],
        },
        output: {
          width: WIDTH,
          height: HEIGHT,
          responses: [{ identifier: 'default', format: { type: 'image/png' } }],
        },
        evalscript: EVALSCRIPT,
      },
      'image/png',
      60000
    );
    const result: NdviOverlay = {
      source: 'sentinel-2-ndvi',
      observedFrom: from,
      observedTo: now.toISOString(),
      bounds: { south: BBOX[1], west: BBOX[0], north: BBOX[3], east: BBOX[2] },
      image: `data:image/png;base64,${png.toString('base64')}`,
      pixels: { width: WIDTH, height: HEIGHT },
    };
    cache = { at: Date.now(), result };
    return { ok: true, result };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    // Configuration problems (missing env vars) are NOT negative-cached —
    // the next request retries immediately, so the layer recovers the moment
    // credentials appear (no stale "connection missing" note for 30 min).
    if (!cdseCredsConfigured()) {
      cache = null;
      return { ok: false, reason };
    }
    cache = { at: Date.now(), error: reason };
    return { ok: false, reason };
  }
}
