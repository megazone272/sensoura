/**
 * Storage abstraction.
 *
 * The pipeline writes only to its own nodes. Existing `/Sensoura/sensorData`,
 * `/Sensoura/system`, `/Sensoura/commands`, `/Sensoura/aiSuggestions` are
 * read-only for this process; nothing here can issue an actuator command.
 */

export interface StoredEntry<T> {
  key: string;
  value: T;
}

/** Sentinel used by `transaction` callbacks to abort a compare-and-set.
 * `null` means "delete the node" (RTDB semantics). */
export const ABORT_TRANSACTION = Symbol('abort-transaction');
export type TransactionUpdate<T> = T | null | typeof ABORT_TRANSACTION;

export interface TransactionOutcome<T> {
  committed: boolean;
  value: T | null;
}

export interface PipelineStore {
  readonly kind: 'firebase' | 'memory';
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  update(path: string, patch: Record<string, unknown>): Promise<void>;
  remove(path: string): Promise<void>;
  /** Latest entries ordered by a numeric child key (bounded read). */
  listRecent<T = unknown>(path: string, orderByChild: string, limit: number): Promise<Array<StoredEntry<T>>>;
  transaction<T>(
    path: string,
    update: (current: T | null) => TransactionUpdate<T>
  ): Promise<TransactionOutcome<T>>;
  stats?(): { reads: number; writes: number };
}

export function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '');
}

export function childKey(path: string, key: string): string {
  const base = normalizePath(path);
  return base === '/' ? `/${key}` : `${base}/${key}`;
}

/**
 * Remove an existing node's descendants before a `set`, mirroring RTDB
 * semantics (set replaces the subtree).
 */
export class MemoryStore implements PipelineStore {
  readonly kind = 'memory' as const;
  private readonly data = new Map<string, unknown>();
  private reads = 0;
  private writes = 0;

  constructor(seed: Record<string, unknown> = {}) {
    for (const [path, value] of Object.entries(seed)) this.data.set(normalizePath(path), clone(value));
  }

  async get<T>(path: string): Promise<T | null> {
    this.reads++;
    const p = normalizePath(path);
    // Reconstruct a subtree from descendant paths (RTDB-like behaviour): a
    // value written at a deeper key must be visible when the parent is read.
    const prefix = p === '/' ? '/' : `${p}/`;
    const subtree: Record<string, unknown> = {};
    let found = false;
    for (const [key, value] of this.data) {
      if (key === p) continue;
      if (key.startsWith(prefix)) {
        assignByPath(subtree, key.slice(prefix.length).split('/'), clone(value));
        found = true;
      }
    }
    const direct = this.data.get(p);
    if (direct !== undefined) {
      if (direct !== null && typeof direct === 'object' && !Array.isArray(direct)) {
        Object.assign(subtree, clone(direct) as Record<string, unknown>);
      } else {
        return clone(direct) as T;
      }
      found = true;
    }
    return found ? (subtree as T) : null;
  }

  async set(path: string, value: unknown): Promise<void> {
    this.writes++;
    const p = normalizePath(path);
    this.dropDescendants(p);
    if (value === null || value === undefined) this.data.delete(p);
    else this.data.set(p, clone(value));
  }

  async update(path: string, patch: Record<string, unknown>): Promise<void> {
    const current = (await this.get<Record<string, unknown>>(path)) ?? {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      // RTDB update accepts slash-separated relative paths.
      if (key.includes('/')) assignByPath(next, key.split('/'), clone(value));
      else if (value === null) delete next[key];
      else next[key] = clone(value);
    }
    await this.set(path, next);
  }

  async remove(path: string): Promise<void> {
    this.writes++;
    const p = normalizePath(path);
    this.dropDescendants(p);
    this.data.delete(p);
  }

  async listRecent<T>(path: string, orderByChild: string, limit: number): Promise<Array<StoredEntry<T>>> {
    this.reads++;
    const base = normalizePath(path);
    const prefix = `${base}/`;
    const entries: Array<StoredEntry<T>> = [];
    for (const [key, value] of this.data) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes('/')) continue; // direct children only
      entries.push({ key: rest, value: clone(value) as T });
    }
    entries.sort((a, b) => childSortValue(a, orderByChild) - childSortValue(b, orderByChild));
    return entries.slice(Math.max(0, entries.length - limit));
  }

  async transaction<T>(
    path: string,
    update: (current: T | null) => TransactionUpdate<T>
  ): Promise<TransactionOutcome<T>> {
    const p = normalizePath(path);
    const current = (await this.get<T>(p)) ?? null;
    const next = update(current === null ? null : clone(current));
    if (next === ABORT_TRANSACTION) return { committed: false, value: current };
    await this.set(p, next);
    return { committed: true, value: next === null ? null : clone(next) };
  }

  stats() {
    return { reads: this.reads, writes: this.writes };
  }

  /** Test/debug helper. */
  dump(): Record<string, unknown> {
    return Object.fromEntries([...this.data.entries()].map(([k, v]) => [k, clone(v)]));
  }

  private dropDescendants(path: string): void {
    const prefix = `${path}/`;
    for (const key of [...this.data.keys()]) {
      if (key === path || key.startsWith(prefix)) this.data.delete(key);
    }
  }
}

function childSortValue(entry: StoredEntry<unknown>, child: string): number {
  const value = entry.value;
  if (typeof value === 'object' && value !== null) {
    const raw = (value as Record<string, unknown>)[child];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  const keyNum = Number(entry.key);
  return Number.isFinite(keyNum) ? keyNum : 0;
}

/**
 * Sort value of a child key, shared by the memory store and the Firebase
 * fallback that sorts an unordered read in memory.
 */
export { childSortValue };

function assignByPath(target: Record<string, unknown>, parts: string[], value: unknown): void {
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing = cursor[part];
    if (typeof existing !== 'object' || existing === null) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete cursor[last];
  else cursor[last] = value;
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}
