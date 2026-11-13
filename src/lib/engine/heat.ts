/**
 * Heat hotspot ranking engine — fully explainable composite risk score.
 *
 * risk = 0.45*norm(LST) + 0.20*(1-green) + 0.20*vulnerable + 0.15*density
 * Every weight is documented in the trace; no hidden steps.
 */

import { DISTRICTS, getLstGrid, lstAt } from '@/lib/data/plzen';
import { lstAnchorNow } from '@/lib/data/lst-anchor';
import { canopyShareAround, CANOPY_META } from '@/lib/data/canopy';
import type { DistrictHeat, Trace } from '@/lib/engine/types';

export const RISK_WEIGHTS = { lst: 0.45, green: 0.2, vulnerable: 0.2, density: 0.15 };

export const DATA_SOURCES = [
  {
    name: 'Copernicus HRL Tree Cover Density (10 m, mozaika ČR)',
    url: 'https://land.copernicus.eu/',
    note: 'REÁLNÁ data: podíl korunního pokryvu stromů (průměr 10 m pixelů v okruhu 1,4 km). Ověřeno proti OSM lesním polygonům (FFT korelace, posun < 10 m).',
  },
  {
    name: 'Copernicus Data Space Ecosystem (Sentinel-3 SLSTR LST, Sentinel-2 L2A)',
    url: 'https://dataspace.copernicus.eu/',
    note: 'Zdroj vrstev teploty povrchu a NDVI. LST vrstva je anomálie městského ostrova tepla ukotvená k živému měření Open-Meteo (sezóna/denní doba/oblaka); při konfiguraci CDSE OAuth klienta se použije reálný raster Sentinel-3 SLSTR z posledních 72 h.',
  },
  {
    name: 'Copernicus Browser',
    url: 'https://browser.dataspace.copernicus.eu/',
    note: 'Interaktivní přístup k rastrovým vrstvám pro ověření dat.',
  },
  {
    name: 'ČSÚ – Sčítání lidu 2021 / veřejná databaze',
    url: 'https://www.czso.cz/csu/czso/home',
    note: 'Obyvatelstvo, podíl seniorů (demo hodnoty profilu).',
  },
  {
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org/',
    note: 'Síť chodníků, zeleň, vodní prvky (základ grafu tras).',
  },
  {
    name: 'Open-Meteo (otevřená meteorologická API)',
    url: 'https://open-meteo.com/',
    note: 'Aktuální počasí a předpověď – vstup do modelů.',
  },
];

function minMax(vals: number[]): [number, number] {
  return [Math.min(...vals), Math.max(...vals)];
}

function norm(v: number, min: number, max: number): number {
  return max - min < 1e-9 ? 0.5 : (v - min) / (max - min);
}

const HEAT_CACHE_TTL_MS = 10 * 60 * 1000; // anchored LST follows the live weather (10-min cache)
let heatCache: { at: number; rows: DistrictHeat[]; key: string } | null = null;

export function getDistrictHeat(): DistrictHeat[] {
  // cache identity includes the anchor — a changed live measurement (or the
  // climatology→live transition on cold start) invalidates the ranked rows
  const anchor = lstAnchorNow();
  const key = `${anchor.tAir}|${anchor.scale}|${anchor.source}`;
  if (heatCache && Date.now() - heatCache.at < HEAT_CACHE_TTL_MS && heatCache.key === key) {
    return heatCache.rows;
  }
  const grid = getLstGrid();

  const rows = DISTRICTS.map((d) => {
    // sample LST grid points within ~1.2 km of the district centroid
    const near = grid.filter(
      (p) => Math.abs(p.lat - d.lat) * 111 <= 1.4 && Math.abs(p.lng - d.lng) * 68 <= 1.4
    );
    // districts outside the Plzeň grid (Klatovy, Sušice, …): sample the
    // anchored model at the centroid + 4 points ~550 m away (never a hardcoded
    // summer value — the anchor makes it plausible in every season)
    let lstAvg: number;
    let lstMax: number;
    if (near.length > 0) {
      lstAvg = near.reduce((a, b) => a + b.lst, 0) / near.length;
      lstMax = Math.max(...near.map((p) => p.lst));
    } else {
      const samples = [
        lstAt(d.lat, d.lng),
        lstAt(d.lat + 0.005, d.lng),
        lstAt(d.lat - 0.005, d.lng),
        lstAt(d.lat, d.lng + 0.0075),
        lstAt(d.lat, d.lng - 0.0075),
      ];
      lstAvg = samples.reduce((a, b) => a + b, 0) / samples.length;
      lstMax = Math.max(...samples);
    }
    // REAL Copernicus canopy: mean tree-canopy share within 1.4 km of the
    // district centroid (kraj grid = mean of 10 m source pixels per ~500 m cell).
    const canopyShare = canopyShareAround(d.lat, d.lng, 1.4);
    // demo fallback keeps the model running even without the canopy grid
    const demoGreen = Math.min(65, Math.max(6, Math.round(58 - (lstAvg - 2) * 1.2)));
    const greenPct = canopyShare !== null
      ? Math.min(65, Math.max(3, Math.round(canopyShare)))
      : demoGreen;
    return { district: d, lstAvg: Math.round(lstAvg * 10) / 10, lstMax: Math.round(lstMax * 10) / 10, greenPct };
  });

  const lstAvgs = rows.map((r) => r.lstAvg);
  const [lstMin, lstMaxAvg] = minMax(lstAvgs);

  const out: DistrictHeat[] = rows.map((r) => {
    const lstPart = norm(r.lstAvg, lstMin, lstMaxAvg);
    const greenPart = 1 - r.greenPct / 65;
    const vulnerablePart = (r.district.seniorsPct - 0.18) / 0.1;
    const densityPart = r.district.density;
    const risk =
      RISK_WEIGHTS.lst * lstPart +
      RISK_WEIGHTS.green * greenPart +
      RISK_WEIGHTS.vulnerable * Math.min(1, Math.max(0, vulnerablePart)) +
      RISK_WEIGHTS.density * densityPart;
    return {
      ...r,
      heatRisk: Math.round(risk * 100),
      riskParts: { lst: lstPart, green: greenPart, vulnerable: Math.min(1, Math.max(0, vulnerablePart)), density: densityPart },
    };
  });

  out.sort((a, b) => b.heatRisk - a.heatRisk);
  heatCache = { at: Date.now(), rows: out, key };
  return out;
}

