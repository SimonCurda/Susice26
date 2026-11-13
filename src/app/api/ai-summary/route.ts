import { NextResponse } from 'next/server';
import { AppError, describeError, errorPayload, readJsonBody } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Optional generative-AI layer (z-ai-web-dev-sdk).
 * IMPORTANT: the decision engines are deterministic and fully traceable.
 * This endpoint ONLY writes a human-friendly narrative on top of an already
 * computed result — it never changes scores or decisions.
 * If the SDK is unavailable, we fall back to a deterministic template AND
 * report the exact reason why the LLM was not used (field `aiError`).
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

    let aiError: string | null = null;
    try {
      const { default: ZAI } = await import('z-ai-web-dev-sdk');
      const zai = await ZAI.create();
      const prompt = [
        'Jsi asistent pro občanskou a úřední komunikaci města. Napiš v češtině kratké shrnutí (max 3 věty) proč model doporučil následující výsledek.',
        'Použij POUZE uvedená fakta, nepřidávej žádná nová čísla ani doporučení. Nezmíňuj, že jsi AI.',
        '',
        `Typ: ${body.kind}`,
        `Výsledek: ${body.title}`,
        'Fakta:',
        ...body.facts.map((f) => `- ${f}`),
      ].join('\n');

      const completion = (await zai.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
      })) as { choices?: { message?: { content?: string } }[] };

      const text = completion?.choices?.[0]?.message?.content?.trim();
      if (!text) {
        aiError = `LLM vrátilo prázdnou odpověď — struktura: ${JSON.stringify(completion).slice(0, 300)}`;
      } else {
        return NextResponse.json({ summary: text, source: 'ai' as const });
      }
    } catch (e) {
      aiError = describeError(e);
    }

    console.warn(`[POST /api/ai-summary] LLM nedostupné, použita deterministická šablona. Důvod: ${aiError}`);
    return NextResponse.json({
      summary: fallback(body.kind, body.title, body.facts),
      source: 'template' as const,
      aiError,
    });
  } catch (e) {
    const payload = errorPayload('POST /api/ai-summary', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[POST /api/ai-summary] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
