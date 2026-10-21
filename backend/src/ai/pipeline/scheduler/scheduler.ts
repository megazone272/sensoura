/**
 * Pipeline scheduler.
 *
 * Guarantees:
 *  - one in-process run at a time per pipeline
 *  - one cross-process run at a time via a durable RTDB job lock with TTL
 *  - a restart cannot re-run a completed schedule bucket (execution record check)
 *  - every run records start, finish, status, stats and sanitized errors
 *  - manual triggers share the same lock/overlap protections
 *  - timers stop and in-flight work is awaited (bounded) on shutdown
 */
import { randomUUID } from 'node:crypto';
import type { ExecutionV1 } from '../schema.js';
import { EXECUTION_SCHEMA } from '../schema.js';
import type { PipelineStore } from '../storage/store.js';
import { JobLock } from '../storage/job-lock.js';
import { readExecution, saveExecution } from '../storage/records.js';
import { alignToInterval, bucketIdFor, compactUtcStamp, toIsoUtc } from '../utils/time.js';
import { describeError, type ExternalApiError } from '../utils/retry.js';
import type { MinimalLogger } from '../integrations/http.js';

export type Trigger = 'schedule' | 'startup' | 'manual';

export type RunStatus =
  | 'succeeded'
  | 'failed'
  | 'skipped_locked'
  | 'skipped_duplicate'
  | 'skipped_overlap'
  | 'skipped_disabled';

export interface RunStats {
  [key: string]: number | string | boolean | null;
}

export interface RunOutcome {
  status: RunStatus;
  executionId: string;
  pipeline: 'decision' | 'prediction';
  bucketId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stats: RunStats;
  errors: Array<{ step: string; code: string; message: string; retryable: boolean }>;
  warnings: string[];
}

export interface SchedulerOptions {
  pipeline: 'decision' | 'prediction';
  intervalMs: number;
  runOnStart: boolean;
  startupDelayMs: number;
  lockTtlMs: number;
  executionsPath: string;
  lockPath: string;
  ownerId: string;
  store: PipelineStore;
  logger: MinimalLogger;
  now?: () => number;
  enabled?: boolean;
  dryRun?: boolean;
  run: (ctx: { executionId: string; bucketId: string; trigger: Trigger }) => Promise<{ stats: RunStats; warnings?: string[] }>;
}

interface InFlight {
  promise: Promise<RunOutcome>;
  startedAt: number;
}