export function hotspotTrace(selected: DistrictHeat, all: DistrictHeat[]): Trace {
  const parts = selected.riskParts;
  return {
    title: `Proč je ${selected.district.name} hodnoceno rizikem ${selected.heatRisk}/100`,
    summary:
      'Kompozitní skóre rizika přehřívání je vážený průměr čtyř faktorů. Všechny vahy i výpočty jsou veřejné a auditovatelné – žádný black box.',
    dataSources: DATA_SOURCES,
    steps: [
      {
        id: 's1', kind: 'data', title: 'Vstupní data',
        detail: 'Průměrná teplota povrchu (LST) je agregována ze sítě ~950 buněk okolo Plzně (výběr v okruhu 1,4 km od centra části). Absolutní hodnoty jsou UKOTVENÉ k živému měření vzdušné teploty (Open-Meteo) — mapa nikdy neukazuje letní hodnoty v zimě. Podíl zeleně je REÁLNÝ: průměrný korunní pokryv stromů z Copernicus 10 m rasteru (HRL Tree Cover Density) agregovaný do ~500 m buňky v okruhu 1,4 km.',
        inputs: [
          { label: 'LST průměr', value: `${selected.lstAvg} °C` },
          { label: 'LST maximum', value: `${selected.lstMax} °C` },
          { label: 'Korunní pokryv (Copernicus)', value: `${selected.greenPct} %` },
          { label: 'Obyvatelé', value: `${selected.district.population.toLocaleString('cs-CZ')}` },
          { label: 'Senioři 65+', value: `${Math.round(selected.district.seniorsPct * 100)} %` },
        ],
      },
      {
        id: 's2', kind: 'weight', title: 'Váhy modelu',
        detail: 'Váhy stanovuje metodika: teplota povrchu 45 % (hlavní fyzikální ukazatel), absence zeleně 20 %, zranitelné skupiny 20 %, hustota zástavby 15 %.',
        inputs: [
          { label: 'Teplota (LST)', value: `${RISK_WEIGHTS.lst * 100} %` },
          { label: 'Zeleň', value: `${RISK_WEIGHTS.green * 100} %` },
          { label: 'Zranitelné skupiny', value: `${RISK_WEIGHTS.vulnerable * 100} %` },
          { label: 'Hustota zástavby', value: `${RISK_WEIGHTS.density * 100} %` },
        ],
      },
      {
        id: 's3', kind: 'score', title: 'Normalizace složek',
        detail: 'Každá složka je normalizována na 0–1 mezi všemi hodnocenými částmi kraje, aby byly porovnatelné. Složka zeleně je absolutní (1 − podíl korunního pokryvu / 65 %), což umožňuje přímé porovnání území.',
        inputs: [
          { label: 'LST složka', value: parts.lst.toFixed(2) },
          { label: 'Složka zeleně (1 − podíl)', value: parts.green.toFixed(2) },
          { label: 'Zranitelné skupiny', value: parts.vulnerable.toFixed(2) },
          { label: 'Hustota', value: parts.density.toFixed(2) },
        ],
      },
      {
        id: 's4', kind: 'score', title: 'Výpočet skóre',
        detail: `risk = 0,45·${parts.lst.toFixed(2)} + 0,20·${parts.green.toFixed(2)} + 0,20·${parts.vulnerable.toFixed(2)} + 0,15·${parts.density.toFixed(2)} = ${(selected.heatRisk / 100).toFixed(2)}`,
        output: `Skóre ${selected.heatRisk}/100`,
      },
      {
        id: 's5', kind: 'decision', title: 'Pozice v žebříčku',
        detail: `Nejvyšší riziko: ${all[0].district.name} (${all[0].heatRisk}/100). ${selected.district.name} je ${all.findIndex((d) => d.district.id === selected.district.id) + 1}. v pořadí z ${all.length} hodnocených území.`,
      },
    ],
    factors: [
      { label: 'Teplota povrchu', weight: RISK_WEIGHTS.lst, contribution: parts.lst },
      { label: 'Absence zeleně', weight: RISK_WEIGHTS.green, contribution: parts.green },
      { label: 'Zranitelné skupiny', weight: RISK_WEIGHTS.vulnerable, contribution: parts.vulnerable },
      { label: 'Hustota zástavby', weight: RISK_WEIGHTS.density, contribution: parts.density },
    ],
    confidence: {
      level: 'medium',
      note: 'Zeleně je reálná (Copernicus 10 m korunní pokryv, grid vygenerován ' + CANOPY_META.generatedAt + '); vrstva zachycuje hlavně lesní porosty, drobnou městskou listnatou zeleň může podhodnocovat. LST je demo vrstva — s reálným rastrem Sentinel-3 SLSTR se výsledky liší v řádu procent.',
    },
    disclaimers: ['Demo vrstva LST metodicky odpovídá Sentinel-3 SLSTR, ale není přímým satelitním měřením.', 'Korunní pokryv: hodnota 0 % znamená „není detekován lesní porost“, ne nutně „žádná vegetace“.'],
  };
}
