import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Optional generative-AI layer (z-ai-web-dev-sdk).
 * IMPORTANT: the decision engines are deterministic and fully traceable.
 * This endpoint ONLY writes a human-friendly narrative on top of an already
 * computed result — it never changes scores or decisions.
 * If the SDK is unavailable (e.g. no API key on Vercel), we fall back to a
 * deterministic template so the app always works.
 */

interface Body {
  kind: 'route' | 'planting' | 'hotspot';
  title: string;
  facts: string[];
}

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
    const body = (await request.json()) as Body;
    if (!body?.title || !Array.isArray(body.facts)) {
      return NextResponse.json({ error: 'Chybí vstup pro shrnutí.' }, { status: 400 });
    }

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
      if (text) {
        return NextResponse.json({ summary: text, source: 'ai' as const });
      }
    } catch (e) {
      console.warn('AI summary unavailable, using deterministic fallback:', e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ summary: fallback(body.kind, body.title, body.facts), source: 'template' as const });
  } catch (e) {
    console.error('ai-summary error', e);
    return NextResponse.json({ error: 'Shrnutí selhalo.' }, { status: 500 });
  }
}
