/**
 * REAL Copernicus tree-canopy data for Plzeňský kraj.
 *
 * Pipeline: user-uploaded Copernicus HRL Tree Cover Density family GeoTIFF
 * (10 m, EPSG:3035, mosaic over Czechia, from Google Drive → data/raw/, which
 * is gitignored) → scripts/canopy_to_json.py → the two small JSON grids below
 * (static imports, kilobytes) + a transparent PNG map overlay rendered with
 * the OFFICIAL CLMS TCD colourmap.
 *
 * Semantics of a grid value: average tree-canopy share of the cell in % (0-100),
 * computed as the mean of all 10 m source pixels inside the cell ("average"
 * resampling). The raster was verified against OSM forest polygons with an FFT
 * cross-correlation: content offset < 10 m (correctly georeferenced).
 * Known caveat (kept transparent): the layer captures forest canopy very well
 * but under-reports small urban deciduous green (e.g. Kopeckého sady reads
 * ~0 %) — treat city-centre zeros as "no detected forest canopy", not
 * "definitely no vegetation".
 */

import canopyPlzenJson from './canopy-plzen.json';
import canopyKrajJson from './canopy-kraj.json';
import { clmsTcdColor } from '@/lib/data/clms-colormaps';

interface CanopyGrid {
  generatedAt: string;
  source: string;
  aggregation: string;
  bbox: { south: number; west: number; north: number; east: number };
  stepDeg: number;
  cols: number;
  rows: number;
  nodataCells: number;
  values: number[];
}

const CITY = canopyPlzenJson as unknown as CanopyGrid;
const KRAJ = canopyKrajJson as unknown as CanopyGrid;

export const CANOPY_META = {
  generatedAt: KRAJ.generatedAt,
  source: KRAJ.source,
  aggregation: KRAJ.aggregation,
  cityStepM: Math.round(CITY.stepDeg * 111_320),
  krajStepM: Math.round(KRAJ.stepDeg * 111_320),
};

/** Public URL of the pre-rendered transparent overlay (official CLMS TCD ramp). */
export const CANOPY_OVERLAY_URL = '/data/canopy-plzen.png';
/** Bounds of the overlay PNG (Plzeň city window, same as the city grid bbox). */
export const CANOPY_OVERLAY_BOUNDS: [number, number][] = [
  [CITY.bbox.south, CITY.bbox.west],
  [CITY.bbox.north, CITY.bbox.east],
];

/** Nearest-cell canopy share at a coordinate (0..100), or null outside both grids. */
export function canopyAt(lat: number, lng: number): number | null {
  const hit = lookup(CITY, lat, lng) ?? lookup(KRAJ, lat, lng);
  return hit;
}

function lookup(g: CanopyGrid, lat: number, lng: number): number | null {
  const col = Math.floor((lng - g.bbox.west) / g.stepDeg);
  const row = Math.floor((g.bbox.north - lat) / g.stepDeg);
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return null;
  return g.values[row * g.cols + col];
}

/**
 * Mean canopy share (%) of all kraj-grid cells within `radiusKm` of a point —
 * the honest district-level "share of tree canopy" input for the risk model.
 * Returns null when the disk has no kraj-grid coverage (never in practice).
 */
export function canopyShareAround(lat: number, lng: number, radiusKm: number): number | null {
  const g = KRAJ;
  let sum = 0;
  let n = 0;
  for (let row = 0; row < g.rows; row++) {
    const cellLat = g.bbox.north - (row + 0.5) * g.stepDeg;
    if (Math.abs(cellLat - lat) * 111 > radiusKm) continue;
    for (let col = 0; col < g.cols; col++) {
      const cellLng = g.bbox.west + (col + 0.5) * g.stepDeg;
      if (Math.abs(cellLng - lng) * 68 > radiusKm) continue;
      const dLat = (cellLat - lat) * 111;
      const dLng = (cellLng - lng) * 68;
      if (dLat * dLat + dLng * dLng <= radiusKm * radiusKm) {
        sum += g.values[row * g.cols + col];
        n++;
      }
    }
  }
  return n > 0 ? sum / n : null;
}

/** Colour of a canopy share on the OFFICIAL CLMS TCD ramp. */
export function canopyColor(pct: number): string {
  return clmsTcdColor(pct);
}

export interface CanopyCell {
  lat: number;
  lng: number;
  canopyPct: number;
}

/**
 * All grid cells (fine city grid when the point is inside it, coarse kraj
 * grid otherwise) within `radiusKm` of a point — used by the planting engine
 * to find genuinely treeless hot cells.
 */
export function canopyCellsAround(lat: number, lng: number, radiusKm: number): CanopyCell[] {
  const g = inside(CITY, lat, lng) ? CITY : KRAJ;
  const out: CanopyCell[] = [];
  for (let row = 0; row < g.rows; row++) {
    const cellLat = g.bbox.north - (row + 0.5) * g.stepDeg;
    if (Math.abs(cellLat - lat) * 111 > radiusKm) continue;
    for (let col = 0; col < g.cols; col++) {
      const cellLng = g.bbox.west + (col + 0.5) * g.stepDeg;
      if (Math.abs(cellLng - lng) * 68 > radiusKm) continue;
      const dLat = (cellLat - lat) * 111;
      const dLng = (cellLng - lng) * 68;
      if (dLat * dLat + dLng * dLng <= radiusKm * radiusKm) {
        out.push({ lat: +cellLat.toFixed(5), lng: +cellLng.toFixed(5), canopyPct: g.values[row * g.cols + col] });
      }
    }
  }
  return out;
}

function inside(g: CanopyGrid, lat: number, lng: number): boolean {
  return (
    lat >= g.bbox.south && lat <= g.bbox.north &&
    lng >= g.bbox.west && lng <= g.bbox.east
  );
}
