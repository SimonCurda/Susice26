'use client';

/**
 * Citizen mode: "Kudy projít v horku" — cool route finder.
 * User preferences: positive options AND negatives, plus a cool-vs-fast slider.
 *
 * Endpoints: preset list OR an EXACT point — found by free OSM geocoding
 * (/api/geocode) or picked by clicking the map. Exact points flow to the
 * engine as {lat,lng,name} and are connected to the walking graph
 * transparently (see routing.ts + trace).
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Coffee,
  Crosshair,
  Droplets,
  Footprints,
  HelpCircle,
  Loader2,
  LocateFixed,
  MapPin,
  MousePointerClick,
  Search,
  Thermometer,
  Timer,
  Trees,
  Waves,
  X,
} from 'lucide-react';
import { COOL_PLACES, START_POINTS } from '@/lib/data/plzen';
import { NEGATIVE_LABELS, OPTION_LABELS } from '@/lib/engine/routing';
import { describeError } from '@/lib/errors';
import type { RouteProfilePrefs, RouteResult } from '@/lib/engine/types';

const OPTION_KEYS = ['shade', 'water', 'benches', 'fountain', 'quiet', 'green', 'transit'] as const;
const NEGATIVE_KEYS = ['traffic', 'slope', 'sun', 'construction', 'crowd'] as const;

/** An exact geographic point chosen by the user (search result, map click or geolocation). */
export interface CoordPoint {
  lat: number;
  lng: number;
  name: string;
}

interface GeocodeResult {
  label: string;
  detail: string;
  lat: number;
  lng: number;
}

export type PickMode = 'start' | 'dest' | null;

export interface CitizenPanelProps {
  ambientTemp: number | null;
  startId: string;
  destId: string;
  onSetStart: (id: string) => void;
  onSetDest: (id: string) => void;
  startCoord: CoordPoint | null;
  destCoord: CoordPoint | null;
  onSetStartCoord: (p: CoordPoint | null) => void;
  onSetDestCoord: (p: CoordPoint | null) => void;
  pickMode: PickMode;
  onSetPickMode: (m: PickMode) => void;
  prefs: RouteProfilePrefs;
  onSetPrefs: (p: RouteProfilePrefs) => void;
  onFind: () => void;
  loading: boolean;
  routes: RouteResult[];
  activeIdx: number;
  onSetActive: (idx: number) => void;
  onRouteTrace: (idx: number) => void;
  onOverallTrace: () => void;
  onGeolocate: () => void;
  geoBusy: boolean;
}

/**
 * Exact-point picker: OSM geocode search + map click. Fully local state for
 * the query; the selected point lives in the parent (page.tsx).
 */
