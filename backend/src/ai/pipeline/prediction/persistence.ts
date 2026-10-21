/**
 * Persistence baseline: tomorrow = today.
 *
 * This is deliberately not a trained ML model. It exists so the pipeline has a
 * measurable baseline before any model can claim skill. Metrics come from a
 * walk-forward backtest on stored observations at the same horizon; they are
 * reported with sample counts and are not extrapolated beyond the data.
 */

export interface SeriesPoint {
  ms: number;
  value: number;
}

export interface PersistenceBacktest {
  supported: boolean;
  horizonHours: number;
  forecast: number | null;
  metrics: {
    MAE: number;
    RMSE: number;
    bias: number;
    sampleSize: number;
  } | null;
  residualStd: number | null;
  reasons: string[];
}

export function backtestPersistence(
  points: readonly SeriesPoint[],
  opts: { horizonHours: number; toleranceMinutes: number; minSamples: number }
): PersistenceBacktest {
  const clean = points
    .filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.value))
    .sort((a, b) => a.ms - b.ms);

  const base: PersistenceBacktest = {
    supported: false,
    horizonHours: opts.horizonHours,
    forecast: clean.length > 0 ? clean[clean.length - 1].value : null,
    metrics: null,
    residualStd: null,
    reasons: [],
  };

  if (clean.length < 2) {
    return { ...base, reasons: ['fewer than 2 valid historical observations'] };
  }

  const horizonMs = opts.horizonHours * 3_600_000;
  const toleranceMs = opts.toleranceMinutes * 60_000;
  const residuals: number[] = [];
  let j = 0;

  for (let i = 0; i < clean.length - 1; i++) {
    const target = clean[i].ms + horizonMs;
    if (j <= i) j = i + 1;
    while (j < clean.length && clean[j].ms < target - toleranceMs) j++;
    if (j >= clean.length) break;
    const actual = clean[j];
    if (Math.abs(actual.ms - target) > toleranceMs) continue;
    // Avoid reusing the same actual point for many predictions.
    if (j > i) {
      residuals.push(clean[i].value - actual.value);
      j++;
    }
  }

  if (residuals.length < opts.minSamples) {
    return {
      ...base,
      reasons: [
        `only ${residuals.length} backtest pairs at ${opts.horizonHours} h with ±${opts.toleranceMinutes} min tolerance; ` +
          `need ${opts.minSamples} (requires proportionally longer history)`,
      ],
    };
  }

  const mae = residuals.reduce((a, r) => a + Math.abs(r), 0) / residuals.length;
  const rmse = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / residuals.length);
  const bias = residuals.reduce((a, r) => a + r, 0) / residuals.length;
  const mean = bias;
  const variance = residuals.reduce((a, r) => a + (r - mean) ** 2, 0) / residuals.length;

  return {
    supported: true,
    horizonHours: opts.horizonHours,
    forecast: clean[clean.length - 1].value,
    metrics: {
      MAE: round(mae, 3),
      RMSE: round(rmse, 3),
      bias: round(bias, 3),
      sampleSize: residuals.length,
    },
    residualStd: round(Math.sqrt(variance), 3),
    reasons: [
      'walk-forward persistence backtest on stored observations',
      'pairs are selected within a fixed time tolerance; overlapping windows are not independent samples',
    ],
  };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
