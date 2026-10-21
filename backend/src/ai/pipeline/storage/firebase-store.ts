/**
 * Firebase Realtime Database adapter for the pipeline.
 *
 * Uses the Firebase Admin SDK (same credentials as the existing backend, via
 * `src/services/firebase.ts`). No secrets are read or logged here.
 *
 * Note: SDK one-shot `get`/`set`/`transaction` calls use the REST transport
 * internally; the websocket listener problem handled by the legacy
 * `RealtimeService` does not apply to these scheduled jobs.
 */
import type { Database } from 'firebase-admin/database';
import { getDatabase } from '../../../services/firebase.js';
import {
  ABORT_TRANSACTION,
  childSortValue,
  normalizePath,
  type PipelineStore,
  type StoredEntry,
  type TransactionOutcome,
  type TransactionUpdate,
} from './store.js';

export class FirebasePipelineStore implements PipelineStore {
  readonly kind = 'firebase' as const;
  private reads = 0;
  private writes = 0;
  /** Number of ordered reads that had to fall back to an unordered read. */
  private indexFallbacks = 0;

  constructor(private readonly db: Database) {}

  async get<T>(path: string): Promise<T | null> {
    this.reads++;
    const snap = await this.db.ref(normalizePath(path)).get();
    return snap.exists() ? (snap.val() as T) : null;
  }

  async set(path: string, value: unknown): Promise<void> {
    this.writes++;
    await this.db.ref(normalizePath(path)).set(sanitizeForFirebase(value));
  }

  async update(path: string, patch: Record<string, unknown>): Promise<void> {
    this.writes++;
    await this.db.ref(normalizePath(path)).update(sanitizeForFirebase(patch));
  }

  async remove(path: string): Promise<void> {
    this.writes++;
    await this.db.ref(normalizePath(path)).remove();
  }

  async listRecent<T>(path: string, orderByChild: string, limit: number): Promise<Array<StoredEntry<T>>> {
    this.reads++;
    const ref = this.db.ref(normalizePath(path));
    try {
      const snap = await ref.orderByChild(orderByChild).limitToLast(limit).get();
      const out: Array<StoredEntry<T>> = [];
      snap.forEach((child) => {
        if (child.key) out.push({ key: child.key, value: child.val() as T });
        return false;
      });
      return out;
    } catch (error) {
      if (!isMissingIndexError(error)) throw error;
      // The database rules do not declare `.indexOn` for this path. The query
      // is refused by the server, so fall back to an unordered read and sort
      // in memory: same result, no index required. See docs/ai-pipeline.md
      // for the recommended `.indexOn` rules.
      this.indexFallbacks++;
      const snap = await ref.get();
      const out: Array<StoredEntry<T>> = [];
      snap.forEach((child) => {
        if (child.key) out.push({ key: child.key, value: child.val() as T });
        return false;
      });
      out.sort((a, b) => childSortValue(a, orderByChild) - childSortValue(b, orderByChild));
      return out.slice(Math.max(0, out.length - limit));
    }
  }

  async transaction<T>(
    path: string,
    update: (current: T | null) => TransactionUpdate<T>
  ): Promise<TransactionOutcome<T>> {
    this.writes++;
    const ref = this.db.ref(normalizePath(path));
    const result = await ref.transaction((current) => {
      const next = update((current ?? null) as T | null);
      if (next === ABORT_TRANSACTION) return undefined; // abort compare-and-set
      return next === null ? null : sanitizeForFirebase(next);
    });
    const value = result.snapshot?.val() as T | null;
    return { committed: result.committed, value: value ?? null };
  }

  stats() {
    return { reads: this.reads, writes: this.writes, indexFallbacks: this.indexFallbacks };
  }
}

/**
 * The Realtime Database refuses an `orderByChild` query whose index is not
 * declared in the security rules.
 */
export function isMissingIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /index not defined/i.test(message);
}

export class FirebaseUnavailableError extends Error {
  constructor() {
    super(
      'Firebase is not configured, so the AI pipeline cannot persist results. ' +
        'Set FIREBASE_* credentials or place backend/serviceAccountKey.json, or run with ' +
        'PIPELINE_ALLOW_MEMORY_FALLBACK=true for a non-persistent local test.'
    );
    this.name = 'FirebaseUnavailableError';
  }
}

export function createFirebasePipelineStore(): FirebasePipelineStore {
  const db = getDatabase();
  if (!db) throw new FirebaseUnavailableError();
  return new FirebasePipelineStore(db);
}

/** Firebase rejects `undefined` and non-finite numbers; normalise explicitly. */
export function sanitizeForFirebase<T>(value: T): T {
  return deepSanitize(value) as T;
}

function deepSanitize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // RTDB path-invalid characters in *keys* would create nested nodes.
      if (k === '') continue;
      out[k] = deepSanitize(v);
    }
    return out;
  }
  return value;
}
