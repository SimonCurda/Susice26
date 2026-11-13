'use client';

/**
 * Chladnější kraj — Plzeňský kraj
 * Open data + Copernicus methodology + explainable AI against urban overheating.
 * Two modes: Citizen (cool routes) & Government (hotspots, planting, measures).
 */

import { useCallback, useEffect, useState } from 'react';
import nextDynamic from 'next/dynamic';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CitizenPanel } from '@/components/app/citizen-panel';
import { GovPanel } from '@/components/app/gov-panel';
import { MethodologyDialog } from '@/components/app/methodology-dialog';
import { TracePanel } from '@/components/app/trace-panel';
import { WeatherBar } from '@/components/app/weather-bar';
import { toast } from '@/hooks/use-toast';
import { describeError } from '@/lib/errors';
import { Landmark, Loader2, MapPin, Sprout, Users } from 'lucide-react';
import { nearestStartPoint } from '@/lib/engine/routing';
import type { DistrictHeat, PlantingPrefs, PlantingResult, RouteProfilePrefs, RouteResult, Trace, WeatherData } from '@/lib/engine/types';

const MapView = nextDynamic(() => import('@/components/app/map-view'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-xl border bg-muted">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

type Mode = 'citizen' | 'gov';

/** Extract the exact error message from an API error payload. */
function apiDetail(j: unknown, res: Response): string {
  if (j && typeof j === 'object') {
    const o = j as { detail?: string; error?: string; scope?: string };
    const msg = o.detail ?? o.error;
    if (msg) return o.scope ? `${msg} [${o.scope}]` : msg;
  }
  return `HTTP ${res.status} ${res.statusText} (bez detailu v odpovědi)`;
}

async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const DEFAULT_ROUTE_PREFS: RouteProfilePrefs = {
  coolVsFast: 55,
  options: { shade: true, water: true, benches: true },
  negatives: { traffic: true, sun: true },
};

const DEFAULT_PLANTING_PREFS: PlantingPrefs = {
  budgetCzk: 800000,
  areaType: 'street',
  priorities: { cooling: true, cost: true },
  constraints: {},
};

export default function Home() {
  const [mode, setMode] = useState<Mode>('citizen');

  // weather
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  // hotspots (government)
  const [hotspots, setHotspots] = useState<DistrictHeat[]>([]);
  const [hotspotsLoading, setHotspotsLoading] = useState(true);

  // citizen state
  const [startId, setStartId] = useState('nam_republiky');
  const [destId, setDestId] = useState('tyrs_sady');
  const [routePrefs, setRoutePrefs] = useState<RouteProfilePrefs>(DEFAULT_ROUTE_PREFS);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [routesTrace, setRoutesTrace] = useState<Trace | null>(null);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);
  const [geoBusy, setGeoBusy] = useState(false);

  // government state
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [plantingHotspotId, setPlantingHotspotId] = useState('plzen2');
  const [plantingPrefs, setPlantingPrefs] = useState<PlantingPrefs>(DEFAULT_PLANTING_PREFS);
  const [plantingResult, setPlantingResult] = useState<PlantingResult | null>(null);
  const [plantingLoading, setPlantingLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<'ai' | 'template' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // trace drawer
  const [trace, setTrace] = useState<Trace | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  // map
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null);

  const openTrace = useCallback((t: Trace) => {
    setTrace(t);
    setTraceOpen(true);
  }, []);

  // initial loads
  useEffect(() => {
    fetch('/api/weather')
      .then(async (r) => {
        const j = await readJsonSafe(r);
        if (!r.ok) throw new Error(apiDetail(j, r));
        return j as WeatherData;
      })
      .then((d: WeatherData) => setWeather(d))
      .catch((e) => setWeatherError(describeError(e)));
    fetch('/api/hotspots')
      .then(async (r) => {
        const j = await readJsonSafe(r);
        if (!r.ok) throw new Error(apiDetail(j, r));
        return j as { hotspots: DistrictHeat[] };
      })
      .then((d: { hotspots: DistrictHeat[] }) => {
        setHotspots(d.hotspots);
        const top = d.hotspots[0];
        if (top) setPlantingHotspotId((prev) => (prev === 'plzen2' ? top.district.id : prev));
      })
      .catch((e) =>
        toast({
          title: 'Nepodařilo se načíst hotspoty',
          description: describeError(e),
          variant: 'destructive',
        })
      )
      .finally(() => setHotspotsLoading(false));
  }, []);

  // citizen: find routes
  const findRoutes = useCallback(async () => {
    setRoutesLoading(true);
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startId, destId, prefs: routePrefs }),
      });
      const data = (await readJsonSafe(res)) as {
        routes?: RouteResult[];
        trace?: Trace;
        problems?: string[];
        weatherFallback?: string;
        detail?: string;
        error?: string;
        scope?: string;
      } | null;
      if (!res.ok) {
        throw new Error(apiDetail(data, res));
      }
      const found = data?.routes ?? [];
      setRoutes(found);
      setRoutesTrace(data?.trace ?? null);
      setActiveRouteIdx(0);
      const first = found[0]?.geometry[0];
      if (first) setFocus({ lat: first.lat, lng: first.lng, zoom: 13, key: Date.now() });
      if (data?.weatherFallback) {
        toast({ title: 'Počasí živě nedostupné — výpočet běží s výchozí teplotou', description: data.weatherFallback });
      }
      if (found.length === 0) {
        const why = (data?.problems ?? []).join(' ') || data?.trace?.summary || 'Zkuste jiný start nebo cíl.';
        toast({ title: 'Trasa nenalezena', description: why, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Hledání tras selhalo', description: describeError(e), variant: 'destructive' });
    } finally {
      setRoutesLoading(false);
    }
  }, [startId, destId, routePrefs]);

  const geolocate = useCallback(() => {
    if (!navigator.geolocation) {
      toast({ title: 'Geolokace není dostupná', variant: 'destructive' });
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const id = nearestStartPoint(pos.coords.latitude, pos.coords.longitude);
        setStartId(id);
        setGeoBusy(false);
        toast({ title: 'Přibližná poloha nastavena', description: 'Start trasy byl přiblížen k nejbližšímu známému bodu.' });
      },
      () => {
        setGeoBusy(false);
        toast({ title: 'Polohu se nepodařilo získat', variant: 'destructive' });
      },
      { timeout: 8000 }
    );
  }, []);

  // government: hotspot trace
  const hotspotTrace = useCallback(
    async (id: string) => {
      setSelectedHotspotId(id);
      const h = hotspots.find((x) => x.district.id === id);
      if (h) setFocus({ lat: h.district.lat, lng: h.district.lng, zoom: 13.5, key: Date.now() });
      try {
        const res = await fetch(`/api/hotspots?id=${encodeURIComponent(id)}`);
        const data = (await readJsonSafe(res)) as { trace?: Trace; detail?: string; error?: string; scope?: string } | null;
        if (!res.ok) throw new Error(apiDetail(data, res));
        if (data?.trace) openTrace(data.trace);
      } catch (e) {
        toast({ title: 'Nepodařilo se načíst stopu rizika', description: describeError(e), variant: 'destructive' });
      }
    },
    [hotspots, openTrace]
  );

  // government: planting
  const generatePlanting = useCallback(async () => {
    setPlantingLoading(true);
    setAiText(null);
    setAiSource(null);
    setAiError(null);
    try {
      const res = await fetch('/api/planting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotspotId: plantingHotspotId, prefs: plantingPrefs }),
      });
      const data = (await readJsonSafe(res)) as (PlantingResult & { detail?: string; error?: string; scope?: string }) | null;
      if (!res.ok) throw new Error(apiDetail(data, res));
      if (!data) throw new Error('Server vrátil prázdné tělo odpovědi (HTTP 200 bez JSON).');
      setPlantingResult(data);
      setFocus({ lat: data.hotspot.district.lat, lng: data.hotspot.district.lng, zoom: 14, key: Date.now() });
    } catch (e) {
      toast({ title: 'Generování návrhu selhalo', description: describeError(e), variant: 'destructive' });
    } finally {
      setPlantingLoading(false);
    }
  }, [plantingHotspotId, plantingPrefs]);

  const aiSummary = useCallback(async () => {
    if (!plantingResult) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'planting',
          title: `Návrh výsadby pro ${plantingResult.hotspot.district.name}`,
          facts: [
            `${plantingResult.totalTrees} stromů za ${plantingResult.totalCostCzk.toLocaleString('cs-CZ')} Kč`,
            `očekávaný pokles LST až ${plantingResult.expectedDlst} °C`,
            `${plantingResult.expectedCanopyM2.toLocaleString('cs-CZ')} m² nového stínu`,
            `prioritní druhy: ${plantingResult.species.map((s) => `${s.nameCs} (${s.count} ks)`).join(', ')}`,
          ],
        }),
      });
      const data = (await readJsonSafe(res)) as {
        summary?: string;
        source?: 'ai' | 'template';
        aiError?: string | null;
        detail?: string;
        error?: string;
        scope?: string;
      } | null;
      if (!res.ok) throw new Error(apiDetail(data, res));
      if (data?.summary) {
        setAiText(data.summary);
        setAiSource(data.source ?? 'template');
        if (data.aiError) {
          setAiError(data.aiError);
          toast({
            title: 'LLM nedostupné — shrnutí z deterministické šablony',
            description: data.aiError,
          });
        }
      } else {
        throw new Error('Server vrátil odpověď bez pole „summary“.');
      }
    } catch (e) {
      toast({ title: 'AI shrnutí se nepodařilo', description: describeError(e), variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  }, [plantingResult]);

  const plantingPoints = mode === 'gov' && plantingResult ? plantingResult.suggestedPoints : [];
  const shownRoutes = mode === 'citizen' ? routes : [];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* header */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
              <Sprout className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight sm:text-lg">Chladnější kraj</h1>
              <p className="text-[11px] leading-tight text-muted-foreground sm:text-xs">
                Plzeňský kraj · otevřená data · Copernicus · vysvětlitelné AI
              </p>
            </div>
          </div>
          <nav aria-label="Režim aplikace" className="ml-auto flex overflow-hidden rounded-lg border">
            <Button
              variant={mode === 'citizen' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-none"
              onClick={() => setMode('citizen')}
              aria-pressed={mode === 'citizen'}
            >
              <Users className="h-4 w-4" /> Občan
            </Button>
            <Button
              variant={mode === 'gov' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-none"
              onClick={() => setMode('gov')}
              aria-pressed={mode === 'gov'}
            >
              <Landmark className="h-4 w-4" /> Samospráva
            </Button>
          </nav>
          <Badge variant="secondary" className="hidden lg:inline-flex">
            Hackathon otevřených dat Plzeňského kraje 2026
          </Badge>
        </div>
      </header>

      {/* main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <WeatherBar weather={weather} error={weatherError} />

        <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
          {/* left: mode panel */}
          <div className="order-2 lg:order-1">
            {mode === 'citizen' ? (
              <CitizenPanel
                ambientTemp={weather?.plzen.current.temperature ?? null}
                startId={startId}
                destId={destId}
                onSetStart={setStartId}
                onSetDest={setDestId}
                prefs={routePrefs}
                onSetPrefs={setRoutePrefs}
                onFind={findRoutes}
                loading={routesLoading}
                routes={shownRoutes}
                activeIdx={activeRouteIdx}
                onSetActive={setActiveRouteIdx}
                onRouteTrace={(i) => routes[i] && openTrace(routes[i].trace)}
                onOverallTrace={() => routesTrace && openTrace(routesTrace)}
                onGeolocate={geolocate}
                geoBusy={geoBusy}
              />
            ) : (
              <GovPanel
                hotspots={hotspots}
                loading={hotspotsLoading}
                weather={weather}
                selectedHotspotId={selectedHotspotId}
                onHotspotTrace={hotspotTrace}
                plantingHotspotId={plantingHotspotId}
                onSetPlantingHotspot={setPlantingHotspotId}
                plantingPrefs={plantingPrefs}
                onSetPlantingPrefs={setPlantingPrefs}
                onGenerate={generatePlanting}
                plantingLoading={plantingLoading}
                plantingResult={plantingResult}
                onPlantingTrace={() => plantingResult && openTrace(plantingResult.trace)}
                onAiSummary={aiSummary}
                aiLoading={aiLoading}
                aiText={aiText}
                aiSource={aiSource}
                aiError={aiError}
              />
            )}
          </div>

          {/* right: map */}
          <div className="order-1 h-[340px] sm:h-[420px] lg:order-2 lg:h-[720px] lg:sticky lg:top-4">
            <MapView
              showLst={mode === 'gov'}
              showCanopy={mode === 'gov'}
              showPlaces={mode === 'citizen'}
              showHotspots={mode === 'gov'}
              hotspots={hotspots}
              routes={shownRoutes}
              activeRouteIdx={activeRouteIdx}
              onSelectRoute={setActiveRouteIdx}
              plantingPoints={plantingPoints}
              onHotspotClick={hotspotTrace}
              focus={focus}
            />
          </div>
        </div>
      </main>

      {/* footer — sticky bottom via mt-auto on root flex wrapper */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-emerald-700" />
            <b>Chladnější kraj</b> — prototyp pro Hackathon otevřených dat Plzeňského kraje 2026
          </span>
          <span>
            Data: <a className="underline-offset-2 hover:underline" href="https://dataspace.copernicus.eu/" target="_blank" rel="noopener noreferrer">Copernicus</a> ·{' '}
            <a className="underline-offset-2 hover:underline" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> ·{' '}
            <a className="underline-offset-2 hover:underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> ·{' '}
            <a className="underline-offset-2 hover:underline" href="https://data.gov.cz/" target="_blank" rel="noopener noreferrer">data.gov.cz</a>
          </span>
          <MethodologyDialog />
          <span className="ml-auto">
            Mapa © OpenStreetMap contributors · LST vrstva je metodická ukázka (detaily v metodice)
          </span>
        </div>
      </footer>

      <TracePanel trace={trace} open={traceOpen} onClose={() => setTraceOpen(false)} />
    </div>
  );
}
