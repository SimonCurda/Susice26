/**
 * Static open-data-derived datasets for the Plzeňský kraj prototype.
 *
 * Real anchors (coordinates of districts, parks, ponds, mill race...) are based on
 * open data (OSM, ČÚZK ArcData, ČSÚ). The land-surface-temperature grid is a
 * deterministic sample layer that follows Copernicus Sentinel-3 SLSTR / Sentinel-2
 * derived methodology — in production it is replaced by real GeoTIFF rasters
 * downloaded via Copernicus Data Space Ecosystem (see Methodology dialog).
 */

import type { CoolPlace, District, GraphEdge, GraphNode, LstPoint, Species } from '@/lib/engine/types';
import { clmsLstTciColor } from '@/lib/data/clms-colormaps';
import { canopyAt } from '@/lib/data/canopy';

export const PLZEN_CENTER = { lat: 49.7477, lng: 13.3776 }; // náměstí Republiky

export const REGION_BBOX = { south: 48.95, west: 12.45, north: 50.2, east: 13.9 };

/** Weather observation points across the region (open-meteo, free open API). */
export const WEATHER_POINTS = [
  { name: 'Plzeň', lat: 49.7477, lng: 13.3776, altitudeNote: 'město, ~310 m n. m.' },
  { name: 'Klatovy', lat: 49.394, lng: 13.295, altitudeNote: 'Chodenická pahorkatina, ~410 m' },
  { name: 'Domažlice', lat: 49.443, lng: 12.929, altitudeNote: 'pod Čerchovem, ~430 m' },
  { name: 'Tachov', lat: 49.797, lng: 12.644, altitudeNote: 'Český les, ~480 m' },
  { name: 'Rokycany', lat: 49.744, lng: 13.594, altitudeNote: 'Hojná Voda údolí, ~360 m' },
  { name: 'Sušice', lat: 49.235, lng: 13.518, altitudeNote: 'údolí Otavy, ~520 m' },
  { name: 'Nepomuk', lat: 49.487, lng: 13.606, altitudeNote: 'Nepomucká vrchovina, ~450 m' },
  { name: 'Nýřany', lat: 49.774, lng: 13.279, altitudeNote: 'Nyřanská pánev, ~340 m' },
];

/** Plzeň city parts + larger towns of the region (ČSÚ population, demo seniors/density). */
export const DISTRICTS: District[] = [
  { id: 'plzen1', name: 'Plzeň 1 (historické centrum)', kind: 'plzen_part', lat: 49.7477, lng: 13.3776, population: 10500, seniorsPct: 0.21, density: 0.95 },
  { id: 'plzen2', name: 'Plzeň 2–Slovany', kind: 'plzen_part', lat: 49.733, lng: 13.4, population: 26000, seniorsPct: 0.24, density: 0.8 },
  { id: 'plzen3', name: 'Plzeň 3–Doubravka', kind: 'plzen_part', lat: 49.754, lng: 13.436, population: 18000, seniorsPct: 0.22, density: 0.6 },
  { id: 'plzen4', name: 'Plzeň 4–Doubravka východ / Újezd', kind: 'plzen_part', lat: 49.762, lng: 13.462, population: 6000, seniorsPct: 0.2, density: 0.4 },
  { id: 'plzen5', name: 'Plzeň 5–Kody', kind: 'plzen_part', lat: 49.735, lng: 13.431, population: 5000, seniorsPct: 0.21, density: 0.45 },
  { id: 'plzen6', name: 'Plzeň 6–Lochotín', kind: 'plzen_part', lat: 49.765, lng: 13.384, population: 21000, seniorsPct: 0.23, density: 0.7 },
  { id: 'plzen7', name: 'Plzeň 7–Radčice', kind: 'plzen_part', lat: 49.779, lng: 13.403, population: 9000, seniorsPct: 0.2, density: 0.5 },
  { id: 'plzen8', name: 'Plzeň 8–Černice', kind: 'plzen_part', lat: 49.719, lng: 13.407, population: 7000, seniorsPct: 0.19, density: 0.35 },
  { id: 'plzen9', name: 'Plzeň 9–Malesice', kind: 'plzen_part', lat: 49.775, lng: 13.337, population: 4000, seniorsPct: 0.22, density: 0.3 },
  { id: 'plzen10', name: 'Plzeň 10–Lhota', kind: 'plzen_part', lat: 49.792, lng: 13.384, population: 12000, seniorsPct: 0.2, density: 0.55 },
  { id: 'bolevic', name: 'Bolevec + Bolevecké rybníky', kind: 'plzen_part', lat: 49.786, lng: 13.394, population: 4000, seniorsPct: 0.24, density: 0.35 },
  { id: 'skvrnany', name: 'Skvrňany (průmyslová zóna)', kind: 'plzen_part', lat: 49.757, lng: 13.362, population: 9000, seniorsPct: 0.25, density: 0.75 },
  { id: 'klatovy', name: 'Klatovy', kind: 'town', lat: 49.394, lng: 13.295, population: 22000, seniorsPct: 0.26, density: 0.55 },
  { id: 'domazlice', name: 'Domažlice', kind: 'town', lat: 49.443, lng: 12.929, population: 11000, seniorsPct: 0.24, density: 0.6 },
  { id: 'tachov', name: 'Tachov', kind: 'town', lat: 49.797, lng: 12.644, population: 12000, seniorsPct: 0.26, density: 0.5 },
  { id: 'rokycany', name: 'Rokycany', kind: 'town', lat: 49.744, lng: 13.594, population: 14000, seniorsPct: 0.24, density: 0.6 },
  { id: 'susice', name: 'Sušice', kind: 'town', lat: 49.235, lng: 13.518, population: 5000, seniorsPct: 0.27, density: 0.45 },
  { id: 'nepomuk', name: 'Nepomuk', kind: 'town', lat: 49.487, lng: 13.606, population: 7500, seniorsPct: 0.25, density: 0.5 },
  { id: 'hors_tyn', name: 'Horšovský Týn', kind: 'town', lat: 49.479, lng: 12.93, population: 5000, seniorsPct: 0.26, density: 0.5 },
  { id: 'nycany', name: 'Nýřany', kind: 'town', lat: 49.774, lng: 13.279, population: 6500, seniorsPct: 0.25, density: 0.6 },
];

