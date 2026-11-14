/**
 * REAL Sentinel-3 SLSTR thermal data via Copernicus Data Space Ecosystem
 * (CDSE) Sentinel Hub Process API.
 *
 * ACTIVATION: set CDSE_CLIENT_ID + CDSE_CLIENT_SECRET environment variables
 * (free OAuth client created in the CDSE account console — browser only,
 * see SETUP.md "Reálná teplota z Sentinel-3"). Without them this module is
 * dormant and the app serves the anchored UHI model from lst-anchor.ts.
 *
 * Auth/token handling is shared with the other Copernicus integrations in
 * src/lib/copernicus/auth.ts (Statistical history, NDVI overlay).
 *
 * WHY BAND S7 (verified live against CDSE, 2026-11-14):
 *   The SLSTR *L2 LST* product is NOT exposed through the Sentinel Hub
 *   Process API — the only SLSTR collection available is `S3SLSTR` (L1B).
 *   Its thermal channel S7 (10.85 µm, 1 km grid) is delivered as
 *   BRIGHTNESS TEMPERATURE IN KELVIN — a direct satellite thermal
 *   measurement that tracks surface skin temperature (within ~1–2 K for
 *   natural surfaces). We convert K → °C in the evalscript and label the
 *   layer honestly as SLSTR thermal data everywhere in the UI.
 *
 * Data flow (server-side only):
 *   1. OAuth2 client_credentials token from CDSE identity service
 *   2. Process API request over the Plzeň bbox, collection S3SLSTR,
 *      band S7 (Kelvin), last 72 h, latest available pass
 *   3. PNG response decoded server-side (pngjs) → °C grid
 *   4. Sanity-checked (physical range + nodata share) before use
 *
 * Every failure carries an EXACT reason string — surfaced by /api/lst-grid.
 */

import { PNG } from 'pngjs';
import { cdseCredsConfigured, cdseEnvWarning, cdsePostRaw, cdseSetupHint } from '@/lib/copernicus/auth';

const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

/** Plzeň city bbox matching the demo grid extents (W, S, E, N — CRS84 order). */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
const WIDTH = 52;
const HEIGHT = 36; // ~350 m per cell — comparable to the demo grid step

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // new SLSTR overpass roughly daily
const NEGATIVE_CACHE_TTL_MS = 15 * 60 * 1000;

export interface RealLstResult {
  source: 'sentinel-3-real';
  observedAt: string;
  points: { lat: number; lng: number; lst: number }[];
  legendMin: number;
  legendMax: number;
}

interface CacheEntry {
  at: number;
  result?: RealLstResult;
  error?: string;
}

let cache: CacheEntry | null = null;

export function credsConfigured(): boolean {
  return cdseCredsConfigured();
}

export function envWarning(): string | null {
  return cdseEnvWarning();
}

/**
 * Evalscript: SLSTR L1B thermal channel S7 (10.85 µm) — brightness
 * temperature in Kelvin. We map −10…60 °C → 0…250 (byte) and mark invalid
 * pixels as 255. NaN-safe: comparisons against NaN are false, so the guard
 * `!(s.S7 > 180 && s.S7 < 400)` catches NaN, nodata and unphysical values
 * without relying on isFinite (not guaranteed in the eval engine).
 */
const EVALSCRIPT = [
  '//VERSION=3',
  'function setup() {',
  '  return {',
  '    input: ["S7"],',
  '    output: { bands: 1, sampleType: "UINT8" },',
  '  };',
  '}',
  'function evaluatePixel(s) {',
  '  if (!(s.S7 > 180 && s.S7 < 400)) return [255];',
  '  const c = s.S7 - 273.15;',
  '  const v = Math.round(((c + 10) / 70) * 250);',
  '  return [Math.max(0, Math.min(250, v))];',
  '}',
].join('\n');

/**
 * Process API request. NOTE: input / output / evalscript are TOP-LEVEL keys —
 * the older "process" wrapper is rejected with COMMON_BAD_PAYLOAD ("input
 * must not be null").
 */
