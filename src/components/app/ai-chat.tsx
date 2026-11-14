'use client';

/**
 * Floating AI advisor — the generative "brain" of the app, available in both
 * modes. It reasons over a LIVE fact sheet built server-side (Open-Meteo,
 * Sentinel-3 status, hotspot ranking, cooling places + current UI state) and
 * answers in Czech. Deterministic engines remain the source of truth; the AI
 * only explains, contextualises and recommends.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { BrainCircuit, Loader2, RotateCcw, SendHorizontal } from 'lucide-react';
import { describeError } from '@/lib/errors';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  reply?: string;
  model?: string;
  source?: 'openrouter' | 'z-ai';
  detail?: string;
  error?: string;
  scope?: string;
}

const SUGGESTIONS: Record<'citizen' | 'gov', string[]> = {
  citizen: [
    'Kam se dnes mohu jít schladit v Plzni?',
    'Kdy je venku nejpříjemnější na procházku?',
    'Jak mám číst teplotní vrstvu na mapě?',
    'Proč je u nádraží tepleji než v Kopeckého sadech?',
  ],
  gov: [
    'Které území bychom měli řešit první a proč?',
    'Jaká opatření dnes dávají smysl spustit?',
    'Kolik stromů a za kolik by pomohlo Slovanům?',
    'Jak komunikovat přehřívání veřejnosti?',
  ],
};

/** Markdown styling for assistant answers (tight, in-bubble). */
const MD_COMPONENTS = {
  p: (props: React.ComponentProps<'p'>) => <p className="mt-2 first:mt-0" {...props} />,
  ul: (props: React.ComponentProps<'ul'>) => <ul className="mt-2 list-disc space-y-1 pl-4 first:mt-0" {...props} />,
  ol: (props: React.ComponentProps<'ol'>) => <ol className="mt-2 list-decimal space-y-1 pl-4 first:mt-0" {...props} />,
  li: (props: React.ComponentProps<'li'>) => <li className="ml-1" {...props} />,
  strong: (props: React.ComponentProps<'strong'>) => <strong className="font-semibold" {...props} />,
  code: (props: React.ComponentProps<'code'>) => (
    <code className="rounded bg-muted px-0.5 font-mono text-[11px]" {...props} />
  ),
  a: (props: React.ComponentProps<'a'>) => (
    <a className="underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />
  ),
};

export interface AiChatProps {
  mode: 'citizen' | 'gov';
  extraFacts?: string[];
}

export function AiChat({ mode, extraFacts }: AiChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // mode switch changes the analyst persona — start a fresh conversation
  useEffect(() => {
    setMessages([]);
    setError(null);
    setInput('');
  }, [mode]);

  // keep the newest message visible
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sending) return;
      const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
      setMessages(nextMessages);
      setInput('');
      setSending(true);
      setError(null);
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            messages: nextMessages.slice(-12),
            extraFacts: (extraFacts ?? []).slice(0, 12),
          }),
        });
        let data: ChatResponse | null = null;
        try {
          data = (await res.json()) as ChatResponse;
        } catch {
          data = null;
        }
        if (!res.ok || !data?.reply) {
          const detail = data?.detail ?? data?.error;
          throw new Error(detail ?? `HTTP ${res.status} ${res.statusText} (bez detailu v odpovědi)`);
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply as string }]);
        if (data.model) setModel(data.model);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setSending(false);
      }
    },
    [messages, sending, mode, extraFacts]
  );

  const reset = () => {
    setMessages([]);
    setError(null);
    setInput('');
  };

  return (
    <>
      {/* floating trigger */}
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 h-11 gap-2 rounded-full px-4 shadow-lg shadow-emerald-900/20 sm:bottom-6 sm:right-6"
        aria-label="Otevřít AI poradce nad živými daty"
      >
        <BrainCircuit className="h-5 w-5" />
        <span className="hidden sm:inline">AI poradce</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white">
                <BrainCircuit className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base">
                  AI poradce — {mode === 'gov' ? 'samospráva' : 'občan'}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Uvažuje nad živými daty: Open-Meteo, Sentinel-3, hotspoty. Rozhodnutí zůstávají na
                  deterministických motorech.
                </SheetDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={reset} aria-label="Nová konverzace" className="h-8 w-8 shrink-0">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            {model ? (
              <Badge variant="outline" className="mt-2 w-fit font-mono text-[10px]" title={`Model: ${model}`}>
                {model}
              </Badge>
            ) : null}
          </SheetHeader>

          {/* messages */}
          <ScrollArea className="min-h-0 flex-1">
            <div ref={scrollRef} className="px-4 py-3">
              {messages.length === 0 ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-950">
                    <b>Zeptejte se na živá data:</b> počasí, teplotu povrchu z Sentinel-3, hotspoty,
                    chladicí místa nebo navrženou výsadbu. AI odpovídá pouze na základě faktů, které
                    aplikace právě vidí — nevídané hodnoty explicitně označí.
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Ukázkové dotazy
                    </p>
                    {SUGGESTIONS[mode].map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        disabled={sending}
                        className="w-full rounded-lg border bg-card px-3 py-2 text-left text-xs transition-colors hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed sm:text-sm ${
                          m.role === 'user'
                            ? 'rounded-br-sm bg-emerald-700 text-white'
                            : 'rounded-bl-sm border bg-muted/40'
                        }`}
                      >
                        {m.role === 'assistant' ? (
                          <ReactMarkdown components={MD_COMPONENTS}>{m.content}</ReactMarkdown>
                        ) : (
                          m.content
                        )}
                      </div>
                    </div>
                  ))}
                  {sending ? (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Analyzuji živá data…
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
              {error ? (
                <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                  <b>AI teď nemůže odpovědět.</b>
                  <p className="mt-1 font-mono text-[10px]">{error}</p>
                  <p className="mt-1 text-muted-foreground">Zkuste to znovu — odpověď může trvat až ~30 s (reasoning model).</p>
                </div>
              ) : null}
            </div>
          </ScrollArea>

          {/* input */}
          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={mode === 'gov' ? 'Ptejte se analytika úřadu…' : 'Ptejte se na chlad, trasy, místa…'}
                aria-label="Vaše otázka pro AI poradce"
                className="min-h-[44px] resize-none text-sm"
                rows={2}
                disabled={sending}
              />
              <Button
                onClick={() => void send(input)}
                disabled={sending || !input.trim()}
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Odeslat otázku"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">
              Enter = odeslat, Shift+Enter = nový řádek. Odpovědi AI jsou návrhy nad živými daty, ne oficiální rozhodnutí.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
