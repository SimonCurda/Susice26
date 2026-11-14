/**
 * Cool-route engine ("Kudy projít").
 *
 * Dijkstra over a walking graph where edge cost combines time with
 * user preferences (positive options) and negatives (what to avoid).
 * Three profiles are computed so the citizen can see the trade-off:
 *   Coolest / Balanced / Fastest — all fully traced.
 *
 * Endpoints: a preset node id (string) OR an EXACT point {lat, lng, name?}.
 * Exact points are connected to the graph through the 3 nearest nodes with
 * straight-line "connector" legs (transparent, listed in the trace). The
 * connectors get REAL tree-canopy greenery from the Copernicus 10 m raster
 * at their midpoint; other attributes are neutral and documented.
 */

import { COOL_PLACES, GRAPH_EDGES, GRAPH_NODES, START_POINTS, haversineM } from '@/lib/data/plzen';
import { canopyAt } from '@/lib/data/canopy';
import { osrmFootRoute } from '@/lib/engine/osrm';
import type { GraphEdge, GraphNode, RouteEndpointInfo, RouteProfilePrefs, RouteResult, RouteSegment, Trace } from '@/lib/engine/types';

/** A route endpoint: preset node id OR an exact geographic point. */
export type RouteEndpointSpec = string | { lat: number; lng: number; name?: string };

/** Plzeň walking-graph coverage — exact points outside this box are rejected with the exact reason. */
export const GRAPH_COVERAGE = { south: 49.66, west: 13.18, north: 49.84, east: 13.58 };

const CONNECTOR_COUNT = 3;
/**
 * Connector legs: ALWAYS the nearest 3 graph nodes, no hard distance cap —
 * every point inside the Plzeň bbox stays routable (functional A→B for the
 * whole city). Long connectors (sparse demo graph) are visible on the map as
 * straight segments and their EXACT lengths are listed in the trace —
 * nothing is hidden.
 */
const SAME_PLACE_M = 100;

