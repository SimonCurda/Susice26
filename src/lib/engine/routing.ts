/**
 * Cool-route engine ("Kudy projít").
 *
 * Dijkstra over a walking graph where edge cost combines time with
 * user preferences (positive options) and negatives (what to avoid).
 * Three profiles are computed so the citizen can see the trade-off:
 *   Coolest / Balanced / Fastest — all fully traced.
 */

import { COOL_PLACES, GRAPH_EDGES, GRAPH_NODES, START_POINTS, edgeLengthM } from '@/lib/data/plzen';
import type { GraphEdge, RouteProfilePrefs, RouteResult, RouteSegment, Trace } from '@/lib/engine/types';

/** BFS reachability over the walking graph (ignores weights — connectivity only). */
function reachableFrom(startId: string): string[] {
  const seen = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const e of GRAPH_EDGES) {
      const v = e.from === u ? e.to : e.to === u ? e.from : null;
      if (v && !seen.has(v)) {
        seen.add(v);
        queue.push(v);
      }
    }
  }
  return [...seen];
}

/**
 * Exact validation of route endpoints BEFORE searching.
 * Returns problems with the exact offending id + the list of valid ids.
 */
export function routeIdProblems(startRaw: string, destRaw: string): string[] {
  const problems: string[] = [];
  const knownIds = GRAPH_NODES.map((n) => n.id).join(', ');
  const startId = toNodeId(startRaw);
  const destId = toNodeId(destRaw);
  if (!GRAPH_NODES.some((n) => n.id === startId)) {
    problems.push(
      `Neznámý start „${startRaw}"${NODE_ALIASES[startRaw] ? ` (alias → „${NODE_ALIASES[startRaw]}", který také není v grafu)` : ''}. Známé id uzlů (${GRAPH_NODES.length}): ${knownIds}.`
    );
  }
  if (!GRAPH_NODES.some((n) => n.id === destId)) {
    problems.push(
      `Neznámý cíl „${destRaw}". Známé id uzlů (${GRAPH_NODES.length}): ${knownIds}.`
    );
  }
  return problems;
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

function edgeCostMinutes(e: GraphEdge, w: WeightConfig, ambTemp: number): { minutes: number; mult: number } {
  const baseMin = edgeLengthM(e) / WALK_SPEED_M_MIN;
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

function dijkstra(startId: string, endId: string, w: WeightConfig, ambTemp: number): string[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const n of GRAPH_NODES) dist.set(n.id, Infinity);
  dist.set(startId, 0);

  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) if (!visited.has(id) && d < best) { best = d; u = id; }
    if (u === null || best === Infinity) return null;
    if (u === endId) break;
    visited.add(u);
    for (const e of GRAPH_EDGES) {
      if (e.from !== u && e.to !== u) continue;
      const v = e.from === u ? e.to : e.from;
      if (visited.has(v)) continue;
      const c = edgeCostMinutes(e, w, ambTemp).minutes;
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

function pathEdges(path: string[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e =
      GRAPH_EDGES.find((x) => x.from === path[i] && x.to === path[i + 1]) ??
      GRAPH_EDGES.find((x) => x.from === path[i + 1] && x.to === path[i]);
    if (e) edges.push(e);
  }
  return edges;
}

/** Segment-level temperature estimate (demo physics, transparent formula). */
function segmentTemp(e: GraphEdge, ambTemp: number): number {
  const delta = (e.shade - 0.5) * -3.5 - (e.water ? 2.5 : 0) - e.green * 1.8 + e.traffic * 0.5;
  return Math.round((ambTemp + delta) * 10) / 10;
}

function buildSegments(path: string[], ambTemp: number): RouteSegment[] {
  const segs: RouteSegment[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = GRAPH_NODES.find((n) => n.id === path[i])!;
    const eIn = i > 0 ? pathEdges([path[i - 1], path[i]])[0] : null;
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

function scoreRoute(edges: GraphEdge[], ambTemp: number): { cooling: number; avgTemp: number; shadePct: number; water: number; rest: number } {
  const totalLen = edges.reduce((a, e) => a + edgeLengthM(e), 0) || 1;
  const shadePct = edges.reduce((a, e) => a + e.shade * edgeLengthM(e), 0) / totalLen;
  const avgTemp =
    edges.reduce((a, e) => a + segmentTemp(e, ambTemp) * edgeLengthM(e), 0) / totalLen;
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

export function findRoutes(
  startIdRaw: string,
  destIdRaw: string,
  prefs: RouteProfilePrefs,
  ambientTemp: number
): { routes: RouteResult[]; trace: Trace; problems: string[] } {
  const startId = toNodeId(startIdRaw);
  const destId = toNodeId(destIdRaw);
  const problems = routeIdProblems(startIdRaw, destIdRaw);
  if (problems.length > 0) {
    return { routes: [], trace: emptyTrace(startIdRaw, destIdRaw, problems), problems };
  }

  const profiles: { id: 'coolest' | 'balanced' | 'fastest'; name: string; color: string }[] = [
    { id: 'coolest', name: 'Nejchladnější', color: '#059669' },
    { id: 'balanced', name: 'Vyvážená', color: '#d97706' },
    { id: 'fastest', name: 'Nejrychlejší', color: '#57534e' },
  ];

  const routes: RouteResult[] = [];
  const comparison: string[] = [];

  for (const p of profiles) {
    const w = weightsFor(prefs, p.id);
    const path = dijkstra(startId, destId, w, ambientTemp);
    if (!path) continue;
    const edges = pathEdges(path);
    const segs = buildSegments(path, ambientTemp);
    const s = scoreRoute(edges, ambientTemp);
    const distM = edges.reduce((a, e) => a + edgeLengthM(e), 0);
    const geometry = path.map((id) => GRAPH_NODES.find((n) => n.id === id)!);
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
      trace: routeTrace(p.id, w, path, edges, prefs, ambientTemp, s, distM),
    });
    comparison.push(`${p.name}: ${Math.round(distM)} m, ${s.cooling}/100 chlad, ${s.avgTemp} °C pocit`);
  }

  // all profiles failed although ids are valid → exact reachability diagnosis
  if (routes.length === 0) {
    const reach = reachableFrom(startId);
    const destReachable = reach.includes(destId);
    problems.push(
      destReachable
        ? `Cíl „${destId}" je v grafu dosažitelný, ale žádný z 3 profilů nenašel cestu — zkontrolujte hrany grafu (${GRAPH_EDGES.length} hran, ${GRAPH_NODES.length} uzlů).`
        : `Cíl „${destId}" NENÍ ze startu „${startId}" dosažitelný. Ze startu je dosažitelných ${reach.length}/${GRAPH_NODES.length} uzlů: ${reach.join(', ')}. Graf má celkem ${GRAPH_EDGES.length} hran mezi ${GRAPH_NODES.length} uzly.`
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
      { name: 'Copernicus Sentinel-2 NDVI', url: 'https://browser.dataspace.copernicus.eu/', note: 'Podíl vegetace na úseku (demo: kurátorované hodnoty).' },
      { name: 'Open-Meteo', url: 'https://open-meteo.com/', note: `Aktuální teplota ${ambientTemp.toFixed(1)} °C použita pro odhad pocitové teploty na úsecích.` },
    ],
    steps: [
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
  distM: number
): Trace {
  const nodeNames = (id: string) => GRAPH_NODES.find((n) => n.id === id)?.name ?? id;
  const scored = edges
    .map((e) => ({ e, ...edgeCostMinutes(e, w, ambTemp), len: edgeLengthM(e) }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  return {
    title: `Proč trasa "${profile === 'coolest' ? 'Nejchladnější' : profile === 'balanced' ? 'Vyvážená' : 'Nejrychlejší'}"`,
    summary: `${path.map(nodeNames).join(' → ')} · ${distM} m · chlad ${s.cooling}/100 · stín ${s.shadePct} % · pocit ${s.avgTemp} °C`,
    dataSources: [
      { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/', note: 'Graf trasy a atributy úseků' },
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
      { id: 't3', kind: 'score', title: 'Nejdražší (nejtěžší) úseky trasy', detail: 'Top 5 úseků s nejvyšší cenou – tam je hledán prostor pro zlepšení (výsadba, stínování).', inputs: scored.map((x) => ({ label: `${x.e.id} (${x.len} m)`, value: `mult ${x.mult.toFixed(2)} · ${x.minutes.toFixed(1)} min` })) },
      { id: 't4', kind: 'decision', title: 'Výsledek', detail: `Skóre chladu ${s.cooling}/100 = stín 45 % + voda 20 % + zeleň 25 % + pocitová teplota 10 %.`, output: `${s.cooling}/100 · ${s.avgTemp} °C` },
    ],
    factors: [
      { label: 'Stín', weight: w.shade, contribution: s.shadePct / 100 },
      { label: 'Voda', weight: w.water, contribution: Math.min(1, s.water / 2) },
      { label: 'Zeleň', weight: w.green, contribution: edges.reduce((a, e) => a + e.green, 0) / edges.length },
      { label: 'Provoz (postih)', weight: w.traffic, contribution: edges.reduce((a, e) => a + e.traffic / 3, 0) / edges.length },
      { label: 'Stoupání (postih)', weight: w.slope, contribution: edges.reduce((a, e) => a + Math.min(8, e.slopePct) / 8, 0) / edges.length },
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

function emptyTrace(startId: string, destId: string, problems: string[]): Trace {
  return {
    title: 'Trasa nenalezena',
    summary: `Start „${startId}" nebo cíl „${destId}" není napojen na walking graf prototypu.`,
    dataSources: [],
    steps: [
      { id: 'e1', kind: 'input', title: 'Přijaté id', detail: `start="${startId}" · cíl="${destId}"`, inputs: [
        { label: 'Známé uzly grafu', value: GRAPH_NODES.map((n) => n.id).join(', ') },
      ] },
      { id: 'e2', kind: 'decision', title: 'Přesný důvod selhání', detail: problems.join(' ') || 'Zvolte prosím jiný start/cíl z nabídky.' },
    ],
    factors: [],
    confidence: { level: 'low', note: 'Graf prototypu pokrývá Plzeň; produkčně se rozšíří na celý kraj.' },
    disclaimers: [],
  };
}
