/**
 * Sentinel-3 SLSTR thermal HISTORY via the CDSE Sentinel Hub Statistical API
 * (the "Copernicus API" for time-series statistics — no image download).
 *
 * WHAT IT MEASURES
 *   Collection S3SLSTR (L1B), thermal channel S7 (10.85 µm) — brightness
 *   temperature in Kelvin, converted to °C in the evalscript. Within each
 *   DAY interval we mosaic the LEAST RECENT acquisition of that day
 *   (dataFilter.mosaickingOrder: "leastRecent") — for Central Europe that is
 *   consistently the ~10:30 local morning pass, so the daily value is a
 *   comparable "day-pass" surface reading (the ~22:30 pass belongs to the
 *   same day interval but is newer, so leastRecent drops it).
 *
 *   Scope: Plzeň city bbox (same as the live LST layer), June–August
 *   (the overheating season) since 2016 (start of the S3A SLSTR archive).
 *
 * CLOUD FILTER (fully explainable, no black box)
 *   Thermal satellite pixels can NOT see through clouds — a cloud top reads
 *   10–30 K colder than the ground. We therefore join each satellite daily
 *   mean with the ERA5 daily maximum air temperature for Plzeň (same day)
 *   and keep the day only when the surface reading is physically plausible
 *   against it:
 *       sat_mean ≥ era5_tMax − 8   (clear-sky surface is warm, not cloud-top)
 *       sat_mean ≤ era5_tMax + 18  (surface can overshoot air temp by day)
 *   Days without ERA5 coverage keep a physical floor [5 °C, 55 °C].
 *   Monthly value = MEDIAN of kept daily means (robust). Every chart states
 *   how many days were kept of how many observed.
 *
 * CHUNKING + CACHE
 *   One Statistical API request per year (~92 daily intervals, a few seconds
 *   each). Past-year chunks are immutable → cached 7 days; the running year
 *   gains new overpasses daily → cached 2 h. Requests run with limited
 *   parallelism (3) to stay friendly to CDSE rate limits.
 *
 * Every failure carries an EXACT reason string — surfaced by
 * /api/copernicus/history.
 */

import { cdseCredsConfigured, cdsePostJson } from '@/lib/copernicus/auth';
import { getPlzenDailyEra5 } from '@/lib/data/era5';
import type { SatelliteHistoryPayload, SatelliteMonthPoint, SatelliteSummerPoint } from '@/lib/copernicus/history-types';

const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';
export const SATELLITE_SOURCE_LABEL = 'Sentinel-3 SLSTR S7 (10,85 µm) · CDSE Statistical API';

/** Plzeň city bbox (W, S, E, N) — same as the live LST layer in sentinel3.ts. */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
/** ~500 m grid over the bbox. */
const WIDTH = 27;
const HEIGHT = 21;
const PIXELS_TOTAL = WIDTH * HEIGHT;

const FIRST_YEAR = 2016; // S3A SLSTR archive start
const PAST_CHUNK_TTL_MS = 7 * 24 * 3600 * 1000;
const CURRENT_CHUNK_TTL_MS = 2 * 3600 * 1000;
const CHUNK_TIMEOUT_MS = 120000;
const PARALLELISM = 3;

/**
 * Evalscript: per-day °C stats band + dataMask (Statistical API requirement).
 * NaN pixels are excluded from statistics automatically; dataMask excludes
 * the rest of our sanity guard.
 */
