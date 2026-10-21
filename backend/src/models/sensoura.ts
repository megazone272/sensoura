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
  target: 'pump' | 'buzzer' | 'led' | 'system';
  action: 'ON' | 'OFF' | 'MUTE' | 'UNMUTE' | 'REBOOT' | 'CALIBRATE';
  mode: 'MANUAL' | 'AUTO';
  timestamp: number;
  id?: string;
}

export interface CommandResult {
  status: 'executed' | 'failed' | 'pending' | 'timeout';
  target: string;
  requestedAction: string;
  actualState: string;
  message: string;
  timestamp: number;
  commandId: string;
}

export interface AISuggestion {
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
  id?: string;
  metadata?: Record<string, any>;
}

export interface SensouraState {
  sensorData: SensorData;
  system: SystemStatus;
  commands: Record<string, Command>;
  commandResults: Record<string, CommandResult>;
  aiSuggestions: Record<string, AISuggestion>;
}

// Validation schemas using Zod
import { z } from 'zod';

export const sensorDataSchema = z.object({
  temperature: z.number().min(-40).max(85),
  soilTemperature: z.number().min(-40).max(85),
  humidity: z.number().min(0).max(100),
  soilMoisture: z.number().min(0).max(100),
  gas: z.number().min(0).max(10000),
  light: z.number().min(0).max(200000),
  airPressure: z.number().min(800).max(1200),
  lastUpdate: z.number(),
});

export const systemStatusSchema = z.object({
  status: z.enum(['online', 'offline', 'error']),
  lastSeen: z.number(),
  deviceId: z.string(),
  relay: z.object({
    mode: z.enum(['AUTO', 'MANUAL']),
    state: z.enum(['ON', 'OFF']),
    reason: z.enum(['soil_dry', 'scheduled', 'manual', 'ai_predicted', 'emergency', 'threshold_met']),
    lastAction: z.number(),
  }),
  buzzer: z.object({ muted: z.boolean() }),
  leds: z.object({ green: z.boolean(), red: z.boolean() }),
});

export const commandSchema = z.object({
  target: z.enum(['pump', 'buzzer', 'led', 'system']),
  action: z.enum(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']),
  mode: z.enum(['MANUAL', 'AUTO']),
  timestamp: z.number(),
});

export const aiSuggestionSchema = z.object({
  type: z.enum(['irrigation', 'environment', 'maintenance', 'anomaly', 'optimization', 'harvest']),
  suggestion: z.string(),
  reason: z.string(),
  recommendedAction: z.object({
    target: z.string(),
    action: z.string(),
    mode: z.enum(['MANUAL', 'AUTO']).nullable(),
  }),
  status: z.enum(['pending', 'approved', 'rejected', 'executed', 'expired']),
  requiresApproval: z.boolean(),
  confidence: z.number().min(0).max(1),
  createdAt: z.number(),
  expiresAt: z.number(),
  metadata: z.record(z.any()).optional(),
});

export type SensorDataInput = z.infer<typeof sensorDataSchema>;
export type SystemStatusInput = z.infer<typeof systemStatusSchema>;
export type CommandInput = z.infer<typeof commandSchema>;
export type AISuggestionInput = z.infer<typeof aiSuggestionSchema>;