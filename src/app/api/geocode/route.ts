import { NextResponse } from 'next/server';
import { AppError, errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/geocode?q=<text>     — forward geocoding (address → point)
 * GET /api/geocode?lat=&lng=    — reverse geocoding (point → label)
 *
 * Free replacement for paid geocoders: OpenStreetMap Nominatim (no API key,
 * ODbL). The request is proxied SERVER-SIDE so we can send the User-Agent
 * identification Nominatim's usage policy requires (browsers cannot set it),
 * the search is hard-bounded to the Plzeň region and results are cached in
 * memory for 1 h. Every failure carries the EXACT upstream reason.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const UA = 'Chladnejsi-kraj/1.0 (hackathon prototype; contact via github.com/SimonCurda/Susice26)';
const TIMEOUT_MS = 12_000;

/** Plzeň city + close surroundings — hard bounding box for the search. */
const VIEWBOX = '13.18,49.66,13.58,49.84'; // west,south,east,north (Nominatim order)
/** Plzeňský kraj — results outside this region are discarded (post-filter). */
const REGION = { south: 48.95, west: 12.45, north: 50.2, east: 13.9 };

interface CacheEntry {
  at: number;
  data: unknown;
}
const CACHE_TTL_MS = 3600_000;
const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 200;

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key: string, data: unknown): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

interface NominatimPlace {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
  name?: string;
}

/** Short Czech-friendly label: name + district part, not the whole display_name. */
function shortLabel(p: NominatimPlace): string {
  const a = p.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.suburb ?? a.city_district ?? 'Plzeň';
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.square;
  const house = a.house_number;
  const local = a.neighbourhood ?? a.quarter ?? a.hamlet;
  if (street && house) return `${street} ${house}, ${city}`;
  if (street) return `${street}, ${city}`;
  if (local) return `${local}, ${city}`;
  return p.name || city;
}

async function nominatim(query: string): Promise<NominatimPlace[]> {
  let res: Response;
  try {
    // bounded=1 intentionally OFF: Nominatim's strict bounding often misses
    // POIs (e.g. "Americká zahrada"). We search with the viewbox as a ranking
    // bias and post-filter to the Plzeňský kraj ourselves (REGION below).
    res = await fetch(
      `${NOMINATIM_URL}/search?format=jsonv2&limit=10&accept-language=cs&countrycodes=cz&viewbox=${VIEWBOX}&q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
  } catch (e) {
    throw new AppError(
      `Nominatim (OpenStreetMap geokódování) nedostupné — ${e instanceof Error ? e.message : String(e)}`,
      'nominatim_unreachable',
      502
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new AppError(
      `Nominatim HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}` +
        (res.status === 403 || res.status === 429
          ? ' — služba dočasně omezuje dotazy (usage policy), zkuste za chvíli'
          : ''),
      'nominatim_http_error',
      502
    );
  }
  const j = (await res.json().catch(() => null)) as NominatimPlace[] | null;
  if (!Array.isArray(j)) {
    throw new AppError('Nominatim vrátil nevalidní JSON (očekáváno pole výsledků).', 'nominatim_bad_json', 502);
  }
  return j;
}

/** Keep only results inside the Plzeňský kraj; city results rank first. */
function filterRegion(places: NominatimPlace[]): NominatimPlace[] {
  const inRegion = places.filter((p) => {
    const lat = Number(p.lat);
    const lng = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return lat >= REGION.south && lat <= REGION.north && lng >= REGION.west && lng <= REGION.east;
  });
  const cityFirst = (p: NominatimPlace): number => {
    const lat = Number(p.lat);
    const lng = Number(p.lon);
    const inCity = lat >= 49.66 && lat <= 49.84 && lng >= 13.18 && lng <= 13.58;
    return inCity ? 0 : 1;
  };
  return inRegion.sort((a, b) => cityFirst(a) - cityFirst(b));
}

async function nominatimReverse(lat: number, lng: number): Promise<NominatimPlace | null> {
  let res: Response;
  try {
    res = await fetch(
      `${NOMINATIM_URL}/reverse?format=jsonv2&accept-language=cs&zoom=18&lat=${lat}&lon=${lng}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
  } catch (e) {
    throw new AppError(
      `Nominatim reverse geokódování nedostupné — ${e instanceof Error ? e.message : String(e)}`,
      'nominatim_unreachable',
      502
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new AppError(`Nominatim reverse HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`, 'nominatim_http_error', 502);
  }
  const j = (await res.json().catch(() => null)) as (NominatimPlace & { error?: string }) | null;
  if (!j || j.error) return null;
  return j;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const latRaw = url.searchParams.get('lat');
  const lngRaw = url.searchParams.get('lng');
  try {
    // ---- reverse: label an exact map point --------------------------------
    if (latRaw !== null && lngRaw !== null) {
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new AppError(
          `Parametry „lat“ a „lng“ musí být čísla — přijato: lat=${JSON.stringify(latRaw)}, lng=${JSON.stringify(lngRaw)}.`,
          'bad_coords',
          400
        );
      }
      const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
      const hit = cacheGet(key);
      if (hit) return NextResponse.json(hit as object);
      const p = await nominatimReverse(lat, lng);
      const data = {
        label: p ? shortLabel(p) : `Bod na mapě (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        detail: p?.display_name ?? null,
      };
      cacheSet(key, data);
      return NextResponse.json(data);
    }

    // ---- forward: search an address --------------------------------------
    const query = (q ?? '').trim();
    if (query.length < 2) {
      throw new AppError(
        'Parametr „q“ je povinný — zadejte alespoň 2 znaky k hledání adresy v Plzni (např. „Kopeckého sady“).',
        'bad_query',
        400
      );
    }
    const key = `fwd:${query.toLowerCase()}`;
    const hit = cacheGet(key);
    if (hit) return NextResponse.json(hit as object);

    let places = filterRegion(await nominatim(query));
    if (places.length === 0 && !/plzeň/i.test(query)) {
      // POI names often need the city hint ("Americká zahrada" → "… Plzeň")
      places = filterRegion(await nominatim(`${query} Plzeň`));
    }
    const results = places
      .filter((p) => p.lat && p.lon)
      .map((p) => ({
        label: shortLabel(p),
        detail: p.display_name ?? '',
        lat: Number(p.lat),
        lng: Number(p.lon),
      }));
    const data = { results, count: results.length };
    cacheSet(key, data);
    return NextResponse.json(data);
  } catch (e) {
    const payload = errorPayload('GET /api/geocode', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[GET /api/geocode] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
