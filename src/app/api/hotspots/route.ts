import { NextResponse } from 'next/server';
import { getDistrictHeat, hotspotTrace } from '@/lib/engine/heat';
import { lstAnchorReady } from '@/lib/data/lst-anchor';
import { AppError, errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // make sure the first request after a cold start serves the LIVE
    // measurement, not the climatology fallback (awaits the anchor refresh)
    await lstAnchorReady();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const all = getDistrictHeat();
    if (id) {
      const h = all.find((d) => d.district.id === id);
      if (!h) {
        const known = all.map((d) => d.district.id).join(', ');
        throw new AppError(
          `Neznámý hotspot „${id}" (parametr ?id=). Dostupné id (${all.length}): ${known}.`,
          'unknown_hotspot',
          404
        );
      }
      return NextResponse.json({ hotspots: all, trace: hotspotTrace(h, all) });
    }
    return NextResponse.json({ hotspots: all });
  } catch (e) {
    const payload = errorPayload('GET /api/hotspots', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[GET /api/hotspots] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
