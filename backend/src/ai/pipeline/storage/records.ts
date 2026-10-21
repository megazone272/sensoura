/**
 * Record persistence helpers.
 *
 * Layout (all policy nodes are under the configurable AI_DATA_ROOT; defaults shown):
 *   /Sensoura/AI_Data/series/{greenhouseId}/{observedAtMs}       indoor series point
 *   /Sensoura/AI_Data/observations/indoor/{greenhouseId}/{day}/{observedAtMs}/{variable}
 *   /Sensoura/AI_Data/observations/external/{sourceId}/{day}/{hour}/{variable}
 *   /Sensoura/AI_Data/executions/{pipeline}/{bucketId}
 *   /Sensoura/AI_Data/locks/{pipeline}
 *   /Sensoura/AI_Suggestions/{recommendationId}
 *   /Sensoura/AI_Predictions/{predictionId}
 *
 * Legacy `/Sensoura/aiSuggestions` is never touched: it has a different schema
 * and is consumed by the existing dashboard (approving a record there
 * actuates the pump, so the pipeline must not write into it).
 *
 * Legacy `/Sensoura/aiPredictions` is READ, and appended to under new
 * deterministic ids. Its existing records are never modified or deleted.
 */
import type { PipelineConfig } from '../config.js';
import {
  executionV1Schema,
  predictionV1Schema,
  sanitizePathKey,
  suggestionV1Schema,
  type ExecutionV1,
  type IndoorSeriesPoint,
  type ObservationV1,
  type PredictionV1,
  type SuggestionV1,
} from '../schema.js';
import { utcDayKey, utcHourKey } from '../utils/time.js';
import type { PipelineStore, StoredEntry } from './store.js';

export interface PipelinePaths {
  sensorData: string;
  system: string;
  dataRoot: string;
  suggestions: string;
  predictions: string;
  /** Pre-existing prediction node: read-only except for appending new records. */
  legacyPredictions: string;
  executions: string;
  locks: string;
  series: string;
  indoorObservations: string;
  externalObservations: string;
}

export function buildPaths(cfg: PipelineConfig, greenhouseId: string): PipelinePaths {
  const gh = sanitizePathKey(greenhouseId);
  return {
    sensorData: cfg.SENSOR_DATA_PATH,
    system: cfg.SYSTEM_PATH,
    dataRoot: cfg.AI_DATA_ROOT,
    suggestions: cfg.AI_SUGGESTIONS_PATH,
    predictions: cfg.AI_PREDICTIONS_PATH,
    legacyPredictions: cfg.AI_LEGACY_PREDICTIONS_PATH,
    executions: `${cfg.AI_DATA_ROOT}/executions`,
    locks: `${cfg.AI_DATA_ROOT}/locks`,
    series: `${cfg.AI_DATA_ROOT}/series/${gh}`,
    indoorObservations: `${cfg.AI_DATA_ROOT}/observations/indoor/${gh}`,
    externalObservations: `${cfg.AI_DATA_ROOT}/observations/external`,
  };
}

export async function saveSuggestion(store: PipelineStore, path: string, record: SuggestionV1): Promise<void> {
  const parsed = suggestionV1Schema.parse(record);
  await store.set(`${path}/${sanitizePathKey(parsed.recommendationId)}`, parsed);
}

export async function savePrediction(store: PipelineStore, path: string, record: PredictionV1): Promise<void> {
  const parsed = predictionV1Schema.parse(record);
  await store.set(`${path}/${sanitizePathKey(parsed.predictionId)}`, parsed);
}

export async function saveExecution(store: PipelineStore, path: string, record: ExecutionV1): Promise<void> {
  const parsed = executionV1Schema.parse(record);
  await store.set(`${path}/${sanitizePathKey(parsed.pipeline)}/${sanitizePathKey(parsed.bucketId)}`, parsed);
}

export async function readExecution(
  store: PipelineStore,
  path: string,
  pipeline: 'decision' | 'prediction',
  bucketId: string
): Promise<ExecutionV1 | null> {
  const raw = await store.get<ExecutionV1>(`${path}/${pipeline}/${sanitizePathKey(bucketId)}`);
  if (!raw) return null;
  const parsed = executionV1Schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** One series point per unique sensor timestamp; retries overwrite identically. */
export async function saveSeriesPoint(
  store: PipelineStore,
  path: string,
  point: IndoorSeriesPoint
): Promise<void> {
  await store.set(`${path}/${point.observedAtMs}`, point);
}

export async function readSeries(
  store: PipelineStore,
  path: string,
  opts: { sinceMs: number; maxPoints: number }
): Promise<IndoorSeriesPoint[]> {
  const entries = await store.listRecent<IndoorSeriesPoint>(path, 'observedAtMs', opts.maxPoints);
  return entries
    .map((e) => e.value)
    .filter((p) => typeof p?.observedAtMs === 'number' && p.observedAtMs >= opts.sinceMs)
    .sort((a, b) => a.observedAtMs - b.observedAtMs);
}

/**
 * Indoor observations are written as one multi-path update per snapshot:
 * fewer Firebase writes than one write per variable, still one record each.
 */
export async function saveIndoorObservations(
  store: PipelineStore,
  basePath: string,
  records: readonly ObservationV1[]
): Promise<number> {
  if (records.length === 0) return 0;
  const day = utcDayKey(records[0].timestamps.observedAtMs);
  const byTimestamp: Record<string, Record<string, ObservationV1>> = {};
  for (const record of records) {
    const bucket = String(record.timestamps.observedAtMs);
    byTimestamp[bucket] ??= {};
    byTimestamp[bucket][sanitizePathKey(record.variable.normalizedName)] = record;
  }
  await store.update(`${basePath}/${day}`, byTimestamp);
  return records.length;
}

/** External records are keyed by provider variable and UTC hour. */
export async function saveExternalObservations(
  store: PipelineStore,
  basePath: string,
  sourceId: string,
  records: readonly ObservationV1[]
): Promise<number> {
  if (records.length === 0) return 0;
  const byDay: Record<string, Record<string, Record<string, ObservationV1>>> = {};
  for (const record of records) {
    const atMs = record.timestamps.observedAtMs;
    const day = utcDayKey(atMs);
    const hour = utcHourKey(atMs);
    byDay[day] ??= {};
    byDay[day][hour] ??= {};
    byDay[day][hour][sanitizePathKey(record.variable.originalName)] = record;
  }
  for (const [day, hours] of Object.entries(byDay)) {
    await store.update(`${basePath}/${sanitizePathKey(sourceId)}/${day}`, hours);
  }
  return records.length;
}

export async function listRecentSuggestions(
  store: PipelineStore,
  path: string,
  limit: number
): Promise<Array<StoredEntry<SuggestionV1>>> {
  return store.listRecent<SuggestionV1>(path, 'createdAtMs', limit);
}

/**
 * Keep the newest `maxRecords` entries. Bounded read; deletes only pipeline
 * collections, never legacy nodes.
 */
export async function pruneCollection(
  store: PipelineStore,
  path: string,
  orderByChild: string,
  maxRecords: number
): Promise<number> {
  const entries = await store.listRecent(path, orderByChild, maxRecords + 50);
  if (entries.length <= maxRecords) return 0;
  const toRemove = entries.slice(0, entries.length - maxRecords);
  for (const entry of toRemove) await store.remove(`${path}/${entry.key}`);
  return toRemove.length;
}
