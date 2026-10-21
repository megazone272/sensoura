/**
 * Spatial / temporal matching.
 *
 * Matching never asserts equivalence. It records how a provider value was
 * associated with the site so a reader can see the time delta and the distance
 * from the configured coordinates to the provider's grid cell.
 */
import type { matchingSchema } from '../schema.js';
import type { z } from 'zod';
import { haversineKm, roundTo } from './units.js';

export type MatchingInfo = z.infer<typeof matchingSchema>;

export interface TemporalMatch {
  matched: boolean;
  deltaSeconds: number | null;
  reason: string | null;
}

/** Nearest-observation match with a hard maximum delta. */
export function matchTemporal(
  observedAtMs: number | null,
  referenceMs: number,
  maxDeltaSeconds: number
): TemporalMatch {
  if (observedAtMs === null || !Number.isFinite(observedAtMs)) {
    return { matched: false, deltaSeconds: null, reason: 'provider observation timestamp is missing' };
  }
  const deltaSeconds = (referenceMs - observedAtMs) / 1000;
  if (Math.abs(deltaSeconds) > maxDeltaSeconds) {
    return {
      matched: false,
      deltaSeconds: roundTo(deltaSeconds, 1),
      reason: `provider observation is ${Math.abs(Math.round(deltaSeconds / 60))} min from the reference ` +
        `(limit ${Math.round(maxDeltaSeconds / 60)} min)`,
    };
  }
  return { matched: true, deltaSeconds: roundTo(deltaSeconds, 1), reason: null };
}

/** Pick the candidate closest in time, recording the chosen delta. */
export function nearestInTime<T extends { atMs: number }>(
  candidates: readonly T[],
  referenceMs: number,
  maxDeltaSeconds: number
): { candidate: T | null; deltaSeconds: number | null; reason: string | null } {
  let best: T | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (!Number.isFinite(c.atMs)) continue;
    const d = Math.abs(c.atMs - referenceMs) / 1000;
    if (d < bestDelta) {
      best = c;
      bestDelta = d;
    }
  }
  if (!best) return { candidate: null, deltaSeconds: null, reason: 'no provider observations available' };
  if (bestDelta > maxDeltaSeconds) {
    return {
      candidate: null,
      deltaSeconds: roundTo((referenceMs - best.atMs) / 1000, 1),
      reason: `closest provider observation is ${Math.round(bestDelta / 60)} min away (limit ${Math.round(maxDeltaSeconds / 60)} min)`,
    };
  }
  return { candidate: best, deltaSeconds: roundTo((referenceMs - best.atMs) / 1000, 1), reason: null };
}

export interface SpatialMatch {
  distanceKm: number | null;
  notes: string[];
}

/**
 * Distance from the configured greenhouse to the provider grid cell centre.
 * It does not reject the observation (providers cannot be more local), it
 * records the representativeness limitation.
 */
export function matchSpatial(
  configured: { lat: number; lon: number } | null,
  observed: { lat: number; lon: number } | null,
  maxDistanceKm: number
): SpatialMatch {
  if (!configured || !observed) {
    return { distanceKm: null, notes: ['spatial distance not computable (missing coordinates)'] };
  }
  const distanceKm = roundTo(haversineKm(configured, observed), 2);
  const notes = [
    `provider grid-cell centre is ${distanceKm} km from the configured greenhouse coordinates`,
    'provider values represent that grid cell and its native resolution, not greenhouse conditions',
  ];
  if (distanceKm > maxDistanceKm) {
    notes.push(`distance exceeds the configured ${maxDistanceKm} km representativeness limit`);
  }
  return { distanceKm, notes };
}

export function indoorMatching(caveats: string[] = []): MatchingInfo {
  return {
    role: 'indoor',
    method: 'none',
    timeDeltaSeconds: null,
    distanceKm: null,
    notes: caveats,
  };
}

export function outdoorMatching(params: {
  timeDeltaSeconds: number | null;
  distanceKm: number | null;
  notes: string[];
  atmosphericIndicator?: boolean;
}): MatchingInfo {
  const method: MatchingInfo['method'] =
    params.timeDeltaSeconds === null ? 'none' : params.distanceKm === null ? 'timestamp' : 'spatial_temporal';
  return {
    role: params.atmosphericIndicator ? 'atmospheric_indicator' : 'outdoor_reference',
    method,
    timeDeltaSeconds: params.timeDeltaSeconds,
    distanceKm: params.distanceKm,
    notes: params.notes,
  };
}
