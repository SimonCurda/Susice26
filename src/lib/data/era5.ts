/**
 * Historical air temperatures for Plzeň + region — ERA5 reanalysis
 * (Copernicus Climate Change Service, C3S / ECMWF) delivered through the
 * open Open-Meteo archive broker (free, no API key, CC-BY 4.0 attribution).
 *
 * WHY ERA5: the Copernicus Climate Data Store (cds.climate.copernicus.eu)
 * serves ERA5 via a separate API key that the project does not have yet.
 * Open-Meteo exposes THE SAME ERA5 dataset as a free open API — zero setup,
 * reliable, and licensed for open use. The Methodology dialog and the UI
 * label the series as "ERA5 (Copernicus C3S) via Open-Meteo" — honest
 * provenance. Switching to the native CDS API later only touches this file
 * (see SETUP.md "CDS API upgrade").
 *
 * Derived values (all deterministic + explainable):
 *  - yearly stats: mean, hottest day, tropical days (max ≥ 30 °C),
 *    tropical nights (min ≥ 20 °C), summer (JJA) mean
 *  - climate normals: 1961–1990, last 10 full years
 *  - warming per decade: OLS slope of yearly means × 10
 *  - region KPIs for the 8 towns of WEATHER_POINTS (since 1994)
 *
 * Cached in memory 12 h (archive data updates once per day).
 * The daily Plzeň rows are also exposed internally — the satellite history
 * (src/lib/copernicus/stats.ts) uses them to filter out cloud-contaminated
 * days (cloud tops read far colder than the day's air temperature).
 */

import { WEATHER_POINTS } from '@/lib/data/plzen';
import { describeError } from '@/lib/errors';

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 30000;

export const ERA5_SOURCE_LABEL = 'ERA5 (Copernicus C3S, ECMWF) via Open-Meteo archive';

/** Full-years window used for the region KPIs. */
const REGION_FROM_YEAR = 1994;

export interface Era5YearStat {
  year: number;
  /** mean of daily means for FULL years; null for the running year */
  tMean: number | null;
  hottest: { date: string; t: number } | null;
  tropicalDays: number; // daily max ≥ 30 °C
  tropicalNights: number; // daily min ≥ 20 °C
  summerMean: number | null; // mean of daily means over JJA (full years only)
  isFullYear: boolean;
}

export interface Era5RegionKpi {
  name: string;
  altitudeNote: string;
  warmingPerDecade: number; // °C per 10 years (OLS on yearly (max+min)/2 mean)
  tropicalDaysAvgLast10: number;
  tropicalDaysLastFullYear: number;
  hottestEver: { date: string; t: number };
  /** present when the town's archive fetch failed */
  note?: string;
}

export interface Era5History {
  fetchedAt: string;
  source: string;
  location: { name: string; lat: number; lng: number };
  firstYear: number;
  lastFullYear: number;
  years: Era5YearStat[];
  normals: {
    ref: '1961–1990';
    refMean: number | null;
    recent: string;
    recentMean: number | null;
    delta: number | null; // recent − reference, °C
  };
  warmingPerDecade: number | null;
  record: { date: string; t: number } | null;
  region: Era5RegionKpi[];
  note: string;
}

