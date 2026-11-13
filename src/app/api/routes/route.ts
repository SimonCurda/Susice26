import { NextResponse } from 'next/server';
import { findRoutes } from '@/lib/engine/routing';
import { getWeather } from '@/lib/openmeteo';
import type { RouteProfilePrefs } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

interface Body {
  startId?: string;
  destId?: string;
  prefs?: Partial<RouteProfilePrefs>;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const startId = body.startId ?? 'nam_republiky';
    const destId = body.destId ?? 'kamen_rybnik';

    const prefs: RouteProfilePrefs = {
      coolVsFast: Math.min(100, Math.max(0, body.prefs?.coolVsFast ?? 55)),
      options: body.prefs?.options ?? {},
      negatives: body.prefs?.negatives ?? {},
    };

    let ambientTemp = 26;
    try {
      const w = await getWeather();
      ambientTemp = w.plzen.current.temperature;
    } catch {
      // fall back to default ambient temperature if Open-Meteo is unreachable
    }

    const { routes, trace } = findRoutes(startId, destId, prefs, ambientTemp);
    return NextResponse.json({ ambientTemp, routes, trace });
  } catch (e) {
    console.error('routes error', e);
    return NextResponse.json({ error: 'Vyhledání tras selhalo.' }, { status: 500 });
  }
}
