/**
 * OSRM foot-routing client (server-side only) — turns the cool-route engine's
 * WAYPOINT CHAIN into real, walkable geometry.
 *
 * WHY: the internal Dijkstra graph is a curated DEMO graph (sparse nodes,
 * straight edges). The route decision (which park / street corridor) is ours,
 * but the drawn line should follow real sidewalks and paths — otherwise the
 * citizen sees "air lines". OSRM's public foot profile
 * (routing.openstreetmap.de, run by FOSSGIS for openstreetmap.org) snaps the
 * segment between each pair of consecutive waypoints to the OSM pedestrian
 * network, so the map line IS the path you can actually walk.
 *
 * DIVISION OF ROLES (kept explicit, no black box):
 *  - WHERE: Dijkstra over the cool graph (shade/water/green/traffic attributes)
 *  - HOW THE LINE LOOKS: OSRM /routed-foot between consecutive waypoints
 *  - fallback: if OSRM is unreachable the route keeps the straight demo
 *    geometry and `geometrySource: 'straight-demo'` says so in the UI/trace.
 *
 * In-memory cache (waypoint-keyed, 6 h) + in-flight dedupe: the three route
 * profiles share consecutive waypoint pairs, so repeated searches are cheap.
 */

const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot';
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 6 * 3600 * 1000;
/** Failed attempts are remembered only briefly — a transient network hiccup
 * must not pin straight-line fallback geometry on the map for hours. */
const NEGATIVE_TTL_MS = 2 * 60 * 1000;
/** Guard against absurd requests — the demo graph has ≤ ~25 waypoints/route. */
const MAX_WAYPOINTS = 50;

export interface OsrmRoute {
  /** dense polyline points lat/lng following real footways */
  points: { lat: number; lng: number }[];
  /** OSRM's own distance (m) along the pedestrian network */
  distanceM: number;
  /** OSRM duration (s) for the walking profile */
  durationS: number;
}

interface CacheEntry {
  at: number;
  route?: OsrmRoute;
  error?: string;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<OsrmRoute | null>>();

function cacheKey(wps: { lat: number; lng: number }[]): string {
  return wps.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join('|');
}

interface OsrmResponse {
  code?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRoute(waypoints: { lat: number; lng: number }[]): Promise<OsrmRoute | null> {
  if (waypoints.length < 2 || waypoints.length > MAX_WAYPOINTS) return null;
  const coords = waypoints.map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');
  const url = `${OSRM_BASE}/route/v1/foot/${coords}?overview=full&geometries=geojson&annotations=false&steps=false`;
  const headers = {
    // FOSSGIS public instances expect an identifying User-Agent
    // (https://operations.osmfoundation.org/policies/nominatim analogy) —
    // requests without one are answered with HTTP 403.
    'User-Agent': 'ChladnejsiKraj/1.0 (github.com/SimonCurda/Susice26)',
  };

  /** One attempt → route or null. `reason` explains EVERY failure (logged). */
  const attemptOnce = async (): Promise<{ route: OsrmRoute | null; reason?: string }> => {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      return { route: null, reason: `network — ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      return { route: null, reason: `HTTP ${res.status} ${res.statusText}${body ? `: ${body}` : ''}` };
    }
    let j: OsrmResponse;
    try {
      j = (await res.json()) as OsrmResponse;
    } catch (e) {
      return { route: null, reason: `parse — ${e instanceof Error ? e.message : String(e)}` };
    }
    const route = j?.code === 'Ok' ? j.routes?.[0] : undefined;
    const coordsList = route?.geometry?.coordinates;
    if (!route || !Array.isArray(coordsList) || coordsList.length < 2) {
      return { route: null, reason: `OSRM code=${j?.code ?? 'none'} (bez geometrie)` };
    }
    const points: { lat: number; lng: number }[] = [];
    for (const c of coordsList) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      const lat = c[1];
      const lng = c[0];
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) points.push({ lat, lng });
    }
    if (points.length < 2) return { route: null, reason: 'geometrie s < 2 body' };
    return { route: { points, distanceM: typeof route.distance === 'number' ? Math.round(route.distance) : 0, durationS: typeof route.duration === 'number' ? route.duration : 0 } };
  };

  // 2 attempts: free public routers have transient hiccups (cold caches, brief
  // 429s) — a single unlucky request must NOT poison the map with straight
  // lines for the next 2 hours (positive cache) / degrade it for 2 minutes.
  let last: { route: OsrmRoute | null; reason?: string } | null = null;
  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleep(900);
    last = await attemptOnce();
    if (last.route) return last.route;
    console.warn(`[osrm] pokus ${i + 1}/2 selhal (${coords.slice(0, 60)}…): ${last.reason}`);
  }
  return null;
}

/**
 * Real footway polyline through the given waypoints, or null when OSRM is
 * unavailable (caller keeps the straight-line fallback). Cached 6 h.
 */
export async function osrmFootRoute(waypoints: { lat: number; lng: number }[]): Promise<OsrmRoute | null> {
  const key = cacheKey(waypoints);
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.route ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.route ?? null;
    cache.delete(key);
  }
  const running = inflight.get(key);
  if (running) return running;
  const p = fetchRoute(waypoints)
    .then((route) => {
      cache.set(key, { at: Date.now(), ...(route ? { route } : { error: 'unavailable' }) });
      return route;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Cache size (for the methodology/trace honesty). */
export function osrmCacheSize(): number {
  return cache.size;
}
