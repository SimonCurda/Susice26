import { NextResponse } from 'next/server';
import { getWeather } from '@/lib/openmeteo';
import { errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const weather = await getWeather();
    return NextResponse.json(weather);
  } catch (e) {
    const payload = errorPayload('GET /api/weather', e);
    console.error(`[GET /api/weather] 502: ${payload.detail}`);
    return NextResponse.json(payload, { status: 502 });
  }
}
