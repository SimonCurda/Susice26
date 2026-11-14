/**
 * ΔLST — the "how much did it warm up between two summers" MAP.
 *
 * WHAT THE TWO LAYERS ARE
 *   For each year we build a clear-hot-day composite of the summer surface
 *   temperature: the N clearest hot days of June–August are selected by the
 *   EXISTING ERA5 cloud filter (src/lib/copernicus/stats.ts → daily means
 *   from the CDSE Statistical API), and for each selected day we fetch a
 *   single-day Process API raster (Sentinel-3 SLSTR S7, morning ~10:30 pass
 *   via "leastRecent"). Per pixel we take the MEDIAN of the selected days —
 *   both years use the SAME rule, so the difference is comparable.
 *
 * WHY NOT ONE BIG MOSAIC
 *   The CDSE S3SLSTR collection exposes only thermal channels (no geometry /
 *   cloud bands — verified against the API), so a whole-summer ORBIT mosaic
 *   would mix ~10:30 day passes with ~22:30 night passes. Selecting clear
 *   days first and fetching day rasters per day keeps the physics honest.
 *
 * DIFF
 *   Δ = composite(to) − composite(from) per pixel, colourised on a diverging
 *   scale −5…+5 °C (teal = cooled, orange = warmed). Nodata stays transparent.
 *
 * CACHING: composites are cached per YEAR (past years 7 d, running year 2 h)
 * — any year pair then costs two cached lookups + a cheap diff. This also
 * makes switching pairs in the UI fast after the first choice.
 */

import { PNG } from 'pngjs';
import { cdseCredsConfigured, cdsePostRaw } from '@/lib/copernicus/auth';
import { getClearHotDays } from '@/lib/copernicus/stats';

const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

/** City bbox (W, S, E, N) — same extents as the live LST layer. */
const BBOX = [13.3, 49.706, 13.49, 49.8] as const;
const WIDTH = 104;
const HEIGHT = 72; // ~140 m per cell

const DAYS_PER_COMPOSITE = 5;
const CANDIDATES = 12; // candidates examined before giving up (commissioning years have holes)
const MIN_DAY_COVERAGE = 0.7; // a day raster counts only with ≥ 70 % valid cells
const MIN_DAYS = 3;
const PAST_TTL_MS = 7 * 24 * 3600 * 1000;
const CURRENT_TTL_MS = 2 * 3600 * 1000;
const DAY_TIMEOUT_MS = 60000;

export const DLST_SOURCE_LABEL = 'Sentinel-3 SLSTR S7 · CDSE Process API + Statistical API';

export interface DlstPayload {
  available: boolean;
  source: string;
  fromYear: number;
  toYear: number;
  bounds: { south: number; west: number; north: number; east: number };
  image: string;
  pixels: { width: number; height: number };
  stats: {
    meanDelta: number;
    minDelta: number;
    maxDelta: number;
    shareWarmed2Pct: number; // % cells with Δ ≥ +2 °C
    shareCooled2Pct: number; // % cells with Δ ≤ −2 °C
    daysFrom: { date: string; mean: number }[];
    daysTo: { date: string; mean: number }[];
  };
  note: string;
}