/** Heat sources (industrial / asphalt heavy zones around Plzeň). */
const HOT_ZONES: { name: string; lat: number; lng: number; strength: number; radiusKm: number }[] = [
  { name: 'Borská pole (komerční + logistika)', lat: 49.7385, lng: 13.3895, strength: 5.0, radiusKm: 0.9 },
  { name: 'Skvrňany – průmysl', lat: 49.759, lng: 13.357, strength: 4.2, radiusKm: 0.8 },
  { name: 'Střed hlavního nádraží + Škoda area', lat: 49.746, lng: 13.386, strength: 3.6, radiusKm: 0.7 },
  { name: 'Doubravka – Korum / retail', lat: 49.7515, lng: 13.4435, strength: 2.8, radiusKm: 0.5 },
];

/** Cool zones (parks, ponds, river valleys) – cool the LST grid around them. */
const COOL_ZONES: { name: string; lat: number; lng: number; strength: number; radiusKm: number }[] = [
  { name: 'Kopeckého sady', lat: 49.7479, lng: 13.3751, strength: 2.6, radiusKm: 0.35 },
  { name: 'Lochotínský park', lat: 49.7649, lng: 13.3832, strength: 2.9, radiusKm: 0.45 },
  { name: 'Bolevecké rybníky', lat: 49.789, lng: 13.394, strength: 3.4, radiusKm: 0.9 },
  { name: 'Doubravský les', lat: 49.759, lng: 13.448, strength: 3.0, radiusKm: 0.7 },
  { name: 'Úslava – údolí (Černice → Dobřany)', lat: 49.715, lng: 13.402, strength: 2.8, radiusKm: 0.7 },
  { name: 'Mlýnský náhon (střed města)', lat: 49.7455, lng: 13.3865, strength: 2.2, radiusKm: 0.25 },
  { name: 'Šafaříkovy sady', lat: 49.7522, lng: 13.3985, strength: 2.2, radiusKm: 0.3 },
  { name: 'Křimický les', lat: 49.714, lng: 13.388, strength: 3.0, radiusKm: 0.8 },
];