/** BFS reachability over a graph (ignores weights — connectivity only). */
function reachableFrom(ctx: GraphCtx, startId: string): string[] {
  const seen = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const e of ctx.edges) {
      const v = e.from === u ? e.to : e.to === u ? e.from : null;
      if (v && !seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return [...seen];
}

/** Per-request graph context: base graph + optional virtual endpoint nodes. */
interface GraphCtx {
  nodesById: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/** Edge length over the REQUEST graph (includes virtual endpoint nodes — the
 *  module-level edgeLengthM in plzen.ts only knows the base GRAPH_NODES and
 *  would crash on connector legs). Same haversine as the base graph. */
function edgeLen(ctx: GraphCtx, e: GraphEdge): number {
  const a = ctx.nodesById.get(e.from);
  const b = ctx.nodesById.get(e.to);
  if (!a || !b) return 0;
  return haversineM(a.lat, a.lng, b.lat, b.lng);
}

function baseCtx(): GraphCtx {
  const nodesById = new Map<string, GraphNode>();
  for (const n of GRAPH_NODES) nodesById.set(n.id, n);
  return { nodesById, edges: [...GRAPH_EDGES] };
}

/** Exact validation of route endpoints BEFORE searching (both id and exact-point specs). */
export function endpointProblems(startSpec: RouteEndpointSpec, destSpec: RouteEndpointSpec): string[] {
  const problems: string[] = [];
  const knownIds = GRAPH_NODES.map((n) => n.id).join(', ');

  const check = (spec: RouteEndpointSpec, role: string): { lat: number; lng: number } | null => {
    if (typeof spec === 'string') {
      const id = toNodeId(spec);
      if (!GRAPH_NODES.some((n) => n.id === id)) {
        problems.push(
          `Neznámý ${role} „${spec}"${NODE_ALIASES[spec] ? ` (alias → „${NODE_ALIASES[spec]}", který také není v grafu)` : ''}. Známé id uzlů (${GRAPH_NODES.length}): ${knownIds}.`
        );
        return null;
      }
      const n = GRAPH_NODES.find((x) => x.id === id)!;
      return { lat: n.lat, lng: n.lng };
    }
    const { lat, lng } = spec;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      problems.push(
        `${role === 'startu' ? 'Start' : 'Cíl'} zadaný souřadnicemi má nečíselné hodnoty: lat=${JSON.stringify(lat)}, lng=${JSON.stringify(lng)}.`
      );
      return null;
    }
    if (lat < GRAPH_COVERAGE.south || lat > GRAPH_COVERAGE.north || lng < GRAPH_COVERAGE.west || lng > GRAPH_COVERAGE.east) {
      problems.push(
        `${role === 'startu' ? 'Start' : 'Cíl'} [${lat.toFixed(5)}, ${lng.toFixed(5)}] leží mimo pokrytí chodcovského grafu Plzně ` +
          `(bbox J ${GRAPH_COVERAGE.south}–S ${GRAPH_COVERAGE.north}, Z ${GRAPH_COVERAGE.west}–V ${GRAPH_COVERAGE.east}).`
      );
      return null;
    }
    const near = nearestNodes(lat, lng, 1)[0];
    if (!near) {
      problems.push(`${role === 'startu' ? 'Start' : 'Cíl'} [${lat.toFixed(5)}, ${lng.toFixed(5)}] nemá v grafu žádný uzel pro připojení.`);
      return null;
    }
    return { lat, lng };
  };

  const a = check(startSpec, 'startu');
  const b = check(destSpec, 'cíle');
  if (a && b && haversineM(a.lat, a.lng, b.lat, b.lng) < SAME_PLACE_M) {
    problems.push(
      `Start a cíl jsou prakticky na stejném místě (${Math.round(haversineM(a.lat, a.lng, b.lat, b.lng))} m od sebe) — hledání trasy nemá smysl.`
    );
  }
  return problems;
}

/** Backward-compatible wrapper (string ids only). */
export function routeIdProblems(startRaw: string, destRaw: string): string[] {
  return endpointProblems(startRaw, destRaw);
}

const WALK_SPEED_M_MIN = 75; // ~4.5 km/h

interface WeightConfig {
  shade: number;
  water: number;
  green: number;
  benches: number;
  fountain: number;
  transit: number;
  traffic: number;
  slope: number;
  construction: number;
  sunExposed: number;
  crowd: number;
}

/** Derive edge weights from user preferences + profile. Fully explicit. */
export function weightsFor(prefs: RouteProfilePrefs, profile: 'coolest' | 'balanced' | 'fastest'): WeightConfig {
  const k = profile === 'fastest' ? 0 : profile === 'balanced' ? 0.6 : 1.15;
  const o = prefs.options;
  const n = prefs.negatives;
  return {
    shade: k * (o.shade ? 1.0 : 0.35),
    water: k * (o.water ? 0.85 : 0.3),
    green: k * (o.green ? 0.7 : 0.3),
    benches: k * (o.benches ? 0.5 : 0.15),
    fountain: k * (o.fountain ? 0.5 : 0.15),
    transit: k * (o.transit ? 0.3 : 0),
    traffic: k * (n.traffic ? 1.4 : 0.4) + (profile === 'fastest' ? 0.1 : 0),
    slope: k * (n.slope ? 1.3 : 0.3),
    construction: k * (n.construction ? 2.2 : 0.8) + 0.4,
    sunExposed: k * (n.sun ? 0.9 : 0.2),
    crowd: k * (n.crowd ? 1.0 : 0.25),
  };
}

function edgeCostMinutes(ctx: GraphCtx, e: GraphEdge, w: WeightConfig, ambTemp: number): { minutes: number; mult: number } {
  const baseMin = edgeLen(ctx, e) / WALK_SPEED_M_MIN;
  const heatLoad = Math.max(0, (ambTemp - 22) / 14); // 0 in mild weather → 1 in extreme heat
  const penalty =
    w.traffic * (e.traffic / 3) * 0.35 +
    w.slope * (Math.min(8, e.slopePct) / 8) * 0.3 +
    (e.construction ? w.construction : 0) * 0.18 +
    (e.crowd ? w.crowd : 0) * 0.18 +
    (e.shade < 0.3 ? w.sunExposed : 0) * 0.22 * (0.4 + heatLoad);
  const relief =
    w.shade * e.shade * 0.5 +
    (e.water ? w.water * 0.5 : 0) +
    w.green * e.green * 0.3 +
    (e.benches > 0 ? w.benches * 0.1 : 0) +
    (e.fountain ? w.fountain * 0.1 : 0);
  const mult = Math.max(0.4, Math.min(2.6, 1 + penalty - relief));
  return { minutes: baseMin * mult, mult };
}

function dijkstra(ctx: GraphCtx, startId: string, endId: string, w: WeightConfig, ambTemp: number): string[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const id of ctx.nodesById.keys()) dist.set(id, Infinity);
  dist.set(startId, 0);

  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) if (!visited.has(id) && d < best) { best = d; u = id; }
    if (u === null || best === Infinity) return null;
    if (u === endId) break;
    visited.add(u);
    for (const e of ctx.edges) {
      if (e.from !== u && e.to !== u) continue;
      const v = e.from === u ? e.to : e.from;
      if (visited.has(v)) continue;
      const c = edgeCostMinutes(ctx, e, w, ambTemp).minutes;
      if (dist.get(u)! + c < dist.get(v)!) {
        dist.set(v, dist.get(u)! + c);
        prev.set(v, u);
      }
    }
  }

  const path: string[] = [];
  let cur: string | undefined = endId;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(cur);
    if (cur === startId) { path.unshift(startId); break; }
  }
  return path[0] === startId ? path : null;
}