const DAY_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["S7", "dataMask"] }],
    output: [
      { id: "celsius", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(samples) {
  const ok = samples.S7 > 180 && samples.S7 < 400;
  return { celsius: [ok ? samples.S7 - 273.15 : NaN], dataMask: [ok ? 1 : 0] };
}`;

interface StatsApiEntry {
  interval: { from: string; to: string };
  outputs?: {
    celsius?: { bands?: { B0?: { stats?: { mean: number; min: number; max: number; stDev: number; sampleCount: number; noDataCount: number } } } };
  };
  error?: { type: string; message: string };
}

interface DayStat {
  date: string;
  mean: number;
  min: number;
  max: number;
  stDev: number;
  sampleCount: number;
}

interface YearChunk {
  year: number;
  days: DayStat[];
  errors: string[];
}

interface ChunkCache {
  at: number;
  chunk?: YearChunk;
  error?: string;
}

const chunkCache = new Map<number, ChunkCache>();
let warmUpRunning = false;
let warmUpDone = false;

function currentYear(): number {
  return new Date().getFullYear();
}

export function satelliteYears(): number[] {
  const ys: number[] = [];
  for (let y = FIRST_YEAR; y <= currentYear(); y++) ys.push(y);
  return ys;
}

function isChunkFresh(year: number, entry: ChunkCache): boolean {
  const ttl = year >= currentYear() ? CURRENT_CHUNK_TTL_MS : PAST_CHUNK_TTL_MS;
  return Date.now() - entry.at < ttl;
}

function chunkComplete(year: number, entry: ChunkCache): boolean {
  return Boolean(entry.chunk || entry.error);
}

async function fetchYearChunk(year: number): Promise<YearChunk> {
  const payload = {
    input: {
      bounds: {
        bbox: [...BBOX],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{ type: 'S3SLSTR', dataFilter: { mosaickingOrder: 'leastRecent' } }],
    },
    aggregation: {
      timeRange: { from: `${year}-06-01T00:00:00Z`, to: `${year}-09-01T00:00:00Z` },
      aggregationInterval: { of: 'P1D' },
      evalscript: DAY_EVALSCRIPT,
      width: WIDTH,
      height: HEIGHT,
    },
    output: { format: { type: 'application/json' } },
  };
  const res = await cdsePostJson<{ data?: StatsApiEntry[] }>(STATS_URL, payload, CHUNK_TIMEOUT_MS);
  const entries = res.data ?? [];
  if (entries.length === 0) {
    throw new Error('Statistical API vrátilo 0 denních intervalů (žádná SLSTR data v rozsahu?)');
  }
  const days: DayStat[] = [];
  const errors: string[] = [];
  for (const e of entries) {
    const date = e.interval.from.slice(0, 10);
    if (e.error) {
      errors.push(`${date}: ${e.error.type} — ${e.error.message.slice(0, 120)}`);
      continue;
    }
    const st = e.outputs?.celsius?.bands?.B0?.stats;
    if (!st || st.sampleCount <= 0) continue; // acquisition-free day
    days.push({
      date,
      mean: st.mean,
      min: st.min,
      max: st.max,
      stDev: st.stDev,
      sampleCount: st.sampleCount,
    });
  }
  if (days.length === 0 && errors.length > 0) {
    throw new Error(`Statistical API: všechny dny selhaly — ${errors[0]}`);
  }
  return { year, days, errors };
}

/** Cloud filter — the join with ERA5 is explained in the module docstring. */
function keepDay(sat: DayStat, era5TMax: number | null): boolean {
  if (sat.sampleCount < PIXELS_TOTAL * 0.5) return false; // mostly nodata
  if (era5TMax === null) return sat.mean >= 5 && sat.mean <= 55;
  return sat.mean >= era5TMax - 8 && sat.mean <= era5TMax + 18;
}

function median(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const v = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(v * 10) / 10;
}

/** Aggregate cached chunks → client payload (ERA5-joined). */
function aggregateFromCache(era5Rows: { date: string; tMax: number | null }[]): {
  months: SatelliteMonthPoint[];
  summers: SatelliteSummerPoint[];
  note: string;
} {
  const era5ByDate = new Map(era5Rows.map((r) => [r.date, r.tMax]));
  const years = satelliteYears();
  const months: SatelliteMonthPoint[] = [];
  const summers: SatelliteSummerPoint[] = [];
  const failedYears: string[] = [];

  for (const year of years) {
    const entry = chunkCache.get(year);
    if (!entry?.chunk) {
      if (entry?.error) failedYears.push(`${year}: ${entry.error.slice(0, 80)}`);
      continue;
    }
    const days = entry.chunk.days;
    // group by calendar month
    const byMonth = new Map<string, DayStat[]>();
    for (const d of days) {
      const m = d.date.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(d);
    }
    const monthOut: SatelliteMonthPoint[] = [];
    let keptTotal = 0;
    let totalTotal = 0;
    let hottest: { date: string; mean: number } | null = null;
    for (const [m, list] of [...byMonth.entries()].sort()) {
      const kept = list.filter((d) => keepDay(d, era5ByDate.get(d.date) ?? null));
      keptTotal += kept.length;
      totalTotal += list.length;
      for (const d of kept) {
        if (!hottest || d.mean > hottest.mean) hottest = { date: d.date, mean: Math.round(d.mean * 10) / 10 };
      }
      monthOut.push({
        month: m,
        year,
        median: median(kept.map((d) => d.mean)),
        keptDays: kept.length,
        totalDays: list.length,
      });
    }
    months.push(...monthOut);

    // yearly summer index = mean of monthly medians (months with ≥ 8 kept days)
    const idxVals = monthOut.filter((m) => m.keptDays >= 8 && m.median !== null).map((m) => m.median!);
    summers.push({
      year,
      index: idxVals.length > 0 ? Math.round((idxVals.reduce((a, b) => a + b, 0) / idxVals.length) * 10) / 10 : null,
      hottestDay: hottest,
      keptDays: keptTotal,
      totalDays: totalTotal,
    });
  }

  const doneCount = years.filter((y) => chunkCache.has(y)).length;
  let note = `Denní přlety ~10:30 LT (mosaik „leastRecent“), mediana jasných dnů; filtr oblak: sat ≥ ERA5 tMax − 8 °C a ≤ ERA5 tMax + 18 °C.`;
  if (failedYears.length > 0) {
    note += ` Roky s chybou: ${failedYears.join(' · ')}`;
  }
  if (doneCount < years.length) {
    note += ` (načteno ${doneCount}/${years.length} ročních chunků)`;
  }
  return { months, summers, note };
}

/** Fire-and-forget background warm-up with limited parallelism. */
function startWarmUp(): void {
  if (warmUpRunning || !cdseCredsConfigured()) return;
  warmUpRunning = true;
  const years = satelliteYears();
  const pending = years.filter((y) => {
    const e = chunkCache.get(y);
    return !e || !isChunkFresh(y, e);
  });

  const queue = [...pending];
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const year = queue.shift()!;
      try {
        const chunk = await fetchYearChunk(year);
        chunkCache.set(year, { at: Date.now(), chunk });
      } catch (e) {
        chunkCache.set(year, { at: Date.now(), error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  const workers = Array.from({ length: Math.min(PARALLELISM, queue.length) }, () => worker());
  void Promise.all(workers)
    .catch(() => undefined)
    .finally(() => {
      warmUpRunning = false;
      warmUpDone = true;
    });
}

/**
 * Public entry: satellite history payload. Safe to call on every request —
 * returns cached aggregates immediately, starts the background warm-up on
 * the first call (subsequent polls pick up newly completed chunks).
 */
export async function getSatelliteHistory(): Promise<SatelliteHistoryPayload> {
  const years = satelliteYears();
  if (!cdseCredsConfigured()) {
    return {
      source: SATELLITE_SOURCE_LABEL,
      available: false,
      progress: { done: 0, total: years.length },
      years,
      months: [],
      summers: [],
      note: 'CDSE_CLIENT_ID/CDSE_CLIENT_SECRET nejsou nastavené — satelitní historie je neaktivní (viz SETUP.md).',
    };
  }

  startWarmUp();

  // NOTE: the ERA5 await below gives the background chunk fetches time to
  // complete — the progress counts are therefore read AFTER it.
  let era5Rows: { date: string; tMax: number | null }[] = [];
  let era5Error: string | null = null;
  try {
    era5Rows = (await getPlzenDailyEra5()).rows.map((r) => ({ date: r.date, tMax: r.tMax }));
  } catch (e) {
    era5Error = e instanceof Error ? e.message : String(e);
  }

  const doneCount = years.filter((y) => {
    const e = chunkCache.get(y);
    return Boolean(e && chunkComplete(y, e));
  }).length;
  const freshCount = years.filter((y) => {
    const e = chunkCache.get(y);
    return Boolean(e?.chunk && isChunkFresh(y, e));
  }).length;
  const allFresh = freshCount === years.length;

  const { months, summers, note } = aggregateFromCache(era5Rows);
  let finalNote = era5Error ? `${note} ERA5 filtr nedostupný: ${era5Error}` : note;
  if (era5Rows.length === 0 && !era5Error) {
    finalNote = `${note} (ERA5 řada zatím prázdná — filtr běží na fyzikálním rozsahu)`;
  }

  return {
    source: SATELLITE_SOURCE_LABEL,
    available: allFresh && summers.some((s) => s.index !== null),
    progress: { done: doneCount, total: years.length },
    years,
    months,
    summers,
    note: finalNote,
  };
}
