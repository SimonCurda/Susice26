'use client';

/**
 * Live weather strip: heat alert banner (Open-Meteo) + forecast/region dialog.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CalendarDays, Loader2, MapPin, Thermometer, TriangleAlert } from 'lucide-react';
import type { WeatherData } from '@/lib/engine/types';

const LEVEL_STYLE: Record<WeatherData['alert']['level'], { cls: string; icon: typeof Thermometer }> = {
  ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CalendarDays },
  watch: { cls: 'border-amber-300 bg-amber-50 text-amber-900', icon: Thermometer },
  warning: { cls: 'border-orange-300 bg-orange-50 text-orange-900', icon: TriangleAlert },
  extreme: { cls: 'border-rose-300 bg-rose-50 text-rose-900', icon: TriangleAlert },
};

export function WeatherBar({ weather, error }: { weather: WeatherData | null; error: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-3">
      {!weather && !error ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Načítám aktuální počasí (Open-Meteo)…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Počasí se nepodařilo načíst ({error}) — ostatní funkce zůstávají aktivní.
        </div>
      ) : weather ? (
        <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${LEVEL_STYLE[weather.alert.level].cls}`}>
          {(() => {
            const Icon = LEVEL_STYLE[weather.alert.level].icon;
            return <Icon className="h-4 w-4 shrink-0" />;
          })()}
          <span className="font-semibold">{weather.alert.title}</span>
          <span className="hidden sm:inline text-xs opacity-90">{weather.alert.message}</span>
          <Badge variant="outline" className="bg-background/60">
            <Thermometer className="mr-1 h-3 w-3" /> Plzeň {weather.plzen.current.temperature} °C (pocit {weather.plzen.current.apparentTemperature} °C)
          </Badge>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="ml-auto h-7 border-current/30 bg-background/60">
                <CalendarDays className="mr-1 h-3.5 w-3.5" /> Předpověď a regiony
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Předpověď Plzeň — 5 dní</DialogTitle>
                <DialogDescription>
                  Data: Open-Meteo (otevřená API, CC-BY). Zdroj živých hodnot pro celou aplikaci.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-5 gap-2">
                {weather.plzen.daily.map((d, i) => (
                  <div key={d.date} className="rounded-lg border p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">{i === 0 ? 'dnes' : new Date(d.date).toLocaleDateString('cs-CZ', { weekday: 'short' })}</div>
                    <div className="text-base font-bold">{d.tMax}°</div>
                    <div className="text-[11px] text-muted-foreground">{d.tMin}°</div>
                    <div className="text-[10px] text-muted-foreground">{d.precipitation} mm · ET₀ {d.et0}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Srovnání regionu teď</div>
                <ul className="divide-y rounded-lg border text-sm">
                  {weather.region.map((r) => (
                    <li key={r.name} className="flex items-center gap-2 px-3 py-1.5">
                      <MapPin className="h-3.5 w-3.5 text-teal-600" />
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-auto font-mono text-xs">{r.temperature} °C</span>
                      <span className="hidden sm:inline text-[11px] text-muted-foreground">{r.altitudeNote}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{weather.wateringAdvice}</p>
              <p className="text-[11px] text-muted-foreground">Tropické noci ve 3denním výhledu: {weather.tropicalNightsNext3}</p>
            </DialogContent>
          </Dialog>
        </div>
      ) : null}
    </div>
  );
}
