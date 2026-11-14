/**
 * Sentinel-2 vegetation HISTORY via the CDSE Sentinel Hub Statistical API —
 * the "vývoj dané proměnné" half of the historical story (the SLSTR module
 * covers temperature history; this one covers vegetation and its moisture).
 *
 * WHAT IT MEASURES
 *   Sentinel-2 L2A surface reflectances → two standard indices:
 *     NDVI = (B08 − B04) / (B08 + B04)   green biomass (listová biomasa)
 *     NDMI = (B8A − B11) / (B8A + B11)   vegetation moisture (1.6 vs 2.2 µm —
 *                                        water content of the canopy)
 *   NDVI falling → less green biomass → weaker evapotranspirative cooling.
 *   NDMI falling → the remaining vegetation is moisture-stressed (suchý
 *   stres) — dry vegetation cools measurably less and burns more easily.
 *   Together they answer „vegetace chladí jako dřív, nebo ne?“ with numbers.
 *
 * AGGREGATION
 *   Scope: Plzeň city bbox (same as every other satellite layer).
 *   One Statistical API request per year, June–August, P1M intervals — each
 *   month is a mosaic of the LEAST cloudy acquisitions (dataFilter
 *   maxCloudCoverage 30, mosaickingOrder "leastCC").
 *   Sentinel pixels cannot see through clouds, so pixels are excluded per SCL
 *   class: 0 nodata, 1 saturated, 3 cloud shadow, 6 water, 8/9/10 clouds.
 *   Water (6) is excluded ON PURPOSE: open water would drag the city NDVI
 *   mean down without being „vegetation“. A month counts only when ≥ 40 % of
 *   land pixels are valid; the summer index is the mean of valid monthly
 *   means. Every month reports keptPct — the chart is never a black box.
 *
 * FIRST YEAR 2018
 *   The L2A (Sen2Cor bottom-of-atmosphere) archive over Europe is complete
 *   only from 2018 (both S2A+S2B, full JJA). Claiming 2016–17 summers would
 *   silently degrade the series — we start where the data is honest.
 *
 * TREND
 *   OLS slope of the summer index × 10 (per decade) for NDVI and NDMI —
 *   deterministic, no AI involved.
 *
 * CHUNKING + CACHE: same pattern as src/lib/copernicus/stats.ts (past years
 * immutable → 7 d, running year → 2 h, parallelism 3, background warm-up).
 */

import { cdseCredsConfigured, cdsePostJson, cdseSetupHint } from '@/lib/copernicus/auth';
import type { VegHistoryPayload, VegMonthPoint, VegSummerPoint } from '@/lib/copernicus/history-types';

const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';
export const VEG_SOURCE_LABEL = 'Sentinel-2 L2A (NDVI/NDMI) · CDSE Statistical API';

/** Plzeň city bbox (W, S, E, N) — same extents as the live NDVI overlay. */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
/** ~200 m grid over the bbox — far coarser than 10 m imagery, plenty for area means. */
const WIDTH = 72;
const HEIGHT = 52;
const PIXELS_TOTAL = WIDTH * HEIGHT;

const FIRST_YEAR = 2018;
const PAST_CHUNK_TTL_MS = 7 * 24 * 3600 * 1000;
const CURRENT_CHUNK_TTL_MS = 2 * 3600 * 1000;
const CHUNK_TIMEOUT_MS = 120000;
const PARALLELISM = 3;

/** A month counts only when this share of land pixels is valid (clear). */
const MIN_VALID_SHARE = 0.4;

