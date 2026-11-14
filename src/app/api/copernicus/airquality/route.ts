import { NextResponse } from 'next/server';
import { getAirQuality } from '@/lib/copernicus/airquality';
import { errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/copernicus/airquality
 *
 * Current air quality over the city bbox — CAMS (Copernicus Atmosphere
 * Monitoring Service) European forecast via the Open-Meteo broker, sampled
 * on a 13 × 9 grid. Returns European AQI + PM2.5/PM10/O3/NO2 per point and
 * a city-centre representative. Cached 15 min; failures carry exact reasons.
 */
export async function GET() {
  try {
    const payload = await getAirQuality();
    return NextResponse.json(payload);
  } catch (e) {
    const p = errorPayload('GET /api/copernicus/airquality', e);
    console.error(`[GET /api/copernicus/airquality] 500: ${p.detail}`);
    return NextResponse.json(p, { status: 500 });
  }
}
