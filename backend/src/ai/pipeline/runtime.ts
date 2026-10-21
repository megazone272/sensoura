/**
 * Pipeline runtime.
 *
 * Owns:
 *  - configuration validation
 *  - the storage backend (Firebase RTDB, or an in-memory store for local runs)
 *  - the two independent schedulers (decision ~30 min, prediction ~daily)
 *  - a small HTTP status server (health, status, manual run triggers)
 *  - graceful shutdown
 *
 * The runtime never executes actuators. Manual triggers only re-run the
 * advisory pipelines; they cannot write a command to the ESP32.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { PipelineConfig } from './config.js';
import { configurationWarnings, describeConfig } from './config.js';
import type { PipelineStore } from './storage/store.js';
import { MemoryStore } from './storage/store.js';
import { createFirebasePipelineStore, FirebaseUnavailableError } from './storage/firebase-store.js';
import { buildPaths, pruneCollection, type PipelinePaths } from './storage/records.js';
import { HttpJsonClientImpl } from './integrations/http.js';
import { PipelineScheduler, type RunOutcome } from './scheduler/scheduler.js';
import { runDecisionCycle } from './cycle/decision-cycle.js';
import { runPredictionCycle } from './cycle/prediction-cycle.js';
import { readLegacyPredictions } from './prediction/legacy.js';
import { resolveGreenhouseId } from './cycle/decision-cycle.js';
import type { MinimalLogger } from './integrations/http.js';

export interface RuntimeOptions {
  cfg: PipelineConfig;
  logger: MinimalLogger;
  store?: PipelineStore;
  now?: () => number;
  /** Overrides the HTTP listener port; 0 disables the status server. */
  statusPort?: number;
  statusHost?: string;
}

export interface Runtime {
  readonly store: PipelineStore;
  readonly paths: PipelinePaths;
  readonly decisionScheduler: PipelineScheduler;
  readonly predictionScheduler: PipelineScheduler;
  readonly warnings: string[];
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Record<string, unknown>;
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  const { cfg, logger } = opts;
  const now = opts.now ?? Date.now;
  const warnings = configurationWarnings(cfg);

  let store: PipelineStore;
  if (opts.store) {
    store = opts.store;
  } else {
    try {
      store = createFirebasePipelineStore();
    } catch (error) {
      if (error instanceof FirebaseUnavailableError && cfg.PIPELINE_ALLOW_MEMORY_FALLBACK) {
        logger.warn(
          'Firebase is not configured: using an in-memory store. Nothing will be persisted.'
        );
        store = new MemoryStore();
        warnings.push(
          'PIPELINE_ALLOW_MEMORY_FALLBACK=true: records are kept in memory only and are lost on restart.'
        );
      } else {
        throw error;
      }
    }
  }

  // The greenhouse id is needed to build the per-greenhouse paths. It is
  // resolved lazily on the first cycle; the path prefix is stable for a
  // configured id and falls back to a stable default otherwise.
  const greenhouseId = cfg.GREENHOUSE_ID ?? 'sensoura-greenhouse-01';
  const paths = buildPaths(cfg, greenhouseId);

  const http = new HttpJsonClientImpl({
    timeoutMs: cfg.EXTERNAL_HTTP_TIMEOUT_MS,
    maxAttempts: cfg.EXTERNAL_HTTP_MAX_ATTEMPTS,
    baseDelayMs: cfg.EXTERNAL_HTTP_BASE_DELAY_MS,
    minGapMs: cfg.EXTERNAL_HTTP_MIN_GAP_MS,
    maxResponseBytes: cfg.EXTERNAL_HTTP_MAX_RESPONSE_BYTES,
    now,
    logger,
  });

  const ownerId = `${process.pid}@${randomUUID().slice(0, 8)}`;

  const decisionScheduler = new PipelineScheduler({
    pipeline: 'decision',
    intervalMs: cfg.DECISION_INTERVAL_MS,
    runOnStart: cfg.DECISION_RUN_ON_START,
    startupDelayMs: cfg.SCHEDULER_STARTUP_DELAY_MS,
    lockTtlMs: cfg.LOCK_TTL_MS,
    executionsPath: paths.executions,
    lockPath: `${paths.locks}/decision`,
    ownerId,
    store,
    logger,
    now,
    enabled: cfg.DECISION_ENABLED && cfg.PIPELINE_ENABLED,
    dryRun: cfg.PIPELINE_DRY_RUN,
    run: async () => {
      const result = await runDecisionCycle({ cfg, store, paths, http, logger, now });
      return { stats: result.stats, warnings: result.warnings };
    },
  });

  const predictionScheduler = new PipelineScheduler({
    pipeline: 'prediction',
    intervalMs: cfg.PREDICTION_INTERVAL_MS,
    runOnStart: cfg.PREDICTION_RUN_ON_START,
    startupDelayMs: cfg.SCHEDULER_STARTUP_DELAY_MS,
    lockTtlMs: cfg.LOCK_TTL_MS,
    executionsPath: paths.executions,
    lockPath: `${paths.locks}/prediction`,
    ownerId,
    store,
    logger,
    now,
    enabled: cfg.PREDICTION_ENABLED && cfg.PIPELINE_ENABLED,
    dryRun: cfg.PIPELINE_DRY_RUN,
    run: async () => {
      const result = await runPredictionCycle({ cfg, store, paths, http, logger, now });
      return { stats: result.stats, warnings: result.warnings };
    },
  });

  const statusPort = opts.statusPort ?? cfg.PIPELINE_PORT;
  const statusHost = opts.statusHost ?? cfg.PIPELINE_HOST;
  let server: Server | null = null;

