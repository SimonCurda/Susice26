'use client';

/**
 * "Historie" tab (government mode) — historical temperatures from Copernicus.
 *
 * Two independent series, each honestly labelled with its provenance and
 * exact failure reasons (project rule: never a generic "something went wrong"):
 *  1. ERA5 (Copernicus C3S) — yearly stats since 1970 via Open-Meteo archive
 *  2. Sentinel-3 SLSTR — summer surface-temperature history since 2016 via
 *     the CDSE Statistical API (loads chunked in the background; this panel
 *     polls until ready).
 *
 * Charts are computed deterministically server-side; this component only
 * renders the received numbers — no client-side recomputation of the story.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ComposedChart,
  Bar,
} from 'recharts';
import { Loader2, RefreshCw, Satellite, Thermometer, TrendingUp, TriangleAlert } from 'lucide-react';
import { describeError } from '@/lib/errors';
import type { HistoryResponse } from '@/lib/copernicus/history-types';

function apiDetail(j: unknown, res: Response): string {
  if (j && typeof j === 'object') {
    const o = j as { detail?: string; error?: string };
    const msg = o.detail ?? o.error;
    if (msg) return msg;
  }
  return `HTTP ${res.status} ${res.statusText} (bez detailu v odpovědi)`;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warm' | 'cool' }) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <div className={`text-lg font-bold leading-tight ${tone === 'warm' ? 'text-orange-600' : tone === 'cool' ? 'text-emerald-700' : ''}`}>
        {value}
      </div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
      {sub ? <div className="text-[10px] leading-tight text-muted-foreground/80">{sub}</div> : null}
    </div>
  );
}

export function HistoryPanel() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/copernicus/history');
      const j = (await res.json().catch(() => null)) as HistoryResponse | null;
      if (!res.ok) throw new Error(apiDetail(j, res));
      if (!j) throw new Error('Server vrátil prázdné tělo odpovědi.');
      setData(j);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // satellite chunks fill in the background — poll while incomplete
  useEffect(() => {
    const incomplete = data?.satellite && !data.satellite.available && data.satellite.progress.done < data.satellite.progress.total;
    if (!incomplete) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    let polls = 0;
    pollRef.current = window.setInterval(() => {
      polls++;
      if (polls > 30) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
        return;
      }
      void load();
    }, 8000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [data, load]);

  const era5 = data?.era5 ?? null;
  const sat = data?.satellite ?? null;

  // chart data (render-only transforms)
  const meanSeries = era5
    ? era5.years
        .filter((y) => y.tMean !== null)
        .map((y) => ({ year: y.year, tMean: y.tMean, trend: trendAt(era5, y.year) }))
    : [];
  const tropSeries = era5
    ? era5.years.filter((y) => y.isFullYear).map((y) => ({ year: y.year, days: y.tropicalDays, nights: y.tropicalNights }))
    : [];
  const satSeries = sat?.available
    ? sat.summers.filter((s) => s.index !== null).map((s) => ({ year: s.year, index: s.index }))
    : [];

  const lastYear = era5?.years[era5.years.length - 1];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Historie teplot — Copernicus</CardTitle>
            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={() => void load()} aria-label="Znovu načíst historii">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <CardDescription>
            Dvě nezávislé řady: ERA5 reanalýza (Copernicus C3S, 1970→) a satelitní teplota povrchu Sentinel-3 (2016→, léto, CDSE Statistical API).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Načítám historické řady (ERA5 ~20 000 dní)…
            </div>
          ) : error ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <b>Historie se nepodařila načíst.</b>
              <div className="mt-1 font-mono text-[10px] leading-relaxed">{error}</div>
            </div>
          ) : !era5 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              ERA5 řada nedostupná: <span className="font-mono text-[10px]">{data?.era5Error}</span>
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi
                  label={`Oteplení od ${era5.normals.ref}`}
                  value={era5.normals.delta !== null ? `+${era5.normals.delta.toFixed(2)} °C` : '—'}
                  sub={`průměr ${era5.normals.recent} vs. ${era5.normals.ref}`}
                  tone="warm"
                />
                <Kpi
                  label="Trend oteplení"
                  value={era5.warmingPerDecade !== null ? `+${era5.warmingPerDecade.toFixed(2)} °C` : '—'}
                  sub="za dekádu (lineární trend 1970→)"
                  tone="warm"
                />
                <Kpi
                  label="Rekordní den (ERA5)"
                  value={era5.record ? `${era5.record.t} °C` : '—'}
                  sub={era5.record ? new Date(era5.record.date).toLocaleDateString('cs-CZ') : undefined}
                />
                <Kpi
                  label={`Tropické dny ${lastYear?.year ?? ''}`}
                  value={lastYear ? `${lastYear.tropicalDays}` : '—'}
                  sub={lastYear && !lastYear.isFullYear ? 'rok zatím neúplný (max ≥ 30 °C)' : 'max ≥ 30 °C'}
                  tone="warm"
                />
              </div>

              {/* chart 1: yearly mean + trend */}
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Průměrná roční teplota vzduchu (ERA5, Plzeň)
                </div>
                <div className="h-[190px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={meanSeries} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fontSize: 10 }} domain={['dataMin - 0.5', 'dataMax + 0.5']} unit="°" width={54} />
                      <Tooltip
                        formatter={(v: number | string, name: string) => [`${typeof v === 'number' ? v.toFixed(2) : v} °C`, name === 'tMean' ? 'průměr roku' : 'trend']}
                        labelFormatter={(l) => `Rok ${l}`}
                        contentStyle={{ fontSize: 11 }}
                      />
                      <Line type="monotone" dataKey="tMean" stroke="#d97706" strokeWidth={1.6} dot={false} name="tMean" />
                      <Line type="monotone" dataKey="trend" stroke="#059669" strokeWidth={1.4} strokeDasharray="6 4" dot={false} name="trend" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  Zelená přerušovaná = lineární trend (OLS). Zdroj: {era5.source}. {era5.note}
                </p>
              </div>

              {/* chart 2: tropical days/nights */}
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tropické dny (≥ 30 °C) a tropické noci (≥ 20 °C) za rok
                </div>
                <div className="h-[190px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={tropSeries} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis tick={{ fontSize: 10 }} width={54} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Bar dataKey="days" name="tropické dny" fill="#ea580c" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="nights" name="tropické noci" fill="#7c3aed" radius={[2, 2, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  70. léta: prakticky 0 tropických dnů · poslední roky: 15–30. Noci ≥ 20 °C jsou metrikou nejvíc svázanou s úmrtími v panelových domácnostech.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* satellite summer history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Satellite className="h-4 w-4 text-teal-600" /> Léto z vesmíru — teplota povrchu (Sentinel-3 SLSTR)
          </CardTitle>
          <CardDescription>
            Jasová teplota kanálu S7 (10,85 µm), denní přlety ~10:30, červen–srpen od 2016. Dny zasažené oblaky se filtrují proti ERA5 — v grafu jen jasné dny.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!sat ? null : !sat.available && sat.progress.done < sat.progress.total ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám satelitní léta z CDSE Statistical API ({sat.progress.done}/{sat.progress.total} ročních dotazů) — zpravidla do jedné minuty.
            </div>
          ) : !sat.available ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="flex items-center gap-1 font-semibold">
                <TriangleAlert className="h-3.5 w-3.5" /> Satelitní historie nyní není k dispozici
              </div>
              <div className="mt-1 font-mono text-[10px] leading-relaxed">{sat.note}</div>
            </div>
          ) : (
            <>
              <div className="h-[170px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={satSeries} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['dataMin - 1', 'dataMax + 1']} unit="°" width={54} />
                    <Tooltip
                      formatter={(v: number | string) => [`${typeof v === 'number' ? v.toFixed(1) : v} °C`, 'index léta (mediana jasných dnů)']}
                      labelFormatter={(l) => `Léto ${l}`}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Line type="monotone" dataKey="index" stroke="#0d9488" strokeWidth={2} dot={{ r: 2.5 }} name="index" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {(() => {
                const hottestOverall = sat.summers
                  .filter((s) => s.hottestDay)
                  .sort((a, b) => (b.hottestDay?.mean ?? 0) - (a.hottestDay?.mean ?? 0))[0];
                const recordYear = satSeries.length > 0 ? satSeries.reduce((a, b) => ((b.index ?? 0) > (a.index ?? 0) ? b : a)) : null;
                return (
                  <div className="grid grid-cols-2 gap-2">
                    <Kpi
                      label="Nejteplejší léto (satelit)"
                      value={recordYear ? `${recordYear.year}: ${recordYear.index} °C` : '—'}
                      sub="mediana povrchu JJA"
                      tone="warm"
                    />
                    <Kpi
                      label="Nejžhavější naměřený den"
                      value={hottestOverall?.hottestDay ? `${hottestOverall.hottestDay.mean} °C` : '—'}
                      sub={hottestOverall?.hottestDay ? new Date(hottestOverall.hottestDay.date).toLocaleDateString('cs-CZ') : undefined}
                    />
                  </div>
                );
              })()}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Zdroj: {sat.source}. {sat.note}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* region comparison */}
      {era5 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Města kraje — kdo se hřeje nejrychleji</CardTitle>
            <CardDescription>
              Trend od 1994 (lineární), průměr tropických dnů za posledních 10 let, absolutní rekord (ERA5 grid).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Město</th>
                    <th className="px-2 py-1.5 text-right font-medium">°C/10 let</th>
                    <th className="px-2 py-1.5 text-right font-medium">Trop. dny/rok</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rekord</th>
                  </tr>
                </thead>
                <tbody>
                  {era5.region.map((r) => (
                    <tr key={r.name} className="border-b last:border-0">
                      <td className="px-2 py-1.5">
                        {r.name}
                        {r.note ? (
                          <span className="ml-1 text-[10px] text-amber-700" title={r.note}>
                            (nedostupné)
                          </span>
                        ) : null}
                        <span className="block text-[10px] text-muted-foreground">{r.altitudeNote}</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right font-mono ${r.warmingPerDecade >= 0.4 ? 'font-semibold text-orange-600' : ''}`}>
                        {r.note ? '—' : `+${r.warmingPerDecade.toFixed(2)}`}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{r.note ? '—' : r.tropicalDaysAvgLast10}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {r.note ? '—' : `${r.hottestEver.t} °C`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 flex items-start gap-1 text-[10px] leading-relaxed text-muted-foreground">
              <TrendingUp className="mt-0.5 h-3 w-3 shrink-0" />
              Všechny řady: ERA5 (Copernicus C3S, ECMWF) přes otevřené API Open-Meteo; trend = OLS regressce celých roků. ERA5 grid ~25 km tlumí extrémy oproti staničním měřením.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        <Thermometer className="h-3 w-3" />
        Historické řady popisují klima — aktuální živé hodnoty viz hlavička a vrstvy mapy.
        <Badge variant="outline" className="ml-auto text-[9px]">vše deterministicky spočítané na serveru</Badge>
      </div>
    </div>
  );
}

/** Trend value at a given year from the server-computed OLS slope (display only). */
function trendAt(era5: NonNullable<HistoryResponse['era5']>, year: number): number | null {
  if (era5.warmingPerDecade === null) return null;
  const fullYears = era5.years.filter((y) => y.isFullYear && y.tMean !== null);
  if (fullYears.length === 0) return null;
  // OLS line through the mean point
  const meanY = fullYears.reduce((a, y) => a + (y.tMean ?? 0), 0) / fullYears.length;
  const meanX = fullYears.reduce((a, y) => a + y.year, 0) / fullYears.length;
  return Math.round((meanY + (year - meanX) * (era5.warmingPerDecade / 10)) * 100) / 100;
}