/** Deterministic pseudo-random in [0,1) so the demo layer is stable across calls. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 111.32;
  const dLng = (bLng - aLng) * 111.32 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function lstAt(lat: number, lng: number): number {
  const dCenter = distKm(lat, lng, PLZEN_CENTER.lat, PLZEN_CENTER.lng);
  // urban heat island core, falling off with distance
  let lst = 25.2 + 6.4 * Math.exp(-dCenter / 1.15);
  for (const z of HOT_ZONES) lst += z.strength * Math.exp(-distKm(lat, lng, z.lat, z.lng) / z.radiusKm);
  for (const z of COOL_ZONES) lst -= z.strength * Math.exp(-distKm(lat, lng, z.lat, z.lng) / z.radiusKm);
  // micro variation (buildings, street canyons)
  const cellKey = Math.round(lat * 900) * 1000 + Math.round(lng * 900);
  lst += (hash01(cellKey) - 0.5) * 2.6;
  // countryside baseline flattening
  if (dCenter > 6) lst -= Math.min(3, (dCenter - 6) * 0.5);
  return Math.round(Math.min(38, Math.max(19, lst)) * 10) / 10;
}

/** ~1500-point LST grid over Plzeň city (0.0035° ≈ 380 m step). Deterministic. */
let lstGridCache: LstPoint[] | null = null;
export function getLstGrid(): LstPoint[] {
  if (lstGridCache) return lstGridCache;
  const pts: LstPoint[] = [];
  const latStep = 0.0035;
  const lngStep = 0.0055;
  for (let lat = 49.706; lat <= 49.8; lat += latStep) {
    for (let lng = 13.3; lng <= 13.49; lng += lngStep) {
      pts.push({ lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000, lst: lstAt(lat, lng) });
    }
  }
  lstGridCache = pts;
  return pts;
}

export const LST_LEGEND_MIN = 21;
export const LST_LEGEND_MAX = 38;

/**
 * Color for an LST value — the OFFICIAL Copernicus CLMS "Temperature Color
 * Index" ramp (black-violet cool → magenta/red → orange → yellow → white hot),
 * identical to how the Copernicus Browser renders Sentinel-3 SLSTR LST.
 * See src/lib/data/clms-colormaps.ts for the exact source file and licence.
 */
export function lstColor(lst: number): string {
  return clmsLstTciColor(lst, LST_LEGEND_MIN, LST_LEGEND_MAX);
}

/** Places to cool down — citizen destinations (OSM anchors, demo attributes). */
export const COOL_PLACES: CoolPlace[] = [
  { id: 'kop_sady', name: 'Kopeckého sady', type: 'park', lat: 49.7479, lng: 13.3751, shadePct: 0.78, hasWaterFeature: false, benches: 24, tempOffset: 2.6, description: 'Městský park u středu – hustý starý stromoví, lavičky, scenérie.' },
  { id: 'lochotin_park', name: 'Lochotínský park', type: 'park', lat: 49.7649, lng: 13.3832, shadePct: 0.82, hasWaterFeature: true, benches: 30, tempOffset: 3.1, description: 'Největší městský park – lesík, potok, hřiště.' },
  { id: 'mlyn_strouha', name: 'Mlýnský náhon (centrum)', type: 'water', lat: 49.7455, lng: 13.3865, shadePct: 0.55, hasWaterFeature: true, benches: 10, tempOffset: 3.0, description: 'Historický náhon pod městem – chlad od vody i ve vedru.' },
  { id: 'safarik', name: 'Šafaříkovy sady', type: 'park', lat: 49.7522, lng: 13.3985, shadePct: 0.7, hasWaterFeature: false, benches: 12, tempOffset: 2.2, description: 'Klidnější sady mezi centrem a Slovany.' },
  { id: 'kamen_rybnik', name: 'Bolevec – Kamenný rybník', type: 'water', lat: 49.789, lng: 13.394, shadePct: 0.45, hasWaterFeature: true, benches: 18, tempOffset: 4.2, description: 'Oblíbené koupaliště a pláže u rybníků severně od města.' },
  { id: 'doubravsky_les', name: 'Les u Újezda', type: 'forest', lat: 49.7795, lng: 13.4565, shadePct: 0.9, hasWaterFeature: false, benches: 8, tempOffset: 3.8, description: 'Skutečný lesní komplex severovýchodně od Doubravky (potvrzeno Copernicus korunním pokryvem ~94 %).' },
  { id: 'bot_zahrada', name: 'Botanická zahrada Plzeň', type: 'park', lat: 49.7637, lng: 13.3787, shadePct: 0.75, hasWaterFeature: true, benches: 15, tempOffset: 2.8, description: 'Skleníky i venkovní části, vodní prvky.' },
  { id: 'fountain_nam', name: 'Pitná fontána – nám. Republiky', type: 'fountain', lat: 49.7474, lng: 13.3782, shadePct: 0.15, hasWaterFeature: true, benches: 6, tempOffset: 1.0, description: 'Pitná voda v centru; stín se ve vedru hledá v okolních sakrálních dvorech.' },
  { id: 'uslava_cernice', name: 'Úslava – údolí Černice', type: 'water', lat: 49.7185, lng: 13.408, shadePct: 0.68, hasWaterFeature: true, benches: 10, tempOffset: 3.4, description: 'Stinné břehy Úslavy – trasa k Dobřanům.' },
  { id: 'krimicky_les', name: 'Křimický les', type: 'forest', lat: 49.714, lng: 13.388, shadePct: 0.92, hasWaterFeature: false, benches: 4, tempOffset: 4.0, description: 'Velký lesní komplex na jihu města.' },
  { id: 'tyrs_sady', name: 'Tyršovy sady', type: 'park', lat: 49.7407, lng: 13.3899, shadePct: 0.72, hasWaterFeature: false, benches: 16, tempOffset: 2.4, description: 'Sady u sportovních areálů, řada vzrostlých stromů.' },
  { id: 'amer_zahrada', name: 'Americká zahrada (Lochotín)', type: 'park', lat: 49.7663, lng: 13.3803, shadePct: 0.8, hasWaterFeature: false, benches: 10, tempOffset: 2.9, description: 'Historická zahrada s dendrologií, klidná.' },
];

