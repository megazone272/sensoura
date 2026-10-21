/**
 * Failure handling for external providers.
 *
 * Retries are bounded, only for transient failures, and honour `Retry-After`.
 * Validation failures (bad payload shape) are never retried: the response is
 * wrong, not late.
 */

export type ExternalErrorKind = 'timeout' | 'network' | 'http' | 'rate_limit' | 'validation';

export class ExternalApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ExternalErrorKind,
    public readonly label: string,
    public readonly status: number | null = null,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = 'ExternalApiError';
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ExternalApiError && error.retryable;
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: ExternalApiError }) => void;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full-jitter exponential backoff. */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs = 30_000): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === opts.attempts) throw error;
      const err = error as ExternalApiError;
      const delay = err.retryAfterMs ?? backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      opts.onRetry?.({ attempt, delayMs: delay, error: err });
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Remove credentials and query strings from URLs before they reach logs or
 * Firebase. Provider URLs here are keyless, but this is defence in depth.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

/** Safe, bounded error description for execution records and API responses. */
export function describeError(error: unknown): ExternalApiError {
  if (error instanceof ExternalApiError) return error;
  if (error instanceof Error) {
    return new ExternalApiError(error.message.slice(0, 500), 'network', 'unknown', null, false);
  }
  return new ExternalApiError(String(error).slice(0, 500), 'network', 'unknown', null, false);
}

export function classifyHttpStatus(status: number): { kind: ExternalErrorKind; retryable: boolean } {
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status >= 500) return { kind: 'http', retryable: true };
  if (status === 408) return { kind: 'timeout', retryable: true };
  return { kind: 'http', retryable: false };
}

export function parseRetryAfter(header: string | null, nowMs = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(60_000, date - nowMs));
  return null;
}
