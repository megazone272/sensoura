/**
 * Durable job lock.
 *
 * A compare-and-set transaction on `/AI_Data/locks/{pipeline}` guarantees that
 * only one instance runs a pipeline at a time, across processes and restarts.
 * Expired locks (crashed run) are reclaimable after `ttlMs`.
 */
import { LOCK_SCHEMA, type LockV1 } from '../schema.js';
import { randomUUID } from 'node:crypto';
import { ABORT_TRANSACTION, type PipelineStore } from './store.js';

export interface AcquireResult {
  acquired: boolean;
  holder: string | null;
  expiresAtMs: number | null;
  lock: LockV1 | null;
}

export class JobLock {
  readonly runId: string;

  constructor(
    private readonly store: PipelineStore,
    private readonly path: string,
    private readonly pipeline: string,
    private readonly ownerId: string,
    private readonly ttlMs: number,
    private readonly now: () => number,
    runId: string = randomUUID()
  ) {
    this.runId = runId;
  }

  async acquire(): Promise<AcquireResult> {
    const nowMs = this.now();
    const candidate: LockV1 = {
      schemaVersion: LOCK_SCHEMA,
      ownerId: this.ownerId,
      runId: this.runId,
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + this.ttlMs,
    };

    const outcome = await this.store.transaction<LockV1>(this.path, (current) => {
      if (current && Number.isFinite(current.expiresAtMs) && current.expiresAtMs > nowMs) {
        return ABORT_TRANSACTION; // held by a live owner
      }
      return candidate;
    });

    if (outcome.committed && outcome.value?.ownerId === this.ownerId && outcome.value.runId === this.runId) {
      return { acquired: true, holder: this.ownerId, expiresAtMs: candidate.expiresAtMs, lock: candidate };
    }

    const holder = outcome.value?.ownerId ?? null;
    return { acquired: false, holder, expiresAtMs: outcome.value?.expiresAtMs ?? null, lock: outcome.value ?? null };
  }

  /** Release only if this run still owns the lock. */
  async release(): Promise<boolean> {
    const outcome = await this.store.transaction<LockV1>(this.path, (current) => {
      if (!current) return ABORT_TRANSACTION;
      if (current.ownerId !== this.ownerId || current.runId !== this.runId) return ABORT_TRANSACTION;
      return null; // delete
    });
    return outcome.committed;
  }

  /** Extend while a long run is still active. */
  async renew(): Promise<boolean> {
    const nowMs = this.now();
    const outcome = await this.store.transaction<LockV1>(this.path, (current) => {
      if (!current || current.ownerId !== this.ownerId || current.runId !== this.runId) {
        return ABORT_TRANSACTION;
      }
      return { ...current, expiresAtMs: nowMs + this.ttlMs };
    });
    return outcome.committed;
  }

  get pipelineName(): string {
    return this.pipeline;
  }
}