/** Citizen starting points (also used as graph nodes). */
export const START_POINTS = [
  { id: 'nam_republiky', name: 'náměstí Republiky (centrum)', lat: 49.7477, lng: 13.3776 },
  { id: 'hl_nadrazi', name: 'Hlavní nádraží', lat: 49.7472, lng: 13.3838 },
  { id: 'slovany', name: 'Slovany – obytný okrsek', lat: 49.733, lng: 13.4 },
  { id: 'lochotin', name: 'Lochotín', lat: 49.765, lng: 13.384 },
  { id: 'bolevic', name: 'Bolevec', lat: 49.786, lng: 13.394 },
  { id: 'doubravka', name: 'Doubravka', lat: 49.754, lng: 13.436 },
  { id: 'cernice', name: 'Černice', lat: 49.719, lng: 13.407 },
];

/**
 * Walking graph of Plzeň – nodes/edges curated from OSM anchors.
 * Edge attributes (shade, traffic, slope, water...) are demo values that in
 * production come from OSM tags + Copernicus NDVI + city GIS layers.
 */
export const GRAPH_NODES: GraphNode[] = [
  { id: 'nam_republiky', name: 'náměstí Republiky', lat: 49.7477, lng: 13.3776, transit: true },
  { id: 'hl_nadrazi', name: 'Hlavní nádraží', lat: 49.7472, lng: 13.3838, transit: true },
  { id: 'kop_sady', name: 'Kopeckého sady', lat: 49.7479, lng: 13.3751 },
  { id: 'mlyn_strouha', name: 'Mlýnský náhon', lat: 49.7455, lng: 13.3865 },
  { id: 'safarik', name: 'Šafaříkovy sady', lat: 49.7522, lng: 13.3985 },
  { id: 'tyrs_sady', name: 'Tyršovy sady', lat: 49.7407, lng: 13.3899 },
  { id: 'slovany', name: 'Slovany', lat: 49.733, lng: 13.4, transit: true },
  { id: 'lochotin_park', name: 'Lochotínský park', lat: 49.7649, lng: 13.3832 },
  { id: 'bot_zahrada', name: 'Botanická zahrada', lat: 49.7637, lng: 13.3787 },
  { id: 'amer_zahrada', name: 'Americká zahrada', lat: 49.7663, lng: 13.3803 },
  { id: 'bolevic_kam', name: 'Kamenný rybník (Bolevec)', lat: 49.789, lng: 13.394 },
  { id: 'bolevic', name: 'Bolevec', lat: 49.786, lng: 13.394, transit: true },
  { id: 'lhota', name: 'Lhota', lat: 49.792, lng: 13.384 },
  { id: 'doubravka', name: 'Doubravka', lat: 49.754, lng: 13.436, transit: true },
  { id: 'doubravsky_les', name: 'Les u Újezda', lat: 49.7795, lng: 13.4565 },
  { id: 'cernice', name: 'Černice', lat: 49.719, lng: 13.407 },
  { id: 'uslava', name: 'Úslava – údolí', lat: 49.7185, lng: 13.408 },
  { id: 'krimicky_les', name: 'Křimický les', lat: 49.714, lng: 13.388 },
  { id: 'dobrany', name: 'Dobřany (údolím Úslavy)', lat: 49.706, lng: 13.384 },
  { id: 'skvrnany', name: 'Skvrňany', lat: 49.757, lng: 13.362, transit: true },
  { id: 'bolezna', name: 'Bolevec – silnice (trasa přes silnici)', lat: 49.78, lng: 13.391 },
  { id: 'petatridilniku', name: 'Sady Pětatřídílníku', lat: 49.7471, lng: 13.3802 },
];