function pathEdges(ctx: GraphCtx, path: string[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e =
      ctx.edges.find((x) => x.from === path[i] && x.to === path[i + 1]) ??
      ctx.edges.find((x) => x.from === path[i + 1] && x.to === path[i]);
    if (e) edges.push(e);
  }
  return edges;
}

/** Segment-level temperature estimate (demo physics, transparent formula). */
function segmentTemp(e: GraphEdge, ambTemp: number): number {
  const delta = (e.shade - 0.5) * -3.5 - (e.water ? 2.5 : 0) - e.green * 1.8 + e.traffic * 0.5;
  return Math.round((ambTemp + delta) * 10) / 10;
}

function buildSegments(ctx: GraphCtx, path: string[], ambTemp: number): RouteSegment[] {
  const segs: RouteSegment[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = ctx.nodesById.get(path[i])!;
    const eIn = i > 0 ? pathEdges(ctx, [path[i - 1], path[i]])[0] : null;
    segs.push({
      lat: node.lat,
      lng: node.lng,
      edgeId: eIn?.id ?? 'start',
      shade: eIn?.shade ?? 0.5,
      water: eIn?.water ?? false,
      green: eIn?.green ?? 0.3,
      traffic: eIn?.traffic ?? 1,
      slopePct: eIn?.slopePct ?? 1,
      tempEst: eIn ? segmentTemp(eIn, ambTemp) : ambTemp,
    });
  }
  return segs;
}

function scoreRoute(ctx: GraphCtx, edges: GraphEdge[], ambTemp: number): { cooling: number; avgTemp: number; shadePct: number; water: number; rest: number } {
  if (edges.length === 0) return { cooling: 0, avgTemp: ambTemp, shadePct: 0, water: 0, rest: 0 };
  const totalLen = edges.reduce((a, e) => a + edgeLen(ctx, e), 0) || 1;
  const shadePct = edges.reduce((a, e) => a + e.shade * edgeLen(ctx, e), 0) / totalLen;
  const avgTemp =
    edges.reduce((a, e) => a + segmentTemp(e, ambTemp) * edgeLen(ctx, e), 0) / totalLen;
  const cooling = Math.round(
    Math.min(100, Math.max(0, (shadePct * 45 + Math.min(1, edges.filter((e) => e.water).length / 2) * 20 + (edges.reduce((a, e) => a + e.green, 0) / edges.length) * 25 + Math.max(0, (32 - avgTemp) / 10) * 10)))
  );
  return {
    cooling,
    avgTemp: Math.round(avgTemp * 10) / 10,
    shadePct: Math.round(shadePct * 100),
    water: edges.filter((e) => e.water).length,
    rest: edges.reduce((a, e) => a + e.benches, 0) + edges.filter((e) => e.fountain).length,
  };
}

/** Cool-place / start-point ids that map to a different graph node id. */
const NODE_ALIASES: Record<string, string> = {
  kamen_rybnik: 'bolevic_kam',
  fountain_nam: 'nam_republiky',
  uslava_cernice: 'uslava',
  lochotin: 'lochotin_park',
};

