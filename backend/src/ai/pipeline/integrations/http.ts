/**
 * External HTTP client: timeout, bounded retries with backoff, rate limit,
 * response-size cap, schema validation and TTL caching.
 *
 * Successful payloads are cached by URL so a 30-minute decision loop does not
 * hammer providers that update hourly or daily.
 */
import type { z } from 'zod';
import {
  classifyHttpStatus,
  ExternalApiError,
  parseRetryAfter,
  redactUrl,
  withRetry,
  defaultSleep,
} from '../utils/retry.js';

export interface MinimalLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: { signal: AbortSignal; headers?: Record<string, string> }) => Promise<FetchResponseLike>;

export interface HttpJsonClientOptions {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  minGapMs: number;
  maxResponseBytes: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  logger?: MinimalLogger;
}

interface CacheEntry {
  expiresAtMs: number;
  value: unknown;
}

export interface HttpJsonClient {
  getJson<T>(url: string, schema: z.ZodType<T>, label: string, cacheMs: number): Promise<T>;
  clearCache(): void;
  cacheSize(): number;
}

export class HttpJsonClientImpl implements HttpJsonClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: HttpJsonClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponseLike>);
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  async getJson<T>(url: string, schema: z.ZodType<T>, label: string, cacheMs: number): Promise<T> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAtMs > this.now()) return cached.value as T;

    const existing = this.inFlight.get(url);
    if (existing) return existing as Promise<T>;

    const task = this.fetchAndValidate(url, schema, label, cacheMs).finally(() => {
      this.inFlight.delete(url);
    });
    this.inFlight.set(url, task);
    return task;
  }

  clearCache(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  cacheSize(): number {
    return this.cache.size;
  }

  private async fetchAndValidate<T>(
    url: string,
    schema: z.ZodType<T>,
    label: string,
    cacheMs: number
  ): Promise<T> {
    const value = await withRetry(
      async () => {
        await this.throttle(url);
        const text = await this.requestText(url, label);
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ExternalApiError(`${label}: response is not valid JSON`, 'validation', label, null, false);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new ExternalApiError(
            `${label}: response failed validation at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'unknown'}`,
            'validation',
            label,
            null,
            false
          );
        }
        return parsed.data;
      },
      {
        attempts: this.opts.maxAttempts,
        baseDelayMs: this.opts.baseDelayMs,
        sleep: this.sleep,
        onRetry: ({ attempt, delayMs, error }) => {
          this.opts.logger?.warn(
            { label, attempt, delayMs, code: error.kind, status: error.status },
            'External request retry'
          );
        },
      }
    );

    this.cache.set(url, { expiresAtMs: this.now() + cacheMs, value });
    return value;
  }

  private async throttle(url: string): Promise<void> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      throw new ExternalApiError('Invalid provider URL', 'validation', 'http', null, false);
    }
    const nowMs = this.now();
    const waitMs = Math.max(0, (this.nextAllowedAt.get(host) ?? 0) - nowMs);
    if (waitMs > 0) await this.sleep(waitMs);
    this.nextAllowedAt.set(host, this.now() + this.opts.minGapMs);
  }

  private async requestText(url: string, label: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    const startedAt = this.now();
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      if (!res.ok) {
        const { kind, retryable } = classifyHttpStatus(res.status);
        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), this.now());
        let snippet = '';
        try {
          const body = await res.text();
          snippet = body.replace(/\s+/g, ' ').slice(0, 200);
        } catch {
          snippet = '';
        }
        throw new ExternalApiError(
          `${label}: HTTP ${res.status} from ${redactUrl(url)}${snippet ? ` — ${snippet}` : ''}`,
          kind,
          label,
          res.status,
          retryable,
          retryAfterMs
        );
      }

      const lengthHeader = res.headers.get('content-length');
      const declared = lengthHeader ? Number(lengthHeader) : NaN;
      if (Number.isFinite(declared) && declared > this.opts.maxResponseBytes) {
        throw new ExternalApiError(`${label}: response too large (${declared} bytes)`, 'validation', label, res.status, false);
      }
      const text = await res.text();
      if (text.length > this.opts.maxResponseBytes) {
        throw new ExternalApiError(`${label}: response too large (${text.length} chars)`, 'validation', label, res.status, false);
      }
      this.opts.logger?.debug(
        { label, ms: Math.round(this.now() - startedAt), bytes: text.length },
        'External request completed'
      );
      return text;
    } catch (error) {
      if (error instanceof ExternalApiError) throw error;
      if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
        throw new ExternalApiError(
          `${label}: timed out after ${this.opts.timeoutMs} ms`,
          'timeout',
          label,
          null,
          true
        );
      }
      throw new ExternalApiError(
        `${label}: network error — ${(error as Error).message.slice(0, 200)}`,
        'network',
        label,
        null,
        true
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