  const runtime: Runtime = {
    store,
    paths,
    decisionScheduler,
    predictionScheduler,
    warnings,

    async start(): Promise<void> {
      logger.info({ config: describeConfig(cfg), warnings }, 'Pipeline runtime starting');

      await decisionScheduler.start();
      await predictionScheduler.start();

      if (statusPort > 0) {
        server = createStatusServer({ cfg, runtime, logger, now });
        await new Promise<void>((resolve, reject) => {
          server!.once('error', reject);
          server!.listen(statusPort, statusHost, () => resolve());
        });
        logger.info({ port: statusPort, host: statusHost }, 'Pipeline status server listening');
      } else {
        logger.info('Pipeline status server disabled');
      }
    },

    async stop(): Promise<void> {
      logger.info('Pipeline runtime stopping');
      await decisionScheduler.stop(cfg.SHUTDOWN_TIMEOUT_MS);
      await predictionScheduler.stop(cfg.SHUTDOWN_TIMEOUT_MS);
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      logger.info('Pipeline runtime stopped');
    },

    status(): Record<string, unknown> {
      const decision = decisionScheduler.last;
      const prediction = predictionScheduler.last;
      return {
        ok: true,
        config: describeConfig(cfg),
        warnings,
        store: { kind: store.kind, ...(store.stats?.() ?? {}) },
        schedules: {
          decision: {
            enabled: cfg.DECISION_ENABLED && cfg.PIPELINE_ENABLED,
            intervalMs: cfg.DECISION_INTERVAL_MS,
            nextRun: decisionScheduler.nextRun,
            running: decisionScheduler.isRunning,
            last: summarize(decision),
          },
          prediction: {
            enabled: cfg.PREDICTION_ENABLED && cfg.PIPELINE_ENABLED,
            intervalMs: cfg.PREDICTION_INTERVAL_MS,
            nextRun: predictionScheduler.nextRun,
            running: predictionScheduler.isRunning,
            last: summarize(prediction),
          },
        },
        paths: {
          sensorData: cfg.SENSOR_DATA_PATH,
          system: cfg.SYSTEM_PATH,
          suggestions: cfg.AI_SUGGESTIONS_PATH,
          predictions: cfg.AI_PREDICTIONS_PATH,
          legacyPredictions: cfg.AI_LEGACY_PREDICTIONS_PATH,
          dataRoot: cfg.AI_DATA_ROOT,
        },
      };
    },
  };

  return runtime;
}

function summarize(outcome: RunOutcome | null): Record<string, unknown> | null {
  if (!outcome) return null;
  return {
    status: outcome.status,
    executionId: outcome.executionId,
    bucketId: outcome.bucketId,
    startedAt: outcome.startedAt,
    finishedAt: outcome.finishedAt,
    durationMs: outcome.durationMs,
    stats: outcome.stats,
    errors: outcome.errors,
    warnings: outcome.warnings,
  };
}

interface StatusServerDeps {
  cfg: PipelineConfig;
  runtime: Runtime;
  logger: MinimalLogger;
  now: () => number;
}

/**
 * Minimal HTTP status server. Endpoints:
 *   GET  /health   liveness
 *   GET  /status   configuration, schedules, last run outcomes
 *   POST /run/decision | /run/prediction   manual trigger (token-protected)
 */
function createStatusServer(deps: StatusServerDeps): Server {
  const { cfg, runtime, logger } = deps;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error) => {
      logger.error({ err: (error as Error).message }, 'Status server request failed');
      sendJson(res, 500, { error: 'internal_error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0];
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === '/health') {
      sendJson(res, 200, { status: 'ok', timestamp: deps.now() });
      return;
    }

    if (method === 'GET' && url === '/status') {
      sendJson(res, 200, runtime.status());
      return;
    }

    // Read-only view of the pre-existing `/Sensoura/aiPredictions` node,
    // parsed with the verified legacy contract.
    if (method === 'GET' && url === '/predictions/legacy') {
      const legacy = await readLegacyPredictions(runtime.store, runtime.paths.legacyPredictions);
      sendJson(res, 200, {
        path: legacy.path,
        present: legacy.present,
        count: legacy.records.length,
        invalidCount: legacy.invalid.length,
        records: legacy.records,
      });
      return;
    }

    if (method === 'POST' && (url === '/run/decision' || url === '/run/prediction')) {
      if (!isAuthorized(req, cfg.PIPELINE_ADMIN_TOKEN)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const pipeline = url.endsWith('decision') ? 'decision' : 'prediction';
      const scheduler =
        pipeline === 'decision' ? runtime.decisionScheduler : runtime.predictionScheduler;
      const outcome = await scheduler.runNow('manual');
      sendJson(res, outcome.status === 'failed' ? 500 : 200, {
        pipeline,
        status: outcome.status,
        executionId: outcome.executionId,
        durationMs: outcome.durationMs,
        stats: outcome.stats,
        errors: outcome.errors,
        warnings: outcome.warnings,
      });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }
}

function isAuthorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true; // no token configured: endpoint is open (documented)
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ') && header.slice(7) === token) return true;
  const alt = req.headers['x-pipeline-token'];
  return typeof alt === 'string' && alt === token;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Prune old pipeline records so the database does not grow without bound. */
export async function prunePipelineRecords(
  store: PipelineStore,
  paths: PipelinePaths,
  cfg: PipelineConfig
): Promise<{ suggestions: number; predictions: number }> {
  const suggestions = await pruneCollection(store, paths.suggestions, 'createdAtMs', cfg.AI_RETENTION_MAX_RECORDS);
  const predictions = await pruneCollection(store, paths.predictions, 'generatedAtMs', cfg.AI_RETENTION_MAX_RECORDS);
  return { suggestions, predictions };
}

export { resolveGreenhouseId };
