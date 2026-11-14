import { NextResponse } from 'next/server';
import { fetchNdvi } from '@/lib/copernicus/ndvi';
import { errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/copernicus/ndvi
 *
 * Live vegetation (NDVI) overlay for the map — Sentinel-2 L2A via the CDSE
 * Process API, most recent reasonably clear acquisition of the last 30 days
 * over the Plzeň city bbox. Returns a small PNG data URI + exact bounds for
 * Leaflet ImageOverlay. Cached server-side 6 h; on failure the JSON carries
 * the exact upstream reason and `available: false` (the map simply shows the
 * canopy layer).
 */
export async function GET() {
  try {
    const res = await fetchNdvi();
    if (res.ok) {
      const r = res.result;
      return NextResponse.json({
        available: true,
        source: r.source,
        observedFrom: r.observedFrom,
        observedTo: r.observedTo,
        bounds: r.bounds,
        image: r.image,
        pixels: r.pixels,
      });
    }
    return NextResponse.json({ available: false, note: res.reason });
  } catch (e) {
    const payload = errorPayload('GET /api/copernicus/ndvi', e);
    console.error(`[GET /api/copernicus/ndvi] 500: ${payload.detail}`);
    return NextResponse.json(payload, { status: 500 });
  }
}
