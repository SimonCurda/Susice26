/**
 * Shared Copernicus Data Space Ecosystem (CDSE) OAuth client — server-side only.
 *
 * Uses OAuth2 client_credentials against the CDSE Keycloak identity service
 * (free OAuth client created in the CDSE account console, Service Accounts
 * enabled — see SETUP.md). The token is cached in memory until ~5 min before
 * expiry (tokens last 30 min) so consecutive API calls reuse it.
 *
 * Every failure carries an EXACT reason string (incl. the fetch `cause` chain)
 * — the app never shows a generic "something went wrong" (src/lib/errors.ts).
 */

import { describeError } from '@/lib/errors';

const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';

const FETCH_TIMEOUT_MS = 20000;

interface TokenCache {
  token: string;
  fetchedAt: number;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;
let inflight: Promise<string> | null = null;

/** True when both CDSE environment variables are configured. */
export function cdseCredsConfigured(): boolean {
  return Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET);
}

/** If only one of the two env vars is set, say exactly which one is missing. */
export function cdseEnvWarning(): string | null {
  if (!process.env.CDSE_CLIENT_ID && !process.env.CDSE_CLIENT_SECRET) return null;
  return process.env.CDSE_CLIENT_SECRET
    ? 'CDSE_CLIENT_ID chybí (CDSE_CLIENT_SECRET je nastavené)'
    : 'CDSE_CLIENT_SECRET chybí (CDSE_CLIENT_ID je nastavené)';
}

/**
 * Actionable, non-generic hint for the "no credentials" state. Shown directly
 * in the UI so the operator knows exactly where to put the two variables —
 * locally (.env.local) or on the hosting (Vercel → Settings → Environment
 * Variables) — and that a redeploy/restart is required afterwards.
 */
export function cdseSetupHint(): string {
  const base =
    'CDSE_CLIENT_ID/CDSE_CLIENT_SECRET nejsou nastavené — vrstva z Copernicusu je neaktivní. ' +
    'Nastav je v .env.local (lokální vývoj) nebo na hostingu: Vercel → Project → Settings → Environment Variables ' +
    '(hodnoty z CDSE account → OAuth Clients, viz SETUP.md) a poté restartuj server / redeploy.';
  const partial = cdseEnvWarning();
  return partial ? `${base} (Zjištěno: ${partial}.)` : base;
}

async function requestToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CDSE_CLIENT_ID ?? '',
    client_secret: process.env.CDSE_CLIENT_SECRET ?? '',
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`CDSE identity služba nedostupná — ${describeError(e)}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(
      `CDSE token HTTP ${res.status}: ${text || res.statusText}` +
        (res.status === 401
          ? ' — zkontrolujte CDSE_CLIENT_ID/CDSE_CLIENT_SECRET (a že má klient zapnuté Service Accounts)'
          : '')
    );
  }
  let j: { access_token?: string; expires_in?: number };
  try {
    j = (await res.json()) as { access_token?: string; expires_in?: number };
  } catch (e) {
    throw new Error(`CDSE token odpověď není JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!j.access_token) throw new Error('CDSE token odpověď nemá access_token');
  const ttl = (typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : 1800) * 1000;
  tokenCache = {
    token: j.access_token,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + ttl,
  };
  return tokenCache.token;
}

/**
 * Valid access token (cached). Concurrent callers share one in-flight request.
 */
export async function getCdseToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token;
  }
  if (inflight) return inflight;
  inflight = requestToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Authenticated JSON POST helper with EXACT error reporting: network failures
 * keep their root cause; HTTP failures include status + upstream reason/body.
 */
export async function cdsePostJson<T>(url: string, payload: unknown, timeoutMs = 60000): Promise<T> {
  const token = await getCdseToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`CDSE POST ${url} síťová chyba — ${describeError(e)}`);
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = '(tělo odpovědi se nepodařilo přečíst)';
    }
    let upstream = '';
    try {
      const j = JSON.parse(body) as { error?: { message?: string; status?: number } };
      if (j?.error?.message) upstream = ` — upstream: „${j.error.message}"`;
    } catch {
      // body is not JSON — raw excerpt is already included
    }
    throw new Error(`CDSE POST ${url} HTTP ${res.status} ${res.statusText}${upstream} Tělo: ${body}`);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new Error(`CDSE POST ${url} vrátilo nevalidní JSON — ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Authenticated raw-body POST helper (Process API returns PNG bytes). */
export async function cdsePostRaw(
  url: string,
  payload: unknown,
  accept = 'image/png',
  timeoutMs = 60000
): Promise<Buffer> {
  const token = await getCdseToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: accept,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(`CDSE POST ${url} síťová chyba — ${describeError(e)}`);
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = '(tělo odpovědi se nepodařilo přečíst)';
    }
    throw new Error(`CDSE POST ${url} HTTP ${res.status} ${res.statusText} Tělo: ${body}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) {
    throw new Error(`CDSE POST ${url} vrátilo podezřele malou odpověď (${buf.length} B)`);
  }
  return buf;
}