/** Road factor: real walking distance ≈ straight line × factor. */
const ROAD_FACTOR = 1.28;

/**
 * REAL Copernicus greenery along a graph edge: tree-canopy share sampled at
 * 25 / 50 / 75 % of the segment (mean of detected cells, 0..1).
 * Returns null when the segment lies outside the canopy grid.
 */
function realCanopyGreen(aLat: number, aLng: number, bLat: number, bLng: number): number | null {
  const samples: number[] = [];
  for (const t of [0.25, 0.5, 0.75]) {
    const v = canopyAt(aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t);
    if (v !== null) samples.push(v);
  }
  if (samples.length === 0) return null;
  const mean = samples.reduce((x, y) => x + y, 0) / samples.length;
  return Math.min(1, Math.max(0, mean / 100));
}

function edge(
  id: string, from: string, to: string,
  attrs: Partial<Omit<GraphEdge, 'id' | 'from' | 'to'>> = {}
): GraphEdge {
  const a = GRAPH_NODES.find((n) => n.id === from)!;
  const b = GRAPH_NODES.find((n) => n.id === to)!;
  const realGreen = realCanopyGreen(a.lat, a.lng, b.lat, b.lng);
  return {
    id, from, to,
    shade: 0.4, traffic: 1, slopePct: 1.5, water: false, green: 0.35,
    benches: 0, fountain: false, construction: false, crowd: false,
    ...attrs,
    // REAL Copernicus tree-canopy share wins over the curated demo value
    // whenever the satellite layer actually detects canopy (≥ 10 %). Below
    // that we keep the curated value, because the layer is known to
    // under-detect small urban deciduous green (see methodology dialog).
    ...(realGreen !== null && realGreen >= 0.1 ? { green: Math.max(0.1, realGreen) } : {}),
  };
}

