import { NextResponse } from 'next/server';
import { buildPlantingPlan } from '@/lib/engine/planting';
import type { PlantingPrefs } from '@/lib/engine/types';

export const dynamic = 'force-dynamic';

interface Body {
  hotspotId?: string;
  prefs?: Partial<PlantingPrefs>;
}

const DEFAULT_PREFS: PlantingPrefs = {
  budgetCzk: 800000,
  areaType: 'street',
  priorities: { cooling: true, cost: true },
  constraints: {},
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const hotspotId = body.hotspotId ?? 'plzen2';
    const prefs: PlantingPrefs = {
      budgetCzk: Math.min(5_000_000, Math.max(100_000, body.prefs?.budgetCzk ?? DEFAULT_PREFS.budgetCzk)),
      areaType: body.prefs?.areaType ?? DEFAULT_PREFS.areaType,
      priorities: body.prefs?.priorities ?? DEFAULT_PREFS.priorities,
      constraints: body.prefs?.constraints ?? DEFAULT_PREFS.constraints,
    };
    const plan = buildPlantingPlan(hotspotId, prefs);
    if (!plan) return NextResponse.json({ error: 'Nepodařilo se sestavit návrh.' }, { status: 400 });
    return NextResponse.json(plan);
  } catch (e) {
    console.error('planting error', e);
    return NextResponse.json({ error: 'Generování návrhu výsadby selhalo.' }, { status: 500 });
  }
}