const VEG_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "B8A", "B11", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndmi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  // 0 nodata, 1 saturated, 3 cloud shadow, 6 water, 8/9/10 clouds
  const bad = s.SCL === 0 || s.SCL === 1 || s.SCL === 3 || s.SCL === 6 || s.SCL === 8 || s.SCL === 9 || s.SCL === 10;
  if (bad || s.dataMask === 0) {
    return { ndvi: [NaN], ndmi: [NaN], dataMask: [0] };
  }
  const ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  const ndmi = (s.B8A - s.B11) / (s.B8A + s.B11);
  return { ndvi: [ndvi], ndmi: [ndmi], dataMask: [1] };
}`;

interface StatsApiEntry {
  interval: { from: string; to: string };
  outputs?: {
    ndvi?: { bands?: { B0?: { stats?: { mean: number; sampleCount: number } } } };
    ndmi?: { bands?: { B0?: { stats?: { mean: number } } } };
  };
  error?: { type: string; message: string };
}

interface MonthStat {
  month: string; // 'YYYY-MM'
  ndvi: number | null;
  ndmi: number | null;
  keptPct: number; // valid land pixel share of the monthly mosaic
}

interface YearChunk {
  year: number;
  months: MonthStat[];
  errors: string[];
}

interface ChunkCache {
  at: number;
  chunk?: YearChunk;
  error?: string;
}

const chunkCache = new Map<number, ChunkCache>();
let warmUpRunning = false;

function currentYear(): number {
  return new Date().getFullYear();
}

export function vegYears(): number[] {
  const ys: number[] = [];
  for (let y = FIRST_YEAR; y <= currentYear(); y++) ys.push(y);
  return ys;
}

function isChunkFresh(year: number, entry: ChunkCache): boolean {
  const ttl = year >= currentYear() ? CURRENT_CHUNK_TTL_MS : PAST_CHUNK_TTL_MS;
  return Date.now() - entry.at < ttl;
}

async function fetchYearChunk(year: number): Promise<YearChunk> {
  const payload = {
    input: {
      bounds: {
        bbox: [...BBOX],
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [
        {
          type: 'S2L2A',
          dataFilter: { maxCloudCoverage: 30, mosaickingOrder: 'leastCC' },
        },
      ],
    },
    aggregation: {
      timeRange: { from: `${year}-06-01T00:00:00Z`, to: `${year}-09-01T00:00:00Z` },
      aggregationInterval: { of: 'P1M' },
      evalscript: VEG_EVALSCRIPT,
      width: WIDTH,
      height: HEIGHT,
    },
    output: { format: { type: 'application/json' } },
  };
  const res = await cdsePostJson<{ data?: StatsApiEntry[] }>(STATS_URL, payload, CHUNK_TIMEOUT_MS);
  const entries = res.data ?? [];
  if (entries.length === 0) {
    throw new Error('Statistical API vrátilo 0 měsíčních intervalů (žádná S2 data v rozsahu?)');
  }
  const months: MonthStat[] = [];
  const errors: string[] = [];
  for (const e of entries) {
    const month = e.interval.from.slice(0, 7);
    if (e.error) {
      errors.push(`${month}: ${e.error.type} — ${e.error.message.slice(0, 120)}`);
      continue;
    }
    const ndviSt = e.outputs?.ndvi?.bands?.B0?.stats;
    const ndmiSt = e.outputs?.ndmi?.bands?.B0?.stats;
    if (!ndviSt || ndviSt.sampleCount <= 0) continue; // no usable acquisition that month
    const keptPct = ndviSt.sampleCount / PIXELS_TOTAL;
    if (keptPct < MIN_VALID_SHARE) continue; // too cloudy to be honest
    months.push({
      month,
      ndvi: Math.round(ndviSt.mean * 1000) / 1000,
      ndmi: ndmiSt ? Math.round(ndmiSt.mean * 1000) / 1000 : null,
      keptPct: Math.round(keptPct * 100) / 100,
    });
  }
  if (months.length === 0 && errors.length > 0) {
    throw new Error(`Statistical API: všechny měsíce selhaly — ${errors[0]}`);
  }
  return { year, months, errors };
}

/** OLS slope × 10 (per decade); null unless ≥ 3 usable points. */
function olsPerDecade(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) * (p.x - mx);
  }
  if (sxx === 0) return null;
  return Math.round(((sxy / sxx) * 10) * 10000) / 10000;
}

function aggregateFromCache(): { months: VegMonthPoint[]; summers: VegSummerPoint[]; trend: VegHistoryPayload['trend']; note: string } {
  const years = vegYears();
  const months: VegMonthPoint[] = [];
  const summers: VegSummerPoint[] = [];
  const failedYears: string[] = [];

  for (const year of years) {
    const entry = chunkCache.get(year);
    if (!entry?.chunk) {
      if (entry?.error) failedYears.push(`${year}: ${entry.error.slice(0, 80)}`);
      continue;
    }
    const monthList = entry.chunk.months;
    const ndviVals = monthList.filter((m) => m.ndvi !== null).map((m) => m.ndvi!);
    const ndmiVals = monthList.filter((m) => m.ndmi !== null).map((m) => m.ndmi!);
    for (const m of monthList) {
      months.push({ month: m.month, year, ndvi: m.ndvi, ndmi: m.ndmi, keptPct: m.keptPct });
    }
    summers.push({
      year,
      ndvi: ndviVals.length > 0 ? Math.round((ndviVals.reduce((a, b) => a + b, 0) / ndviVals.length) * 1000) / 1000 : null,
      ndmi: ndmiVals.length > 0 ? Math.round((ndmiVals.reduce((a, b) => a + b, 0) / ndmiVals.length) * 1000) / 1000 : null,
    });
  }

  const doneCount = years.filter((y) => chunkCache.has(y)).length;
  let note = `Měsíční mozaiky nejméně oblačných scén (maxCloudCoverage 30 %, „leastCC“), SCL filtr vylučuje oblaky, stín, vodu a nodata; měsíc se počítá od ${Math.round(MIN_VALID_SHARE * 100)} % validních land pixelů (keptPct v tooltipu). L2A archiv Evropy kompletní od ${FIRST_YEAR}.`;
  if (failedYears.length > 0) {
    note += ` Roky s chybou: ${failedYears.join(' · ')}`;
  }
  if (doneCount < years.length) {
    note += ` (načteno ${doneCount}/${years.length} ročních chunků)`;
  }

  const trend = {
    ndviPerDecade: olsPerDecade(summers.filter((s) => s.ndvi !== null).map((s) => ({ x: s.year, y: s.ndvi! }))),
    ndmiPerDecade: olsPerDecade(summers.filter((s) => s.ndmi !== null).map((s) => ({ x: s.year, y: s.ndmi! }))),
  };
  return { months, summers, trend, note };
}

/** Fire-and-forget background warm-up with limited parallelism. */
function startWarmUp(): void {
  if (warmUpRunning || !cdseCredsConfigured()) return;
  warmUpRunning = true;
  const years = vegYears();
  const queue = years.filter((y) => {
    const e = chunkCache.get(y);
    return !e || !isChunkFresh(y, e);
  });

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
    });
}

/**
 * Public entry: vegetation history payload. Returns cached aggregates
 * immediately and starts the background warm-up on the first call (the
 * history panel polls until progress completes, same as the SLSTR series).
 */
export async function getVegHistory(): Promise<VegHistoryPayload> {
  const years = vegYears();
  if (!cdseCredsConfigured()) {
    return {
      source: VEG_SOURCE_LABEL,
      available: false,
      progress: { done: 0, total: years.length },
      years,
      months: [],
      summers: [],
      trend: { ndviPerDecade: null, ndmiPerDecade: null },
      note: cdseSetupHint(),
    };
  }

  startWarmUp();

  const doneCount = years.filter((y) => {
    const e = chunkCache.get(y);
    return Boolean(e && (e.chunk || e.error));
  }).length;

  const { months, summers, trend, note } = aggregateFromCache();
  const allDone = doneCount === years.length;
  return {
    source: VEG_SOURCE_LABEL,
    available: allDone && summers.some((s) => s.ndvi !== null),
    progress: { done: doneCount, total: years.length },
    years,
    months,
    summers,
    trend,
    note,
  };
}
