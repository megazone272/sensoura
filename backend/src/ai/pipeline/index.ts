/**
 * Pipeline process entrypoint.
 *
 * Runs the AI data-integration, decision and prediction pipelines as their own
 * process, separate from the legacy HTTP backend in `src/index.ts`.
 *
 *   npm run pipeline          # start the scheduler + status server
 *   npm run pipeline:once     # run both pipelines once and exit
 */
import { loadPipelineConfig, PipelineConfigError } from './config.js';
import { createRuntime } from './runtime.js';
import { runDecisionCycle } from './cycle/decision-cycle.js';
import { runPredictionCycle } from './cycle/prediction-cycle.js';
import { HttpJsonClientImpl } from './integrations/http.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger('pipeline');

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadPipelineConfig(process.env);
  } catch (error) {
    if (error instanceof PipelineConfigError) {
      logger.error({ issues: error.issues }, 'Invalid pipeline configuration');
      process.exitCode = 78; // EX_CONFIG
      return;
    }
    throw error;
  }

  // `--once` runs both pipelines a single time and exits: useful for a
  // scheduled job, a smoke test or a one-off backfill.
  if (process.argv.includes('--once')) {
    await runOnce(cfg);
    return;
  }

  const runtime = createRuntime({ cfg, logger });
  await runtime.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting the pipeline down');
    try {
      await runtime.stop();
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

void main().catch((error) => {
  logger.fatal({ err: error }, 'Pipeline failed to start');
  process.exit(1);
});

/** Run the decision and prediction cycles once, then exit. */
async function runOnce(cfg: ReturnType<typeof loadPipelineConfig>): Promise<void> {
  const runtime = createRuntime({ cfg, logger, statusPort: 0 });
  const http = new HttpJsonClientImpl({
    timeoutMs: cfg.EXTERNAL_HTTP_TIMEOUT_MS,
    maxAttempts: cfg.EXTERNAL_HTTP_MAX_ATTEMPTS,
    baseDelayMs: cfg.EXTERNAL_HTTP_BASE_DELAY_MS,
    minGapMs: cfg.EXTERNAL_HTTP_MIN_GAP_MS,
    maxResponseBytes: cfg.EXTERNAL_HTTP_MAX_RESPONSE_BYTES,
    logger,
  });

  const decision = await runDecisionCycle({
    cfg,
    store: runtime.store,
    paths: runtime.paths,
    http,
    logger,
  });
  logger.info({ stats: decision.stats, warnings: decision.warnings }, 'Decision cycle finished');

  const prediction = await runPredictionCycle({
    cfg,
    store: runtime.store,
    paths: runtime.paths,
    http,
    logger,
  });
  logger.info({ stats: prediction.stats, warnings: prediction.warnings }, 'Prediction cycle finished');

  // The Firebase SDK keeps sockets open; exit explicitly so `--once` really
  // is a one-shot command (cron, CI, a scheduled job).
  process.exit(0);
}
