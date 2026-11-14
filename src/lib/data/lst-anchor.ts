/**
 * Live anchoring of the LST layer to REAL measurements.
 *
 * The spatial pattern of the heat layer is a surface-urban-heat-island (VRC)
 * anomaly field (see src/lib/data/plzen.ts). The ABSOLUTE level displayed is
 * anchored to the live Open-Meteo measurement for Plzeň, scaled by a
 * transparent physical factor:
 *
 *   displayed °C = T_air (real) + anomaly × scale
 *
 *   scale = season × dayNight × cloud
 *   - season:   0.50–1.00, sinusoid over the year (low winter sun → weak
 *               surface heating, peak around the summer solstice)
 *   - dayNight: 1.00 by day, 0.45 at night (surface stores heat, UHI persists
 *               but weaker after sunset)
 *   - cloud:    0.55–1.00, less solar contrast under overcast skies
 *
 * Every factor is documented in the Methodology dialog — no hidden magic.
 */

import { getWeather } from '@/lib/openmeteo';

export interface LstAnchor {
  /** REAL current air temperature (Open-Meteo, Plzeň) in °C. */
  tAir: number;
  /** Combined scaling factor applied to the anomaly field. */
  scale: number;
  isDay: boolean;
  cloudPct: number | null;
  /** 'open-meteo' = live measurement, 'climatology' = safe fallback. */
  source: 'open-meteo' | 'climatology';
  fetchedAt: string;
}

const TTL_MS = 10 * 60 * 1000; // matches the Open-Meteo cache

let cache: { at: number; anchor: LstAnchor } | null = null;
let inflight: Promise<void> | null = null;

/** Seasonal solar-heating factor 0.5 (deep winter) → 1.0 (summer). */
export function seasonFactor(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = (now.getTime() - start) / 86400000;
  const s = Math.sin((2 * Math.PI * (doy - 105)) / 365); // peak ≈ 21 June
  return Math.round((0.5 + 0.5 * Math.max(0, s)) * 100) / 100;
}

/** Pure, testable scale computation (season × dayNight × cloud). */
export function computeScale(isDay: boolean, cloudPct: number | null, now: Date): number {
  const day = isDay ? 1 : 0.45;
  const cloud = cloudPct === null ? 0.75 : 0.55 + 0.45 * (1 - Math.min(100, Math.max(0, cloudPct)) / 100);
  return Math.round(seasonFactor(now) * day * cloud * 100) / 100;
}

/**
 * Climatological fallback so the map stays physically plausible even if the
 * weather API is down (rough November-weighted mean air temp for Plzeň).
 */
function climatologyDefault(): LstAnchor {
  const now = new Date();
  const tAir = 6;
  return {
    tAir,
    scale: computeScale(now.getUTCHours() >= 7 && now.getUTCHours() < 18, 70, now),
    isDay: now.getUTCHours() >= 7 && now.getUTCHours() < 18,
    cloudPct: null,
    source: 'climatology',
    fetchedAt: now.toISOString(),
  };
}

async function refresh(): Promise<void> {
  try {
    const w = await getWeather();
    const now = new Date(w.fetchedAt);
    cache = {
      at: Date.now(),
      anchor: {
        tAir: w.plzen.current.temperature,
        scale: computeScale(w.plzen.current.isDay, w.plzen.current.cloudCover, now),
        isDay: w.plzen.current.isDay,
        cloudPct: w.plzen.current.cloudCover,
        source: 'open-meteo',
        fetchedAt: w.fetchedAt,
      },
    };
  } catch {
    // keep the previous cache or climatology; the next caller retries
  } finally {
    inflight = null;
  }
}

/**
 * Synchronous access to the current anchor. On the first call (before any
 * weather fetch resolved) it returns the climatology default and kicks off
 * the async refresh for subsequent callers.
 */
export function lstAnchorNow(): LstAnchor {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.anchor;
  if (!inflight) inflight = refresh();
  return cache?.anchor ?? climatologyDefault();
}

/**
 * Async variant for API route handlers: awaits the in-flight refresh (if any)
 * so the FIRST request after a cold start already serves the live measurement
 * instead of the climatology fallback.
 */
export async function lstAnchorReady(): Promise<LstAnchor> {
  lstAnchorNow();
  if (inflight) await inflight;
  return lstAnchorNow();
}
