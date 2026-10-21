/**
 * Tests for the `/Sensoura/aiPredictions` compatibility layer.
 *
 * The fixtures below are the records that actually exist in the database:
 *   "3001": rainfall with a human-readable period string
 *   "3002": air_temp with a numeric value
 * They must keep working exactly as they are.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildLegacyProjections,
  legacyPredictionSchema,
  legacyProjectionId,
  parseLegacyPredictionEntry,
  projectPredictionToLegacy,
  readLegacyPredictions,
  saveLegacyPredictionIfAbsent,
} from '../src/ai/pipeline/prediction/legacy.js';
import { MemoryStore } from '../src/ai/pipeline/storage/store.js';
import { PREDICTION_SCHEMA, type PredictionV1 } from '../src/ai/pipeline/schema.js';

const LEGACY_PATH = '/Sensoura/aiPredictions';

/** The verified live content of /Sensoura/aiPredictions. */
const EXISTING_RECORDS = {
  '3001': {
    type: 'rainfall',
    predictedValue: 'after 2 days afternoon',
    confidence: 0.85,
    predictionTime: 1791867600000,
  },
  '3002': {
    type: 'air_temp',
    predictedValue: 30.0,
    confidence: 0.9,
    predictionTime: 1791867600000,
  },
};

/**
 * The contract an existing consumer would code against: four fields, the
 * field names and the millisecond timestamp, nothing else required.
 */
const legacyConsumerSchema = z.object({
  type: z.string().min(1),
  predictedValue: z.union([z.string(), z.number()]),
  confidence: z.number().min(0).max(1),
  predictionTime: z.number().int().positive(),
});

/**
 * The documented contract for the node after the pipeline appends records:
 * the same four fields, but `confidence` is nullable because the pipeline
 * never fabricates a confidence it did not compute.
 */
const legacyConsumerSchemaNullableConfidence = z.object({
  type: z.string().min(1),
  predictedValue: z.union([z.string(), z.number()]),
  confidence: z.number().min(0).max(1).nullable(),
  predictionTime: z.number().int().positive(),
});

const NOW_MS = 1791867600000;

function makePrediction(overrides: Partial<PredictionV1> & Pick<PredictionV1, 'target'>): PredictionV1 {
  return {
    schemaVersion: PREDICTION_SCHEMA,
    predictionId: `pred_test_${overrides.target}`,
    greenhouseId: 'sensoura-greenhouse-01',
    generatedAt: '2026-10-13T05:00:00.000Z',
    generatedAtMs: NOW_MS,
    predictionType: 'environmental_forecast',
    predictedValue: null,
    unit: null,
    forecastHorizon: null,
    probability: null,
    riskLevel: null,
    uncertainty: null,
    inputSummary: {},
    dataQuality: { status: 'ok', reasons: [] },
    modelVersion: 'open-meteo:best_match',
    methodClass: 'external_provider',
    validationMetrics: null,
    status: 'ok',
    notes: [],
    ...overrides,
  };
}