interface OpenMeteoArchiveDaily {
  time: string[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  temperature_2m_mean?: (number | null)[];
}

interface OpenMeteoArchiveResponse {
  daily?: OpenMeteoArchiveDaily;
  error?: boolean;
  reason?: string;
}

interface DailyRow {
  date: string;
  year: number;
  tMax: number | null;
  tMin: number | null;
  tMean: number | null;
}

interface CacheEntry {
  at: number;
  history: Era5History;
  daily: DailyRow[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

async function fetchArchive(
  lat: number,
  lng: number,
  fromYear: number,
  withMean: boolean
): Promise<OpenMeteoArchiveDaily> {
  // ERA5 archive ends ~5 days before today
  const end = new Date(Date.now() - 6 * 86400000);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=${fromYear}-01-01&end_date=${end.toISOString().slice(0, 10)}` +
    `&daily=temperature_2m_max,temperature_2m_min${withMean ? ',temperature_2m_mean' : ''}` +
    `&timezone=Europe%2FPrague`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(
      `Open-Meteo archive: síťový dotaz selhal (timeout ${TIMEOUT_MS} ms nebo DNS/TLS) — ${describeError(e)}`
    );
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = '(tělo nepřečteno)';
    }
    let reason = '';
    try {
      const j = JSON.parse(body) as { reason?: string };
      if (j?.reason) reason = ` — upstream reason: „${j.reason}"`;
    } catch {
      // not JSON
    }
    throw new Error(`Open-Meteo archive vrátilo HTTP ${res.status} ${res.statusText}${reason} — ${body}`);
  }
  const j = (await res.json()) as OpenMeteoArchiveResponse;
  if (j.error) {
    throw new Error(`Open-Meteo archive vrátilo chybu: „${j.reason ?? 'neznámá'}“ pro [${lat}, ${lng}] od ${fromYear}`);
  }
  const d = j.daily;
  if (!d?.time || !Array.isArray(d.time) || d.time.length === 0) {
    throw new Error(`Open-Meteo archive vrátilo prázdnou řadu (bez bloku „daily“) pro [${lat}, ${lng}] od ${fromYear}`);
  }
  return d;
}

/**
 * Batched multi-location archive fetch (ONE request for all towns — parallel
 * single requests hit the open-meteo minutely rate limit with HTTP 429).
 * Returns rows per town; towns that come back without a daily block fail
 * their entry with an exact reason.
 */
async function fetchArchiveMulti(
  points: { name: string; lat: number; lng: number }[],
  fromYear: number
): Promise<{ name: string; rows: DailyRow[] }[]> {
  const end = new Date(Date.now() - 6 * 86400000);
  const lats = points.map((p) => p.lat).join(',');
  const lngs = points.map((p) => p.lng).join(',');
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lngs}` +
    `&start_date=${fromYear}-01-01&end_date=${end.toISOString().slice(0, 10)}` +
    `&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FPrague`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`Open-Meteo archive (multi): síťový dotaz selhal — ${describeError(e)}`);
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = '(tělo nepřečteno)';
    }
    let reason = '';
    try {
      const j = JSON.parse(body) as { reason?: string };
      if (j?.reason) reason = ` — upstream reason: „${j.reason}"`;
    } catch {
      // not JSON
    }
    throw new Error(`Open-Meteo archive (multi) vrátilo HTTP ${res.status} ${res.statusText}${reason} — ${body}`);
  }
  const j = (await res.json()) as OpenMeteoArchiveResponse | OpenMeteoArchiveResponse[];
  const arr = Array.isArray(j) ? j : [j];
  if (arr.length !== points.length) {
    throw new Error(
      `Open-Meteo archive (multi) vrátilo ${arr.length} lokalit, ale požadováno ${points.length}`
    );
  }
  return points.map((p, i) => {
    const d = arr[i]?.daily;
    if (!d?.time || d.time.length === 0) {
      throw new Error(`Open-Meteo archive (multi): chybí řada „daily“ pro ${p.name}`);
    }
    return { name: p.name, rows: toRows(d) };
  });
}

