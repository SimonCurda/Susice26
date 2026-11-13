'use client';

/**
 * Reasoning-trace drawer — the anti-black-box feature.
 * Shows every step of a recommendation: inputs, data sources, weights,
 * computations, assumptions and the final decision. Audit-friendly.
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { toast } from '@/hooks/use-toast';
import {
  Calculator,
  CheckCircle2,
  Database,
  ExternalLink,
  Filter,
  FlaskConical,
  Copy,
  Scale,
  TextCursorInput,
} from 'lucide-react';
import type { Trace, TraceStepKind } from '@/lib/engine/types';

const KIND_META: Record<TraceStepKind, { icon: typeof Database; color: string; label: string }> = {
  input: { icon: TextCursorInput, color: 'text-teal-700 bg-teal-50 border-teal-200', label: 'Vstup' },
  data: { icon: Database, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'Data' },
  filter: { icon: Filter, color: 'text-amber-700 bg-amber-50 border-amber-200', label: 'Filtr' },
  weight: { icon: Scale, color: 'text-orange-700 bg-orange-50 border-orange-200', label: 'Váhy' },
  score: { icon: Calculator, color: 'text-stone-700 bg-stone-100 border-stone-200', label: 'Výpočet' },
  decision: { icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-100 border-emerald-300', label: 'Rozhodnutí' },
  assumption: { icon: FlaskConical, color: 'text-rose-700 bg-rose-50 border-rose-200', label: 'Předpoklad' },
};

const CONFIDENCE_STYLE: Record<Trace['confidence']['level'], string> = {
  high: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-300',
  low: 'bg-rose-100 text-rose-800 border-rose-300',
};

export function TracePanel({ trace, open, onClose }: { trace: Trace | null; open: boolean; onClose: () => void }) {
  const copyJson = () => {
    if (!trace) return;
    navigator.clipboard
      .writeText(JSON.stringify(trace, null, 2))
      .then(() => toast({ title: 'Stopa zkopírována', description: 'JSON stopy výpočtu je ve schránce — lze auditovat.' }))
      .catch(() => toast({ title: 'Kopírování selhalo', variant: 'destructive' }));
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        {trace ? (
          <>
            <SheetHeader className="border-b px-4 py-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <SheetTitle className="text-base leading-snug">{trace.title}</SheetTitle>
                <Badge variant="outline" className={`shrink-0 ${CONFIDENCE_STYLE[trace.confidence.level]}`}>
                  jistota: {trace.confidence.level === 'high' ? 'vysoká' : trace.confidence.level === 'medium' ? 'střední' : 'nízká'}
                </Badge>
              </div>
              <SheetDescription className="text-xs leading-relaxed">{trace.summary}</SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 py-3 space-y-4">
                {/* factors */}
                <section aria-label="Vahy faktorů">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vahy faktorů a jejich vliv</h3>
                  <div className="space-y-2">
                    {trace.factors.map((f) => (
                      <div key={f.label}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium">{f.label}</span>
                          <span className="text-muted-foreground">váha {(f.weight * 100).toFixed(0)} %</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, f.contribution * 100)}%` }} />
                        </div>
                        {f.note ? <p className="mt-0.5 text-[11px] text-muted-foreground">{f.note}</p> : null}
                      </div>
                    ))}
                  </div>
                </section>
                <Separator />
                {/* steps */}
                <section aria-label="Kroky výpočtu">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kroky výpočtu</h3>
                  <ol className="space-y-3">
                    {trace.steps.map((s, i) => {
                      const meta = KIND_META[s.kind];
                      const Icon = meta.icon;
                      return (
                        <li key={s.id} className="relative pl-9">
                          <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{i + 1}. {s.title}</span>
                              <span className={`rounded border px-1 py-0.5 text-[10px] font-medium ${meta.color}`}>{meta.label}</span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
                            {s.inputs && s.inputs.length > 0 ? (
                              <div className="mt-1.5 rounded-md border bg-muted/50 p-2">
                                <table className="w-full text-[11px]">
                                  <tbody>
                                    {s.inputs.map((kv, k) => (
                                      <tr key={k}>
                                        <td className="pr-2 py-0.5 align-top text-muted-foreground">{kv.label}</td>
                                        <td className="py-0.5 font-mono font-medium">{kv.value}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                            {s.output ? (
                              <p className="mt-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">{s.output}</p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
                <Separator />
                {/* data sources */}
                <section aria-label="Zdroje dat">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zdroje dat (otevřená data)</h3>
                  <ul className="space-y-2">
                    {trace.dataSources.map((d, i) => (
                      <li key={i} className="rounded-md border p-2">
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:underline">
                          {d.name} <ExternalLink className="h-3 w-3" />
                        </a>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{d.note}</p>
                      </li>
                    ))}
                  </ul>
                </section>
                {/* disclaimers */}
                {trace.disclaimers.length > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                    {trace.disclaimers.map((d, i) => (
                      <p key={i}>- {d}</p>
                    ))}
                  </div>
                ) : null}
                <p className="text-[11px] text-muted-foreground">{trace.confidence.note}</p>
              </div>
            </ScrollArea>
            <div className="border-t p-3">
              <Button variant="outline" size="sm" className="w-full" onClick={copyJson}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Kopírovat stopu (JSON) pro audit
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">Žádná stopa k zobrazení.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
