import { NextResponse } from 'next/server';
import { getDistrictHeat, hotspotTrace } from '@/lib/engine/heat';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const all = getDistrictHeat();
  if (id) {
    const h = all.find((d) => d.district.id === id);
    if (!h) return NextResponse.json({ error: 'Unknown district id' }, { status: 404 });
    return NextResponse.json({ hotspots: all, trace: hotspotTrace(h, all) });
  }
  return NextResponse.json({ hotspots: all });
}