function toNodeId(id: string): string {
  return NODE_ALIASES[id] ?? id;
}

/** K nearest graph nodes to a coordinate, with distances (m). */
function nearestNodes(lat: number, lng: number, k: number): { node: GraphNode; distM: number }[] {
  return GRAPH_NODES
    .map((node) => ({ node, distM: haversineM(lat, lng, node.lat, node.lng) }))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, k);
}

/** Resolved endpoint (before graph registration). */
interface ResolvedEndpoint {
  /** '__start' | '__dest' for exact points, null for presets */
  virtualId: string | null;
  /** node id the search actually starts/ends at (preset id, or first connector) */
  nodeId: string;
  info: RouteEndpointInfo;
  exact: { lat: number; lng: number; name: string } | null;
  connectors: { nodeId: string; distM: number }[];
}

function resolveEndpoint(spec: RouteEndpointSpec, role: 'start' | 'dest'): ResolvedEndpoint | null {
  if (typeof spec === 'string') {
    const id = toNodeId(spec);
    const n = GRAPH_NODES.find((x) => x.id === id);
    if (!n) return null;
    return {
      virtualId: null,
      nodeId: id,
      exact: null,
      connectors: [],
      info: { kind: 'preset', name: n.name, lat: n.lat, lng: n.lng, snapDistanceM: null },
    };
  }
  const name = (spec.name ?? '').trim() || `Bod na mapě [${spec.lat.toFixed(4)}, ${spec.lng.toFixed(4)}]`;
  const connectors = nearestNodes(spec.lat, spec.lng, CONNECTOR_COUNT);
  return {
    virtualId: role === 'start' ? '__start' : '__dest',
    nodeId: connectors[0]?.node.id ?? '',
    exact: { lat: spec.lat, lng: spec.lng, name },
    connectors: connectors.map((c) => ({ nodeId: c.node.id, distM: c.distM })),
    info: {
      kind: 'exact',
      name,
      lat: spec.lat,
      lng: spec.lng,
      snapDistanceM: connectors[0] ? Math.round(connectors[0].distM) : null,
    },
  };
}

/**
 * Register an exact endpoint into the graph: a virtual node + straight-line
 * connector edges to the nearest graph nodes WITHIN CONNECTOR_MAX_M.
 * Connector greenery is REAL (Copernicus canopy at midpoint); shade derives
 * from it transparently.
 */
function registerExactEndpoint(ctx: GraphCtx, ep: ResolvedEndpoint): void {
  if (!ep.virtualId || !ep.exact) return;
  ctx.nodesById.set(ep.virtualId, {
    id: ep.virtualId,
    name: ep.exact.name,
    lat: ep.exact.lat,
    lng: ep.exact.lng,
  });
  const midGreen = canopyAt(ep.exact.lat, ep.exact.lng);
  const green = midGreen !== null ? Math.min(1, Math.max(0.05, midGreen / 100)) : 0.35;
  const shade = Math.min(0.9, 0.2 + 0.6 * green); // transparent connector heuristic
  for (const c of ep.connectors) {
    ctx.edges.push({
      id: `${ep.virtualId === '__start' ? 'vstart' : 'vdest'}:${c.nodeId}`,
      from: ep.virtualId,
      to: c.nodeId,
      shade,
      traffic: 2,
      slopePct: 2,
      water: false,
      green,
      benches: 0,
      fountain: false,
      construction: false,
      crowd: false,
    });
  }
}

