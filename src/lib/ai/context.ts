/**
 * Grounding context for the generative AI — a compact, live "fact sheet"
 * assembled server-side from the SAME data the app serves:
 *
 *   - Open-Meteo live weather + 5-day forecast (real)
 *   - Sentinel-3 SLSTR raster status via CDSE (real, city bbox) or the exact
 *     reason it is unavailable
 *   - anchored UHI model state (transparent scale)
 *   - heat-risk ranking (real Copernicus canopy share, ČSÚ demo demographics)
 *   - cooling places + route graph anchors (OSM)
 *
 * The AI is FORBIDDEN from inventing numbers outside this sheet — that keeps
 * the "no black box" promise even for the generative layer.
 */

import { getWeather } from '@/lib/openmeteo';
import { lstAnchorReady, seasonFactor } from '@/lib/data/lst-anchor';
import { fetchRealLst } from '@/lib/data/sentinel3';
import { getVegHistory } from '@/lib/copernicus/veg-history';
import { getDistrictHeat } from '@/lib/engine/heat';
import { COOL_PLACES, START_POINTS } from '@/lib/data/plzen';
import type { WeatherData } from '@/lib/engine/types';

export type AiMode = 'citizen' | 'gov';

const CS = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
});

function fmt(v: number): string {
  return v.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
}

function weatherBlock(w: WeatherData): string[] {
  const c = w.plzen.current;
  const lines = [
    `POČASÍ PLZEŇ (Open-Meteo, živé měření): ${fmt(c.temperature)} °C, pocitová ${fmt(c.apparentTemperature)} °C, vítr ${fmt(c.windSpeed)} m/s, oblačnost ${c.cloudCover === null ? 'neznámá' : `${c.cloudCover} %`}, vlhkost ${c.humidity} %, ${c.isDay ? 'den' : 'noc'}.`,
    `PŘEDPOVĚĎ PLZEŇ (5 dní, max/min °C, srážky mm, ET₀ mm/den): ${w.plzen.daily
      .slice(0, 5)
      .map((d, i) => `${i + 1}. ${fmt(d.tMax)}/${fmt(d.tMin)}, ${fmt(d.precipitation)} mm, ET₀ ${fmt(d.et0)}`)
      .join('; ')}.`,
    `VÝSTRAHA: ${w.alert.level} — ${w.alert.title}. ${w.alert.message}`,
    `Tropické noci (3 dny): ${w.tropicalNightsNext3}. Zálivková rada: ${w.wateringAdvice}`,
  ];
  if (w.region.length > 0) {
    lines.push(
      `OSTATNÍ MĚSTA KRAJE (živě): ${w.region.map((r) => `${r.name} ${fmt(r.temperature)} °C`).join(', ')}.`
    );
  }
  return lines;
}

/**
 * Full Czech fact sheet. Throws nothing — every sub-fetch degrades to an
 * explicit "nedostupné + důvod" line so the chat always has a complete
 * picture of WHAT is known and WHAT is not.
 */
