'use client';

/**
 * Citizen mode: "Kudy projít v horku" — cool route finder.
 * User preferences: positive options AND negatives, plus a cool-vs-fast slider.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Coffee, Droplets, Footprints, HelpCircle, Loader2, LocateFixed, Thermometer, Timer, Trees, Waves } from 'lucide-react';
import { COOL_PLACES, START_POINTS } from '@/lib/data/plzen';
import { NEGATIVE_LABELS, OPTION_LABELS } from '@/lib/engine/routing';
import type { RouteProfilePrefs, RouteResult } from '@/lib/engine/types';

const OPTION_KEYS = ['shade', 'water', 'benches', 'fountain', 'quiet', 'green', 'transit'] as const;
const NEGATIVE_KEYS = ['traffic', 'slope', 'sun', 'construction', 'crowd'] as const;

export interface CitizenPanelProps {
  ambientTemp: number | null;
  startId: string;
  destId: string;
  onSetStart: (id: string) => void;
  onSetDest: (id: string) => void;
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

export function CitizenPanel(p: CitizenPanelProps) {
  const toggleOption = (k: string, v: boolean | 'indeterminate') => p.onSetPrefs({ ...p.prefs, options: { ...p.prefs.options, [k]: v === true } });
  const toggleNegative = (k: string, v: boolean | 'indeterminate') => p.onSetPrefs({ ...p.prefs, negatives: { ...p.prefs.negatives, [k]: v === true } });

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-1 pr-3">
        {/* route definition */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kudy projít v horku?</CardTitle>
            <CardDescription>Vyberte start a cíl — najdeme chladnější cestu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="start">Odkud</Label>
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
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dest">Kam (místo k odpočinku)</Label>
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
              {(() => {
                const dest = COOL_PLACES.find((c) => c.id === p.destId);
                return dest ? (
                  <p className="text-xs text-muted-foreground">
                    {dest.description} <Badge variant="secondary" className="ml-1">o {dest.tempOffset.toFixed(1)} °C chladnější</Badge>
                  </p>
                ) : null;
              })()}
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
