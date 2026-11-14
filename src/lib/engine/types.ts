/**
 * Shared types for the explainable decision engines.
 *
 * Design principle: every engine result carries a full "trace" (reasoning trail)
 * so no recommendation is a black box. Government users can audit every step:
 * inputs, data sources, weights, intermediate scores and final decisions.
 */

export type TraceStepKind =
  | 'input' // user or environment inputs
  | 'data' // data source used
  | 'filter' // rule that eliminated options
  | 'weight' // weighting decision
  | 'score' // computation step
  | 'decision' // final decision
  | 'assumption'; // explicit assumption / simplification

export interface TraceStep {
  id: string;
  kind: TraceStepKind;
  title: string;
  detail: string;
  inputs?: { label: string; value: string }[];
  output?: string;
}

export interface TraceFactor {
  label: string;
  /** relative weight 0..1 used in the model */
  weight: number;
  /** contribution of this factor to the final score (0..1) */
  contribution: number;
  note?: string;
}

export interface DataSourceRef {
  name: string;
  url: string;
  note: string;
}

export interface Trace {
  title: string;
  summary: string;
  dataSources: DataSourceRef[];
  steps: TraceStep[];
  factors: TraceFactor[];
  confidence: { level: 'high' | 'medium' | 'low'; note: string };
  disclaimers: string[];
}

/** A point on the land surface temperature demo grid (Copernicus-derived methodology). */
export interface LstPoint {
  lat: number;
  lng: number;
  lst: number; // deg C
}

export interface District {
  id: string;
  name: string;
  kind: 'plzen_part' | 'town';
  lat: number;
  lng: number;
  population: number;
  /** share of residents 65+ (demo, from CZSO 2021 census profile) */
  seniorsPct: number;
  /** built-up density 0..1 (demo) */
  density: number;
}

export interface DistrictHeat {
  district: District;
  lstAvg: number;
  lstMax: number;
  greenPct: number;
  heatRisk: number; // 0..100 composite
  riskParts: { lst: number; green: number; vulnerable: number; density: number };
}

/** Destination that cools people down (park, pond, fountain, forest, pool...). */
export interface CoolPlace {
  id: string;
  name: string;
  type: 'park' | 'water' | 'forest' | 'fountain' | 'square' | 'pool';
  lat: number;
  lng: number;
  shadePct: number;
  hasWaterFeature: boolean;
  benches: number;
  tempOffset: number; // deg C cooler than surrounding street level
  description: string;
}

export interface GraphNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** public transport stop nearby */
  transit?: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** 0..1 shaded share of the segment */
  shade: number;
  /** 0..3 traffic level (0 quiet, 3 arterial road) */
  traffic: number;
  /** average slope % */
  slopePct: number;
  /** follows a water body or mill race */
  water: boolean;
  /** greenery along the segment 0..1 */
  green: number;
  benches: number;
  fountain: boolean;
  /** temporary construction/roadworks */
  construction: boolean;
  /** crowded area (city center events) */
  crowd: boolean;
}

export interface RouteProfilePrefs {
  /** 0..100 - 0 = only care about time, 100 = only care about coolness */
  coolVsFast: number;
  options: Record<string, boolean>;
  negatives: Record<string, boolean>;
}

export interface RouteSegment {
  lat: number;
  lng: number;
  edgeId: string;
  shade: number;
  water: boolean;
  green: number;
  traffic: number;
  slopePct: number;
  tempEst: number;
}

/** Endpoint metadata for a computed route (preset list item or exact user point). */
export interface RouteEndpointInfo {
  kind: 'preset' | 'exact';
  name: string;
  lat: number;
  lng: number;
  /** distance from an exact point to the nearest graph node (m); null for presets */
  snapDistanceM: number | null;
}

export interface RouteResult {
  profileId: 'coolest' | 'balanced' | 'fastest';
  profileName: string;
  color: string;
  distanceM: number;
  minutes: number;
  coolingScore: number; // 0..100
  avgTempEst: number;
  shadePct: number;
  waterPoints: number;
  restPoints: number;
  segments: RouteSegment[];
  geometry: { lat: number; lng: number }[];
  /** endpoint metadata (present so the UI can label exact A→B points) */
  endpoints?: { start: RouteEndpointInfo; dest: RouteEndpointInfo };
  trace: Trace;
}

export interface Species {
  id: string;
  nameCs: string;
  nameLat: string;
  /** CZK per tree incl. planting + 3 years of care */
  costCzk: number;
  /** mature canopy m2 */
  canopyM2: number;
  cooling: number; // 1..5
  drought: number; // 1..5
  growth: number; // 1..5 (5 = fast effect)
  biodiversity: number; // 1..5
  lowMaintenance: number; // 1..5
  allergen: number; // 1..3 (3 = problematic)
  streetOk: boolean;
  parkOk: boolean;
  /** suitable in heritage/monument zones (smaller species only) */
  heritageOk: boolean;
  minSoilM3: number;
  note: string;
}

export interface PlantingPrefs {
  budgetCzk: number;
  areaType: 'street' | 'square' | 'park_edge' | 'school' | 'parking';
  priorities: Record<string, boolean>;
  constraints: Record<string, boolean>;
}

export interface PlantingSpeciesPlan {
  speciesId: string;
  nameCs: string;
  nameLat: string;
  count: number;
  unitCostCzk: number;
  totalCostCzk: number;
  canopyM2: number;
  score: number;
  why: string;
}

export interface PlantingResult {
  hotspot: DistrictHeat;
  species: PlantingSpeciesPlan[];
  totalTrees: number;
  totalCostCzk: number;
  expectedDlst: number;
  expectedCanopyM2: number;
  coBenefits: { label: string; value: string }[];
  suggestedPoints: { lat: number; lng: number; lst: number; canopyPct: number }[];
  companionMeasures: { name: string; detail: string; unitCost: string }[];
  trace: Trace;
}

export interface HeatAlert {
  level: 'ok' | 'watch' | 'warning' | 'extreme';
  title: string;
  message: string;
  triggeredBy: string[];
}

export interface WeatherData {
  fetchedAt: string;
  plzen: {
    current: {
      temperature: number;
      apparentTemperature: number;
      humidity: number;
      /** dew point °C (Magnus formula from T + RH) — > 15 °C feels muggy */
      dewPoint: number;
      windSpeed: number;
      weatherCode: number;
      isDay: boolean;
      precipitation: number;
      cloudCover: number | null;
    };
    daily: {
      date: string;
      tMax: number;
      tMin: number;
      precipitation: number;
      et0: number;
      radiation: number;
    }[];
  };
  region: { name: string; temperature: number; apparentTemperature: number; humidity: number; altitudeNote: string }[];
  alert: HeatAlert;
  wateringAdvice: string;
  tropicalNightsNext3: number;
}