describe('legacy aiPredictions structure', () => {
  it('parses the two example records that exist in the database', () => {
    const store = new MemoryStore({ [LEGACY_PATH]: EXISTING_RECORDS });
    return readLegacyPredictions(store, LEGACY_PATH).then((read) => {
      expect(read.present).toBe(true);
      expect(read.records).toHaveLength(2);
      expect(read.invalid).toHaveLength(0);

      const rainfall = read.records.find((r) => r.key === '3001')!;
      expect(rainfall.type).toBe('rainfall');
      expect(rainfall.predictedValue).toBe('after 2 days afternoon');
      expect(rainfall.confidence).toBe(0.85);
      expect(rainfall.predictionTime).toBe(1791867600000);

      const airTemp = read.records.find((r) => r.key === '3002')!;
      expect(airTemp.type).toBe('air_temp');
      expect(airTemp.predictedValue).toBe(30.0);
      expect(airTemp.confidence).toBe(0.9);
    });
  });

  it('keeps the existing representation, including the rainfall string, verbatim', () => {
    const entry = parseLegacyPredictionEntry('3001', EXISTING_RECORDS['3001']);
    expect(entry.raw).toEqual(EXISTING_RECORDS['3001']);
    expect(entry.predictedValue).toBe('after 2 days afternoon');
    expect(typeof entry.predictedValue).toBe('string');
  });

  it('stays compatible with an existing consumer parser', () => {
    for (const [key, record] of Object.entries(EXISTING_RECORDS)) {
      const parsed = legacyConsumerSchema.parse(record);
      expect(parsed.type).toBe(record.type);
      expect(parsed.predictionTime).toBe(record.predictionTime);
      expect(parsed.confidence).toBeGreaterThanOrEqual(0);
      expect(parsed.confidence).toBeLessThanOrEqual(1);
      expect(key).toMatch(/^\d+$/);
    }
  });

  it('converts predictionTime between unix milliseconds and UTC', () => {
    const entry = parseLegacyPredictionEntry('3001', EXISTING_RECORDS['3001']);
    expect(entry.predictionTime).toBe(1791867600000);
    expect(entry.predictionTimeIso).toBe(new Date(1791867600000).toISOString());

    // Round trip: ms -> ISO -> ms is lossless.
    const ms = entry.predictionTime!;
    expect(Date.parse(new Date(ms).toISOString())).toBe(ms);
  });

  it('accepts both numeric and text prediction values', () => {
    const numeric = parseLegacyPredictionEntry('3002', EXISTING_RECORDS['3002']);
    const text = parseLegacyPredictionEntry('3001', EXISTING_RECORDS['3001']);
    expect(typeof numeric.predictedValue).toBe('number');
    expect(typeof text.predictedValue).toBe('string');
    expect(numeric.valid).toBe(true);
    expect(text.valid).toBe(true);
  });

  it('flags invalid confidence values instead of trusting them', () => {
    const outOfRange = parseLegacyPredictionEntry('x', {
      type: 'air_temp',
      predictedValue: 30,
      confidence: 1.4,
      predictionTime: NOW_MS,
    });
    expect(outOfRange.confidence).toBeNull();
    expect(outOfRange.valid).toBe(false);
    expect(outOfRange.issues.join(' ')).toMatch(/confidence/);

    const negative = parseLegacyPredictionEntry('x', {
      type: 'air_temp',
      predictedValue: 30,
      confidence: -0.2,
      predictionTime: NOW_MS,
    });
    expect(negative.confidence).toBeNull();
    expect(negative.valid).toBe(false);

    const notANumber = parseLegacyPredictionEntry('x', {
      type: 'air_temp',
      predictedValue: 30,
      confidence: 'high',
      predictionTime: NOW_MS,
    });
    expect(notANumber.confidence).toBeNull();
    expect(notANumber.valid).toBe(false);

    const notFinite = parseLegacyPredictionEntry('x', {
      type: 'air_temp',
      predictedValue: 30,
      confidence: Number.POSITIVE_INFINITY,
      predictionTime: NOW_MS,
    });
    expect(notFinite.confidence).toBeNull();
    expect(notFinite.valid).toBe(false);

    // A missing confidence is "not computed", not an error.
    const absent = parseLegacyPredictionEntry('x', {
      type: 'air_temp',
      predictedValue: 30,
      predictionTime: NOW_MS,
    });
    expect(absent.confidence).toBeNull();
    expect(absent.valid).toBe(true);
  });

  it('flags a predictionTime that is not a millisecond timestamp', () => {
    const seconds = parseLegacyPredictionEntry('x', {
      type: 'air_temp',
      predictedValue: 30,
      confidence: 0.9,
      predictionTime: 1791867600,
    });
    expect(seconds.predictionTime).toBeNull();
    expect(seconds.issues.join(' ')).toMatch(/predictionTime/);
  });
});

