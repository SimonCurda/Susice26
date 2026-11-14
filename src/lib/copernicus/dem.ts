/**
 * Terrain — Copernicus DEM (GLO-30, 30 m global elevation model) via the
 * CDSE Sentinel Hub Process API, rendered as a shaded-relief overlay.
 *
 * WHY IT MATTERS FOR HEAT
 *   Elevation and slope are the "why THERE" of the temperature map:
 *   - valley floors (Mže / Radbuza / Úslava) pool cold air at night — the
 *     anchored-model night temperature follows this;
 *   - steep south-facing slopes bake in the afternoon sun;
 *   - you cannot "plant your way out" of a hot sealed plateau, but valley
 *     parks benefit from cold-air drainage. The planting engine and the
 *     methodology dialog reference this layer as the static terrain context.
 *
 * RENDERING (fully deterministic, done server-side)
 *   1. Process API over the city bbox, collection `DEM` (COP-30), band `DEM`
 *      (metres above sea level) → 340 × 260 grid (~40 m per cell);
 *   2. hillshade from cell-to-cell gradients (sun azimuth NW 315°, alt 45°);
 *   3. subtle hypsometric tint × hillshade → RGBA PNG, nodata transparent.
 *
 * Static dataset — cached 24 h. Every failure carries an EXACT reason.
 */

import { PNG } from 'pngjs';
import { cdseCredsConfigured, cdseEnvWarning, cdsePostRaw } from '@/lib/copernicus/auth';

const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

/** City bbox (W, S, E, N) — same extents as every other layer. */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
const WIDTH = 340;
const HEIGHT = 260;

/** metres → byte encoding: 250–550 m → 0–250, 255 = nodata (1.2 m/step). */
const DEM_MIN_M = 250;
const DEM_MAX_M = 550;

const CACHE_TTL_MS = 24 * 3600 * 1000;
const NEGATIVE_TTL_MS = 15 * 60 * 1000;

export interface DemPayload {
  available: boolean;
  source: string;
  bounds: { south: number; west: number; north: number; east: number };
  image: string; // data:image/png;base64,...
  pixels: { width: number; height: number };
  stats: { min: number; max: number; mean: number; valleySharePct: number };
  note: string;
}

interface CacheEntry {
  at: number;
  payload?: DemPayload;
  error?: string;
}

let cache: CacheEntry | null = null;

const EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["DEM"] }], output: { bands: 1, sampleType: "UINT8" } };
}
function evaluatePixel(s) {
  if (!(s.DEM > -100 && s.DEM < 9000)) return [255];
  const v = Math.round(((s.DEM - ${DEM_MIN_M}) / (${DEM_MAX_M - DEM_MIN_M})) * 250);
  return [Math.max(0, Math.min(250, v))];
}`;

function byteToMetres(v: number): number | null {
  if (v >= 251) return null;
  return DEM_MIN_M + (v / 250) * (DEM_MAX_M - DEM_MIN_M);
}

/** Hypsometric tint for the elevation range of Plzeň (~290–470 m). */
function terrainTint(m: number): [number, number, number] {
  // 3-stop ramp: valley green-grey → mid warm grey → hill light brown
  const stops: { at: number; c: [number, number, number] }[] = [
    { at: 280, c: [214, 226, 214] },
    { at: 340, c: [228, 224, 208] },
    { at: 420, c: [222, 205, 178] },
    { at: 480, c: [212, 190, 160] },
  ];
  if (m <= stops[0].at) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    if (m <= stops[i].at) {
      const t = (m - stops[i - 1].at) / (stops[i].at - stops[i - 1].at);
      const a = stops[i - 1].c;
      const b = stops[i].c;
      return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
    }
  }
  return stops[stops.length - 1].c;
}

/** Lambertian hillshade (azimuth 315° NW, sun altitude 45°). */
function hillshade(metres: Float64Array, x: number, y: number): number {
  const cellW = ((BBOX[2] - BBOX[0]) * 111320 * Math.cos(((BBOX[1] + BBOX[3]) / 2) * (Math.PI / 180))) / WIDTH;
  const cellH = ((BBOX[3] - BBOX[1]) * 110540) / HEIGHT;
  const at = (xx: number, yy: number): number => metres[yy * WIDTH + xx];
  const xL = Math.max(0, x - 1);
  const xR = Math.min(WIDTH - 1, x + 1);
  const yT = Math.max(0, y - 1);
  const yB = Math.min(HEIGHT - 1, y + 1);
  const dx = (at(xR, y) - at(xL, y)) / ((xR - xL || 1) * cellW);
  const dy = (at(x, yB) - at(x, yT)) / ((yB - yT || 1) * cellH);
  const slope = Math.atan(Math.sqrt(dx * dx + dy * dy));
  const aspect = Math.atan2(dy, dx);
  const azRad = (315 * Math.PI) / 180;
  const altRad = (45 * Math.PI) / 180;
  const shade =
    Math.cos(altRad) * Math.sin(slope) * Math.cos(azRad - aspect) + Math.sin(altRad) * Math.cos(slope);
  return Math.max(0.35, Math.min(1.25, shade));
}

async function fetchDem(): Promise<DemPayload> {
  const png = await cdsePostRaw(
    PROCESS_URL,
    {
      input: {
        bounds: {
          bbox: [...BBOX],
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [{ type: 'DEM', dataFilter: { demVersion: 'COP-30' } }],
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
  const img = PNG.sync.read(png);
  if (img.width !== WIDTH || img.height !== HEIGHT) {
    throw new Error(`Process API vrátilo ${img.width}×${img.height} px, očekáváno ${WIDTH}×${HEIGHT}`);
  }

  // decode to metres
  const metres = new Float64Array(WIDTH * HEIGHT);
  const valid: number[] = [];
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const m = byteToMetres(img.data[i * 4]);
    metres[i] = m ?? NaN;
    if (m !== null) valid.push(m);
  }
  if (valid.length < WIDTH * HEIGHT * 0.5) {
    throw new Error(`Copernicus DEM: jen ${valid.length} z ${WIDTH * HEIGHT} buněk validních`);
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const stats = {
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    // "valley floor" = lowest 10 % of cells → where night cold air pools
    valleySharePct: Math.round((sorted[Math.floor(sorted.length * 0.1)] - sorted[0]) / (sorted[sorted.length - 1] - sorted[0]) * 100) / 100,
  };

  // render tint × hillshade
  const out = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = y * WIDTH + x;
      const o = idx * 4;
      const m = metres[idx];
      if (!Number.isFinite(m)) {
        out.data[o] = 0;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 0;
        continue;
      }
      const tint = terrainTint(m);
      const shade = hillshade(metres, x, y);
      out.data[o] = Math.max(0, Math.min(255, Math.round(tint[0] * shade)));
      out.data[o + 1] = Math.max(0, Math.min(255, Math.round(tint[1] * shade)));
      out.data[o + 2] = Math.max(0, Math.min(255, Math.round(tint[2] * shade)));
      out.data[o + 3] = 235;
    }
  }
  const pngBuf = PNG.sync.write(out, { colorType: 6 });
  return {
    available: true,
    source: 'Copernicus DEM GLO-30 · CDSE Process API',
    bounds: { south: BBOX[1], west: BBOX[0], north: BBOX[3], east: BBOX[2] },
    image: `data:image/png;base64,${pngBuf.toString('base64')}`,
    pixels: { width: WIDTH, height: HEIGHT },
    stats,
    note: `Statický model reliéfu (30 m, verze COP-30): nadmořská výška ${stats.min}–${stats.max} m, průměr ~${stats.mean} m. Stínování: slunce SV→ZJZ, azimut 315°, výška 45°. Údolní dno (nejnižší decil buněk) se v noci plní studeným vzduchem stékajícím ze svahů — proto noční minima leží u Mže/Radbuzy, ne na návrších.`,
  };
}

export async function getDem(): Promise<DemPayload> {
  if (cache?.payload && Date.now() - cache.at < CACHE_TTL_MS) return cache.payload;
  if (cache?.error && Date.now() - cache.at < NEGATIVE_TTL_MS) {
    return unavailable(cache.error);
  }
  if (!cdseCredsConfigured()) {
    return unavailable(cdseEnvWarning() ?? 'env-missing');
  }
  try {
    const payload = await fetchDem();
    cache = { at: Date.now(), payload };
    return payload;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    cache = { at: Date.now(), error: reason };
    return unavailable(reason);
  }
}

function unavailable(reason: string): DemPayload {
  return {
    available: false,
    source: 'Copernicus DEM GLO-30 · CDSE Process API',
    bounds: { south: BBOX[1], west: BBOX[0], north: BBOX[3], east: BBOX[2] },
    image: '',
    pixels: { width: WIDTH, height: HEIGHT },
    stats: { min: 0, max: 0, mean: 0, valleySharePct: 0 },
    note: reason,
  };
}
