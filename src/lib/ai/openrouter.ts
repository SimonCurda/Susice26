/**
 * Generative-AI client — the "AI that thinks and reasons". SERVER-SIDE ONLY
 * (the API key must never reach the client).
 *
 * PROVIDER AUTO-DETECTION: the key decides the endpoint. Both providers use
 * the same OpenAI-compatible chat-completions shape, only the URL, headers
 * and model ids differ:
 *  - key starting with "gsk_" → GROQ (api.groq.com) — the user may paste a
 *    Groq key into OPENROUTER_API_KEY (or set GROQ_API_KEY); it must NOT be
 *    sent to openrouter.ai (that would 401 and look like "AI broken")
 *  - otherwise → OPENROUTER (openrouter.ai)
 *
 * Design:
 *  - primary model from GROQ_MODEL / OPENROUTER_MODEL (provider-specific
 *    defaults), then an automatic fallback chain of the same provider
 *  - every attempt records its EXACT failure reason (HTTP status + upstream
 *    body) — consistent with the app's no-black-box error philosophy
 *  - reasoning models may spend the token budget inside `message.reasoning`
 *    and return empty `content`; that is treated as a failed attempt and the
 *    next model in the chain is tried
 *
 * The deterministic engines (routing, risk, planting) always stay the source
 * of truth — this layer only reasons/explains on top of live data.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Per-model cap: with the fallback chain the worst case stays bounded. */
const TIMEOUT_MS = 45_000;

/** OpenRouter keys look like "sk-or-v1-…", Groq keys look like "gsk-…". */
function looksLikeGroqKey(key: string): boolean {
  return /^gsk[_-]/.test(key.trim());
}

export function aiProvider(): 'groq' | 'openrouter' {
  const key = apiKey();
  return looksLikeGroqKey(key) ? 'groq' : 'openrouter';
}

function apiKey(): string {
  return (process.env.OPENROUTER_API_KEY ?? process.env.GROQ_API_KEY ?? '').trim();
}

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
/**
 * Chain tried in order after the primary model fails.
 *  - 2 paid models (fast, reliable, Czech-capable)
 *  - 2 FREE models (:free, 0 Kč/request) — the promised "free replacement"
 *    tier: when paid quota runs out or billing breaks, the chatbot still
 *    answers. Verified live: both respond in Czech; reasoning models need
 *    enough max_tokens (they think inside the budget) → callers send ≥ 800.
 */
export const FALLBACK_MODELS = [
  'deepseek/deepseek-chat',
  'nvidia/nemotron-3.5-super-vl:free',
  'inclusionai/ling-3.2-flash:free',
] as const;

export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
/** Groq fallbacks across generations — if one is deprecated, the next answers. */
export const GROQ_FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
] as const;

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
  return Boolean(apiKey());
}

export function primaryModel(): string {
  if (aiProvider() === 'groq') {
    return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  }
  return process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
}

function fallbackModels(): string[] {
  return aiProvider() === 'groq' ? [...GROQ_FALLBACK_MODELS] : [...FALLBACK_MODELS];
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
  const provider = aiProvider();
  let res: Response;
  try {
    res = await fetch(provider === 'groq' ? GROQ_URL : OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
        // OpenRouter attribution headers (recommended; free ranking on the dashboard) —
        // harmless to omit for Groq, which only needs Authorization
        ...(provider === 'openrouter'
          ? {
              'HTTP-Referer': 'https://github.com/SimonCurda/Susice26',
              'X-Title': 'Chladnejsi kraj',
            }
          : {}),
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
    let hint = '';
    try {
      const j = JSON.parse(text) as { error?: { message?: string; metadata?: { raw?: string } } };
      const raw = j?.error?.metadata?.raw ?? j?.error?.message ?? '';
      if (res.status === 429 || /rate-?limit/i.test(raw)) {
        hint = ' — limit překročen (429), pokračuji dalším modelem v řadě';
      } else if (res.status === 402) {
        hint = ' — vyčerpaný kredit OpenRouter, pokračuji ZDARMA modelem';
      }
    } catch {
      // body not JSON — raw excerpt is already included
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}${hint}${text ? `: ${text}` : ''}`);
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
    throw new Error('OPENROUTER_API_KEY / GROQ_API_KEY není nastavené — generativní AI je vypnutá');
  }
  const models = [primaryModel(), ...fallbackModels()].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );
  // floor: free reasoning models (nemotron/ling) think inside the token budget
  // — a small budget yields EMPTY content, so keep a sane minimum
  const maxTokens = Math.max(opts.maxTokens ?? 1200, 800);
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
  throw new Error(
    `Všechny ${aiProvider() === 'groq' ? 'Groq' : 'OpenRouter'} modely selhaly — ${attempts.join(' | ')}`
  );
}
