/**
 * Timestamp handling.
 *
 * The repository is inconsistent on purpose-relevant detail: the ESP32
 * firmware writes `lastUpdate` as Unix SECONDS (`(uint32_t)time(nullptr)`),
 * while the README, seed JSON and dashboard examples use milliseconds.
 * Guessing silently is dangerous for staleness detection, so every value is
 * inspected and the detected format is preserved next to the UTC timestamp.
 */

export type TimestampFormat =
  | 'unix_seconds'
  | 'unix_ms'
  | 'iso8601_utc'
  | 'iso8601_with_offset'
  | 'power_hourly_utc'
  | 'unknown';

export interface DetectedTimestamp {
  ms: number | null;
  format: TimestampFormat;
  raw: number | string;
  warnings: string[];
}

const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);
const SECONDS_MS_THRESHOLD = 1e11;

export function isPlausibleTimestampMs(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms < MAX_PLAUSIBLE_MS;
}

/** Detect seconds vs milliseconds vs ISO for a sensor/provider timestamp. */
export function detectTimestamp(value: unknown): DetectedTimestamp {
  const warnings: string[] = [];

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { ms: null, format: 'unknown', raw: value, warnings: ['timestamp is not finite'] };
    }
    if (Math.abs(value) < SECONDS_MS_THRESHOLD) {
      const ms = Math.round(value * 1000);
      if (!isPlausibleTimestampMs(ms)) {
        return {
          ms: null,
          format: 'unix_seconds',
          raw: value,
          warnings: ['Unix-seconds timestamp outside plausible 2000-2100 range'],
        };
      }
      return { ms, format: 'unix_seconds', raw: value, warnings };
    }
    if (!isPlausibleTimestampMs(value)) {
      return {
        ms: null,
        format: 'unix_ms',
        raw: value,
        warnings: ['Unix-millisecond timestamp outside plausible 2000-2100 range'],
      };
    }
    return { ms: value, format: 'unix_ms', raw: value, warnings };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { ms: null, format: 'unknown', raw: value, warnings: ['timestamp string is empty'] };
    }

    // POWER hourly keys, e.g. "2026101000" (UTC when requested with time-standard=UTC).
    if (/^\d{10}$/.test(trimmed)) {
      const ms = parsePowerHourUtc(trimmed);
      return ms === null
        ? { ms: null, format: 'power_hourly_utc', raw: value, warnings: ['invalid POWER hourly key'] }
        : { ms, format: 'power_hourly_utc', raw: value, warnings };
    }

    // ISO without an offset: providers are queried with timezone=UTC, but the
    // assumption is recorded rather than hidden.
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    const normalized = hasOffset ? trimmed : `${trimmed}Z`;
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) {
      return { ms: null, format: 'unknown', raw: value, warnings: ['unparseable timestamp string'] };
    }
    if (!isPlausibleTimestampMs(parsed)) {
      return {
        ms: null,
        format: hasOffset ? 'iso8601_with_offset' : 'iso8601_utc',
        raw: value,
        warnings: ['ISO timestamp outside plausible 2000-2100 range'],
      };
    }
    if (!hasOffset) warnings.push('ISO timestamp had no offset; interpreted as UTC (providers queried with timezone=UTC)');
    return { ms: parsed, format: hasOffset ? 'iso8601_with_offset' : 'iso8601_utc', raw: value, warnings };
  }

  return { ms: null, format: 'unknown', raw: '', warnings: ['timestamp is missing or unsupported type'] };
}

/** Parse POWER key `YYYYMMDDHH` interpreted as UTC (API called with time-standard=UTC). */
export function parsePowerHourUtc(key: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  const [, y, mo, d, h] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h));
  return isPlausibleTimestampMs(ms) ? ms : null;
}

export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

export function parseIsoUtc(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid ISO timestamp: ${iso}`);
  return ms;
}

/** `YYYY-MM-DD` in UTC. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `YYYY-MM-DDTHH` in UTC. */
export function utcHourKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

/** `YYYY-MM-DDTHH:mm` in UTC (used for idempotent prediction ids). */
export function utcMinuteKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

export function utcDateKeyCompact(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

export function addDaysUtc(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

export function addHours(ms: number, hours: number): number {
  return ms + hours * 3_600_000;
}

/**
 * Calendar day (`YYYY-MM-DD`) in a configured IANA timezone.
 * Agronomic days (planting date, Smith periods) are local-day concepts while
 * all stored timestamps stay UTC.
 */
export function localDayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Milliseconds to add to UTC to obtain the zone's wall clock at `ms`. */
export function timeZoneOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function minutesBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / 60_000;
}

/** Align a timestamp down to an interval boundary (scheduler buckets). */
export function alignToInterval(ms: number, intervalMs: number): number {
  return Math.floor(ms / intervalMs) * intervalMs;
}

/** Next aligned boundary strictly after `ms`. */
export function nextIntervalBoundary(ms: number, intervalMs: number): number {
  return alignToInterval(ms, intervalMs) + intervalMs;
}

/** Compact UTC stamp safe for Firebase keys and ids, e.g. `20261021T103000Z`. */
export function compactUtcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function bucketIdFor(ms: number, intervalMs: number): string {
  return compactUtcStamp(alignToInterval(ms, intervalMs));
}

export function safeDurationMs(startMs: number, endMs: number): number {
  return Math.max(0, endMs - startMs);
}
