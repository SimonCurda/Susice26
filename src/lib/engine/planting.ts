/**
 * "Co vysázet" planting recommender — fully explainable species selection,
 * budget decomposition and expected cooling effect.
 */

import { SPECIES, lstAt } from '@/lib/data/plzen';
import { canopyCellsAround } from '@/lib/data/canopy';
import { AppError } from '@/lib/errors';
import { getDistrictHeat, DATA_SOURCES } from '@/lib/engine/heat';
import type { DistrictHeat, PlantingPrefs, PlantingResult, PlantingSpeciesPlan, Trace } from '@/lib/engine/types';

export const PRIORITY_LABELS: Record<string, string> = {
  cooling: 'Maximální chlazení',
  cost: 'Nákladová účinnost',
  biodiversity: 'Biodiverzita',
  fast: 'Rychlý efekt',
  lowMaintenance: 'Nízká údržba',
  lowAllergen: 'Nízká alergenicita',
};

export const CONSTRAINT_LABELS: Record<string, string> = {
  heritage: 'Památková / historická zóna',
  utilities: 'Podzemní inženýrské sítě',
  narrow: 'Úzké chodníky',
  drySoil: 'Suchá, propustná půda',
};

export const AREA_LABELS: Record<string, string> = {
  street: 'Ulice / alej',
  square: 'Náměstí / plaza',
  park_edge: 'Okraj parku / lesoparku',
  school: 'Okolí školy / hřiště',
  parking: 'Parkoviště / přeložka',
};

const AREA_ALLOWANCE: Record<PlantingPrefs['areaType'], 'streetOk' | 'parkOk'> = {
  street: 'streetOk',
  square: 'streetOk',
  park_edge: 'parkOk',
  school: 'parkOk',
  parking: 'streetOk',
};

/** Affected area per hotspot (m²) — demo assumption, exposed in trace. */
const HOTSPOT_AREA_M2 = 250_000;

