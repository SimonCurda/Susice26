import { NextResponse } from 'next/server';
import { buildPlantingPlan } from '@/lib/engine/planting';
import { AppError, errorPayload, readJsonBody } from '@/lib/errors';
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

const AREA_TYPES = ['street', 'square', 'park_edge', 'school', 'parking'] as const;

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as Body;

    const hotspotId = body.hotspotId ?? 'plzen2';
    if (typeof hotspotId !== 'string') {
      throw new AppError(
        `Pole „hotspotId“ musí být řetězec — přijato: ${JSON.stringify(hotspotId)} (${typeof hotspotId}).`,
        'bad_field_type',
        400
      );
    }

    const areaType = body.prefs?.areaType ?? DEFAULT_PREFS.areaType;
    if (!AREA_TYPES.includes(areaType as (typeof AREA_TYPES)[number])) {
      throw new AppError(
        `Neznámý „areaType“: „${areaType}". Povolené hodnoty: ${AREA_TYPES.join(', ')}.`,
        'bad_area_type',
        400
      );
    }

    if (typeof body.prefs?.budgetCzk !== 'undefined' && (typeof body.prefs.budgetCzk !== 'number' || !Number.isFinite(body.prefs.budgetCzk))) {
      throw new AppError(
        `Pole „prefs.budgetCzk“ musí být konečné číslo — přijato: ${JSON.stringify(body.prefs.budgetCzk)} (${typeof body.prefs.budgetCzk}).`,
        'bad_budget',
        400
      );
    }

    const prefs: PlantingPrefs = {
      budgetCzk: Math.min(5_000_000, Math.max(100_000, body.prefs?.budgetCzk ?? DEFAULT_PREFS.budgetCzk)),
      areaType: areaType as PlantingPrefs['areaType'],
      priorities: body.prefs?.priorities ?? DEFAULT_PREFS.priorities,
      constraints: body.prefs?.constraints ?? DEFAULT_PREFS.constraints,
    };

    const plan = buildPlantingPlan(hotspotId, prefs);
    return NextResponse.json(plan);
  } catch (e) {
    const payload = errorPayload('POST /api/planting', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[POST /api/planting] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
