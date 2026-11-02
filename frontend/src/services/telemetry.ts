export function validTimestamp(value: unknown): number | null {
  const timestamp = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function telemetryAgeMs(value: unknown, now = Date.now()): number | null {
  const timestamp = validTimestamp(value);
  if (timestamp === null) return null;
  const age = now - timestamp;
  return age >= 0 ? age : null;
}

export function isTelemetryStale(value: unknown, maxAgeMs = 120_000, now = Date.now()): boolean {
  const age = telemetryAgeMs(value, now);
  return age === null || age > maxAgeMs;
}

export function safeDate(value: unknown): Date | null {
  const timestamp = validTimestamp(value);
  return timestamp === null ? null : new Date(timestamp);
}
