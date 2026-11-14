import { NextResponse } from 'next/server';
import { getDem } from '@/lib/copernicus/dem';
import { errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/copernicus/dem
 *
 * Shaded-relief terrain overlay — Copernicus DEM GLO-30 via the CDSE Process
 * API, hillshade + hypsometric tint rendered server-side. Static dataset,
 * cached 24 h; the payload also carries elevation statistics (min/max/mean)
 * used by the legend and the AI fact sheet.
 */
export async function GET() {
  try {
    const payload = await getDem();
    return NextResponse.json(payload);
  } catch (e) {
    const p = errorPayload('GET /api/copernicus/dem', e);
    console.error(`[GET /api/copernicus/dem] 500: ${p.detail}`);
    return NextResponse.json(p, { status: 500 });
  }
}
