import { NextResponse } from 'next/server';
import { getLstDiff } from '@/lib/copernicus/dlst';
import { errorPayload } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/copernicus/dlst?from=2016&to=2026
 *
 * ΔLST map — the difference of two summers' clear-hot-day composites
 * (Sentinel-3 SLSTR S7, days selected by the ERA5 cloud filter). First
 * computation fetches 5 day rasters per year (Process API) and is slow
 * (tens of seconds); composites are cached per year, so later pairs are
 * fast. Failures carry exact reasons in `note`.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawFrom = url.searchParams.get('from') ?? '2016';
    const rawTo = url.searchParams.get('to') ?? String(new Date().getFullYear());
    const from = Number.parseInt(rawFrom, 10);
    const to = Number.parseInt(rawTo, 10);
    const payload = await getLstDiff(from, to);
    return NextResponse.json(payload);
  } catch (e) {
    const p = errorPayload('GET /api/copernicus/dlst', e);
    console.error(`[GET /api/copernicus/dlst] 500: ${p.detail}`);
    return NextResponse.json(p, { status: 500 });
  }
}