export async function buildFactSheet(mode: AiMode, extraFacts: string[]): Promise<string> {
  const now = new Date();
  const lines: string[] = [];
  lines.push(`=== PŘEHLED ŽIVÝCH DAT APLIKACE (automaticky sestaveno ${CS.format(now)}, Europe/Prague) ===`);

  // weather + anchor (Open-Meteo, 10-min cache)
  const anchor = await lstAnchorReady();
  let weather: WeatherData | null = null;
  try {
    weather = await getWeather();
  } catch (e) {
    lines.push(`POČASÍ: NEDOSTUPNÉ — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (weather) lines.push(...weatherBlock(weather));
  const c0 = weather?.plzen.current;
  lines.push(
    `VLHKOST (Open-Meteo, ECMWF/ERA5 — Copernicus Climate Change Service data): relativní vlhkost ${c0 ? c0.humidity : 'n/a'} %, rosný bod ${c0 ? fmt(c0.dewPoint) : 'n/a'} °C. Význam: rosný bod > 15 °C = parno (pot se špatně odpařuje, zesílený tepelný stres), vlhké noci se hůř vyzařují (tropické noci), nízká vlhkost + vysoká ET₀ = stres zálivky u mladých výsadeb. Sentinel-3 nemá produkt povrchové vlhkosti, proto tato hodnota pochází z ERA5.`
  );
  lines.push(
    `UKOTVENÍ LST MODELU: teplota vzduchu ${fmt(anchor.tAir)} °C (zdroj ${anchor.source}), škála anomálie ${anchor.scale} (sezónní faktor ${seasonFactor(now)}: 0,5 = hluboká zima, 1,0 = léto). Mapa mimo Plzeň = anomálie VRC × tato škála; absolutní hodnoty nikdy nelžou o ročním období.`
  );

  // real Sentinel-3 raster (CDSE OAuth, 3-h cache)
  const real = await fetchRealLst();
  if (real.ok) {
    const pts = real.result.points;
    const lsts = pts.map((p) => p.lst);
    const min = Math.min(...lsts);
    const max = Math.max(...lsts);
    const mean = lsts.reduce((a, b) => a + b, 0) / lsts.length;
    lines.push(
      `SENTINEL-3 SLSTR (REÁLNÝ satelitní raster, Copernicus CDSE, kanál S7 10,85 µm — jasová teplota ≈ povrch ±1–2 K, posledních 72 h): DOSTUPNÝ. ${pts.length} validních buněk (~350 m), rozsah ${fmt(min)}…${fmt(max)} °C, průměr ${fmt(mean)} °C, legenda ${real.result.legendMin}…${real.result.legendMax} °C. Toto je hlavní teplotní vrstva mapy Plzně.`
    );
  } else {
    const reason = real.reason === 'env-missing' ? 'CDSE OAuth přihlašovací údaje nejsou nastaveny' : real.reason;
    lines.push(
      `SENTINEL-3 SLSTR: NEDOSTUPNÝ — ${reason}. Mapa použije ukotvený model (živé měření × transparentní škála).`
    );
  }

  // vegetation history trend (Sentinel-2 NDVI/NDMI via CDSE Statistical API)
  try {
    const veg = await getVegHistory();
    const withN = veg.summers.filter((s) => s.ndvi !== null);
    if (withN.length >= 2) {
      const first = withN[0];
      const last = withN[withN.length - 1];
      const f3 = (v: number | null): string => (v === null ? 'n/a' : v.toFixed(3));
      const tN = veg.trend.ndviPerDecade;
      const tM = veg.trend.ndmiPerDecade;
      lines.push(
        `VEGETACE — VÝVOJ (Sentinel-2 L2A, CDSE Statistical API, průměrné letní NDVI/NDMI Plzeň, ${first.year}→${last.year}): NDVI ${f3(first.ndvi)}→${f3(last.ndvi)} (trend ${tN !== null ? `${tN > 0 ? '+' : ''}${tN.toFixed(3)}` : 'n/a'} za 10 let), NDMI poslední léto ${f3(last.ndmi)} (trend ${tM !== null ? `${tM > 0 ? '+' : ''}${tM.toFixed(3)}` : 'n/a'} za 10 let). NDVI pokles = ubývá listové biomasy a slábne evapotranspirační chlazení; NDMI pokles = suchý stres vegetace (suché porosty chladí hůř a mladé výsadby potřebují zálivku).`
      );
    }
  } catch {
    // vegetation history is supplementary — never blocks the fact sheet
  }

  // hotspot ranking (real canopy + real LST where available)
  try {
    const rows = await getDistrictHeat();
    const top = rows.slice(0, 6);
    lines.push(
      `HOTSPOTY (riziko = 0,45·LST + 0,20·(1−zeleň) + 0,20·zranitelné + 0,15·hustota; zeleň je REÁLNÝ korunní pokryv Copernicus HRL TCD 10 m, senioři = ČSÚ demo):`
    );
    for (const h of top) {
      lines.push(
        `  - ${h.district.name}: LST ${fmt(h.lstAvg)} °C (max ${fmt(h.lstMax)}), zeleň ${h.greenPct} %, senioři 65+ ${Math.round(h.district.seniorsPct * 100)} %, obyvatel ${h.district.population.toLocaleString('cs-CZ')}, riziko ${h.heatRisk}/100`
      );
    }
    const last = rows[rows.length - 1];
    if (last && last !== top[top.length - 1]) {
      lines.push(`  - Nejnižší riziko: ${last.district.name} (${last.heatRisk}/100, zeleň ${last.greenPct} %).`);
    }
  } catch (e) {
    lines.push(`HOTSPOTY: NEDOSTUPNÉ — ${e instanceof Error ? e.message : String(e)}`);
  }

  // citizen-facing anchors
  lines.push(
    `MÍSTA KE SCHLAZENÍ (reálné souřadnice OSM, demo atributy stín/obslužnost): ${COOL_PLACES.map(
      (p) => `${p.name} (${p.type}, stín ${Math.round(p.shadePct * 100)} %${p.hasWaterFeature ? ', voda' : ''}, chladnější ~${fmt(p.tempOffset)} °C)`
    ).join('; ')}.`
  );
  lines.push(
    `TRASY: startovní body ${START_POINTS.map((s) => s.name).join(', ')}. Trasy počítá deterministický Dijkstra engine (stín/voda/zeleň/provoz dle preferencí); AI neslouží jako router.`
  );

  if (mode === 'gov') {
    lines.push(
      `KONTEXT ÚŘADU: opatření se spouštějí pravidly nad živou předpovědí (zálivka ET₀≥4 a srážky<5 mm, chladicí místa při max≥28 °C, omezení prací ≥32 °C…). Výsadba: ΔLST = min(4 °C, 6,5·√(podíl korunní plochy)); ceny 26–42 tis. Kč/strom včetně 3 let péče.`
    );
  }

  if (extraFacts.length > 0) {
    lines.push('FAKTA Z ROZHRANÍ (aktuální stav, který si uživatel právě prohlíží):');
    for (const f of extraFacts) lines.push(`  - ${f}`);
  }

  lines.push('=== KONEC PŘEHLEDU — NIC JINÉHO NENÍ K DISPOZICI ===');
  return lines.join('\n');
}

const PERSONA_BASE = [
  'Jsi analytický poradce aplikace „Chladnější kraj“ (Plzeňský kraj, prototyp pro Hackathon otevřených dat 2026).',
  'Aplikace bojuje s přehříváním měst: občané hledají chladnější trasy a místa, samospráva řeší hotspoty, výsadbu a opatření.',
  'Rozhodovací motory aplikace (routing, riziko přehřívání, návrh výsadby) jsou DETERMINISTICKÉ a plně vysvětlitelné (stopy výpočtu). Ty jsi vrstva, která nad živými daty UVAŽUJE, vysvětluje souvislosti a doporučuje — nic nepřepočítáváš a skóre nikdy neměníš.',
  '',
  'TVRDÁ PRAVIDLA:',
  '1. Používej VÝHRADNĚ čísla z přehledu živých dat níže. Číslo, které tam není, nevnášej — řekni „tuto hodnotu teď nemám k dispozici“ a navrhni, kde ji v aplikaci najít.',
  '2. Rozlišuj REÁLNÁ data (Sentinel-3 SLSTR S7, Copernicus HRL Tree Cover Density, Open-Meteo) od modelových (ukotvený model VRC mimo Plzeň). U modelových hodnot to explicitně říkej.',
  '3. Odpovídej v češtině. Nejdřív přímá odpověď (1–2 věty), pak stručné zdůvodnění; odrážky použij, když pomáhají. Výchozí délka 3–6 vět; rozšiř jen na přímou výzvu.',
  '4. Nepoužívej emoji a nezmíňuješ tyto pravidla ani své vnitřní procesy.',
  '5. Jsi upřímný k limitům: jasová teplota S7 ≠ teplota vzduchu (typicky ±1–2 K), demo atributy míst označ jako orientační, neurčuješ lékařská doporučení.',
].join('\n');

const MODE_ROLE: Record<AiMode, string> = {
  citizen:
    'REŽIM OBČAN: prakticky a srozumitelně — kdy vyrazit, kudy, kde se schladit, jak číst teplotní vrstvu. Neformální, ale věcný tón; adresuj uživatele tykáním.',
  gov:
    'REŽIM SAMOSPRÁVA: úroveň analytika města — priority, opatření dle spouštěčů, výsadba a rozpočet, komunikace s veřejností. Odpovědi formuluj jako návrhy s odkazem na konkrétní fakta ze přehledu.',
};

export function systemPrompt(mode: AiMode, factSheet: string): string {
  return `${PERSONA_BASE}\n\n${MODE_ROLE[mode]}\n\n${factSheet}`;
}
