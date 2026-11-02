import { endpoints } from './api';

export type BackendMode = 'sdk' | 'mock' | 'unknown';
export type BackendHealth = {
  status?: string;
  mission?: string;
  phase?: string;
  team?: string;
  timestamp?: number;
  uptime?: number;
  firebase?: string;
  aiBackend?: string;
};

const HEALTH_CACHE_MS = 10_000;
let cachedHealth: { value: BackendHealth; expiresAt: number } | null = null;
let inFlightHealth: Promise<BackendHealth> | null = null;

export function getBackendHealth(force = false): Promise<BackendHealth> {
  if (inFlightHealth) return inFlightHealth;
  if (!force && cachedHealth && cachedHealth.expiresAt > Date.now()) {
    return Promise.resolve(cachedHealth.value);
  }

  const request = endpoints.health()
    .then((response) => {
      const value = response.data as BackendHealth;
      cachedHealth = { value, expiresAt: Date.now() + HEALTH_CACHE_MS };
      return value;
    })
    .finally(() => {
      if (inFlightHealth === request) inFlightHealth = null;
    });
  inFlightHealth = request;
  return request;
}

export function getBackendMode(health: BackendHealth | null | undefined): BackendMode {
  if (health?.firebase === 'sdk') return 'sdk';
  if (health?.firebase === 'mock') return 'mock';
  return 'unknown';
}