export const GRAPH_EDGES: GraphEdge[] = [
  // center core
  edge('e1', 'nam_republiky', 'hl_nadrazi', { shade: 0.25, traffic: 3, crowd: true, benches: 4, green: 0.15 }),
  edge('e2', 'nam_republiky', 'kop_sady', { shade: 0.85, traffic: 1, green: 0.9, benches: 8 }),
  edge('e3', 'nam_republiky', 'mlyn_strouha', { shade: 0.6, traffic: 2, water: true, green: 0.5, fountain: true }),
  edge('e4', 'hl_nadrazi', 'mlyn_strouha', { shade: 0.45, traffic: 2, water: true, green: 0.3 }),
  edge('e5', 'hl_nadrazi', 'safarik', { shade: 0.35, traffic: 3, green: 0.2, construction: true }), // Škoda area crossing – roadworks demo
  edge('e6', 'nam_republiky', 'safarik', { shade: 0.3, traffic: 2, green: 0.2, crowd: true }),
  // center → south parks
  edge('e7', 'safarik', 'tyrs_sady', { shade: 0.55, traffic: 2, green: 0.45, benches: 3 }),
  edge('e8', 'tyrs_sady', 'slovany', { shade: 0.6, traffic: 1, green: 0.6, benches: 4, slopePct: 2.5 }),
  edge('e9', 'safarik', 'slovany', { shade: 0.3, traffic: 3, slopePct: 3.5, green: 0.15 }), // arterial
  edge('e10', 'slovany', 'cernice', { shade: 0.5, traffic: 2, slopePct: 4.5, green: 0.4 }),
  edge('e11', 'cernice', 'uslava', { shade: 0.7, traffic: 0, water: true, green: 0.75, benches: 3 }),
  edge('e12', 'uslava', 'krimicky_les', { shade: 0.85, traffic: 0, green: 0.95, water: false, benches: 2 }),
  edge('e13', 'uslava', 'dobrany', { shade: 0.75, traffic: 0, water: true, green: 0.85, slopePct: 1, benches: 4 }),
  edge('e14', 'krimicky_les', 'cernice', { shade: 0.9, traffic: 0, green: 0.9, slopePct: 3 }),
  edge('e15', 'kop_sady', 'mlyn_strouha', { shade: 0.55, traffic: 2, water: true, green: 0.4 }),
  edge('e16', 'kop_sady', 'nam_republiky', { shade: 0.85, traffic: 1, green: 0.9, benches: 8 }), // reverse duplicate for flexibility
  // center → north (Lochotín, Botanická, Americká)
  edge('e17', 'nam_republiky', 'bot_zahrada', { shade: 0.45, traffic: 2, green: 0.35, benches: 2, slopePct: 3 }),
  edge('e18', 'bot_zahrada', 'lochotin_park', { shade: 0.8, traffic: 1, green: 0.85, benches: 5 }),
  edge('e19', 'bot_zahrada', 'amer_zahrada', { shade: 0.75, traffic: 1, green: 0.8 }),
  edge('e20', 'lochotin_park', 'amer_zahrada', { shade: 0.85, traffic: 0, green: 0.9, benches: 6 }),
  edge('e21', 'lochotin_park', 'bolevic', { shade: 0.6, traffic: 2, green: 0.5, slopePct: 4 }),
  edge('e22', 'skvrnany', 'lochotin_park', { shade: 0.3, traffic: 3, green: 0.2 }),
  edge('e23', 'hl_nadrazi', 'skvrnany', { shade: 0.28, traffic: 3, green: 0.15 }),
  // north → Bolevec ponds
  edge('e24', 'bolevic', 'bolevic_kam', { shade: 0.5, traffic: 1, green: 0.6, benches: 6 }),
  edge('e25', 'bolevic', 'lhota', { shade: 0.4, traffic: 2, green: 0.45, slopePct: 3.5 }),
  edge('e26', 'lhota', 'bolevic_kam', { shade: 0.55, traffic: 1, green: 0.6, benches: 3 }),
  edge('e27', 'lochotin_park', 'bolezna', { shade: 0.45, traffic: 3, green: 0.35 }), // crossing busy road
  edge('e28', 'bolezna', 'bolevic_kam', { shade: 0.6, traffic: 1, green: 0.7 }),
  // east: Doubravka
  edge('e29', 'hl_nadrazi', 'doubravka', { shade: 0.35, traffic: 3, green: 0.25, slopePct: 2.5 }),
  edge('e30', 'doubravka', 'doubravsky_les', { shade: 0.75, traffic: 1, green: 0.85, benches: 4 }),
  edge('e31', 'doubravsky_les', 'bolevic_kam', { shade: 0.85, traffic: 0, green: 0.9, slopePct: 3.5 }),
  edge('e32', 'slovany', 'doubravka', { shade: 0.4, traffic: 3, slopePct: 3, green: 0.2 }),
  // parallel corridors for genuine route trade-offs
  edge('e33', 'nam_republiky', 'tyrs_sady', { shade: 0.28, traffic: 3, green: 0.15, slopePct: 2 }), // arteriální ulice k Slovanům – rychlé, ale horké
  edge('e34', 'kop_sady', 'tyrs_sady', { shade: 0.78, traffic: 1, green: 0.85, benches: 3 }), // koridorem parku
  edge('e35', 'skvrnany', 'bolezna', { shade: 0.25, traffic: 3, green: 0.15 }), // Bolevecská silnice
  edge('e37', 'nam_republiky', 'petatridilniku', { shade: 0.7, traffic: 1, green: 0.8, benches: 4 }),
  edge('e38', 'petatridilniku', 'mlyn_strouha', { shade: 0.6, traffic: 1, water: true, green: 0.5 }),
];