export function buildPlantingPlan(hotspotId: string, prefs: PlantingPrefs): PlantingResult {
  const all = getDistrictHeat();
  const hotspot = all.find((h) => h.district.id === hotspotId);
  if (!hotspot) {
    const known = all.map((h) => `${h.district.id} (${h.district.name})`).join(', ');
    throw new AppError(
      `Neznámý hotspot „${hotspotId}". Dostupné hotspoty (${all.length}): ${known}.`,
      'unknown_hotspot',
      400
    );
  }

  // 1) hard filters from area type + constraints
  const eliminated: { speciesId: string; reason: string }[] = [];
  const eligible = SPECIES.filter((s) => {
    if (prefs.constraints.heritage && !s.heritageOk) {
      eliminated.push({ speciesId: s.id, reason: 'památková zóna: jen menší druhy' });
      return false;
    }
    if (prefs.constraints.utilities && s.minSoilM3 > 12) {
      eliminated.push({ speciesId: s.id, reason: `kořenový prostor ${s.minSoilM3} m³ koliduje se sítěmi` });
      return false;
    }
    if (prefs.constraints.narrow && !s.streetOk) {
      eliminated.push({ speciesId: s.id, reason: 'úzký chodník: velkokorunní druhy vyloučeny' });
      return false;
    }
    if (!s[AREA_ALLOWANCE[prefs.areaType]]) {
      eliminated.push({ speciesId: s.id, reason: `nevhodné pro prostor „${AREA_LABELS[prefs.areaType]}“` });
      return false;
    }
    return true;
  });
  const pool = eligible.length > 0 ? eligible : SPECIES.filter((s) => s[AREA_ALLOWANCE[prefs.areaType]]);

  // 2) priority score per species (explicit weights)
  const p = prefs.priorities;
  const activePriorities = Object.entries(p).filter(([, v]) => v);
  const w: Record<string, number> = {
    cooling: activePriorities.length ? (p.cooling ? 0.35 : 0) + 0.15 : 0.3,
    cost: p.cost ? 0.25 : 0.05,
    biodiversity: p.biodiversity ? 0.2 : 0.05,
    fast: p.fast ? 0.15 : 0.05,
    lowMaintenance: p.lowMaintenance ? 0.12 : 0.04,
    lowAllergen: p.lowAllergen ? 0.1 : 0.02,
  };
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  const scored = pool
    .map((s) => {
      const norm = (v: number) => (v - 1) / 4; // 1..5 → 0..1
      const costEff = 0.35 + 0.65 * norm(Math.min(5, Math.max(1, 3 + (40000 - s.costCzk) / 10000)));
      const score =
        (w.cooling * norm(s.cooling) +
          w.cost * costEff +
          w.biodiversity * norm(s.biodiversity) +
          w.fast * norm(s.growth) +
          w.lowMaintenance * norm(s.lowMaintenance) +
          w.lowAllergen * norm(4 - s.allergen)) /
        wSum;
      return { species: s, score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score);

  // 3) budget decomposition — top 3 species, 50/30/20 split
  const top = scored.slice(0, 3);
  const shares = [0.5, 0.3, 0.2];
  const plans: PlantingSpeciesPlan[] = top.map((t, i) => {
    const budgetShare = prefs.budgetCzk * shares[i];
    const count = Math.max(1, Math.floor(budgetShare / t.species.costCzk));
    return {
      speciesId: t.species.id,
      nameCs: t.species.nameCs,
      nameLat: t.species.nameLat,
      count,
      unitCostCzk: t.species.costCzk,
      totalCostCzk: count * t.species.costCzk,
      canopyM2: count * t.species.canopyM2,
      score: t.score,
      why: t.species.note,
    };
  });

  const totalTrees = plans.reduce((a, s) => a + s.count, 0);
  const totalCost = plans.reduce((a, s) => a + s.totalCostCzk, 0);
  const totalCanopy = plans.reduce((a, s) => a + s.canopyM2, 0);

  // 4) expected LST reduction (transparent formula, capped)
  const canopyShare = totalCanopy / HOTSPOT_AREA_M2;
  const expectedDlst = Math.round(Math.min(4, 6.5 * Math.sqrt(canopyShare)) * 10) / 10;

  // 5) co-benefits
  const energyKwh = Math.round(totalCanopy * 12);
  const coBenefits = [
    { label: 'Nový korunní stín', value: `${totalCanopy.toLocaleString('cs-CZ')} m² (~${(totalCanopy / 750).toFixed(1)} tenisové kurtu)` },
    { label: 'Úspora energie budov v okolí', value: `≈ ${energyKwh.toLocaleString('cs-CZ')} kWh/rok (orientačně)` },
    { label: 'Účinnost za peníze', value: `${Math.round(totalCanopy / (totalCost / 1000))} m² stínu / 1 000 Kč` },
    { label: 'Dostupnost vody (zálivka)', value: prefs.constraints.drySoil ? 'zvážit zavlažování – suchá půda' : 'standardní zálivka 3 roky' },
  ];

  const trace = plantingTrace(hotspot, prefs, eliminated, scored.slice(0, 6), plans, totalTrees, totalCost, totalCanopy, expectedDlst, canopyShare, w, wSum);

  return {
    hotspot,
    species: plans,
    totalTrees,
    totalCostCzk: totalCost,
    expectedDlst,
    expectedCanopyM2: totalCanopy,
    coBenefits,
    suggestedPoints: suggestPoints(hotspot, totalTrees),
    companionMeasures: [
      { name: 'Zelené pásy / bioswale', detail: 'Záchyt a vsakování dešťovky podél komunikací', unitCost: '≈ 4 500 Kč/m' },
      { name: 'Propustné povrchy', detail: 'Snížení přehřívání asfaltu, vsak dešťovky', unitCost: '≈ 2 800 Kč/m²' },
      { name: 'Zavlažovací nádrže na stromy', detail: 'Zálivka mladých výsadeb v vedrech', unitCost: '≈ 3 200 Kč/ks' },
    ],
    trace,
  };
}

/**
 * REAL planting candidates from the Copernicus canopy grid: cells around the
 * hotspot centroid with the LOWEST detected tree canopy that the LST model
 * marks hottest (score = LST − canopy/25). Points are kept ≥ ~120 m apart so
 * markers don't stack. Falls back to a deterministic ring only outside grid
 * coverage (never in practice).
 */
function suggestPoints(hotspot: DistrictHeat, count: number) {
  const n = Math.min(24, Math.max(6, count));
  const cells = canopyCellsAround(hotspot.district.lat, hotspot.district.lng, 1.8);
  if (cells.length === 0) return legacyRing(hotspot, n);
  const scored = cells
    .map((c) => ({ ...c, lst: lstAt(c.lat, c.lng) }))
    .sort((a, b) => b.lst - b.canopyPct / 25 - (a.lst - a.canopyPct / 25));
  const picked: { lat: number; lng: number; lst: number; canopyPct: number }[] = [];
  for (const c of scored) {
    const far = picked.every((p) => Math.abs(p.lat - c.lat) * 111 > 0.12 || Math.abs(p.lng - c.lng) * 68 > 0.12);
    if (far) picked.push({ lat: c.lat, lng: c.lng, lst: c.lst, canopyPct: c.canopyPct });
    if (picked.length >= n) break;
  }
  return picked.sort((a, b) => b.lst - a.lst);
}

/** Deterministic fallback ring (used only when the canopy grid is missing). */
function legacyRing(hotspot: DistrictHeat, n: number) {
  const pts: { lat: number; lng: number; lst: number; canopyPct: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = 0.0022 + (i % 3) * 0.0016;
    const lat = hotspot.district.lat + Math.sin(ang) * r;
    const lng = hotspot.district.lng + (Math.cos(ang) * r * 1.55);
    pts.push({ lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000, lst: lstAt(lat, lng), canopyPct: -1 });
  }
  return pts.sort((a, b) => b.lst - a.lst);
}

function plantingTrace(
  hotspot: DistrictHeat,
  prefs: PlantingPrefs,
  eliminated: { speciesId: string; reason: string }[],
  topScored: { species: (typeof SPECIES)[number]; score: number }[],
  plans: PlantingSpeciesPlan[],
  totalTrees: number,
  totalCost: number,
  totalCanopy: number,
  expectedDlst: number,
  canopyShare: number,
  w: Record<string, number>,
  wSum: number
): Trace {
  return {
    title: `Proč tento návrh výsadby pro ${hotspot.district.name}`,
    summary: `Budget ${prefs.budgetCzk.toLocaleString('cs-CZ')} Kč → ${totalTrees} stromů → ≈ −${expectedDlst} °C LST v lokálním okolí.`,
    dataSources: DATA_SOURCES,
    steps: [
      { id: 'p1', kind: 'input', title: 'Vstupy', inputs: [
        { label: 'Území', value: hotspot.district.name },
        { label: 'LST průměr / max', value: `${hotspot.lstAvg} °C / ${hotspot.lstMax} °C` },
        { label: 'Korunní pokryv (Copernicus, reálný)', value: `${hotspot.greenPct} %` },
        { label: 'Rozpočet', value: `${prefs.budgetCzk.toLocaleString('cs-CZ')} Kč` },
        { label: 'Prostor', value: AREA_LABELS[prefs.areaType] },
        { label: 'Priorities', value: Object.entries(prefs.priorities).filter(([, v]) => v).map(([k]) => PRIORITY_LABELS[k] ?? k).join(', ') || 'žádné výslovné – použita rovnováha' },
        { label: 'Omezení', value: Object.entries(prefs.constraints).filter(([, v]) => v).map(([k]) => CONSTRAINT_LABELS[k] ?? k).join(', ') || 'žádná' },
      ] },
      { id: 'p2', kind: 'filter', title: 'Filtr druhů podle omezení', detail: eliminated.length ? `Vyloučeno ${eliminated.length} druhů: ${eliminated.map((e) => `${SPECIES.find((s) => s.id === e.speciesId)?.nameCs} (${e.reason})`).join('; ')}.` : 'Žádný druh nevyloučen – plná paleta 10 druhů k dispozici.' },
      { id: 'p3', kind: 'weight', title: 'Váhy priorit', detail: 'Váhy se přepočítávají podle zvolených priorit; vždy zůstává základní složka chlazení.', inputs: Object.entries(w).map(([k, v]) => ({ label: k, value: v.toFixed(2) })) },
      { id: 'p4', kind: 'score', title: 'Skóre druhů (top 6)', detail: 'Skóre = vážený průměr normalizovaných vlastností (0–1).', inputs: topScored.map((t) => ({ label: t.species.nameCs, value: t.score.toFixed(2) })) },
      { id: 'p5', kind: 'score', title: 'Rozdělení rozpočtu', detail: 'Top 3 druhy dostávají 50 / 30 / 20 % rozpočtu (diverzifikace proti monokultuře a chorobám).', inputs: plans.map((s) => ({ label: s.nameCs, value: `${s.count} ks × ${s.unitCostCzk.toLocaleString('cs-CZ')} Kč = ${s.totalCostCzk.toLocaleString('cs-CZ')} Kč` })), output: `Celkem ${totalTrees} stromů za ${totalCost.toLocaleString('cs-CZ')} Kč (rezerva zůstává na doplňkové prvky).` },
      { id: 'p6', kind: 'assumption', title: 'Model ochlazení', detail: `ΔLST = min(4 °C, 6,5·√(podíl korunní plochy)). Podíl = ${totalCanopy.toLocaleString('cs-CZ')} m² / ${HOTSPOT_AREA_M2.toLocaleString('cs-CZ')} m² = ${(canopyShare * 100).toFixed(1)} % → ΔLST ≈ −${expectedDlst} °C. Plocha ${HOTSPOT_AREA_M2.toLocaleString('cs-CZ')} m² je předpoklad pro demo; v produkci se nahradí GIS polygonem.` },
      { id: 'p6b', kind: 'data', title: 'Výběr konkrétních míst výsadby', detail: 'Navržené body NEJSOU syntetické: engine scanuje reálnou mřížku korunního pokryvu Copernicus v okruhu 1,8 km od centra hotspotu a vybírá buňky s nejnižším detekovaným korunním pokryvem, které model LST současně značí jako nejteplejší (skóre = LST − korunní pokryv/25). Body jsou od sebe vzdálené alespoň ~120 m.', inputs: [
        { label: 'Buňky v okruhu', value: 'mřížka Copernicus 10 m → střední hodnota na buňku' },
        { label: 'Kritérium', value: 'nejteplejší ∧ nejméně stromů (obě hodnoty viditelné v tooltipu bodu na mapě)' },
      ] },
      { id: 'p7', kind: 'decision', title: 'Doporučení', detail: `Vysadit ${totalTrees} stromů (mix top ${plans.length} druhů). Očekávaný efekt −${expectedDlst} °C LST, ${totalCanopy.toLocaleString('cs-CZ')} m² nového stínu. Doplnit o doporučené doprovodné prvky (vsaky, propustné povrchy).` },
    ],
    factors: [
      { label: 'Chlazení (koruna, evapotranspirace)', weight: w.cooling / wSum, contribution: topScored[0] ? (topScored[0].species.cooling - 1) / 4 : 0.6 },
      { label: 'Nákladová účinnost', weight: w.cost / wSum, contribution: 0.55 },
      { label: 'Biodiverzita', weight: w.biodiversity / wSum, contribution: 0.5 },
      { label: 'Rychlost efektu', weight: w.fast / wSum, contribution: 0.45 },
      { label: 'Údržba', weight: w.lowMaintenance / wSum, contribution: 0.4 },
    ],
    confidence: { level: 'medium', note: 'Ceny a efekty jsou orientační (tržní ceny sadby v ČR 2024–2025, literární ΔLST 1–4 °C pro městskou vegetaci).' },
    disclaimers: ['Návrh nenahrazuje projektovout dokumentaci ani posouzení architektem / krajinářem.', 'Reálné realizace je třeba konzultovat se správou veřejné zeleně.'],
  };
}