async function renderLst(now: Date): Promise<{ png: Buffer; from: string }> {
  const from = new Date(now.getTime() - 72 * 3600 * 1000).toISOString();
  const payload = {
    input: {
      bounds: {
        bbox: [...BBOX],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [
        {
          type: 'S3SLSTR',
          dataFilter: { timeRange: { from, to: now.toISOString() } },
        },
      ],
    },
    output: {
      width: WIDTH,
      height: HEIGHT,
      responses: [{ identifier: 'default', format: { type: 'image/png' } }],
    },
    evalscript: EVALSCRIPT,
  };
  const png = await cdsePostRaw(PROCESS_URL, payload, 'image/png', 20000);
  return { png, from };
}

/** Byte → °C (inverse of the evalscript mapping; 251+ = nodata). */
function byteToC(v: number): number | null {
  if (v >= 251) return null; // nodata marker (evalscript returns 255)
  return (v / 250) * 70 - 10;
}

/** Sync read of the cached real raster — null until a fetch has succeeded. */
export function cachedRealLst(): RealLstResult | null {
  return cache && cache.result ? cache.result : null;
}

export async function fetchRealLst(): Promise<{ ok: true; result: RealLstResult } | { ok: false; reason: string }> {
  if (!credsConfigured()) {
    return { ok: false, reason: cdseSetupHint() };
  }
  if (cache) {
    const ttl = cache.result ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (Date.now() - cache.at < ttl) {
      return cache.result ? { ok: true, result: cache.result } : { ok: false, reason: cache.error ?? 'unknown' };
    }
  }

  const now = new Date();
  try {
    const { png, from } = await renderLst(now);
    const img = PNG.sync.read(png);
    if (img.width !== WIDTH || img.height !== HEIGHT) {
      throw new Error(`Process API vrátilo ${img.width}×${img.height} px, očekáváno ${WIDTH}×${HEIGHT}`);
    }
    const points: { lat: number; lng: number; lst: number }[] = [];
    let valid = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const [west, south, east, north] = BBOX;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const idx = (y * WIDTH + x) * 4; // RGBA
        const c = byteToC(img.data[idx]);
        if (c === null) continue;
        valid++;
        sum += c;
        if (c < min) min = c;
        if (c > max) max = c;
        const lat = north - ((y + 0.5) * (north - south)) / HEIGHT;
        const lng = west + ((x + 0.5) * (east - west)) / WIDTH;
        points.push({ lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000, lst: Math.round(c * 10) / 10 });
      }
    }
    if (valid === 0) {
      throw new Error('Sentinel-3 SLSTR: za poslední 72 h není nad Plzní žádná validní termální pozorování (oblaka / nodata)');
    }
    const mean = sum / valid;
    if (mean < -35 || mean > 65) {
      throw new Error(`Sanity check selhal: průměr ${mean.toFixed(1)} °C není fyzicky možný (evalscript/škála špatně?)`);
    }
    if (valid < WIDTH * HEIGHT * 0.25) {
      throw new Error(`Sentinel-3 SLSTR: jen ${valid} z ${WIDTH * HEIGHT} buněk validních (málo clear-sky)`);
    }
    // percentile-clamped legend bounds — one outlier pixel must not stretch
    // the CLMS TCI ramp across an extreme range
    const sorted = points.map((p) => p.lst).sort((a, b) => a - b);
    const pct = (t: number) => sorted[Math.min(sorted.length - 1, Math.floor(t * sorted.length))];
    const result: RealLstResult = {
      source: 'sentinel-3-real',
      observedAt: now.toISOString(), // data FETCHED at this time; raster = latest pass within 72 h
      points,
      legendMin: Math.floor(pct(0.02)),
      legendMax: Math.ceil(pct(0.98)),
    };
    cache = { at: Date.now(), result, error: undefined };
    void from;
    return { ok: true, result };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    cache = { at: Date.now(), error: reason };
    return { ok: false, reason };
  }
}
