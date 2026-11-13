import { NextResponse } from 'next/server';
import { AppError, describeError, errorPayload, readJsonBody } from '@/lib/errors';
import { openrouterChat, openRouterConfigured } from '@/lib/ai/openrouter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Generative-AI narrative layer. IMPORTANT: the decision engines are
 * deterministic and fully traceable. This endpoint ONLY writes a human-friendly
 * narrative on top of an already computed result — it never changes scores or
 * decisions.
 *
 * Fallback order: OpenRouter (primary) → z-ai SDK → deterministic template.
 * Every fallback carries the EXACT reason why the previous step was skipped
 * (field `aiError`), consistent with the no-black-box philosophy.
 */

interface Body {
  kind: 'route' | 'planting' | 'hotspot';
  title: string;
  facts: string[];
}

const KINDS = ['route', 'planting', 'hotspot'] as const;

function fallback(kind: Body['kind'], title: string, facts: string[]): string {
  const head =
    kind === 'route'
      ? 'Trasa byla vybrána kombinací stínu, vody, zeleně a nízkého provozu podle vašich preferencí.'
      : kind === 'planting'
        ? 'Návrh výsadby vychází z teploty povrchu, podílu zeleně, rozpočtu a zvolených omezení.'
        : 'Riziko přehřívání je kompozitem teploty povrchu, zeleně, zranitelných skupin a hustoty zástavby.';
  return `${head} ${title}: ${facts.slice(0, 4).join(' · ')}. Všechny váhy a kroky najdete v transparentní stopě výpočtu.`;
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as Body;

    if (!KINDS.includes(body?.kind)) {
      throw new AppError(
        `Neznámý „kind“: ${JSON.stringify(body?.kind)}. Povolené: ${KINDS.join(', ')}.`,
        'bad_kind',
        400
      );
    }
    if (!body?.title || typeof body.title !== 'string') {
      throw new AppError(
        `Pole „title“ je povinné a musí být řetězec — přijato: ${JSON.stringify(body?.title)}.`,
        'bad_title',
        400
      );
    }
    if (!Array.isArray(body?.facts) || body.facts.length === 0) {
      throw new AppError(
        `Pole „facts“ musí být neprázdné pole řetězců — přijato: ${JSON.stringify(body?.facts).slice(0, 200)}.`,
        'bad_facts',
        400
      );
    }

    const prompt = [
      'Jsi asistent pro občanskou a úřední komunikaci města. Napiš v češtině kratké shrnutí (max 3 věty) proč model doporučil následující výsledek.',
      'Použij POUZE uvedená fakta, nepřidávej žádná nová čísla ani doporučení. Nezmíň, že jsi AI. Nepoužívej emoji.',
      '',
      `Typ: ${body.kind}`,
      `Výsledek: ${body.title}`,
      'Fakta:',
      ...body.facts.map((f) => `- ${f}`),
    ].join('\n');

    const aiNotes: string[] = [];

    // 1) OpenRouter — primary brain
    if (openRouterConfigured()) {
      try {
        const r = await openrouterChat(
          {
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 600,
            temperature: 0.3,
          },
        );
        return NextResponse.json({
          summary: r.text,
          source: 'ai' as const,
          model: r.model,
          ...(r.attempts.length > 0 ? { aiNote: `původní model selhal: ${r.attempts.join(' | ')}` } : {}),
        });
      } catch (e) {
        aiNotes.push(`OpenRouter: ${describeError(e)}`);
      }
    } else {
      aiNotes.push('OpenRouter: OPENROUTER_API_KEY není nastavené');
    }

    // 2) z-ai SDK fallback
    try {
      const { default: ZAI } = await import('z-ai-web-dev-sdk');
      const zai = await ZAI.create();
      const completion = (await zai.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
      })) as { choices?: { message?: { content?: string } }[] };
      const text = completion?.choices?.[0]?.message?.content?.trim();
      if (text) {
        return NextResponse.json({
          summary: text,
          source: 'ai' as const,
          model: 'z-ai',
          aiError: aiNotes.join(' | '),
        });
      }
      aiNotes.push(`z-ai: prázdná odpověď — ${JSON.stringify(completion).slice(0, 200)}`);
    } catch (e) {
      aiNotes.push(`z-ai: ${describeError(e)}`);
    }

    // 3) deterministic template
    console.warn(`[POST /api/ai-summary] LLM nedostupné, použita deterministická šablona. Pokusy: ${aiNotes.join(' | ')}`);
    return NextResponse.json({
      summary: fallback(body.kind, body.title, body.facts),
      source: 'template' as const,
      aiError: aiNotes.join(' | '),
    });
  } catch (e) {
    const payload = errorPayload('POST /api/ai-summary', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[POST /api/ai-summary] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