/** Drought-tolerant tree palette for the Plzeňský kraj climate (species DB demo). */
export const SPECIES: Species[] = [
  { id: 'tilia', nameCs: "Lípa srdčitá 'Greenspire'", nameLat: 'Tilia cordata', costCzk: 42000, canopyM2: 80, cooling: 4, drought: 3, growth: 3, biodiversity: 3, lowMaintenance: 3, allergen: 2, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 12, note: 'Národní strom, dobře snáší i město, kynejší v suchu.' },
  { id: 'acer_campe', nameCs: 'Javor babyka', nameLat: 'Acer campestre', costCzk: 32000, canopyM2: 45, cooling: 3, drought: 4, growth: 3, biodiversity: 4, lowMaintenance: 4, allergen: 1, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 8, note: 'Tvrdý, kompaktní, ideální do ulic a památkových zón.' },
  { id: 'quercus_cerris', nameCs: 'Dub cer', nameLat: 'Quercus cerris', costCzk: 38000, canopyM2: 110, cooling: 5, drought: 5, growth: 2, biodiversity: 5, lowMaintenance: 4, allergen: 2, streetOk: false, parkOk: true, heritageOk: false, minSoilM3: 18, note: 'Velký korunami i kořeny – jen do širokých prostorů a parků.' },
  { id: 'gleditsia', nameCs: "Trnka 'Skyline'", nameLat: "Gleditsia triacanthos 'Skyline'", costCzk: 40000, canopyM2: 60, cooling: 3, drought: 5, growth: 4, biodiversity: 2, lowMaintenance: 4, allergen: 1, streetOk: true, parkOk: true, heritageOk: false, minSoilM3: 10, note: 'Prosvětlený korunní stín – tráva pod ním vydrží.' },
  { id: 'celtis', nameCs: 'Muk západní', nameLat: 'Celtis occidentalis', costCzk: 34000, canopyM2: 55, cooling: 3, drought: 5, growth: 3, biodiversity: 3, lowMaintenance: 4, allergen: 1, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 10, note: 'Hbitý v suchu i soli, přehlížený hrdina ulic.' },
  { id: 'styphno', nameCs: 'Sófora japonská', nameLat: 'Styphnolobium japonicum', costCzk: 42000, canopyM2: 65, cooling: 3, drought: 4, growth: 3, biodiversity: 3, lowMaintenance: 3, allergen: 1, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 12, note: 'Kvete koncem léta – zdroj nektaru v období, kdy nic nekvetu.' },
  { id: 'fraxinus_ornus', nameCs: 'Jasan mannový', nameLat: 'Fraxinus ornus', costCzk: 30000, canopyM2: 40, cooling: 2, drought: 5, growth: 4, biodiversity: 4, lowMaintenance: 4, allergen: 1, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 8, note: 'Menší koruna, nenáročný, jarní květ.' },
  { id: 'sorbus', nameCs: 'Jeřáb domácí', nameLat: 'Sorbus domestica', costCzk: 28000, canopyM2: 35, cooling: 2, drought: 4, growth: 3, biodiversity: 5, lowMaintenance: 3, allergen: 1, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 8, note: 'Plody pro ptáky, štíhlý charakter do alejí.' },
  { id: 'pinus_nigra', nameCs: 'Borovice černá', nameLat: 'Pinus nigra', costCzk: 26000, canopyM2: 50, cooling: 3, drought: 5, growth: 3, biodiversity: 3, lowMaintenance: 5, allergen: 2, streetOk: false, parkOk: true, heritageOk: false, minSoilM3: 10, note: 'Do parků a lesoparků, celoroční koruna.' },
  { id: 'carpinus', nameCs: 'Habr obecný', nameLat: 'Carpinus betulus', costCzk: 26000, canopyM2: 45, cooling: 3, drought: 3, growth: 3, biodiversity: 3, lowMaintenance: 3, allergen: 2, streetOk: true, parkOk: true, heritageOk: true, minSoilM3: 10, note: 'Levný, formovatelný, ale citlivější v extrémním suchu.' },
];

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export function edgeLengthM(e: GraphEdge): number {
  const a = GRAPH_NODES.find((n) => n.id === e.from)!;
  const b = GRAPH_NODES.find((n) => n.id === e.to)!;
  return Math.max(150, Math.round(haversineM(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR));
}
