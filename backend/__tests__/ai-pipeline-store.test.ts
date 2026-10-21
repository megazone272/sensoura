/**
 * Tests for the Firebase Realtime Database adapter of the pipeline.
 *
 * A minimal fake database mimics the RTDB semantics the adapter relies on,
 * including the server's refusal of an `orderByChild` query whose index is
 * not declared in the security rules.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  FirebasePipelineStore,
  isMissingIndexError,
  sanitizeForFirebase,
} from '../src/ai/pipeline/storage/firebase-store.js';
import { ABORT_TRANSACTION } from '../src/ai/pipeline/storage/store.js';

interface FakeRef {
  get(): Promise<{
    val(): unknown;
    exists(): boolean;
    forEach(cb: (c: FakeChild) => boolean): void;
  }>;
  set(value: unknown): Promise<void>;
  update(patch: Record<string, unknown>): Promise<void>;
  remove(): Promise<void>;
  transaction<T>(fn: (current: T | null) => T | null | typeof ABORT_TRANSACTION): Promise<{
    committed: boolean;
    snapshot: { val(): unknown } | null;
  }>;
  orderByChild(child: string): { limitToLast(limit: number): { get(): Promise<{ forEach(cb: (c: FakeChild) => boolean): void }> } };
}

interface FakeChild {
  key: string | null;
  val(): unknown;
}

/** Minimal in-memory RTDB: flat key -> value, no deep merge on set. */
class FakeDatabase {
  readonly data = new Map<string, unknown>();
  /** Paths that have a declared index, e.g. '/x': ['observedAtMs']. */
  readonly indexes = new Map<string, string[]>();

  ref(path: string): FakeRef {
    const key = path === '/' ? '/' : path.replace(/\/+$/, '');
    const db = this;
    const children = () => {
      const prefix = key === '/' ? '/' : `${key}/`;
      return [...db.data.entries()]
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(([k, value]) => ({ key: k.slice(prefix.length), val: () => value }));
    };
    return {
      async get() {
        const direct = db.data.has(key);
        return {
          val: () => (direct ? db.data.get(key) : null),
          exists: () => direct || children().length > 0,
          forEach(cb: (c: FakeChild) => boolean) {
            for (const child of children()) cb(child);
          },
        };
      },
      async set(value: unknown) {
        db.data.set(key, value);
      },
      async update(patch: Record<string, unknown>) {
        const current = (db.data.get(key) as Record<string, unknown>) ?? {};
        db.data.set(key, { ...current, ...patch });
      },
      async remove() {
        db.data.delete(key);
      },
      async transaction(fn) {
        const current = (db.data.get(key) as never) ?? null;
        const next = fn(current);
        // The adapter signals an abort by returning `undefined`, like the SDK.
        if (next === ABORT_TRANSACTION || next === undefined) {
          return { committed: false, snapshot: { val: () => current } };
        }
        if (next === null) db.data.delete(key);
        else db.data.set(key, next);
        return { committed: true, snapshot: { val: () => db.data.get(key) ?? null } };
      },
      orderByChild(child: string) {
        return {
          limitToLast(limit: number) {
            return {
              async get() {
                const declared = db.indexes.get(key);
                if (!declared || !declared.includes(child)) {
                  throw new Error(
                    `Index not defined, add ".indexOn": "${child}", for path "${key}", to the rules`
                  );
                }
                const entries = [...db.data.entries()]
                  .filter(([k]) => k.startsWith(`${key}/`) && !k.slice(key.length + 1).includes('/'))
                  .map(([k, value]) => ({
                    key: k.slice(key.length + 1),
                    val: () => (value as Record<string, unknown>)[child],
                  }))
                  .sort((a, b) => Number(a.val()) - Number(b.val()))
                  .slice(-limit);
                return {
                  forEach(cb: (c: FakeChild) => boolean) {
                    for (const entry of entries) cb(entry);
                  },
                };
              },
            };
          },
        };
      },
    };
  }
}

