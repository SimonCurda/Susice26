/**
 * OpenRouter client — the generative-AI brain of the app ("AI that thinks
 * and reasons"). SERVER-SIDE ONLY (the API key must never reach the client).
 *
 * Design:
 *  - primary model from OPENROUTER_MODEL (default: a reasoning-capable,
 *    EU-region-available model), then an automatic fallback chain
 *  - every attempt records its EXACT failure reason (HTTP status + upstream
 *    body) — consistent with the app's no-black-box error philosophy
 *  - reasoning models may spend the token budget inside `message.reasoning`
 *    and return empty `content`; that is treated as a failed attempt and the
 *    next model in the chain is tried
 *
 * The deterministic engines (routing, risk, planting) always stay the source
 * of truth — this layer only reasons/explains on top of live data.
 */

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 60_000;

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
/** Chain tried in order after the primary model fails. Verified live, EU region. */
export const FALLBACK_MODELS = ['deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct'] as const;

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResult {
  text: string;
  model: string;
  /** Exact per-model attempt log — surfaced when everything fails. */
  attempts: string[];
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function primaryModel(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
}

interface ORResponse {
  choices?: {
    message?: { content?: string | null; reasoning?: string | null };
    finish_reason?: string;
  }[];
  usage?: { total_tokens?: number };
  error?: { message?: string; code?: number | string };
}

async function callModel(
  model: string,
  messages: ChatMsg[],
  maxTokens: number,
  temperature: number
): Promise<{ text: string; tokens: number }> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}`,
        // OpenRouter attribution headers (recommended; free ranking on the dashboard)
        'HTTP-Referer': 'https://github.com/SimonCurda/Susice26',
        'X-Title': 'Chladnejsi kraj',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`síťová chyba — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  const j = (await res.json().catch(() => null)) as ORResponse | null;
  const content = j?.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) {
    const finish = j?.choices?.[0]?.finish_reason ?? 'unknown';
    const hadReasoning = Boolean(j?.choices?.[0]?.message?.reasoning);
    throw new Error(
      hadReasoning
        ? `prázdný obsah (model spotřeboval tokeny na reasoning, finish=${finish})`
        : `prázdný obsah (finish=${finish})`
    );
  }
  return { text: content, tokens: j?.usage?.total_tokens ?? 0 };
}

/**
 * Chat completion through OpenRouter with automatic model fallback.
 * Throws an Error listing the EXACT reason of every attempt.
 */
export async function openrouterChat(opts: {
  messages: ChatMsg[];
  maxTokens?: number;
  temperature?: number;
}): Promise<OpenRouterResult> {
  if (!openRouterConfigured()) {
    throw new Error('OPENROUTER_API_KEY není nastavené — generativní AI je vypnutá');
  }
  const models = [primaryModel(), ...FALLBACK_MODELS].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );
  const maxTokens = opts.maxTokens ?? 1200;
  const temperature = opts.temperature ?? 0.4;
  const attempts: string[] = [];

  for (const model of models) {
    try {
      const { text } = await callModel(model, opts.messages, maxTokens, temperature);
      return { text, model, attempts };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      attempts.push(`${model}: ${reason}`);
    }
  }
  throw new Error(`Všechny OpenRouter modely selhaly — ${attempts.join(' | ')}`);
}