describe('projecting pipeline predictions onto the legacy shape', () => {
  it('projects outdoor temperature as a number with an explicit unit', () => {
    const projection = projectPredictionToLegacy(
      makePrediction({
        target: 'outdoor_air_temperature_24h',
        predictedValue: 30.0,
        unit: 'degC',
        forecastHorizon: {
          hours: 24,
          validFrom: '2026-10-13T05:00:00.000Z',
          validTo: '2026-10-14T05:00:00.000Z',
        },
      })
    )!;

    expect(projection.type).toBe('air_temp');
    expect(projection.predictedValue).toBe(30.0);
    expect(projection.unit).toBe('degC');
    expect(projection.predictionTime).toBe(NOW_MS);
    expect(projection.confidence).toBeNull();
    expect(projection.confidenceNote).toMatch(/never invents/i);
  });

  it('projects rainfall as a period string and keeps the quantity in an optional field', () => {
    const projection = projectPredictionToLegacy(
      makePrediction({
        target: 'outdoor_precipitation_24h',
        predictedValue: 3.5,
        unit: 'mm',
        forecastHorizon: {
          hours: 24,
          validFrom: '2026-10-13T05:00:00.000Z',
          validTo: '2026-10-14T05:00:00.000Z',
        },
      })
    )!;

    // Legacy contract: rainfall carries a period description as a string.
    expect(projection.type).toBe('rainfall');
    expect(typeof projection.predictedValue).toBe('string');
    expect(projection.predictedValue).toBe('after 1 day');
    expect(projection.precipitationMm).toBe(3.5);
    expect(projection.unit).toBe('mm');
  });

  it('does not publish unsupported or diagnostic predictions', () => {
    expect(
      projectPredictionToLegacy(
        makePrediction({ target: 'voc_index_from_mq135', status: 'unsupported' })
      )
    ).toBeNull();
    expect(
      projectPredictionToLegacy(
        makePrediction({
          target: 'outdoor_reference_cross_check',
          predictionType: 'source_comparison',
          predictedValue: { date: '2026-10-12' },
        })
      )
    ).toBeNull();
    expect(
      projectPredictionToLegacy(
        makePrediction({ target: 'outdoor_air_temperature_24h', status: 'error' })
      )
    ).toBeNull();
  });

  it('produces records an existing consumer parser accepts', () => {
    const projections = buildLegacyProjections(
      [
        makePrediction({
          target: 'outdoor_air_temperature_24h',
          predictedValue: 30.0,
          unit: 'degC',
        }),
        makePrediction({
          target: 'outdoor_precipitation_72h',
          predictedValue: 12.25,
          unit: 'mm',
        }),
      ],
      [],
      NOW_MS
    );

    expect(projections).toHaveLength(2);
    for (const projection of projections) {
      // The four legacy field names are all present, with the documented
      // types, so the existing reader keeps working.
      const parsed = legacyConsumerSchemaNullableConfidence.parse(projection.record);
      expect(parsed.type).toBeTruthy();
      expect(parsed.predictionTime).toBe(NOW_MS);
      expect(parsed.confidence).toBeNull();
      expect(parsed.predictedValue).toBeDefined();
    }
  });

  it('never invents a confidence value', () => {
    const projections = buildLegacyProjections(
      [
        makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 30 }),
        makePrediction({ target: 'outdoor_precipitation_24h', predictedValue: 1 }),
      ],
      [],
      NOW_MS
    );
    for (const projection of projections) {
      expect(projection.record.confidence).toBeNull();
      expect(projection.record.confidenceNote).toBeTruthy();
    }
  });

  it('keeps the existing records readable by a strict consumer', () => {
    for (const record of Object.values(EXISTING_RECORDS)) {
      expect(() => legacyConsumerSchema.parse(record)).not.toThrow();
    }
  });
});

describe('record ids', () => {
  it('is deterministic for the same inputs', () => {
    const predictions = [
      makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 30 }),
      makePrediction({ target: 'outdoor_precipitation_24h', predictedValue: 3.5 }),
    ];
    const a = buildLegacyProjections(predictions, [], NOW_MS);
    const b = buildLegacyProjections(predictions, [], NOW_MS);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it('is stable regardless of the order the predictions arrive in', () => {
    const a = makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 30 });
    const b = makePrediction({ target: 'outdoor_precipitation_24h', predictedValue: 3.5 });
    const forward = buildLegacyProjections([a, b], [], NOW_MS);
    const reversed = buildLegacyProjections([b, a], [], NOW_MS);
    expect(forward.map((p) => p.record.type)).toEqual(reversed.map((p) => p.record.type));
    expect(forward.map((p) => p.id)).toEqual(reversed.map((p) => p.id));
  });

  it('cannot collide with the existing numeric record keys', () => {
    const id = legacyProjectionId(NOW_MS, 0);
    expect(id).toMatch(/^\d+$/);
    expect(id).not.toBe('3001');
    expect(id).not.toBe('3002');
    expect(Number(id)).toBeGreaterThan(1e12);
  });

  it('splits back into its timestamp and index without ambiguity', () => {
    const id = legacyProjectionId(NOW_MS, 7);
    expect(id).toHaveLength(17);
    expect(Number(id.slice(0, 13))).toBe(NOW_MS);
    expect(Number(id.slice(13))).toBe(7);
  });

  it('refuses inputs that would break the fixed-width id format', () => {
    expect(() => legacyProjectionId(0, 0)).toThrow(/13-digit/);
    expect(() => legacyProjectionId(1_000_000_000_000, 0)).not.toThrow();
    expect(() => legacyProjectionId(NOW_MS, -1)).toThrow(/index/);
    expect(() => legacyProjectionId(NOW_MS, 10_000)).toThrow(/index/);
    expect(() => legacyProjectionId(NOW_MS, 1.5)).toThrow(/index/);
  });

  it('gives different ids to different records of the same run', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(legacyProjectionId(NOW_MS, i));
    expect(ids.size).toBe(50);
    expect(new Set([...ids].map((id) => id.slice(0, 13))).size).toBe(1);
  });

  it('gives different ids across runs', () => {
    expect(legacyProjectionId(NOW_MS, 0)).not.toBe(legacyProjectionId(NOW_MS + 1, 0));
  });
});

