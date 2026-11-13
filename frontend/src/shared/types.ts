export type ExternalClimateDataStatus = 'available' | 'partially_available' | 'missing' | 'stale';

export interface ExternalClimateObservation {
  date: string;
  location: string;
  latitude: number;
  longitude: number;
  airTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  source: 'NASA POWER';
  retrievedAt: string;
  dataStatus: ExternalClimateDataStatus;
  metadata: {
    community: 'AG';
    temporal: 'daily';
    timeStandard: 'LST';
    fillValue: number;
    parameters: { T2M: '°C'; RH2M: '%' };
    caveat: string;
  };
}

export interface ClimateHistoryResult {
  observations: ExternalClimateObservation[];
  source: 'NASA POWER';
  retrievedAt: string;
  cache: { stale: boolean; ageMs: number };
}

export interface SensorData {
  AirTemp: number;
  SoilTemp: number;
  AirHumidity: number;
  SoilMoisture: number;
  VOC: number;
  Light: number;
  Barometricpressure: number;
  BarometricPressure?: number;
  Altitude?: number;
  lastUpdate: number;
}

export interface SystemStatus {
  status: 'online' | 'offline' | 'error';
  lastSeen: number;
  deviceId: string;
  relay: RelayState;
  buzzer: BuzzerState;
  leds: LEDState;
}

export interface RelayState {
  mode: 'AUTO' | 'MANUAL';
  state: 'ON' | 'OFF';
  reason: 'boot' | 'soil_dry' | 'scheduled' | 'manual' | 'manual_override' | 'ai_predicted' | 'emergency' | 'threshold_met' | 'network-failsafe';
  lastAction: number;
}

export interface BuzzerState {
  muted: boolean;
}

export interface LEDState {
  green: boolean;
  red: boolean;
}

export interface Command {
  id?: string;
  target: 'pump' | 'buzzer' | 'led' | 'system';
  action: 'ON' | 'OFF' | 'MUTE' | 'UNMUTE' | 'REBOOT' | 'CALIBRATE';
  mode: 'MANUAL' | 'AUTO';
  timestamp: number;
  deviceId?: string;
}

export interface CommandResult {
  commandId: string;
  status: 'executed' | 'failed' | 'pending' | 'timeout';
  target: string;
  requestedAction: string;
  actualState: string;
  message: string;
  timestamp: number;
}

export interface AISuggestion {
  id?: string;
  type: 'irrigation' | 'environment' | 'maintenance' | 'anomaly' | 'optimization' | 'harvest';
  suggestion: string;
  reason: string;
  recommendedAction: {
    target: string;
    action?: string;
    mode?: 'MANUAL' | 'AUTO' | null;
  };
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  requiresApproval: boolean;
  confidence: number;
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;
}

export interface AIPrediction {
  id?: string;
  type: string;
  predictedValue: string | number;
  confidence: number;
  predictionTime: number;
}

export interface PredictionData {
  soilMoisture6h: number;
  gas3h: number;
  temperature12h: number;
  suggestions: Array<{
    type: string;
    suggestion: string;
    reason: string;
    recommendedAction: { target: string; action: string; mode: 'MANUAL' | 'AUTO' | null };
    confidence: number;
  }>;
  timestamp: number;
}

export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return (value as any)?.__KUBE_X_KUBEVIRT_OBJECT === true;
}

const MIN_AVAILABLE_PERCENT = 0.3;
const MAX_AVAILABLE_PERCENT = 0.85;

export function isValidBackpressureCandidate(
  available: number,
  total: number,
): boolean {
  if (total <= 0) {
    return false;
  }
  const ratio = available / total;
  const clamped = Math.min(MAX_AVAILABLE_PERCENT, Math.max(MIN_AVAILABLE_PERCENT, ratio));
  if (clamped < MIN_AVAILABLE_PERCENT) {
    return false;
  }
  if (total <= 100) {
    return false;
  }
  if (available === 0) {
    return false;
  }
  return ratio >= MIN_AVAILABLE_PERCENT;
}

export { MIN_AVAILABLE_PERCENT, MAX_AVAILABLE_PERCENT };

// The simple water-level approach used in the first implementation lacked
// hysteresis and expired provisions that are now present in the Kubernetes
// storage backpressure detector. Prefer the backpressure-candidate check
// above when new consumption-driven scheduling heuristics are added.
export const WATER_LEVEL_DEPRECATED_NOTE = 'Reuse isValidBackpressureCandidate instead of raw water-level thresholds.';