export class PipelineScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: InFlight | null = null;
  private started = false;
  private stopped = false;
  private readonly now: () => number;
  private lastOutcome: RunOutcome | null = null;

  constructor(private readonly opts: SchedulerOptions) {
    this.now = opts.now ?? Date.now;
  }

  get isRunning(): boolean {
    return this.inFlight !== null;
  }

  get last(): RunOutcome | null {
    return this.lastOutcome;
  }

  get nextRun(): string | null {
    if (!this.started || this.stopped || this.timer === null) return null;
    const next = alignToInterval(this.now(), this.opts.intervalMs) + this.opts.intervalMs;
    return toIsoUtc(next);
  }

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    if (this.opts.enabled === false) {
      this.opts.logger.info({ pipeline: this.opts.pipeline }, 'Pipeline disabled by configuration');
      return;
    }

    if (this.opts.runOnStart) {
      this.timer = setTimeout(() => {
        void this.tick('startup');
      }, this.opts.startupDelayMs);
      this.timer.unref?.();
    } else {
      this.scheduleNext();
    }
    this.opts.logger.info(
      {
        pipeline: this.opts.pipeline,
        intervalMs: this.opts.intervalMs,
        runOnStart: this.opts.runOnStart,
        nextRun: this.nextRun,
      },
      'Scheduler started'
    );
  }

  /** Stop timers and wait (bounded) for the in-flight run. */
  async stop(timeoutMs: number): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.inFlight) return;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.());
    await Promise.race([this.inFlight.promise.then(() => undefined), timeout]);
    this.opts.logger.info({ pipeline: this.opts.pipeline }, 'Scheduler stopped');
  }

  /** Manual/startup trigger; returns immediately when a run is in flight. */
  async runNow(trigger: Trigger = 'manual'): Promise<RunOutcome> {
    if (this.opts.enabled === false) {
      return this.outcome('skipped_disabled', '', this.now(), [], [], { reason: 'disabled by configuration' });
    }
    if (this.inFlight) {
      return this.outcome('skipped_overlap', '', this.now(), [], [], { reason: 'a run is already in progress' });
    }
    const executionId = `${this.opts.pipeline}_${compactUtcStamp(this.now())}_${trigger}_${randomUUID().slice(0, 8)}`;
    const promise = this.execute(trigger, executionId).finally(() => {
      this.inFlight = null;
      this.scheduleNext();
    });
    this.inFlight = { promise, startedAt: this.now() };
    return promise;
  }

  private async tick(trigger: Trigger): Promise<void> {
    if (this.stopped) return;
    if (this.inFlight) {
      this.opts.logger.warn({ pipeline: this.opts.pipeline }, 'Skipping scheduled run: previous run still active');
      this.scheduleNext();
      return;
    }

    const bucketId = bucketIdFor(this.now(), this.opts.intervalMs);
    const executionId = `${this.opts.pipeline}_${bucketId}_${trigger}`;
    const promise = this.execute(trigger, executionId, bucketId).finally(() => {
      this.inFlight = null;
      this.scheduleNext();
    });
    this.inFlight = { promise, startedAt: this.now() };
    await promise;
  }

  private async execute(trigger: Trigger, executionId: string, bucketIdInput?: string): Promise<RunOutcome> {
    const startedAtMs = this.now();
    const bucketId = bucketIdInput ?? bucketIdFor(startedAtMs, this.opts.intervalMs);
    const warnings: string[] = [];

    // Restart safety: a schedule/startup bucket that already succeeded must not
    // run again after a restart. Manual runs are always new.
    if (trigger !== 'manual') {
      const existing = await readExecution(this.opts.store, this.opts.executionsPath, this.opts.pipeline, executionId);
      if (existing && (existing.status === 'succeeded' || existing.status === 'running')) {
        return this.outcome('skipped_duplicate', executionId, startedAtMs, [], warnings, {
          reason: `execution ${executionId} already ${existing.status}`,
        });
      }
    }

    const lock = new JobLock(
      this.opts.store,
      this.opts.lockPath,
      this.opts.pipeline,
      this.opts.ownerId,
      this.opts.lockTtlMs,
      this.now,
      executionId
    );
    const acquired = await lock.acquire();
    if (!acquired.acquired) {
      const outcome = this.outcome('skipped_locked', executionId, startedAtMs, [], warnings, {
        reason: `lock held by ${acquired.holder ?? 'unknown'} until ${acquired.expiresAtMs ?? 'unknown'}`,
      });
      await this.record(outcome, bucketId, trigger);
      return outcome;
    }

    const running: ExecutionV1 = {
      schemaVersion: EXECUTION_SCHEMA,
      executionId,
      pipeline: this.opts.pipeline,
      bucketId,
      trigger,
      status: 'running',
      startedAt: toIsoUtc(startedAtMs),
      finishedAt: null,
      durationMs: null,
      stats: {},
      errors: [],
      dryRun: this.opts.dryRun ?? false,
      storeKind: this.opts.store.kind,
      hostInfo: this.opts.ownerId,
    };
    await saveExecution(this.opts.store, this.opts.executionsPath, running);

    let status: RunStatus = 'succeeded';
    let stats: RunStats = {};
    let errors: RunOutcome['errors'] = [];
    try {
      const result = await this.opts.run({ executionId, bucketId, trigger });
      stats = result.stats;
      warnings.push(...(result.warnings ?? []));
    } catch (error) {
      status = 'failed';
      const described: ExternalApiError = describeError(error);
      errors = [{ step: this.opts.pipeline, code: described.kind, message: described.message, retryable: described.retryable }];
      this.opts.logger.error(
        { pipeline: this.opts.pipeline, executionId, code: described.kind, err: described.message },
        'Pipeline run failed'
      );
    } finally {
      const released = await lock.release().catch(() => false);
      if (!released) {
        warnings.push('job lock was not released (expired or ownership changed)');
      }
      const finishedAtMs = this.now();
      const finalRecord: ExecutionV1 = {
        ...running,
        status,
        finishedAt: toIsoUtc(finishedAtMs),
        durationMs: Math.max(0, finishedAtMs - startedAtMs),
        stats,
        errors,
      };
      await saveExecution(this.opts.store, this.opts.executionsPath, finalRecord);
    }

    const outcome = this.outcome(status, executionId, startedAtMs, errors, warnings, stats);
    this.lastOutcome = outcome;
    this.opts.logger.info(
      { pipeline: this.opts.pipeline, executionId, status, durationMs: outcome.durationMs, stats },
      'Pipeline run finished'
    );
    return outcome;
  }

  private async record(outcome: RunOutcome, bucketId: string, trigger: Trigger): Promise<void> {
    const record: ExecutionV1 = {
      schemaVersion: EXECUTION_SCHEMA,
      executionId: outcome.executionId,
      pipeline: this.opts.pipeline,
      bucketId,
      trigger,
      status: outcome.status,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      durationMs: outcome.durationMs,
      stats: outcome.stats,
      errors: outcome.errors,
      dryRun: this.opts.dryRun ?? false,
      storeKind: this.opts.store.kind,
      hostInfo: this.opts.ownerId,
    };
    await saveExecution(this.opts.store, this.opts.executionsPath, record);
  }

  private outcome(
    status: RunStatus,
    executionId: string,
    startedAtMs: number,
    errors: RunOutcome['errors'],
    warnings: string[],
    stats: RunStats
  ): RunOutcome {
    const finishedAtMs = this.now();
    return {
      status,
      executionId,
      pipeline: this.opts.pipeline,
      bucketId: executionId ? bucketIdFor(startedAtMs, this.opts.intervalMs) : '',
      startedAt: toIsoUtc(startedAtMs),
      finishedAt: toIsoUtc(finishedAtMs),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      stats,
      errors,
      warnings,
    };
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const nowMs = this.now();
    const delay = Math.max(1_000, alignToInterval(nowMs, this.opts.intervalMs) + this.opts.intervalMs - nowMs);
    this.timer = setTimeout(() => {
      void this.tick('schedule');
    }, delay);
    this.timer.unref?.();
  }
}
