/**
 * Late blight (Phytophthora infestans) weather-risk baseline.
 *
 * Uses the Smith Period criterion: at least 11 hours with relative humidity
 * >= 90 % on each of two consecutive days, with a minimum temperature >= 10 °C
 * on both days. It is an empirical rule developed in the UK and is NOT a
 * diagnosis, not cultivar-aware, and not validated for Egyptian conditions.
 * It is emitted with `methodClass: rule_based` and no fabricated accuracy.
 */
import { localDayKey } from '../utils/time.js';

export interface HourlyWeather {
  atMs: number;
  tempC: number | null;
  rhPct: number | null;
}

export interface BlightDay {
  dateKey: string;
  hoursObserved: number;
  humidHours: number;
  minTempC: number | null;
  maxTempC: number | null;
  conditionsMet: boolean;
  complete: boolean;
  riskLevel: 'low' | 'moderate' | 'high';
  reasons: string[];
}

export interface BlightAssessment {
  days: BlightDay[];
  overallRisk: 'low' | 'moderate' | 'high';
  method: 'smith-period';
  caveats: string[];
}

export interface BlightOptions {
  timeZone: string;
  rhThresholdPct: number;
  minHumidHours: number;
  minTempC: number;
  nowMs: number;
}

export function assessLateBlight(hourly: readonly HourlyWeather[], opts: BlightOptions): BlightAssessment {
  const byDay = new Map<string, HourlyWeather[]>();

  for (const row of hourly) {
    if (!Number.isFinite(row.atMs)) continue;
    const key = localDayKey(row.atMs, opts.timeZone);
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }

  const sortedDays = [...byDay.keys()].sort();
  const days: BlightDay[] = [];

  for (const dateKey of sortedDays) {
    const rows = byDay.get(dateKey) ?? [];
    const tempRows = rows.filter((r) => typeof r.tempC === 'number' && Number.isFinite(r.tempC));
    const humidHours = rows.filter(
      (r) => typeof r.rhPct === 'number' && Number.isFinite(r.rhPct) && r.rhPct >= opts.rhThresholdPct
    ).length;
    const minTemp = tempRows.length ? Math.min(...tempRows.map((r) => r.tempC as number)) : null;
    const maxTemp = tempRows.length ? Math.max(...tempRows.map((r) => r.tempC as number)) : null;
    const complete = rows.length >= 22;
    const conditionsMet =
      humidHours >= opts.minHumidHours && minTemp !== null && minTemp >= opts.minTempC;

    const reasons: string[] = [];
    if (!complete) reasons.push(`only ${rows.length} hourly values available for this day`);
    if (minTemp === null) reasons.push('no valid temperature values');
    else if (minTemp < opts.minTempC) reasons.push(`minimum temperature ${minTemp} °C is below ${opts.minTempC} °C`);
    if (humidHours < opts.minHumidHours) {
      reasons.push(`${humidHours} h at RH >= ${opts.rhThresholdPct} % (needs ${opts.minHumidHours} h)`);
    }

    days.push({
      dateKey,
      hoursObserved: rows.length,
      humidHours,
      minTempC: minTemp,
      maxTempC: maxTemp,
      conditionsMet,
      complete,
      riskLevel: 'low',
      reasons,
    });
  }

  // Two consecutive qualifying days => Smith period. Today may be incomplete;
  // if yesterday qualifies and today already meets humidity/temperature, risk is
  // still high, with an explicit completeness note.
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const prev = days[i - 1];
    const consecutive = !!prev && prev.conditionsMet && day.conditionsMet;
    const yesterdayQualified = !!prev && prev.conditionsMet;

    if (consecutive) {
      day.riskLevel = 'high';
      day.reasons.push('two consecutive days meet the Smith Period criteria');
    } else if (yesterdayQualified && day.humidHours >= opts.minHumidHours - 2 && (day.minTempC ?? 0) >= opts.minTempC) {
      day.riskLevel = 'moderate';
      day.reasons.push('yesterday qualified and today is close to the criteria (incomplete evidence)');
    } else if (day.conditionsMet) {
      day.riskLevel = 'moderate';
      day.reasons.push('single day meets the criteria; a second consecutive day is required for a Smith Period');
    } else {
      day.riskLevel = 'low';
    }
  }

  const rank = { low: 0, moderate: 1, high: 2 } as const;
  const overallRisk = days.reduce<'low' | 'moderate' | 'high'>(
    (acc, d) => (rank[d.riskLevel] > rank[acc] ? d.riskLevel : acc),
    'low'
  );

  return {
    days,
    overallRisk,
    method: 'smith-period',
    caveats: [
      'Rule-based weather risk, NOT a disease diagnosis or a detection of Phytophthora infestans.',
      'Smith Period thresholds were developed for UK conditions; applicability to the Nile Delta is not validated here.',
      'Cultivar resistance, inoculum presence, irrigation method and canopy microclimate are not modelled.',
      'Input is open-air provider weather for a grid cell, not greenhouse canopy conditions.',
      'No validation metrics exist because no labelled disease observations are available in this repository.',
    ],
  };
}
