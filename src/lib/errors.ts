/**
 * Exact-error utilities — the app never says generic "something went wrong".
 *
 * Every failure surfaces: what failed, in which scope (endpoint/step),
 * upstream HTTP status + body, and the root cause chain of the exception.
 */

/** Typed application error with an exact message, machine code and HTTP status. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Extract the most precise message available from any thrown value,
 * including the `cause` chain (network errors in `fetch` nest the real
 * cause, e.g. `ENOTFOUND api.open-meteo.com`, inside `error.cause`).
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    let s = `${e.name}: ${e.message}`;
    const cause = (e as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      s += ` ← příčina: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
    }
    return s;
  }
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Structured JSON error payload with exact details for the client to display. */
export function errorPayload(scope: string, e: unknown): {
  error: string;
  detail: string;
  scope: string;
  code: string | null;
  at: string;
} {
  const message = e instanceof Error ? e.message : describeError(e);
  return {
    error: message,
    detail: describeError(e),
    scope,
    code: e instanceof AppError ? e.code : null,
    at: new Date().toISOString(),
  };
}

/** Parse a JSON request body — throws an AppError containing the exact parse failure + received text. */
export async function readJsonBody(request: Request): Promise<unknown> {
  let text = '';
  try {
    text = await request.text();
  } catch (e) {
    throw new AppError(`Nelze přečíst tělo požadavku: ${describeError(e)}`, 'unreadable_body', 400);
  }
  if (!text.trim()) {
    throw new AppError('Prázdné tělo požadavku — očekávám JSON objekt (Content-Type: application/json).', 'empty_body', 400);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AppError(
      `Nevalidní JSON v těle požadavku: ${describeError(e)}. Přijatý text (prvních 200 znaků): ${text.slice(0, 200)}`,
      'bad_json',
      400
    );
  }
}