export async function findRoutes(
  startSpec: RouteEndpointSpec,
  destSpec: RouteEndpointSpec,
  prefs: RouteProfilePrefs,
  ambientTemp: number
): Promise<{ routes: RouteResult[]; trace: Trace; problems: string[] }> {
  const problems = endpointProblems(startSpec, destSpec);
  const startEp = problems.length ? null : resolveEndpoint(startSpec, 'start');
  const destEp = problems.length ? null : resolveEndpoint(destSpec, 'dest');
  if (problems.length > 0 || !startEp || !destEp) {
    return { routes: [], trace: emptyTrace(startSpec, destSpec, problems), problems };
  }

  const ctx = baseCtx();
  registerExactEndpoint(ctx, startEp);
  registerExactEndpoint(ctx, destEp);

  const profiles: { id: 'coolest' | 'balanced' | 'fastest'; name: string; color: string }[] = [
    { id: 'coolest', name: 'Nejchladnější', color: '#059669' },
    { id: 'balanced', name: 'Vyvážená', color: '#d97706' },
    { id: 'fastest', name: 'Nejrychlejší', color: '#57534e' },
  ];

  const routes: RouteResult[] = [];
  const comparison: string[] = [];

  for (const p of profiles) {
    const w = weightsFor(prefs, p.id);
    const path = dijkstra(ctx, startEp.virtualId ?? startEp.nodeId, destEp.virtualId ?? destEp.nodeId, w, ambientTemp);
    if (!path) continue;
    const edges = pathEdges(ctx, path);
    const segs = buildSegments(ctx, path, ambientTemp);
    const s = scoreRoute(ctx, edges, ambientTemp);
    // REAL WALKABLE GEOMETRY: the Dijkstra result decides WHERE (which parks /
    // corridors), OSRM routed-foot snaps the line to the actual OSM pedestrian
    // network so the citizen sees the path they can actually walk — not air
    // lines between demo nodes. Straight demo geometry is the honest fallback.
    const waypoints = path
      .map((id) => ctx.nodesById.get(id))
      .filter((n): n is GraphNode => Boolean(n))
      .map((n) => ({ lat: n.lat, lng: n.lng }));
    const osrm = await osrmFootRoute(waypoints);
    const geometrySource: RouteResult['geometrySource'] = osrm ? 'osrm-foot' : 'straight-demo';
    const distM = osrm?.distanceM || edges.reduce((a, e) => a + edgeLen(ctx, e), 0);
    const geometry = osrm ? osrm.points : waypoints;
    routes.push({
      profileId: p.id,
      profileName: p.name,
      color: p.color,
      distanceM: distM,
      minutes: Math.round(distM / WALK_SPEED_M_MIN),
      coolingScore: s.cooling,
      avgTempEst: s.avgTemp,
      shadePct: s.shadePct,
      waterPoints: s.water,
      restPoints: s.rest,
      segments: segs,
      geometry,
      geometrySource,
      endpoints: { start: startEp.info, dest: destEp.info },
      trace: routeTrace(p.id, w, path, edges, prefs, ambientTemp, s, distM, ctx, startEp.info, destEp.info, geometrySource),
    });
    comparison.push(`${p.name}: ${Math.round(distM)} m, ${s.cooling}/100 chlad, ${s.avgTemp} °C pocit`);
  }

  // all profiles failed although endpoints are valid → exact reachability diagnosis
  if (routes.length === 0) {
    const startNodeId = startEp.virtualId ?? startEp.nodeId;
    const destNodeId = destEp.virtualId ?? destEp.nodeId;
    const reach = reachableFrom(ctx, startNodeId);
    const destReachable = reach.includes(destNodeId);
    problems.push(
      destReachable
        ? `Cíl „${destEp.info.name}" je v grafu dosažitelný, ale žádný z 3 profilů nenašel cestu — zkontrolujte hrany grafu (${ctx.edges.length} hran, ${ctx.nodesById.size} uzlů).`
        : `Cíl „${destEp.info.name}" NENÍ ze startu „${startEp.info.name}" dosažitelný. Ze startu je dosažitelných ${reach.length}/${ctx.nodesById.size} uzlů. Graf má celkem ${GRAPH_EDGES.length} hran mezi ${GRAPH_NODES.length} uzly.`
    );
  }

  const coolest = routes.find((r) => r.profileId === 'coolest');
  const fastest = routes.find((r) => r.profileId === 'fastest');
  const meta: Trace = {
    title: 'Jak vznikla doporučení tras',
    summary:
      'Hledáme cesty Dijkstrovým algoritmem v grafu chodníků Plzně. Každý úsek má atributy (stín, voda, zeleň, provoz, stoupání) a cena úseku se počítá z vašich preferencí – vše vidíte níže.',
    dataSources: [
      { name: 'OpenStreetMap – síť chodníků a atributy úseků', url: 'https://www.openstreetmap.org/', note: 'Základ grafu; demo atributy kurátorované, produkčně z OSM tagů.' },
      { name: 'OSRM routed-foot (FOSSGIS/openstreetmap.org)', url: 'https://routing.openstreetmap.de/', note: 'Nakreslená čára trasy = reálné chodníky a pěší stezky OSM mezi uzly rozhodovacího grafu; při nedostupnosti čarový fallback rovných linek (v trace vždy uvedeno).' },
      { name: 'Copernicus Sentinel-2 NDVI', url: 'https://browser.dataspace.copernicus.eu/', note: 'Podíl vegetace na úseku (demo: kurátorované hodnoty).' },
      { name: 'Open-Meteo', url: 'https://open-meteo.com/', note: `Aktuální teplota ${ambientTemp.toFixed(1)} °C použita pro odhad pocitové teploty na úsecích.` },
    ],
    steps: [
      ...(startEp.info.kind === 'exact' || destEp.info.kind === 'exact'
        ? [{
            id: 'r0',
            kind: 'input' as const,
            title: 'Přesné body zadání',
            detail:
              'Start/cíl zadaný přesnými souřadnicemi. Bod je připojen k chodcovskému grafu 3 nejbližšími uzly přímými spojnicemi (viditelné na mapě); zeleň připojnic je reálná z Copernicus korunního pokryvu (10 m), ostatní atributy připojnic neutrální. Prototypový graf je řídký — u vzdálenějších bodů je připojnice delší a přesnost nižší.',
            inputs: [
              { label: 'Start', value: `${startEp.info.name}${startEp.info.snapDistanceM !== null ? ` · připojnice ${startEp.info.snapDistanceM} m k grafu` : ''}` },
              { label: 'Cíl', value: `${destEp.info.name}${destEp.info.snapDistanceM !== null ? ` · připojnice ${destEp.info.snapDistanceM} m k grafu` : ''}` },
            ],
          }]
        : []),
      { id: 'r1', kind: 'input', title: 'Vaše preference', detail: 'Volby a záporné volby se převádějí na váhy v ceně úseku.', inputs: [
        { label: 'Chlad vs. rychlost', value: `${prefs.coolVsFast}/100` },
        { label: 'Aktivní volby', value: Object.entries(prefs.options).filter(([, v]) => v).map(([k]) => OPTION_LABELS[k] ?? k).join(', ') || 'žádné' },
        { label: 'Aktivní záporné volby', value: Object.entries(prefs.negatives).filter(([, v]) => v).map(([k]) => NEGATIVE_LABELS[k] ?? k).join(', ') || 'žádné' },
      ] },
      { id: 'r2', kind: 'score', title: 'Porovnání profilů', detail: 'Vždy počítáme tři profily, abyste viděli kompromis. ' + comparison.join(' · ') },
      { id: 'r3', kind: 'decision', title: 'Závěr', detail: coolest && fastest ? `Nejchladnější varianta je ${Math.abs(coolest.distanceM - fastest.distanceM) < 50 ? 'o nic' : `${Math.round(Math.abs(coolest.distanceM - fastest.distanceM))} m`} delší, ale je ${Math.max(0, Math.round((fastest.avgTempEst - coolest.avgTempEst) * 10) / 10)} °C chladnější a má ${coolest.cooling}/100 skóre chladu.` : 'Trasy vypočteny.' },
    ],
    factors: [
      { label: 'Stín', weight: weightsFor(prefs, 'coolest').shade, contribution: coolest?.shadePct ? coolest.shadePct / 100 : 0.5 },
      { label: 'Voda na trase', weight: weightsFor(prefs, 'coolest').water, contribution: Math.min(1, (coolest?.waterPoints ?? 0) / 2) },
      { label: 'Zeleň', weight: weightsFor(prefs, 'coolest').green, contribution: 0.6 },
      { label: 'Prohlídka provozu (záporné)', weight: weightsFor(prefs, 'coolest').traffic, contribution: 0.4 },
      { label: 'Stoupání (záporné)', weight: weightsFor(prefs, 'coolest').slope, contribution: 0.3 },
    ],
    confidence: { level: 'medium', note: 'Atributy úseků jsou v prototypu kurátorované; produkčně budou z OSM + Copernicus NDVI + městského GIS.' },
    disclaimers: ['Odhad pocitové teploty je zjednodušený model: teplota vzduchu + korekce na stín, vodu, zeleň a provoz.'],
  };

  if (problems.length > 0) {
    meta.summary = `${meta.summary} PROBLÉM: ${problems.join(' | ')}`;
    meta.steps.push({ id: 'r-problem', kind: 'filter', title: 'Proč nebyla trasa nalezena', detail: problems.join(' ') });
    meta.confidence = { level: 'low', note: 'Výsledek je neplatný kvůli problému popsanému výše.' };
  }

  return { routes, trace: meta, problems };
}