describe('Firebase pipeline store', () => {
  it('reads, writes, updates and removes', async () => {
    const db = new FakeDatabase();
    const store = new FirebasePipelineStore(db as never);

    await store.set('/Sensoura/aiPredictions/3001', { type: 'rainfall' });
    expect(await store.get('/Sensoura/aiPredictions/3001')).toEqual({ type: 'rainfall' });

    await store.update('/Sensoura/aiPredictions/3001', { confidence: 0.85 });
    expect(await store.get('/Sensoura/aiPredictions/3001')).toEqual({
      type: 'rainfall',
      confidence: 0.85,
    });

    await store.remove('/Sensoura/aiPredictions/3001');
    expect(await store.get('/Sensoura/aiPredictions/3001')).toBeNull();
  });

  it('falls back to an unordered read when the index is not declared', async () => {
    const db = new FakeDatabase();
    db.data.set('/Sensoura/AI_Data/series/gh/100', { observedAtMs: 100 });
    db.data.set('/Sensoura/AI_Data/series/gh/200', { observedAtMs: 200 });
    db.data.set('/Sensoura/AI_Data/series/gh/300', { observedAtMs: 300 });

    const store = new FirebasePipelineStore(db as never);

    // No index is declared, so the server refuses the ordered query. The
    // adapter catches that and retries unordered instead of failing the cycle.
    const entries = await store.listRecent('/Sensoura/AI_Data/series/gh', 'observedAtMs', 10);
    expect(entries.map((e) => e.key)).toEqual(['100', '200', '300']);
    expect(store.stats().indexFallbacks).toBe(1);
  });

  it('propagates a non-index server error instead of silently falling back', async () => {
    const db = new FakeDatabase();
    const store = new FirebasePipelineStore(db as never);
    const boom = new Error('permission denied');
    const original = db.ref.bind(db);
    vi.spyOn(db, 'ref').mockImplementation((path: string) => {
      const ref = original(path);
      return {
        ...ref,
        orderByChild: () => ({
          limitToLast: () => ({
            get: () => Promise.reject(boom),
          }),
        }),
      } as never;
    });

    await expect(store.listRecent('/Sensoura/AI_Data/series/gh', 'observedAtMs', 10)).rejects.toThrow(
      'permission denied'
    );
    expect(store.stats().indexFallbacks).toBe(0);
  });

  it('uses the ordered query when the index is declared', async () => {
    const db = new FakeDatabase();
    db.indexes.set('/Sensoura/AI_Data/series/gh', ['observedAtMs']);
    db.data.set('/Sensoura/AI_Data/series/gh/100', { observedAtMs: 100 });
    db.data.set('/Sensoura/AI_Data/series/gh/200', { observedAtMs: 200 });

    const store = new FirebasePipelineStore(db as never);
    const entries = await store.listRecent('/Sensoura/AI_Data/series/gh', 'observedAtMs', 1);
    expect(entries.map((e) => e.key)).toEqual(['200']);
    expect(store.stats().indexFallbacks).toBe(0);
  });

  it('runs a compare-and-set transaction and can abort it', async () => {
    const db = new FakeDatabase();
    const store = new FirebasePipelineStore(db as never);

    const first = await store.transaction<{ owner: string }>('/locks/decision', () => ({ owner: 'a' }));
    expect(first.committed).toBe(true);

    const second = await store.transaction<{ owner: string }>('/locks/decision', () => ABORT_TRANSACTION);
    expect(second.committed).toBe(false);
    expect((await store.get('/locks/decision')) as { owner: string }).toEqual({ owner: 'a' });
  });

  it('recognises the missing-index error', () => {
    expect(isMissingIndexError(new Error('Index not defined, add ".indexOn"'))).toBe(true);
    expect(isMissingIndexError(new Error('permission denied'))).toBe(false);
    expect(isMissingIndexError('Index not defined')).toBe(true);
  });
});

describe('Firebase value sanitisation', () => {
  it('replaces values the Realtime Database would reject', () => {
    const sanitized = sanitizeForFirebase({
      ok: 1,
      missing: undefined,
      notFinite: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      nested: { alsoMissing: undefined },
      list: [1, undefined, Number.NaN],
    }) as Record<string, unknown>;

    expect(sanitized.ok).toBe(1);
    expect(sanitized.missing).toBeNull();
    expect(sanitized.notFinite).toBeNull();
    expect(sanitized.infinite).toBeNull();
    expect((sanitized.nested as Record<string, unknown>).alsoMissing).toBeNull();
    expect(sanitized.list).toEqual([1, null, null]);
  });

  it('keeps a null confidence as null instead of dropping it', () => {
    const sanitized = sanitizeForFirebase({ confidence: null, type: 'air_temp' }) as Record<string, unknown>;
    expect(sanitized.confidence).toBeNull();
    expect(sanitized.type).toBe('air_temp');
  });
});
