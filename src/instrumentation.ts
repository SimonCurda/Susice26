/**
 * Next.js instrumentation — runs once when the server process boots.
 *
 * WHY THIS EXISTS (measured, not guessed):
 * Some hosting/sandbox networks block IPv6 egress while the IPv4 path is
 * healthy. Three of our data hosts are dual-stack (routing.openstreetmap.de,
 * openrouter.ai, air-quality-api.open-meteo.com) and Node's built-in fetch
 * then hangs on the silently-dropped IPv6 attempt (ETIMEDOUT) even though the
 * IPv4 path answers in < 1 s. We therefore install undici's fetch with an
 * Agent pinned to IPv4 as the process-wide `fetch` — one place, every
 * server-side call (CDSE, Open-Meteo, OpenRouter, OSRM) benefits. On networks
 * where IPv6 works this changes nothing except a purely cosmetic preference.
 */
export async function register(): Promise<void> {
  if (typeof process === 'undefined' || process.env.NEXT_RUNTIME === 'edge') return;
  if ((globalThis as Record<string, unknown>).__ipv4FetchInstalled) return;
  try {
    const { fetch: undiciFetch, Agent } = await import('undici');
    const agent = new Agent({ connect: { family: 4 } });
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init ?? {}),
        dispatcher: agent,
      }) as unknown as Response) as typeof fetch;
    (globalThis as Record<string, unknown>).__ipv4FetchInstalled = original;
  } catch {
    // undici unavailable — keep the platform fetch (fine on IPv6-capable hosts)
  }
}
