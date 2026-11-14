import { NextResponse } from 'next/server';
import { endpointProblems, findRoutes, type RouteEndpointSpec } from '@/lib/engine/routing';
import { getWeather } from '@/lib/openmeteo';
import { lstAnchorReady } from '@/lib/data/lst-anchor';
import { AppError, errorPayload, readJsonBody } from '@/lib/errors';
import type { RouteProfilePrefs } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/routes
 *
 * Endpoints accepted per side (both also for backward compatibility):
 *  - "nodeId"                         — preset graph node (validated against known ids)
 *  - { "lat": 49.75, "lng": 13.39, "name": "Moje adresa" } — EXACT point,
 *    connected to the walking graph via the 3 nearest nodes (transparent,
 *    see routing.ts). Validation runs BEFORE search: bbox coverage, numeric
 *    values, min distance apart — every rejection carries the exact reason.
 */
interface Body {
  startId?: string;
  destId?: string;
  start?: RouteEndpointSpec;
  dest?: RouteEndpointSpec;
  prefs?: Partial<RouteProfilePrefs>;
}

function parseCoord(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new AppError(
      `Pole „${field}“ musí být číslo — přijato: ${JSON.stringify(v)} (${typeof v}).`,
      'bad_coord',
      400
    );
  }
  return v;
}

function normalizeEndpoint(raw: unknown, legacyId: string | undefined, field: string): RouteEndpointSpec {
  if (raw === undefined && legacyId === undefined) {
    throw new AppError(`Chybí pole „${field}“ (nebo legacy pole „${field}Id“).`, 'missing_endpoint', 400);
  }
  if (raw === undefined) return legacyId as string;
  if (typeof raw === 'string') {
    if (!raw.trim()) throw new AppError(`Pole „${field}“ je prázdný řetězec.`, 'empty_endpoint', 400);
    return raw.trim();
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { lat?: unknown; lng?: unknown; name?: unknown };
    const lat = parseCoord(o.lat, `${field}.lat`);
    const lng = parseCoord(o.lng, `${field}.lng`);
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : undefined;
    return { lat, lng, name };
  }
  throw new AppError(
    `Pole „${field}“ musí být řetězec (id uzlu) nebo objekt {lat, lng, name?} — přijato: ${JSON.stringify(raw).slice(0, 120)}.`,
    'bad_endpoint',
    400
  );
}

export async function POST(request: Request) {
  try {
    // anchor the LST model to the live measurement before scoring segments
    await lstAnchorReady();
    const body = (await readJsonBody(request)) as Body;
    const start = normalizeEndpoint(body.start, body.startId, 'start');
    const dest = normalizeEndpoint(body.dest, body.destId, 'dest');

    // exact validation before search (unknown ids / out-of-coverage points → 400 with reasons)
    const problems = endpointProblems(start, dest);
    if (problems.length > 0) {
      throw new AppError(`Trasu nelze hledat: ${problems.join(' | ')}`, 'route_bad_endpoints', 400);
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

    const { routes, trace, problems: searchProblems } = findRoutes(start, dest, prefs, ambientTemp);
    return NextResponse.json({ ambientTemp, routes, trace, problems: searchProblems, weatherFallback });
  } catch (e) {
    const payload = errorPayload('POST /api/routes', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[POST /api/routes] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