/** Multi-location fetch with backoff retry — beats transient 429/minutely windows. */
async function fetchArchiveMultiWithRetry(
  points: { name: string; lat: number; lng: number }[],
  fromYear: number,
  attempts = 4
): Promise<{ name: string; rows: DailyRow[] }[]> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchArchiveMulti(points, fromYear);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('HTTP 429') || msg.includes('síťový dotaz selhal')) {
        await new Promise((r) => setTimeout(r, 8000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

function toRows(d: OpenMeteoArchiveDaily): DailyRow[] {
  const rows: DailyRow[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const tMax = d.temperature_2m_max?.[i] ?? null;
    const tMin = d.temperature_2m_min?.[i] ?? null;
    const tMean = d.temperature_2m_mean?.[i] ?? null;
    rows.push({
      date: d.time[i],
      year: Number(d.time[i].slice(0, 4)),
      tMax: typeof tMax === 'number' ? tMax : null,
      tMin: typeof tMin === 'number' ? tMin : null,
      tMean: typeof tMean === 'number' ? tMean : null,
    });
  }
  return rows;
}

function yearStats(rows: DailyRow[], year: number): Era5YearStat {
  const yr = rows.filter((r) => r.year === year);
  let sumMean = 0;
  let nMean = 0;
  let hottest: { date: string; t: number } | null = null;
  let trop = 0;
  let tropN = 0;
  let sumSummer = 0;
  let nSummer = 0;
  for (const r of yr) {
    if (r.tMean !== null) {
      sumMean += r.tMean;
      nMean++;
    }
    if (r.tMax !== null) {
      if (!hottest || r.tMax > hottest.t) hottest = { date: r.date, t: r.tMax };
      if (r.tMax >= 30) trop++;
    }
    if (r.tMin !== null && r.tMin >= 20) tropN++;
    const month = Number(r.date.slice(5, 7));
    if ((month === 6 || month === 7 || month === 8) && r.tMean !== null) {
      sumSummer += r.tMean;
      nSummer++;
    }
  }
  const isFull = yr.length >= 360;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    year,
    tMean: isFull && nMean > 300 ? r2(sumMean / nMean) : null,
    hottest: hottest ? { date: hottest.date, t: Math.round(hottest.t * 10) / 10 } : null,
    tropicalDays: trop,
    tropicalNights: tropN,
    summerMean: isFull && nSummer > 80 ? r2(sumSummer / nSummer) : null,
    isFullYear: isFull,
  };
}

/** Ordinary least squares slope of y over years, in °C per decade. */
function olsSlopePerDecade(points: { x: number; y: number }[]): number | null {
  if (points.length < 15) return null;
  const n = points.length;
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  return Math.round(slope * 10 * 100) / 100;
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

/**
 * Daily ERA5 rows for Plzeň — INTERNAL use (satellite cloud filter).
 * Reads through the same 12 h cache as getHistory().
 */
export async function getPlzenDailyEra5(): Promise<{ rows: DailyRow[]; lastDate: string }> {
  const e = await load();
  return { rows: e.daily, lastDate: e.daily[e.daily.length - 1]?.date ?? '' };
}

/** Client payload: full ERA5 history for Plzeň + region KPIs. */
export async function getHistory(): Promise<Era5History> {
  return (await load()).history;
}

async function load(): Promise<CacheEntry> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = build().finally(() => {
    inflight = null;
  });
  cache = await inflight;
  return cache;
}

async function build(): Promise<CacheEntry> {
  const plzen = WEATHER_POINTS[0];
  const plzenRaw = await fetchArchive(plzen.lat, plzen.lng, 1970, true);
  const daily = toRows(plzenRaw);
  const firstYear = Number(daily[0].date.slice(0, 4));
  const maxYear = Number(daily[daily.length - 1].date.slice(0, 4));

  const years: Era5YearStat[] = [];
  for (let y = firstYear; y <= maxYear; y++) years.push(yearStats(daily, y));

  const fullYears = years.filter((y) => y.isFullYear);
  const refMean = mean(fullYears.filter((y) => y.year >= 1961 && y.year <= 1990).map((y) => y.tMean ?? 0));
  const recent10 = fullYears.slice(-10);
  const recentMean = mean(recent10.map((y) => y.tMean ?? 0));
  const slope = olsSlopePerDecade(fullYears.map((y) => ({ x: y.year, y: y.tMean ?? 0 })));

  let record: { date: string; t: number } | null = null;
  for (const r of daily) {
    if (r.tMax !== null && (!record || r.tMax > record.t)) record = { date: r.date, t: r.tMax };
  }

  // region towns (skip Plzeň itself) — ONE batched multi-location request
  // (parallel single requests hit the open-meteo minutely rate limit, 429)
  const towns = WEATHER_POINTS.filter((p) => p.name !== plzen.name);
  const region: Era5RegionKpi[] = [];
  let multiRows: Map<string, DailyRow[]>;
  try {
    const withRetry = await fetchArchiveMultiWithRetry(towns, REGION_FROM_YEAR);
    multiRows = new Map(withRetry.map((r) => [r.name, r.rows]));
  } catch (e) {
    multiRows = new Map(towns.map((t) => [t.name, []]));
    const reason = describeError(e).slice(0, 160);
    for (const t of towns) {
      region.push({
        name: t.name,
        altitudeNote: t.altitudeNote,
        warmingPerDecade: 0,
        tropicalDaysAvgLast10: 0,
        tropicalDaysLastFullYear: 0,
        hottestEver: { date: '', t: 0 },
        note: `data nedostupná: ${reason}`,
      });
    }
  }
  for (const t of towns) {
    if (region.some((r) => r.name === t.name)) continue; // already filled with a note
    const rows = multiRows.get(t.name) ?? [];
    if (rows.length === 0) {
      region.push({
        name: t.name,
        altitudeNote: t.altitudeNote,
        warmingPerDecade: 0,
        tropicalDaysAvgLast10: 0,
        tropicalDaysLastFullYear: 0,
        hottestEver: { date: '', t: 0 },
        note: 'data nedostupná (prázdná řada)',
      });
      continue;
    }
    try {
      const fullYrs: number[] = [];
      for (let y = REGION_FROM_YEAR; y <= maxYear; y++) {
        if (rows.filter((r) => r.year === y).length >= 360) fullYrs.push(y);
      }
      const yearlyMeans = fullYrs.map((y) => {
        const yr = rows.filter((r) => r.year === y);
        const vals = yr.filter((r) => r.tMax !== null && r.tMin !== null).map((r) => (r.tMax! + r.tMin!) / 2);
        return { x: y, y: vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length) };
      });
      const last10 = fullYrs.slice(-10);
      const tropAvg =
        last10.length === 0
          ? 0
          : Math.round(
              (last10.reduce(
                (a, y) => a + rows.filter((r) => r.year === y && (r.tMax ?? -99) >= 30).length,
                0
              ) /
                last10.length) *
                10
            ) / 10;
      const lastFull = fullYrs[fullYrs.length - 1];
      let hottest: { date: string; t: number } | null = null;
      for (const r of rows) {
        if (r.tMax !== null && (!hottest || r.tMax > hottest.t)) hottest = { date: r.date, t: r.tMax };
      }
      region.push({
        name: t.name,
        altitudeNote: t.altitudeNote,
        warmingPerDecade: olsSlopePerDecade(yearlyMeans) ?? 0,
        tropicalDaysAvgLast10: tropAvg,
        tropicalDaysLastFullYear: lastFull
          ? rows.filter((r) => r.year === lastFull && (r.tMax ?? -99) >= 30).length
          : 0,
        hottestEver: hottest ?? { date: '', t: 0 },
      });
    } catch (e) {
      region.push({
        name: t.name,
        altitudeNote: t.altitudeNote,
        warmingPerDecade: 0,
        tropicalDaysAvgLast10: 0,
        tropicalDaysLastFullYear: 0,
        hottestEver: { date: '', t: 0 },
        note: `výpočet selhal: ${describeError(e).slice(0, 120)}`,
      });
    }
  }

  const runningYear = years.find((y) => !y.isFullYear);
  const lastDate = daily[daily.length - 1].date;
  const note = runningYear
    ? `Rok ${runningYear.year} je zatím neúplný (k ${lastDate}); řada ERA5 má ~6denní zpoždění a síť ~25 km tlumí extrémy oproti staničním měřením (stanovní rekord Plzeň-Bolevec 41,5 °C z 4. 8. 2026 odpovídá v ERA5 gridu ~39 °C).`
    : 'Řada ERA5 má ~6denní zpoždění a síť ~25 km tlumí extrémy oproti staničním měřením.';

  return {
    at: Date.now(),
    daily,
    history: {
      fetchedAt: new Date().toISOString(),
      source: ERA5_SOURCE_LABEL,
      location: { name: plzen.name, lat: plzen.lat, lng: plzen.lng },
      firstYear,
      lastFullYear: maxYear,
      years,
      normals: {
        ref: '1961–1990',
        refMean,
        recent: `${recent10[0]?.year ?? 0}–${recent10[recent10.length - 1]?.year ?? 0}`,
        recentMean,
        delta: refMean !== null && recentMean !== null ? Math.round((recentMean - refMean) * 100) / 100 : null,
      },
      warmingPerDecade: slope,
      record,
      region,
      note,
    },
  };
}
