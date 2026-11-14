import { NextResponse } from 'next/server';
import { getHistory } from '@/lib/data/era5';
import { getSatelliteHistory } from '@/lib/copernicus/stats';
import { getVegHistory } from '@/lib/copernicus/veg-history';
import type { HistoryResponse } from '@/lib/copernicus/history-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/copernicus/history
 *
 * Historical Copernicus series for Plzeň + region, three independent series:
 *  1. era5       — daily ERA5 reanalysis (Copernicus C3S) since 1970, aggregated
 *                  to yearly stats + climate normals + warming trend (Open-Meteo
 *                  archive broker). Fetched and cached server-side (12 h).
 *  2. satellite  — Sentinel-3 SLSTR surface temperature since 2016 via the CDSE
 *                  Statistical API (June–August, daily intervals, cloud-filtered
 *                  against ERA5). Chunks load in the background (1 chunk per
 *                  year); the response reports progress and fills in on polls.
 *  3. vegetation — Sentinel-2 L2A NDVI + NDMI (vegetation biomass + its
 *                  moisture) since 2018 via the CDSE Statistical API (June–
 *                  August monthly least-cloud mosaics). Same chunked
 *                  background loading pattern.
 *
 * The series are independent: a failure in one never breaks the others.
 */
export async function GET() {
  const [era5, satellite, vegetation] = await Promise.allSettled([
    getHistory(),
    getSatelliteHistory(),
    getVegHistory(),
  ]);

  const payload: HistoryResponse = {
    fetchedAt: new Date().toISOString(),
    era5: era5.status === 'fulfilled' ? era5.value : null,
    era5Error: era5.status === 'rejected' ? String(era5.reason?.message ?? era5.reason) : null,
    satellite: satellite.status === 'fulfilled' ? satellite.value : null,
    vegetation: vegetation.status === 'fulfilled' ? vegetation.value : null,
    vegetationError: vegetation.status === 'rejected' ? String(vegetation.reason?.message ?? vegetation.reason) : null,
  };

  if (era5.status === 'rejected') {
    console.error(`[GET /api/copernicus/history] era5 failed: ${payload.era5Error}`);
  }
  if (satellite.status === 'rejected') {
    const satReason = String(satellite.reason?.message ?? satellite.reason);
    console.error(`[GET /api/copernicus/history] satellite failed: ${satReason}`);
    payload.satellite = {
      source: 'Sentinel-3 SLSTR · CDSE Statistical API',
      available: false,
      progress: { done: 0, total: 0 },
      years: [],
      months: [],
      summers: [],
      note: `satelitní historie se nepodařila: ${satReason}`,
    };
  }
  if (vegetation.status === 'rejected') {
    const vegReason = String(vegetation.reason?.message ?? vegetation.reason);
    console.error(`[GET /api/copernicus/history] vegetation failed: ${vegReason}`);
    payload.vegetation = null;
  }

  if (payload.era5Error && !payload.satellite && !payload.vegetation) {
    return NextResponse.json({ ...payload, detail: payload.era5Error }, { status: 502 });
  }
  return NextResponse.json(payload);
}