function ExactPointPicker(p: {
  role: 'start' | 'dest';
  point: CoordPoint | null;
  onSet: (pt: CoordPoint | null) => void;
  pickActive: boolean;
  onTogglePick: () => void;
  onCancelPick: () => void;
  geoBusy?: boolean;
  onGeolocate?: () => void;
  onSwitchToList: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const query = q.trim();
    if (query.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const j = (await res.json().catch(() => null)) as
        | { results?: GeocodeResult[]; count?: number; detail?: string; error?: string }
        | null;
      if (!res.ok) throw new Error(j?.detail ?? j?.error ?? `HTTP ${res.status} ${res.statusText}`);
      setResults(j?.results ?? []);
      if ((j?.count ?? 0) === 0) setError('Nic nenalezeno — zkuste jinou formulaci (ulice a číslo, název místa).');
    } catch (e) {
      setError(describeError(e));
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {p.point ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" title={p.point.name}>{p.point.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {p.point.lat.toFixed(5)}, {p.point.lng.toFixed(5)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => p.onSet(null)}
              aria-label="Vymazat přesný bod"
              title="Vymazat přesný bod"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Hledat adresu nebo místo v Plzni…"
            aria-label={`Přesný ${p.role === 'start' ? 'start' : 'cíl'} — hledání adresy`}
            className="h-10 flex-1 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => void search()}
            disabled={busy || q.trim().length < 2}
            aria-label="Hledat adresu"
            title="Hledat adresu (OpenStreetMap, zdarma)"
            className="h-10 w-10 shrink-0"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
          <Button
            variant={p.pickActive ? 'default' : 'outline'}
            size="icon"
            onClick={p.onTogglePick}
            aria-label="Vybrat kliknutím na mapě"
            aria-pressed={p.pickActive}
            title="Vybrat kliknutím na mapě"
            className={`h-10 w-10 shrink-0 ${p.pickActive ? 'bg-emerald-700 hover:bg-emerald-800' : ''}`}
          >
            {p.pickActive ? <Crosshair className="h-4 w-4 animate-pulse" /> : <MousePointerClick className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {results && !p.point ? (
        <div className="max-h-44 divide-y overflow-y-auto rounded-md border">
          {results.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">Žádné výsledky v okrese Plzeň-město.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.lat},${r.lng},${i}`}
                className="w-full px-2.5 py-1.5 text-left transition-colors hover:bg-emerald-50"
                onClick={() => {
                  p.onSet({ lat: r.lat, lng: r.lng, name: r.label });
                  p.onCancelPick();
                  setResults(null);
                  setQ('');
                }}
              >
                <div className="truncate text-xs font-medium">{r.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">{r.detail}</div>
              </button>
            ))
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-[11px] leading-relaxed text-destructive" role="alert">{error}</p>
      ) : null}

      {p.pickActive ? (
        <p className="text-[11px] font-medium text-emerald-700">
          Klikněte do mapy vpravo — {p.role === 'start' ? 'start' : 'cíl'} se nastaví přesně na zvolené místo. (Esc zruší)
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!p.point ? (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={p.onSwitchToList}
          >
            Vybrat ze seznamu
          </button>
        ) : null}
        {p.role === 'start' && p.onGeolocate ? (
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            onClick={p.onGeolocate}
            disabled={p.geoBusy}
            title="Použít mou aktuální polohu jako přesný start"
          >
            {p.geoBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />}
            Použít mou polohu
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CitizenPanel(p: CitizenPanelProps) {
  const toggleOption = (k: string, v: boolean | 'indeterminate') => p.onSetPrefs({ ...p.prefs, options: { ...p.prefs.options, [k]: v === true } });
  const toggleNegative = (k: string, v: boolean | 'indeterminate') => p.onSetPrefs({ ...p.prefs, negatives: { ...p.prefs.negatives, [k]: v === true } });

  // per-field exact UI: auto-activated when a coord is set, can be toggled manually
  const [startExactUi, setStartExactUi] = useState(false);
  const [destExactUi, setDestExactUi] = useState(false);
  const startExact = startExactUi || p.startCoord !== null;
  const destExact = destExactUi || p.destCoord !== null;

  const togglePick = (role: 'start' | 'dest') => {
    p.onSetPickMode(p.pickMode === role ? null : role);
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-1 pr-3">
        {/* route definition */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kudy projít v horku?</CardTitle>
            <CardDescription>
              Vyberte start a cíl ze seznamu, nebo zadejte PŘESNÉ body — hledáním adresy, kliknutím do mapy nebo
              geolokací. Najdeme chladnější cestu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="start">Odkud</Label>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {startExact ? 'přesný bod' : 'ze seznamu'}
                </span>
              </div>
              {startExact ? (
                <ExactPointPicker
                  role="start"
                  point={p.startCoord}
                  onSet={(pt) => {
                    p.onSetStartCoord(pt);
                    if (!pt) setStartExactUi(false);
                  }}
                  pickActive={p.pickMode === 'start'}
                  onTogglePick={() => togglePick('start')}
                  onCancelPick={() => p.onSetPickMode(null)}
                  geoBusy={p.geoBusy}
                  onGeolocate={p.onGeolocate}
                  onSwitchToList={() => {
                    setStartExactUi(false);
                    p.onSetStartCoord(null);
                    p.onSetPickMode(null);
                  }}
                />
              ) : (
                <div className="flex gap-2">
                  <Select value={p.startId} onValueChange={p.onSetStart}>
                    <SelectTrigger id="start" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {START_POINTS.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={p.onGeolocate} disabled={p.geoBusy} aria-label="Použít mou polohu" title="Použít mou polohu">
                    {p.geoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      setStartExactUi(true);
                      p.onSetPickMode('start');
                    }}
                    aria-label="Vybrat přesný start na mapě"
                    title="Vybrat přesný start (hledání nebo kliknutí do mapy)"
                  >
                    <MousePointerClick className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="dest">Kam (místo k odpočinku)</Label>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {destExact ? 'přesný bod' : 'ze seznamu'}
                </span>
              </div>
              {destExact ? (
                <ExactPointPicker
                  role="dest"
                  point={p.destCoord}
                  onSet={(pt) => {
                    p.onSetDestCoord(pt);
                    if (!pt) setDestExactUi(false);
                  }}
                  pickActive={p.pickMode === 'dest'}
                  onTogglePick={() => togglePick('dest')}
                  onCancelPick={() => p.onSetPickMode(null)}
                  onSwitchToList={() => {
                    setDestExactUi(false);
                    p.onSetDestCoord(null);
                    p.onSetPickMode(null);
                  }}
                />
              ) : (
                <div className="space-y-1.5">
                  <div className="flex gap-2">
                    <Select value={p.destId} onValueChange={p.onSetDest}>
                      <SelectTrigger id="dest" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COOL_PLACES.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        setDestExactUi(true);
                        p.onSetPickMode('dest');
                      }}
                      aria-label="Vybrat přesný cíl na mapě"
                      title="Vybrat přesný cíl (hledání nebo kliknutí do mapy)"
                    >
                      <MousePointerClick className="h-4 w-4" />
                    </Button>
                  </div>
                  {(() => {
                    const dest = COOL_PLACES.find((c) => c.id === p.destId);
                    return dest ? (
                      <p className="text-xs text-muted-foreground">
                        {dest.description} <Badge variant="secondary" className="ml-1">o {dest.tempOffset.toFixed(1)} °C chladnější</Badge>
                      </p>
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* preferences */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Co preferuji</CardTitle>
            <CardDescription>Volby zvyšují váhu vhodných úseků.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {OPTION_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <Checkbox id={`opt-${k}`} checked={p.prefs.options[k] ?? false} onCheckedChange={(v) => toggleOption(k, v)} />
                <Label htmlFor={`opt-${k}`} className="text-sm font-normal cursor-pointer">{OPTION_LABELS[k]}</Label>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Čemu se vyhnout</CardTitle>
            <CardDescription>Záporné volby zvýhodňují úseky, které vás netrápí.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {NEGATIVE_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <Checkbox id={`neg-${k}`} checked={p.prefs.negatives[k] ?? false} onCheckedChange={(v) => toggleNegative(k, v)} />
                <Label htmlFor={`neg-${k}`} className="text-sm font-normal cursor-pointer">{NEGATIVE_LABELS[k]}</Label>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              Chlad vs. rychlost
              <Badge variant="secondary">{p.prefs.coolVsFast}/100</Badge>
            </CardTitle>
            <CardDescription>Kolik času ochotně přidáte za stín a chlad?</CardDescription>
          </CardHeader>
          <CardContent>
            <Slider
              value={[p.prefs.coolVsFast]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => p.onSetPrefs({ ...p.prefs, coolVsFast: v[0] })}
              aria-label="Chlad versus rychlost"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>chci být rychle tam</span>
              <span>chci maximální chlad</span>
            </div>
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={p.onFind} disabled={p.loading}>
          {p.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Footprints className="mr-2 h-4 w-4" />}
          Najít chladnou cestu
        </Button>

        {/* results */}
        {p.routes.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Navržené trasy {p.ambientTemp !== null ? `(pocit ${p.ambientTemp.toFixed(1)} °C ve stínové korekci)` : ''}</h3>
              <Button variant="ghost" size="sm" onClick={p.onOverallTrace}>
                <HelpCircle className="mr-1 h-3.5 w-3.5" /> Jak to funguje
              </Button>
            </div>
            {(() => {
              const ep = p.routes[0]?.endpoints;
              return ep && (ep.start.kind === 'exact' || ep.dest.kind === 'exact') ? (
                <p className="px-1 text-[11px] leading-relaxed text-emerald-800">
                  <MapPin className="mr-1 inline h-3 w-3" />
                  Trasa z přesného bodu „{ep.start.name}" do „{ep.dest.name}". Připojení k chodcovskému grafu:
                  {ep.start.snapDistanceM !== null ? ` start ${ep.start.snapDistanceM} m,` : ''}
                  {ep.dest.snapDistanceM !== null ? ` cíl ${ep.dest.snapDistanceM} m.` : ' viz stopa výpočtu.'}
                </p>
              ) : null;
            })()}
            {p.routes.map((r, i) => (
              <Card
                key={r.profileId}
                className={`cursor-pointer border-l-4 transition-shadow ${i === p.activeIdx ? 'shadow-md' : 'opacity-90 hover:opacity-100'}`}
                style={{ borderLeftColor: r.color }}
                onClick={() => p.onSetActive(i)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color: r.color }}>
                      {r.profileName}
                    </span>
                    <Badge variant={i === p.activeIdx ? 'default' : 'secondary'}>chlad {r.coolingScore}/100</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> {r.minutes} min · {r.distanceM} m</span>
                    <span className="flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> pocit {r.avgTempEst} °C</span>
                    <span className="flex items-center gap-1"><Trees className="h-3.5 w-3.5" /> stín {r.shadePct} %</span>
                    <span className="flex items-center gap-1"><Waves className="h-3.5 w-3.5" /> voda {r.waterPoints}×</span>
                    <span className="flex items-center gap-1"><Coffee className="h-3.5 w-3.5" /> odpočinek {r.restPoints}×</span>
                    <span className="flex items-center gap-1"><Footprints className="h-3.5 w-3.5" /> {r.geometry.length - 1} úseků</span>
                  </div>
                  <Separator />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onRouteTrace(i);
                    }}
                  >
                    <HelpCircle className="mr-1 h-3.5 w-3.5" /> Proč tahle trasa?
                  </Button>
                </CardContent>
              </Card>
            ))}
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              Trasy jsou orientační (prototyp). Vždy zvažte aktuální dopravní situaci. Šedá přerušovaná = nejrychlejší varianta pro srovnání.
            </p>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
