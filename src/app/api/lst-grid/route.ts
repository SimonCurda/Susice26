import { NextResponse } from 'next/server';
import { getLstGrid } from '@/lib/data/plzen';
import { lstAnchorReady } from '@/lib/data/lst-anchor';
import { credsConfigured, envWarning, fetchRealLst } from '@/lib/data/sentinel3';
import { errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * Temperature grid for the map — single source of truth for the LST layer.
 *
 * 1. If CDSE OAuth credentials are configured, try REAL Sentinel-3 SLSTR LST
 *    (last 72 h, clear-sky mosaic) — exact upstream errors surface in `note`.
 * 2. Otherwise (or on failure): anchored UHI model — anomaly field × live
 *    Open-Meteo measurement, scaled by season/day-night/cloud.
 *
 * Legend bounds are computed from the served grid so the official CLMS TCI
 * colour ramp always spans the currently displayed temperature range.
 */
export async function GET() {
  try {
    const anchor = await lstAnchorReady();

    if (credsConfigured()) {
      const real = await fetchRealLst();
      if (real.ok) {
        const r = real.result;
        return NextResponse.json({
          source: r.source,
          observedAt: r.observedAt,
          anchor,
          points: r.points,
          legendMin: r.legendMin,
          legendMax: r.legendMax,
        });
      }
      // fall through to the anchored model, carrying the exact reason
      return NextResponse.json(anchoredResponse(anchor, `Sentinel-3 režim aktivní, ale raster se nepodařilo načíst: ${real.reason}`));
    }

    const env = envWarning();
    return NextResponse.json(anchoredResponse(anchor, env ?? undefined));
  } catch (e) {
    const payload = errorPayload('GET /api/lst-grid', e);
    console.error(`[GET /api/lst-grid] 500: ${payload.detail}`);
    return NextResponse.json(payload, { status: 500 });
  }
}

function anchoredResponse(
  anchor: ReturnType<typeof lstAnchorNow>,
  note?: string
): {
  source: 'anchored-model';
  observedAt: null;
  anchor: ReturnType<typeof lstAnchorNow>;
  points: { lat: number; lng: number; lst: number }[];
  legendMin: number;
  legendMax: number;
  note?: string;
} {
  const points = getLstGrid();
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.lst < min) min = p.lst;
    if (p.lst > max) max = p.lst;
  }
  return {
    source: 'anchored-model',
    observedAt: null,
    anchor,
    points,
    legendMin: Math.floor(min),
    legendMax: Math.ceil(max),
    ...(note ? { note } : {}),
  };
}
