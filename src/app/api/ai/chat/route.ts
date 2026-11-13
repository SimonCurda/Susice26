import { NextResponse } from 'next/server';
import { AppError, errorPayload, readJsonBody } from '@/lib/errors';
import { openrouterChat, openRouterConfigured, type ChatMsg } from '@/lib/ai/openrouter';
import { buildFactSheet, systemPrompt, type AiMode } from '@/lib/ai/context';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Conversational AI analyst — "the brain that thinks and reasons" on top of
 * the live open data. Grounded in a server-built fact sheet (weather,
 * Sentinel-3 status, hotspot ranking, cooling places); strict no-fabrication
 * rules; deterministic engines stay the source of truth.
 *
 * Fallback order: OpenRouter (primary) → z-ai SDK → exact-error 502.
 */

interface Body {
  mode?: 'citizen' | 'gov';
  messages?: { role?: string; content?: string }[];
  extraFacts?: string[];
}

const MAX_HISTORY = 12;
const MAX_FACTS = 12;
const MAX_FACT_LEN = 500;

function sanitizeHistory(body: Body): ChatMsg[] {
  const raw = Array.isArray(body.messages) ? body.messages : [];
  if (raw.length === 0) {
    throw new AppError('Pole „messages“ je povinné — alespoň jedna zpráva uživatele.', 'empty_messages', 400);
  }
  const cleaned: ChatMsg[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m?.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    if (content.length > 4000) {
      throw new AppError(
        `Zpráva je příliš dlouhá (${content.length} znaků, limit 4000).`,
        'message_too_long',
        400
      );
    }
    cleaned.push({ role, content });
  }
  if (!cleaned.some((m) => m.role === 'user')) {
    throw new AppError('Historie musí obsahovat alespoň jednu zprávu role „user“.', 'no_user_message', 400);
  }
  return cleaned;
}

function sanitizeFacts(body: Body): string[] {
  const raw = Array.isArray(body.extraFacts) ? body.extraFacts : [];
  return raw
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .slice(0, MAX_FACTS)
    .map((f) => f.trim().slice(0, MAX_FACT_LEN));
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as Body;
    const mode: AiMode = body?.mode === 'gov' ? 'gov' : 'citizen';
    const history = sanitizeHistory(body);
    const extraFacts = sanitizeFacts(body);

    const factSheet = await buildFactSheet(mode, extraFacts);
    const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt(mode, factSheet) }, ...history];

    // 1) OpenRouter — the primary brain
    if (openRouterConfigured()) {
      try {
        const r = await openrouterChat({ messages, maxTokens: 1400, temperature: 0.4 });
        return NextResponse.json({ reply: r.text, model: r.model, source: 'openrouter' as const });
      } catch (e) {
        console.warn(
          `[POST /api/ai/chat] OpenRouter selhal, zkouším z-ai fallback. Důvod: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // 2) z-ai SDK fallback (sandbox environment; keeps the demo alive)
    try {
      const { default: ZAI } = await import('z-ai-web-dev-sdk');
      const zai = await ZAI.create();
      const completion = (await zai.chat.completions.create({
        messages,
      })) as { choices?: { message?: { content?: string } }[] };
      const text = completion?.choices?.[0]?.message?.content?.trim();
      if (text) {
        return NextResponse.json({ reply: text, model: 'z-ai', source: 'z-ai' as const });
      }
      throw new Error(`LLM vrátilo prázdnou odpověď — ${JSON.stringify(completion).slice(0, 200)}`);
    } catch (e) {
      throw new AppError(
        `Generativní AI je nedostupná (OpenRouter${openRouterConfigured() ? '' : ' — chybí OPENROUTER_API_KEY'} i z-ai fallback). Důvod posledního pokusu: ${e instanceof Error ? e.message : String(e)}`,
        'ai_unavailable',
        502
      );
    }
  } catch (e) {
    const payload = errorPayload('POST /api/ai/chat', e);
    const status = e instanceof AppError ? e.status : 500;
    console.error(`[POST /api/ai/chat] ${status}: ${payload.detail}`);
    return NextResponse.json(payload, { status });
  }
}