export const OPTION_LABELS: Record<string, string> = {
  shade: 'Maximum stínu',
  water: 'Trasa u vody',
  benches: 'Lavičky k odpočinku',
  fountain: 'Pitná voda cestou',
  slope_flat: 'Rovný terén',
  quiet: 'Klidné ulice',
  green: 'Hodně zeleně',
  transit: 'Napojení na MHD',
};
export const NEGATIVE_LABELS: Record<string, string> = {
  traffic: 'Rušné komunikace',
  slope: 'Prudká stoupání',
  sun: 'Nestíněné úseky',
  construction: 'Stavby a uzavírky',
  crowd: 'Přeplněná místa',
};

function routeTrace(
  profile: 'coolest' | 'balanced' | 'fastest',
  w: WeightConfig,
  path: string[],
  edges: GraphEdge[],
  prefs: RouteProfilePrefs,
  ambTemp: number,
  s: { cooling: number; avgTemp: number; shadePct: number; water: number; rest: number },
  distM: number,
  ctx: GraphCtx,
  startInfo: RouteEndpointInfo,
  destInfo: RouteEndpointInfo,
  geometrySource: 'osrm-foot' | 'straight-demo'
): Trace {
  const nodeNames = (id: string) => ctx.nodesById.get(id)?.name ?? id;
  const scored = edges
    .map((e) => ({ e, ...edgeCostMinutes(ctx, e, w, ambTemp), len: edgeLen(ctx, e) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  return {
    title: `Proč trasa "${profile === 'coolest' ? 'Nejchladnější' : profile === 'balanced' ? 'Vyvážená' : 'Nejrychlejší'}"`,
    summary: `${startInfo.name} → ${destInfo.name} · ${path.map(nodeNames).join(' → ')} · ${distM} m · chlad ${s.cooling}/100 · stín ${s.shadePct} % · pocit ${s.avgTemp} °C`,
    dataSources: [
      { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/', note: 'Graf trasy a atributy úseků' },
      { name: 'OSRM routed-foot (FOSSGIS)', url: 'https://routing.openstreetmap.de/', note: geometrySource === 'osrm-foot' ? 'Nakreslená čára = reálné chodníky OSM (pěší profil) mezi uzly trasy' : 'OSRM nedostupné — zobrazeny rovné linky mezi uzly demo grafu (fallback)' },
      { name: 'Copernicus HRL Tree Cover Density', url: 'https://land.copernicus.eu/', note: 'Reálná zeleň připojnic přesných bodů (10 m raster)' },
      { name: 'Open-Meteo', url: 'https://open-meteo.com/', note: `Vstupní teplota ${ambTemp.toFixed(1)} °C` },
    ],
    steps: [
      { id: 't1', kind: 'weight', title: 'Váhy použitých preferencí', detail: 'Každá volba zvyšuje/snižuje cenu úseku. Uvedeny vahy tohoto profilu.', inputs: [
        { label: 'stín', value: w.shade.toFixed(2) },
        { label: 'voda', value: w.water.toFixed(2) },
        { label: 'zeleň', value: w.green.toFixed(2) },
        { label: 'provoz (postih)', value: w.traffic.toFixed(2) },
        { label: 'stoupání (postih)', value: w.slope.toFixed(2) },
        { label: 'stavby (postih)', value: w.construction.toFixed(2) },
      ] },
      { id: 't2', kind: 'score', title: 'Cena úseku = čas × multiplikátor', detail: 'mult = 1 + postihy − úlevy; postihy: provoz, stoupání, stavby, slunce, davy. Úlevy: stín, voda, zeleň, lavičky, fontány.' },
      { id: 't-geo', kind: 'input', title: 'Geometrie nakreslené čáry', detail: geometrySource === 'osrm-foot'
          ? 'Trasa je mezi uzly rozhodovacího grafu vedena po reálných chodnících a pěších stezkách OSM (OSRM routed-foot, pěší profil). Délka i čas odpovídají skutečně schůdné trase.'
          : 'OSRM (reálné chodníky OSM) teď neodpovídá — čára je zobrazena jako přímé spojnice mezi uzly demo grafu. Rozhodnutí trasy (kudy) je stejné; při obnovení OSRM se čára automaticky vrátí na reálné chodníky.', inputs: [
        { label: 'Zdroj geometrie', value: geometrySource === 'osrm-foot' ? 'OSM pěší síť (OSRM routed-foot)' : 'rovné linky demo grafu (fallback)' },
        { label: 'Délka trasy', value: `${distM} m` },
      ] },
      { id: 't3', kind: 'score', title: 'Nejdražší (nejtěžší) úseky trasy', detail: 'Top 5 úseků s nejvyšší cenou – tam je hledán prostor pro zlepšení (výsadba, stínování).', inputs: scored.map((x) => ({ label: `${x.e.id} (${x.len} m)`, value: `mult ${x.mult.toFixed(2)} · ${x.minutes.toFixed(1)} min` })) },
      { id: 't4', kind: 'decision', title: 'Výsledek', detail: `Skóre chladu ${s.cooling}/100 = stín 45 % + voda 20 % + zeleň 25 % + pocitová teplota 10 %.`, output: `${s.cooling}/100 · ${s.avgTemp} °C` },
    ],
    factors: [
      { label: 'Stín', weight: w.shade, contribution: s.shadePct / 100 },
      { label: 'Voda', weight: w.water, contribution: Math.min(1, s.water / 2) },
      { label: 'Zeleň', weight: w.green, contribution: edges.length ? edges.reduce((a, e) => a + e.green, 0) / edges.length : 0.3 },
      { label: 'Provoz (postih)', weight: w.traffic, contribution: edges.length ? edges.reduce((a, e) => a + e.traffic / 3, 0) / edges.length : 0.4 },
      { label: 'Stoupání (postih)', weight: w.slope, contribution: edges.length ? edges.reduce((a, e) => a + Math.min(8, e.slopePct) / 8, 0) / edges.length : 0.3 },
    ],
    confidence: { level: 'medium', note: 'Demo atributy úseků; produkčně z OSM tagů + NDVI.' },
    disclaimers: ['Trasa je orientační – nepoužívejte ji jako přesnou navigaci v dopravních uzavírkách.'],
  };
}

/** Snap coordinates to nearest known start point (for geolocation). */
export function nearestStartPoint(lat: number, lng: number): string {
  let best = START_POINTS[0];
  let bestD = Infinity;
  for (const p of START_POINTS) {
    const d = (p.lat - lat) ** 2 + (p.lng - lng) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best.id;
}

export function isCoolPlace(id: string): boolean {
  return COOL_PLACES.some((p) => p.id === id);
}

function emptyTrace(startSpec: RouteEndpointSpec, destSpec: RouteEndpointSpec, problems: string[]): Trace {
  const label = (s: RouteEndpointSpec) =>
    typeof s === 'string' ? s : `[${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}]${s.name ? ` (${s.name})` : ''}`;
  return {
    title: 'Trasa nenalezena',
    summary: `Start „${label(startSpec)}" nebo cíl „${label(destSpec)}" není napojen na walking graf prototypu.`,
    dataSources: [],
    steps: [
      { id: 'e1', kind: 'input', title: 'Přijaté zadání', detail: `start=${label(startSpec)} · cíl=${label(destSpec)}`, inputs: [
        { label: 'Známé uzly grafu', value: GRAPH_NODES.map((n) => n.id).join(', ') },
        { label: 'Pokrytí pro přesné body', value: `bbox lat ${GRAPH_COVERAGE.south}–${GRAPH_COVERAGE.north}, lng ${GRAPH_COVERAGE.west}–${GRAPH_COVERAGE.east}` },
      ] },
      { id: 'e2', kind: 'decision', title: 'Přesný důvod selhání', detail: problems.join(' ') || 'Zvolte prosím jiný start/cíl z nabídky.' },
    ],
    factors: [],
    confidence: { level: 'low', note: 'Výsledek je neplatný kvůli problému popsanému výše.' },
    disclaimers: [],
  };
}