/** S7 Kelvin → °C byte encoding, identical to sentinel3.ts (255 = nodata). */
const DAY_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ["S7"], output: { bands: 1, sampleType: "UINT8" } };
}
function evaluatePixel(s) {
  if (!(s.S7 > 180 && s.S7 < 400)) return [255];
  const c = s.S7 - 273.15;
  const v = Math.round(((c + 10) / 70) * 250);
  return [Math.max(0, Math.min(250, v))];
}`;

function byteToC(v: number): number | null {
  if (v >= 251) return null;
  return (v / 250) * 70 - 10;
}

interface Composite {
  at: number;
  year: number;
  vals: Float64Array; // °C, NaN = nodata
  days: { date: string; mean: number }[];
}

const compositeCache = new Map<number, Composite>();
const compositeInflight = new Map<number, Promise<Composite>>();

function compositeTtl(year: number): number {
  return year >= new Date().getFullYear() ? CURRENT_TTL_MS : PAST_TTL_MS;
}

function isFresh(c: Composite): boolean {
  return Date.now() - c.at < compositeTtl(c.year);
}

async function fetchDayCelsius(date: string): Promise<{ vals: Float64Array; validCount: number }> {
  const from = `${date}T00:00:00Z`;
  const to = new Date(new Date(`${date}T00:00:00Z`).getTime() + 24 * 3600 * 1000).toISOString();
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
            type: 'S3SLSTR',
            dataFilter: { timeRange: { from, to }, mosaickingOrder: 'leastRecent' },
          },
        ],
      },
      output: {
        width: WIDTH,
        height: HEIGHT,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
      evalscript: DAY_EVALSCRIPT,
    },
    'image/png',
    DAY_TIMEOUT_MS
  );
  const img = PNG.sync.read(png);
  if (img.width !== WIDTH || img.height !== HEIGHT) {
    throw new Error(`Process API vrátilo ${img.width}×${img.height} px, očekáváno ${WIDTH}×${HEIGHT}`);
  }
  const vals = new Float64Array(WIDTH * HEIGHT);
  let validCount = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const c = byteToC(img.data[i * 4]);
    vals[i] = c === null ? NaN : c;
    if (c !== null) validCount++;
  }
  return { vals, validCount };
}

/** Per-pixel median of valid values (the composite). */
function medianOf(samples: number[]): number {
  if (samples.length === 0) return NaN;
  const s = [...samples].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function buildComposite(year: number): Promise<Composite> {
  const candidates = await getClearHotDays(year, CANDIDATES);
  const accepted: { date: string; mean: number; vals: Float64Array }[] = [];
  const rejected: string[] = [];
  for (const d of candidates) {
    if (accepted.length >= DAYS_PER_COMPOSITE) break;
    const { vals, validCount } = await fetchDayCelsius(d.date);
    if (validCount >= WIDTH * HEIGHT * MIN_DAY_COVERAGE) {
      accepted.push({ date: d.date, mean: d.mean, vals });
    } else {
      rejected.push(`${d.date} (${Math.round((validCount / (WIDTH * HEIGHT)) * 100)} % pokrytí)`);
    }
  }
  if (accepted.length < MIN_DAYS) {
    throw new Error(
      `Léto ${year}: jen ${accepted.length} z ${candidates.length} kandidátů má ≥ ${Math.round(MIN_DAY_COVERAGE * 100)} % pokrytí bboxu` +
        (rejected.length > 0 ? ` — odmítnuto: ${rejected.slice(0, 4).join(', ')}${rejected.length > 4 ? '…' : ''}. ` : '. ') +
        `SLSTR v komisioní fázi (${year}) měl často částečné zábery — zvolte pozdější rok.`
    );
  }
  const vals = new Float64Array(WIDTH * HEIGHT);
  let validCells = 0;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const samples: number[] = [];
    for (const r of accepted) {
      const v = r.vals[i];
      if (Number.isFinite(v)) samples.push(v);
    }
    if (samples.length >= Math.ceil(accepted.length / 2)) {
      vals[i] = medianOf(samples);
      validCells++;
    } else {
      vals[i] = NaN;
    }
  }
  if (validCells < WIDTH * HEIGHT * 0.4) {
    throw new Error(`Kompozit léta ${year}: jen ${validCells} z ${WIDTH * HEIGHT} buněk validních — málo jasných dnů`);
  }
  const composite: Composite = { at: Date.now(), year, vals, days: accepted.map((a) => ({ date: a.date, mean: a.mean })) };
  compositeCache.set(year, composite);
  compositeInflight.delete(year);
  return composite;
}

function getComposite(year: number): Promise<Composite> {
  const cached = compositeCache.get(year);
  if (cached && isFresh(cached)) return Promise.resolve(cached);
  const inflight = compositeInflight.get(year);
  if (inflight) return inflight;
  const p = buildComposite(year).catch((e) => {
    compositeInflight.delete(year);
    throw e;
  });
  compositeInflight.set(year, p);
  return p;
}

/** Diverging colour: ≤ −4 °C teal (#0d9488) → 0 neutral → ≥ +4 °C orange (#ea580c). */
function deltaColor(d: number): [number, number, number] {
  const neutral: [number, number, number] = [245, 245, 244];
  const cool: [number, number, number] = [13, 148, 136];
  const warm: [number, number, number] = [234, 88, 12];
  const t = Math.max(-4, Math.min(4, d));
  const k = Math.min(1, Math.abs(t) / 4);
  const target = t < 0 ? cool : warm;
  return [
    Math.round(neutral[0] + (target[0] - neutral[0]) * k),
    Math.round(neutral[1] + (target[1] - neutral[1]) * k),
    Math.round(neutral[2] + (target[2] - neutral[2]) * k),
  ];
}

export async function getLstDiff(fromYear: number, toYear: number): Promise<DlstPayload> {
  const currentYear = new Date().getFullYear();
  if (!cdseCredsConfigured()) {
    return unavailable(fromYear, toYear, 'CDSE_CLIENT_ID/CDSE_CLIENT_SECRET nejsou nastavené');
  }
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear < 2016 || toYear > currentYear || fromYear >= toYear) {
    return unavailable(fromYear, toYear, `Neplatný rozsah let — očekáváno 2016 ≤ from < to ≤ ${currentYear}`);
  }
  try {
    const [compFrom, compTo] = await Promise.all([getComposite(fromYear), getComposite(toYear)]);
    const diffs: number[] = [];
    const out = new PNG({ width: WIDTH, height: HEIGHT });
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      const o = i * 4;
      const a = compFrom.vals[i];
      const b = compTo.vals[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        out.data[o] = 0;
        out.data[o + 1] = 0;
        out.data[o + 2] = 0;
        out.data[o + 3] = 0;
        continue;
      }
      const d = b - a;
      diffs.push(d);
      const c = deltaColor(d);
      out.data[o] = c[0];
      out.data[o + 1] = c[1];
      out.data[o + 2] = c[2];
      out.data[o + 3] = 220;
    }
    if (diffs.length < WIDTH * HEIGHT * 0.3) {
      return unavailable(fromYear, toYear, 'Příliš málo společných validních buněk pro rozdíl dvou let');
    }
    diffs.sort((x, y) => x - y);
    const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
    const warmed2 = (diffs.filter((d) => d >= 2).length / diffs.length) * 100;
    const cooled2 = (diffs.filter((d) => d <= -2).length / diffs.length) * 100;
    const pngBuf = PNG.sync.write(out, { colorType: 6 });
    // SLSTR 2016–2017 = S3A commissioning era (provisional calibration, later
    // reprocessed) — whole-composite offsets up to several K are documented;
    // say so explicitly instead of letting a biased Δ look like physics.
    const commissioningNote =
      fromYear <= 2017
        ? ` POZOR: léto ${fromYear} je z komisioní fáze Sentinel-3A (prozatímní kalibrace, později reprocessované) — celkový posun řady může být až o jednotky K systematický; pro srovnání let doporučujeme roky 2018+.`
        : '';
    return {
      available: true,
      source: DLST_SOURCE_LABEL,
      fromYear,
      toYear,
      bounds: { south: BBOX[1], west: BBOX[0], north: BBOX[3], east: BBOX[2] },
      image: `data:image/png;base64,${pngBuf.toString('base64')}`,
      pixels: { width: WIDTH, height: HEIGHT },
      stats: {
        meanDelta: Math.round(mean * 10) / 10,
        minDelta: Math.round(diffs[0] * 10) / 10,
        maxDelta: Math.round(diffs[diffs.length - 1] * 10) / 10,
        shareWarmed2Pct: Math.round(warmed2),
        shareCooled2Pct: Math.round(cooled2),
        daysFrom: compFrom.days,
        daysTo: compTo.days,
      },
      note: `Kompozit ${compFrom.days.length} nejasnějších horkých dnů léta ${fromYear} vs. ${compTo.days.length} dnů léta ${toYear} — denní přlety ~10:30 (mosaik „leastRecent“), dny vybrané ERA5 filtrem oblaků, hodnota buněk = mediana vybraných dnů (~140 m grid). Δ = to − from; obě léta používají stejné pravidlo, takže rozdíl je srovnatelný.${commissioningNote}`,
    };
  } catch (e) {
    return unavailable(fromYear, toYear, e instanceof Error ? e.message : String(e));
  }
}

function unavailable(fromYear: number, toYear: number, reason: string): DlstPayload {
  return {
    available: false,
    source: DLST_SOURCE_LABEL,
    fromYear,
    toYear,
    bounds: { south: BBOX[1], west: BBOX[0], north: BBOX[3], east: BBOX[2] },
    image: '',
    pixels: { width: WIDTH, height: HEIGHT },
    stats: {
      meanDelta: 0,
      minDelta: 0,
      maxDelta: 0,
      shareWarmed2Pct: 0,
      shareCooled2Pct: 0,
      daysFrom: [],
      daysTo: [],
    },
    note: reason,
  };
}
