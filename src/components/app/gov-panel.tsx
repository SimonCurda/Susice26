'use client';

/**
 * Government mode ("Samospráva"):
 *  1) Přehled horkých míst — transparent heat-risk ranking
 *  2) Co vysázet — planting recommendations with full reasoning trace
 *  3) Opatření — rule-based measures triggered by live forecast
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BadgeCheck,
  BrainCircuit,
  Droplets,
  HelpCircle,
  Loader2,
  Sparkles,
  Sprout,
  Sun,
  TreePine,
  TriangleAlert,
  Thermometer,
  Wind,
} from 'lucide-react';
import { AREA_LABELS, CONSTRAINT_LABELS, PRIORITY_LABELS } from '@/lib/engine/planting';
import { HistoryPanel } from '@/components/app/history-panel';
import type { DistrictHeat, PlantingPrefs, PlantingResult, WeatherData } from '@/lib/engine/types';

const PRIORITY_KEYS = ['cooling', 'cost', 'biodiversity', 'fast', 'lowMaintenance', 'lowAllergen'] as const;
const CONSTRAINT_KEYS = ['heritage', 'utilities', 'narrow', 'drySoil'] as const;
const AREA_KEYS = ['street', 'square', 'park_edge', 'school', 'parking'] as const;

function riskBadge(risk: number) {
  if (risk >= 60) return <Badge className="bg-rose-600 hover:bg-rose-600">{risk}/100</Badge>;
  if (risk >= 45) return <Badge className="bg-orange-500 hover:bg-orange-500">{risk}/100</Badge>;
  if (risk >= 30) return <Badge className="bg-amber-500 hover:bg-amber-500">{risk}/100</Badge>;
  return <Badge className="bg-emerald-600 hover:bg-emerald-600">{risk}/100</Badge>;
}

export interface GovPanelProps {
  hotspots: DistrictHeat[];
  loading: boolean;
  weather: WeatherData | null;
  selectedHotspotId: string | null;
  onHotspotTrace: (id: string) => void;
  plantingHotspotId: string;
  onSetPlantingHotspot: (id: string) => void;
  plantingPrefs: PlantingPrefs;
  onSetPlantingPrefs: (p: PlantingPrefs) => void;
  onGenerate: () => void;
  plantingLoading: boolean;
  plantingResult: PlantingResult | null;
  onPlantingTrace: () => void;
  onAiSummary: () => void;
  aiLoading: boolean;
  aiText: string | null;
  aiSource: 'ai' | 'template' | null;
  aiError: string | null;
}

export function GovPanel(p: GovPanelProps) {
  const togglePriority = (k: string, v: boolean | 'indeterminate') =>
    p.onSetPlantingPrefs({ ...p.plantingPrefs, priorities: { ...p.plantingPrefs.priorities, [k]: v === true } });
  const toggleConstraint = (k: string, v: boolean | 'indeterminate') =>
    p.onSetPlantingPrefs({ ...p.plantingPrefs, constraints: { ...p.plantingPrefs.constraints, [k]: v === true } });

  const measures = p.weather ? buildMeasures(p.weather) : [];

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="overview">Hotspots</TabsTrigger>
        <TabsTrigger value="planting">Výsadby</TabsTrigger>
        <TabsTrigger value="measures">Opatření</TabsTrigger>
        <TabsTrigger value="history">Historie</TabsTrigger>
      </TabsList>

      {/* ---------- tab 1: hotspot overview ---------- */}
      <TabsContent value="overview" className="mt-3 space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Riziko přehřívání po územích</CardTitle>
            <CardDescription>
              Skóre = 45 % teplota povrchu + 20 % absence zeleně (REÁLNÝ korunní pokryv z Copernicus 10 m) + 20 % zranitelné skupiny + 15 % hustota zástavby. Klikněte na řádek pro rozklad skóre.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* plain overflow container — Radix ScrollArea's display:table
                viewport lets the 5-column table's intrinsic min-width (~514 px)
                propagate up and force horizontal page overflow on mobile */}
            <div className="max-h-[430px] overflow-y-auto rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Území</TableHead>
                    <TableHead className="text-right">LST</TableHead>
                    <TableHead className="text-right">Zeleň</TableHead>
                    <TableHead className="text-right">65+</TableHead>
                    <TableHead className="text-right">Riziko</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.loading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    p.hotspots.map((h) => (
                      <TableRow
                        key={h.district.id}
                        className={`cursor-pointer ${p.selectedHotspotId === h.district.id ? 'bg-muted/60' : 'hover:bg-muted/40'}`}
                        onClick={() => p.onHotspotTrace(h.district.id)}
                      >
                        <TableCell className="font-medium">{h.district.name}</TableCell>
                        <TableCell className="text-right font-mono">{h.lstAvg} °C</TableCell>
                        <TableCell className="text-right font-mono">{h.greenPct} %</TableCell>
                        <TableCell className="text-right font-mono">{Math.round(h.district.seniorsPct * 100)} %</TableCell>
                        <TableCell className="text-right">{riskBadge(h.heatRisk)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <p className="px-1 text-[11px] text-muted-foreground">
          Sloupec „Zeleň“ je reálný průměrný korunní pokryv stromů z Copernicus 10 m rasteru (HRL Tree Cover Density, mozaika ČR, ověřeno proti OSM). LST pro Plzeň je REÁLNÝ živý raster Sentinel-3 SLSTR (termální kanál S7, 10,85 µm, posledních 72 h, přes Copernicus Process API — legenda mapy ukazuje zdroj a počet buněk); území mimo Plzeň pokrývá ukotvený model dle živého měření Open-Meteo.
        </p>
      </TabsContent>

      {/* ---------- tab 2: planting ---------- */}
      <TabsContent value="planting" className="mt-3 space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Parametry návrhu</CardTitle>
            <CardDescription>Všechny volby se promítnou do viditelných vah a filtrů v doporučení.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Území (hotspot)</Label>
              <Select value={p.plantingHotspotId} onValueChange={p.onSetPlantingHotspot}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {p.hotspots.map((h) => (
                    <SelectItem key={h.district.id} value={h.district.id}>
                      {h.district.name} (riziko {h.heatRisk})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center justify-between">
                Rozpočet
                <span className="font-mono text-sm">{p.plantingPrefs.budgetCzk.toLocaleString('cs-CZ')} Kč</span>
              </Label>
              <Slider
                value={[p.plantingPrefs.budgetCzk]}
                min={200000}
                max={3000000}
                step={100000}
                onValueChange={(v) => p.onSetPlantingPrefs({ ...p.plantingPrefs, budgetCzk: v[0] })}
                aria-label="Rozpočet"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Typ prostoru</Label>
              <Select value={p.plantingPrefs.areaType} onValueChange={(v) => p.onSetPlantingPrefs({ ...p.plantingPrefs, areaType: v as PlantingPrefs['areaType'] })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AREA_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>{AREA_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Priority</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {PRIORITY_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <Checkbox id={`pri-${k}`} checked={p.plantingPrefs.priorities[k] ?? false} onCheckedChange={(v) => togglePriority(k, v)} />
                    <Label htmlFor={`pri-${k}`} className="text-sm font-normal cursor-pointer">{PRIORITY_LABELS[k]}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Omezení (záporné volby)</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CONSTRAINT_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <Checkbox id={`con-${k}`} checked={p.plantingPrefs.constraints[k] ?? false} onCheckedChange={(v) => toggleConstraint(k, v)} />
                    <Label htmlFor={`con-${k}`} className="text-sm font-normal cursor-pointer">{CONSTRAINT_LABELS[k]}</Label>
                  </div>
                ))}
              </div>
            </div>
            <Button className="w-full" onClick={p.onGenerate} disabled={p.loading || p.plantingLoading}>
              {p.plantingLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
              Vygenerovat návrh výsadby
            </Button>
          </CardContent>
        </Card>

        {p.plantingResult ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Návrh: {p.plantingResult.hotspot.district.name}</CardTitle>
              <CardDescription>Výstupy jsou orientační — vše lze zkontrolovat ve stopě výpočtu.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-bold text-emerald-700">{p.plantingResult.totalTrees}</div>
                  <div className="text-[11px] text-muted-foreground">stromů</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-bold text-emerald-700">{p.plantingResult.expectedDlst} °C</div>
                  <div className="text-[11px] text-muted-foreground">pokles LST (max.)</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-bold">{(p.plantingResult.expectedCanopyM2 / 1000).toFixed(1)}k m²</div>
                  <div className="text-[11px] text-muted-foreground">nový stín</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-lg font-bold">{(p.plantingResult.totalCostCzk / 1e6).toFixed(2)} mil.</div>
                  <div className="text-[11px] text-muted-foreground">Kč celkem</div>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Druh</TableHead>
                    <TableHead className="text-right">ks</TableHead>
                    <TableHead className="text-right">Cena</TableHead>
                    <TableHead className="hidden sm:table-cell">Proč</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.plantingResult.species.map((s) => (
                    <TableRow key={s.speciesId}>
                      <TableCell className="font-medium">
                        {s.nameCs}
                        <span className="block text-[11px] italic text-muted-foreground">{s.nameLat}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{s.count}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{s.totalCostCzk.toLocaleString('cs-CZ')} Kč</TableCell>
                      <TableCell className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:table-cell" title={s.why}>{s.why}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Doprovodné přínosy</Label>
                <ul className="space-y-1">
                  {p.plantingResult.coBenefits.map((b, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span><b>{b.label}:</b> {b.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Doporučené doprovodné prvky</Label>
                <ul className="space-y-1">
                  {p.plantingResult.companionMeasures.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <Droplets className="h-3.5 w-3.5 shrink-0 text-teal-600" />
                      <span><b>{m.name}</b> — {m.detail} <span className="text-muted-foreground">({m.unitCost})</span></span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="flex-1" onClick={p.onPlantingTrace}>
                  <HelpCircle className="mr-2 h-4 w-4" /> Proč tento návrh?
                </Button>
                <Button className="flex-1" onClick={p.onAiSummary} disabled={p.aiLoading}>
                  {p.aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  AI shrnutí (doplňkové)
                </Button>
              </div>
              {p.aiText ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-950">
                  <div className="mb-1 flex items-center gap-1 font-semibold">
                    <BrainCircuit className="h-3.5 w-3.5" /> Generativní shrnutí
                    <Badge variant="outline" className="ml-1 text-[10px]">{p.aiSource === 'ai' ? 'LLM' : 'šablona (fallback)'}</Badge>
                  </div>
                  {p.aiText}
                  <p className="mt-1 text-[10px] text-emerald-800/80">
                    Pozn.: rozhodování modelu je deterministické a auditovatelné; generativní AI pouze popisuje již spočítaný výsledek.
                  </p>
                  {p.aiError ? (
                    <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-[10px] leading-relaxed text-amber-900">
                      Proč není LLM shrnutí: {p.aiError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </TabsContent>

      {/* ---------- tab 3: measures ---------- */}
      <TabsContent value="measures" className="mt-3 space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Předpověď Plzeň (Open-Meteo, živě)</CardTitle>
            <CardDescription>5denní výhled — vstup pro pravidla opatření níže.</CardDescription>
          </CardHeader>
          <CardContent>
            {p.weather ? (
              <div className="grid grid-cols-5 gap-2">
                {p.weather.plzen.daily.slice(0, 5).map((d, i) => (
                  <div key={d.date} className="rounded-lg border p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{i === 0 ? 'dnes' : new Date(d.date).toLocaleDateString('cs-CZ', { weekday: 'short' })}</div>
                    <div className="text-sm font-bold">{d.tMax}°</div>
                    <div className="text-[10px] text-muted-foreground">{d.tMin}° · {d.precipitation} mm</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Doporučená opatření a jejich spouštěče</CardTitle>
            <CardDescription>Pravidla vidíte přímo u každého opatření — žádné skryté logiky.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {measures.length === 0 ? (
              <p className="text-sm text-muted-foreground">Načítá se počasí…</p>
            ) : (
              measures.map((m, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-md border p-2.5 ${m.active ? '' : 'opacity-60'}`}>
                  <m.icon className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.name}</span>
                      {m.active ? <Badge className="bg-orange-500 hover:bg-orange-500">aktivní</Badge> : <Badge variant="secondary">neaktivní</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.detail}</p>
                    <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">spouštěč: {m.trigger}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ---------- tab 4: copernicus history ---------- */}
      <TabsContent value="history" className="mt-3">
        <HistoryPanel />
      </TabsContent>
    </Tabs>
  );
}

interface Measure {
  name: string;
  detail: string;
  trigger: string;
  active: boolean;
  icon: typeof Sun;
}

function buildMeasures(w: WeatherData): Measure[] {
  const tMaxToday = w.plzen.daily[0]?.tMax ?? 20;
  const rain3 = w.plzen.daily.slice(0, 3).reduce((a, d) => a + d.precipitation, 0);
  const et0 = w.plzen.daily[0]?.et0 ?? 2;

  return [
    {
      name: 'Zálivka mladých výsadeb',
      detail: w.wateringAdvice,
      trigger: `ET₀ ≥ 4 mm/den a srážky 3 dny < 5 mm (nyní ET₀ ${et0}, srážky ${rain3.toFixed(1)} mm)`,
      active: et0 >= 4 && rain3 < 5,
      icon: Droplets,
    },
    {
      name: 'Otevřít chladicí místa / stínované stanoviště',
      detail: 'Vyčlenit prostory se stínem a vodou pro seniory a bezdomácké klienty v době 11–17 h.',
      trigger: 'denní max ≥ 28 °C',
      active: tMaxToday >= 28,
      icon: Sun,
    },
    {
      name: 'Omezit venkovní pracovní aktivity městských firem',
      detail: 'Posun prací v přímém slunci mimo 11–17 h, povinné pitné režimy.',
      trigger: 'denní max ≥ 32 °C',
      active: tMaxToday >= 32,
      icon: TriangleAlert,
    },
    {
      name: 'Zavlažování / misting na náměstích',
      detail: 'Dočasná mlhová zamlžování a vodní zrcadla na klíčových veřejných prostranstvích.',
      trigger: 'denní max ≥ 30 °C a vítr < 4 m/s',
      active: tMaxToday >= 30 && w.plzen.current.windSpeed < 4,
      icon: Wind,
    },
    {
      name: 'Kontrolní volání registrovaným seniorům',
      detail: 'Aktivovat sociální služby pro telefonické kontroly ohrožených osob.',
      trigger: 'tropická noc (min ≥ 20 °C) ve výhledu',
      active: w.tropicalNightsNext3 > 0,
      icon: Thermometer,
    },
    {
      name: 'Připravit výsadbu ještě letos (sezóna výsadeb)',
      detail: `Náš engine doporučuje pro nejteplejší území plán výsadby — viz záložka „Co vysázet“ a žebříček „Hotspots“.`,
      trigger: 'LST hotspot ≥ 31 °C',
      active: true,
      icon: TreePine,
    },
  ];
}