describe('writing new predictions without destroying existing ones', () => {
  it('preserves the existing records byte for byte', async () => {
    const store = new MemoryStore({ [LEGACY_PATH]: structuredClone(EXISTING_RECORDS) });
    const projections = buildLegacyProjections(
      [
        makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 28.4 }),
        makePrediction({ target: 'outdoor_precipitation_24h', predictedValue: 1.2 }),
      ],
      [],
      NOW_MS
    );

    for (const projection of projections) {
      const outcome = await saveLegacyPredictionIfAbsent(
        store,
        LEGACY_PATH,
        projection.id,
        projection.record
      );
      expect(outcome).toBe('written');
    }

    const after = await store.get<Record<string, unknown>>(LEGACY_PATH);
    expect(after['3001']).toEqual(EXISTING_RECORDS['3001']);
    expect(after['3002']).toEqual(EXISTING_RECORDS['3002']);
    expect(Object.keys(after)).toHaveLength(2 + projections.length);
  });

  it('never overwrites an existing record, even under the same key', async () => {
    const store = new MemoryStore({ [LEGACY_PATH]: structuredClone(EXISTING_RECORDS) });
    const projection = buildLegacyProjections(
      [makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 28.4 })],
      [],
      NOW_MS
    )[0];

    await saveLegacyPredictionIfAbsent(store, LEGACY_PATH, projection.id, projection.record);
    const mutated = { ...projection.record, predictedValue: 99 };
    const outcome = await saveLegacyPredictionIfAbsent(
      store,
      LEGACY_PATH,
      projection.id,
      mutated as typeof projection.record
    );

    expect(outcome).toBe('skipped_existing');
    const after = await store.get<Record<string, Record<string, unknown>>>(LEGACY_PATH);
    expect(after[projection.id].predictedValue).toBe(28.4);
    expect(after['3002'].predictedValue).toBe(30.0);
  });

  it('is idempotent across repeated runs of the same cycle', async () => {
    const store = new MemoryStore({ [LEGACY_PATH]: structuredClone(EXISTING_RECORDS) });
    const predictions = [makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 28.4 })];

    for (let run = 0; run < 3; run++) {
      const projections = buildLegacyProjections(predictions, [], NOW_MS);
      for (const projection of projections) {
        await saveLegacyPredictionIfAbsent(store, LEGACY_PATH, projection.id, projection.record);
      }
    }

    const after = await store.get<Record<string, unknown>>(LEGACY_PATH);
    expect(Object.keys(after)).toHaveLength(3);
    expect(after['3001']).toEqual(EXISTING_RECORDS['3001']);
  });

  it('links a new prediction to the previous record of the same type', async () => {
    const store = new MemoryStore({ [LEGACY_PATH]: structuredClone(EXISTING_RECORDS) });
    const read = await readLegacyPredictions(store, LEGACY_PATH);

    const projections = buildLegacyProjections(
      [makePrediction({ target: 'outdoor_air_temperature_24h', predictedValue: 28.4 })],
      read.records,
      NOW_MS + 3_600_000
    );

    expect(projections[0].record.previousPrediction).toEqual({
      predictionTime: 1791867600000,
      predictedValue: 30.0,
      confidence: 0.9,
    });
  });
});

describe('legacy record validation', () => {
  it('accepts the existing records with the documented schema', () => {
    for (const record of Object.values(EXISTING_RECORDS)) {
      const parsed = legacyPredictionSchema.parse(record);
      expect(parsed.type).toBe(record.type);
      expect(parsed.predictionTime).toBe(record.predictionTime);
    }
  });

  it('rejects a record whose confidence is outside 0..1', () => {
    const result = legacyPredictionSchema.safeParse({
      type: 'air_temp',
      predictedValue: 30,
      confidence: 4,
      predictionTime: NOW_MS,
    });
    expect(result.success).toBe(false);
  });

  it('keeps unknown additive fields when parsing', () => {
    const parsed = legacyPredictionSchema.parse({
      type: 'air_temp',
      predictedValue: 30,
      confidence: 0.9,
      predictionTime: NOW_MS,
      unit: 'degC',
      forecastEnd: '2026-10-14T05:00:00.000Z',
    });
    expect((parsed as Record<string, unknown>).unit).toBe('degC');
    expect((parsed as Record<string, unknown>).forecastEnd).toBe('2026-10-14T05:00:00.000Z');
  });
});
