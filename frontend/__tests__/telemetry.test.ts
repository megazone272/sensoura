import { describe, expect, it } from 'vitest';
import { isTelemetryStale, telemetryAgeMs, validTimestamp } from '@services/telemetry';

describe('telemetry timestamps', () => {
  it('parses milliseconds and ISO timestamps only when valid', () => {
    expect(validTimestamp(1_800_000_000_000)).toBe(1_800_000_000_000);
    expect(validTimestamp('2026-10-31T12:00:00.000Z')).toBe(Date.parse('2026-10-31T12:00:00.000Z'));
    expect(validTimestamp('not-a-date')).toBeNull();
    expect(validTimestamp(null)).toBeNull();
  });

  it('does not call a future or unknown reading live', () => {
    expect(telemetryAgeMs(2_000, 1_000)).toBeNull();
    expect(isTelemetryStale(undefined, 120_000, 1_000)).toBe(true);
    expect(isTelemetryStale(900, 120_000, 1_000)).toBe(false);
  });
});
