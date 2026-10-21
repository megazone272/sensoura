export interface SensorData {
  temperature: number;
  soilTemperature: number;
  humidity: number;
  soilMoisture: number;
  gas: number;
  light: number;
  airPressure: number;
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
  reason: 'soil_dry' | 'scheduled' | 'manual' | 'ai_predicted' | 'emergency' | 'threshold_met';
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
    action: string;
    mode: 'MANUAL' | 'AUTO' | null;
  };
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  requiresApproval: boolean;
  confidence: number;
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;
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