import { NextResponse } from 'next/server';
import { getWeather } from '@/lib/openmeteo';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const weather = await getWeather();
    return NextResponse.json(weather);
  } catch (e) {
    console.error('weather error', e);
    return NextResponse.json({ error: 'Nepodařilo se načíst data o počasí z Open-Meteo.' }, { status: 502 });
  }
}
