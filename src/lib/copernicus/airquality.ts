/**
 * Air quality — CAMS (Copernicus Atmosphere Monitoring Service) European
 * forecast delivered through the open Open-Meteo Air Quality broker.
 *
 * WHY THIS SOURCE
 *   The Plzeňský kraj has no open realtime AQ sensor network the app could
 *   lean on; CAMS is the Copernicus service designed exactly for this (model
 *   forecast at ~5–6 km over Europe). We are HONEST about it being a MODEL
 *   raster, not station measurements — the UI and methodology say so.
 *
 * LAYER DESIGN
 *   One multi-location request for a 13 × 9 grid over the city bbox
 *   (~1.1 km spacing) with `current` values: European AQI, PM2.5, PM10,
 *   ozone, NO2. The map layer renders soft circles coloured by the official
 *   European AQI scale. Because CAMS is coarse, neighbouring circles will
 *   rarely differ much over one city — that is the honest truth of the data
 *   and is stated in the legend ("model CAMS ~5 km, ne měření").
 *
 * Cached 15 min (forecast refreshes hourly). Exact failure reasons surface
 * through /api/copernicus/airquality.
 */

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const AIR_SOURCE_LABEL = 'CAMS (Copernicus Atmosphere Monitoring Service) via Open-Meteo';

/** City bbox (W, S, E, N) — same extents as every other satellite layer. */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
const GX = 13;
const GY = 9;
const POINTS = GX * GY;

const CACHE_TTL_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 20000;

export interface AirPoint {
  lat: number;
  lng: number;
  /** European AQI (0–500, official bands: 0–20 good … >100 extremely poor) */
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  o3: number | null;
  no2: number | null;
}

export interface AirQualityPayload {
  available: boolean;
  source: string;
  fetchedAt: string;
  grid: AirPoint[];
  /** grid point nearest the city centre (náměstí Republiky) */
  city: AirPoint | null;
  note: string;
}

interface CacheEntry {
  at: number;
  payload?: AirQualityPayload;
  error?: string;
}

let cache: CacheEntry | null = null;
let inflight: Promise<AirQualityPayload> | null = null;

function buildGrid(): { lats: string[]; lngs: string[] } {
  const lats: string[] = [];
  const lngs: string[] = [];
  for (let y = 0; y < GY; y++) {
    const lat = BBOX[1] + ((y + 0.5) * (BBOX[3] - BBOX[1])) / GY;
    for (let x = 0; x < GX; x++) {
      const lng = BBOX[0] + ((x + 0.5) * (BBOX[2] - BBOX[0])) / GX;
      lats.push(lat.toFixed(4));
      lngs.push(lng.toFixed(4));
    }
  }
  return { lats, lngs };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseResponse(json: unknown): AirPoint[] {
  const arr = Array.isArray(json) ? json : [json];
  const out: AirPoint[] = [];
  for (const item of arr) {
    const o = item as {
      latitude?: number;
      longitude?: number;
      current?: { european_aqi?: unknown; pm2_5?: unknown; pm10?: unknown; ozone?: unknown; nitrogen_dioxide?: unknown };
    };
    if (typeof o?.latitude !== 'number' || typeof o?.longitude !== 'number') continue;
    const c = o.current ?? {};
    out.push({
      lat: o.latitude,
      lng: o.longitude,
      aqi: num(c.european_aqi),
      pm25: num(c.pm2_5),
      pm10: num(c.pm10),
      o3: num(c.ozone),
      no2: num(c.nitrogen_dioxide),
    });
  }
  return out;
}

async function fetchOnce(): Promise<AirQualityPayload> {
  const { lats, lngs } = buildGrid();
  const url =
    `${AQ_URL}?latitude=${lats.join(',')}&longitude=${lngs.join(',')}` +
    `&current=european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=Europe%2FPrague`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Open-Meteo air-quality HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ''}`);
  }
  const json: unknown = await res.json();
  const grid = parseResponse(json);
  if (grid.length === 0) {
    throw new Error('Open-Meteo air-quality: odpověď neobsahuje žádné validní lokality');
  }
  // city point = grid cell nearest náměstí Republiky (49.7477, 13.3776)
  let city: AirPoint | null = null;
  let best = Infinity;
  for (const p of grid) {
    const d = (p.lat - 49.7477) ** 2 + (p.lng - 13.3776) ** 2;
    if (d < best) {
      best = d;
      city = p;
    }
  }
  return {
    available: true,
    source: AIR_SOURCE_LABEL,
    fetchedAt: new Date().toISOString(),
    grid,
    city,
    note: `Modelová předpověď CAMS (rozlišení ~5–6 km) na ${POINTS} bodů sítě nad Plzní — NE staniční měření. Evropský AQI: 0–20 dobrá, 20–40 přijatelná, 40–60 střední, 60–80 špatná, 80–100 velmi špatná, >100 extrémně špatná.`,
  };
}

/**
 * The broker endpoint is occasionally flaky from this environment (transient
 * undici "fetch failed"/ETIMEDOUT even for tiny requests) — retry with a
 * longer backoff. Production egress (Vercel) does not exhibit this.
 */
async function fetchNow(): Promise<AirQualityPayload> {
  const attempts = 4;
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchOnce();
    } catch (e) {
      const cause = (e as { cause?: { message?: string; code?: string } }).cause;
      const causeMsg = cause ? ` (příčina: ${cause.code ?? cause.message ?? 'unknown'})` : '';
      lastErr = new Error(`${e instanceof Error ? e.message : String(e)}${causeMsg}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function getAirQuality(): Promise<AirQualityPayload> {
  if (cache?.payload && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;
  if (cache?.error && Date.now() - cache.at < CACHE_TTL_MS) {
    return {
      available: false,
      source: AIR_SOURCE_LABEL,
      fetchedAt: new Date(cache.at).toISOString(),
      grid: [],
      city: null,
      note: cache.error,
    };
  }
  if (!inflight) {
    inflight = fetchNow()
      .then((payload) => {
        cache = { at: Date.now(), payload };
        return payload;
      })
      .catch((e) => {
        const reason = e instanceof Error ? e.message : String(e);
        cache = { at: Date.now(), error: reason };
        throw new Error(reason);
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (e) {
    return {
      available: false,
      source: AIR_SOURCE_LABEL,
      fetchedAt: new Date().toISOString(),
      grid: [],
      city: null,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Official European AQI band colour + Czech label (EEA scale). */
export function aqiBand(aqi: number | null): { color: string; label: string } | null {
  if (aqi === null) return null;
  if (aqi <= 20) return { color: '#00b2a5', label: 'dobrá' };
  if (aqi <= 40) return { color: '#71c96e', label: 'přijatelná' };
  if (aqi <= 60) return { color: '#e6e26e', label: 'střední' };
  if (aqi <= 80) return { color: '#f2a65a', label: 'špatná' };
  if (aqi <= 100) return { color: '#e6674d', label: 'velmi špatná' };
  return { color: '#a050f0', label: 'extrémně špatná' };
}
