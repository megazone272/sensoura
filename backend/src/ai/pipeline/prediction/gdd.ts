/**
 * Growing degree days (GDD) by the simple daily-mean method:
 *
 *   GDD(day) = max(0, Tmean(day) - Tbase)
 *
 * and cumulative GDD is the sum from the planting date. Tbase is configurable
 * (default 7 °C); no cultivar-specific thresholds are invented — stage targets
 * must be supplied from a cited source.
 */

export interface DailyTemperature {
  dateKey: string; // YYYY-MM-DD
  meanTempC: number | null;
}

export interface GddDay {
  dateKey: string;
  meanTempC: number | null;
  gdd: number | null;
  cumulative: number;
  missing: boolean;
}

export interface GddSeries {
  days: GddDay[];
  cumulativeToDate: number;
  missingDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export function computeGddSeries(
  days: readonly DailyTemperature[],
  baseTempC: number,
  opts: { startDate?: string; endDate?: string } = {}
): GddSeries {
  const sorted = [...days]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dateKey))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  let cumulative = 0;
  let missingDays = 0;
  const out: GddDay[] = [];

  for (const day of sorted) {
    if (opts.startDate && day.dateKey < opts.startDate) continue;
    if (opts.endDate && day.dateKey > opts.endDate) continue;
    if (day.meanTempC === null || !Number.isFinite(day.meanTempC)) {
      missingDays++;
      out.push({ dateKey: day.dateKey, meanTempC: null, gdd: null, cumulative, missing: true });
      continue;
    }
    const gdd = Math.max(0, day.meanTempC - baseTempC);
    cumulative += gdd;
    out.push({
      dateKey: day.dateKey,
      meanTempC: day.meanTempC,
      gdd: round(gdd, 3),
      cumulative: round(cumulative, 3),
      missing: false,
    });
  }

  return {
    days: out,
    cumulativeToDate: round(cumulative, 3),
    missingDays,
    firstDate: out[0]?.dateKey ?? null,
    lastDate: out[out.length - 1]?.dateKey ?? null,
  };
}

export interface StageProjection {
  thresholdGdd: number;
  projectedDate: string | null;
  daysFromStart: number | null;
  reached: boolean;
  reason: string;
}

/**
 * Project the date a threshold is reached using the observed cumulative value
 * plus future daily mean temperatures. Returns null when the forecast does not
 * extend far enough — no extrapolation from a guessed seasonal curve.
 */
export function projectThreshold(params: {
  cumulativeGdd: number;
  thresholdGdd: number;
  baseTempC: number;
  startDate: string;
  futureDays: readonly DailyTemperature[];
  lastObservedDate: string | null;
}): StageProjection {
  const { cumulativeGdd, thresholdGdd, baseTempC, startDate } = params;
  if (cumulativeGdd >= thresholdGdd) {
    return {
      thresholdGdd,
      projectedDate: params.lastObservedDate,
      daysFromStart: params.lastObservedDate ? daysBetween(startDate, params.lastObservedDate) : null,
      reached: true,
      reason: 'threshold already reached by the accumulated GDD',
    };
  }

  const future = [...params.futureDays]
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dateKey))
    .filter((d) => !params.lastObservedDate || d.dateKey > params.lastObservedDate)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  let cumulative = cumulativeGdd;
  for (const day of future) {
    if (day.meanTempC === null || !Number.isFinite(day.meanTempC)) continue;
    cumulative += Math.max(0, day.meanTempC - baseTempC);
    if (cumulative >= thresholdGdd) {
      return {
        thresholdGdd,
        projectedDate: day.dateKey,
        daysFromStart: daysBetween(startDate, day.dateKey),
        reached: false,
        reason: 'projected using provider forecast daily temperatures within the forecast horizon',
      };
    }
  }

  return {
    thresholdGdd,
    projectedDate: null,
    daysFromStart: null,
    reached: false,
    reason: 'threshold not reached within the available forecast horizon; no seasonal extrapolation is made',
  };
}

function daysBetween(a: string, b: string): number | null {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
