import { NextResponse } from 'next/server';
import { findRoutes, routeIdProblems } from '@/lib/engine/routing';
import { getWeather } from '@/lib/openmeteo';
import { lstAnchorReady } from '@/lib/data/lst-anchor';
import { AppError, errorPayload, readJsonBody } from '@/lib/errors';
import type { RouteProfilePrefs } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

interface Body {
  startId?: string;
  destId?: string;
  prefs?: Partial<RouteProfilePrefs>;
}

export async function POST(request: Request) {
  try {
    // anchor the LST model to the live measurement before scoring segments
    await lstAnchorReady();
    const body = (await readJsonBody(request)) as Body;
    const startId = body.startId ?? 'nam_republiky';
    const destId = body.destId ?? 'kamen_rybnik';

    if (typeof startId !== 'string' || typeof destId !== 'string') {
      throw new AppError(
        `Pole „startId“ a „destId“ musí být řetězce — přijato: startId=${JSON.stringify(startId)} (${typeof startId}), destId=${JSON.stringify(destId)} (${typeof destId}).`,
        'bad_field_type',
        400
      );
    }

    // exact validation before search (unknown ids → 400 with valid id list)
    const idProblems = routeIdProblems(startId, destId);
    if (idProblems.length > 0) {
      throw new AppError(`Trasu nelze hledat: ${idProblems.join(' | ')}`, 'route_unknown_ids', 400);
    }

    const prefs: RouteProfilePrefs = {
      coolVsFast: Math.min(100, Math.max(0, body.prefs?.coolVsFast ?? 55)),
      options: body.prefs?.options ?? {},
      negatives: body.prefs?.negatives ?? {},
    };

    // weather is a bonus input — if it fails we still search, but report exactly why we fell back
    let ambientTemp = 26;
    let weatherFallback: string | undefined;
    try {
      const w = await getWeather();
      ambientTemp = w.plzen.current.temperature;
    } catch (e) {
      weatherFallback = `Open-Meteo nedostupné — použita výchozí teplota 26 °C. Přesný důvod: ${e instanceof Error ? e.message : String(e)}`;
    }

    const { routes, trace, problems } = findRoutes(startId, destId, prefs, ambientTemp);
    return NextResponse.json({ ambientTemp, routes, trace, problems, weatherFallback });
  } catch (e) {
    const payload = errorPayload('POST /api/routes', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[POST /api/routes] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
