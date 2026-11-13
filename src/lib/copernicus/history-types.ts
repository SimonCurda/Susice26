/**
 * Shared (type-only) payload shapes for /api/copernicus/history.
 * Importable from client components — contains no server code.
 */

export interface HistoryYearPoint {
  year: number;
  tMean: number | null;
  hottest: { date: string; t: number } | null;
  tropicalDays: number;
  tropicalNights: number;
  summerMean: number | null;
  isFullYear: boolean;
}

export interface HistoryRegionRow {
  name: string;
  altitudeNote: string;
  warmingPerDecade: number;
  tropicalDaysAvgLast10: number;
  tropicalDaysLastFullYear: number;
  hottestEver: { date: string; t: number };
  note?: string;
}

export interface Era5HistoryPayload {
  source: string;
  location: { name: string; lat: number; lng: number };
  firstYear: number;
  lastFullYear: number;
  years: HistoryYearPoint[];
  normals: {
    ref: '1961–1990';
    refMean: number | null;
    recent: string;
    recentMean: number | null;
    delta: number | null;
  };
  warmingPerDecade: number | null;
  record: { date: string; t: number } | null;
  region: HistoryRegionRow[];
  note: string;
}

export interface SatelliteMonthPoint {
  /** 'YYYY-MM' (June, July or August) */
  month: string;
  year: number;
  /** median of cloud-filtered daily means, °C */
  median: number | null;
  keptDays: number;
  totalDays: number;
}

export interface SatelliteSummerPoint {
  year: number;
  /** mean of monthly medians (June–August), °C */
  index: number | null;
  hottestDay: { date: string; mean: number } | null;
  keptDays: number;
  totalDays: number;
}

export interface SatelliteHistoryPayload {
  source: string;
  available: boolean;
  /** {done, total} — chunked fetch progress (1 chunk per summer) */
  progress: { done: number; total: number };
  years: number[];
  months: SatelliteMonthPoint[];
  summers: SatelliteSummerPoint[];
  note: string;
}

export interface HistoryResponse {
  fetchedAt: string;
  era5: Era5HistoryPayload | null;
  era5Error: string | null;
  satellite: SatelliteHistoryPayload | null;
}
