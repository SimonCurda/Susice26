/**
 * REAL Sentinel-3 SLSTR Land Surface Temperature via Copernicus Data Space
 * Ecosystem (CDSE) Sentinel Hub Process API.
 *
 * ACTIVATION: set CDSE_CLIENT_ID + CDSE_CLIENT_SECRET environment variables
 * (free OAuth client created in the CDSE account console — browser only,
 * see SETUP.md "Reálná teplota z Sentinel-3"). Without them this module is
 * dormant and the app serves the anchored UHI model from lst-anchor.ts.
 *
 * Data flow (server-side only):
 *   1. OAuth2 client_credentials token from CDSE identity service
 *   2. Process API request over the Plzeň bbox, collection S3SLSTR-L2-LST,
 *      band LST (Kelvin), last 72 h, ORBIT mosaicking, latest pass wins
 *   3. PNG response decoded server-side (pngjs) → °C grid
 *   4. Sanity-checked (physical range + nodata share) before use
 *
 * Every failure carries an EXACT reason string — surfaced by /api/lst-grid.
 */

import { PNG } from 'pngjs';

const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
const FETCH_TIMEOUT_MS = 20000;

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
  return Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET);
}

export function envWarning(): string | null {
  if (!process.env.CDSE_CLIENT_ID && !process.env.CDSE_CLIENT_SECRET) return null;
  return process.env.CDSE_CLIENT_SECRET
    ? 'CDSE_CLIENT_ID chybí (CDSE_CLIENT_SECRET je nastavené)'
    : 'CDSE_CLIENT_SECRET chybí (CDSE_CLIENT_ID je nastavené)';
}

/**
 * Evalscript: band LST is Kelvin in the S3SLSTR-L2-LST collection.
 * We map −10…60 °C → 0…255 (byte) and mark invalid pixels as 255.
 */
const EVALSCRIPT = [
  '//VERSION=3',
  'function setup() {',
  '  return {',
  '    input: ["LST"],',
  '    output: { bands: 1, sampleType: "UINT8" },',
  '  };',
  '}',
  'function evaluatePixel(s) {',
  '  if (!isFinite(s.LST)) return [255];',
  '  const c = s.LST - 273.15;',
  '  const v = Math.round(((c + 10) / 70) * 255);',
  '  return [Math.max(0, Math.min(254, v))];',
  '}',
].join('\n');

async function fetchToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CDSE_CLIENT_ID ?? '',
    client_secret: process.env.CDSE_CLIENT_SECRET ?? '',
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`CDSE identity služba nedostupná — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`CDSE token HTTP ${res.status}: ${text || res.statusText}`);
  }
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('CDSE token odpověď nemá access_token');
  return j.access_token;
}

async function renderLst(token: string, now: Date): Promise<{ png: Buffer; from: string }> {
  const from = new Date(now.getTime() - 72 * 3600 * 1000).toISOString();
  const payload = {
    process: {
      id: 'lst-grid',
      input: {
        bounds: { bbox: [...BBOX], properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
        data: [
          {
            type: 'S3SLSTR-L2-LST',
            dataFilter: { timeRange: { from, to: now.toISOString() } },
          },
        ],
      },
      output: {
        width: WIDTH,
        height: HEIGHT,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
    },
    evalscript: EVALSCRIPT,
  };
  let res: Response;
  try {
    res = await fetch(PROCESS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Accept': 'image/png',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Process API síťová chyba — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`Process API HTTP ${res.status}: ${text || res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error(`Process API vrátilo podezřele malou odpověď (${buf.length} B)`);
  return { png: buf, from };
}

/** Byte → °C (inverse of the evalscript mapping; 255 = nodata). */
function byteToC(v: number): number | null {
  if (v >= 254) return null; // nodata marker
  return (v / 255) * 70 - 10;
}

export async function fetchRealLst(): Promise<{ ok: true; result: RealLstResult } | { ok: false; reason: string }> {
  if (!credsConfigured()) {
    return { ok: false, reason: 'env-missing' };
  }
  if (cache) {
    const ttl = cache.result ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (Date.now() - cache.at < ttl) {
      return cache.result ? { ok: true, result: cache.result } : { ok: false, reason: cache.error ?? 'unknown' };
    }
  }

  const now = new Date();
  try {
    const token = await fetchToken();
    const { png, from } = await renderLst(token, now);
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
      throw new Error('Sentinel-3 SLSTR: za poslední 72 h není nad Plzní žádná clear-sky pozorování (oblaka)');
    }
    const mean = sum / valid;
    if (mean < -35 || mean > 65) {
      throw new Error(`Sanity check selhal: průměr ${mean.toFixed(1)} °C není fyzicky možný (evalscript/škála špatně?)`);
    }
    if (valid < WIDTH * HEIGHT * 0.25) {
      throw new Error(`Sentinel-3 SLSTR: jen ${valid} z ${WIDTH * HEIGHT} buněk validních (málo clear-sky)`);
    }
    const result: RealLstResult = {
      source: 'sentinel-3-real',
      observedAt: now.toISOString(),
      points,
      legendMin: Math.floor(min),
      legendMax: Math.ceil(max),
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
