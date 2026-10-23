import { describe, it, expect } from 'vitest';
import type {
  SensorData,
  SystemStatus,
  Command,
  CommandResult,
  AISuggestion,
  PredictionData,
} from '../src/models/sensoura.js';

describe('Data Models', () => {
  describe('SensorData', () => {
    it('should have all required fields', () => {
      const sensorData: SensorData = {
        AirTemp: 28.4,
        SoilTemp: 22.5,
        AirHumidity: 65,
        SoilMoisture: 24,
        VOC: 185,
        Light: 720,
        Barometricpressure: 1013.25,
        lastUpdate: Date.now(),
      };

      expect(sensorData.AirTemp).toBeDefined();
      expect(sensorData.SoilTemp).toBeDefined();
      expect(sensorData.AirHumidity).toBeDefined();
      expect(sensorData.SoilMoisture).toBeDefined();
      expect(sensorData.VOC).toBeDefined();
      expect(sensorData.Light).toBeDefined();
      expect(sensorData.Barometricpressure).toBeDefined();
      expect(sensorData.lastUpdate).toBeDefined();
    });

    it('should accept valid ranges', () => {
      const validData: SensorData = {
        AirTemp: 0, // -50 to 60 typically
        SoilTemp: 0,
        AirHumidity: 0, // 0-100%
        SoilMoisture: 0, // 0-100%
        VOC: 0,
        Light: 0,
        Barometricpressure: 900,
        lastUpdate: Date.now(),
      };

      expect(validData).toBeDefined();
    });
  });

  describe('SystemStatus', () => {
    it('should have valid status values', () => {
      const status: SystemStatus = {
        status: 'online',
        lastSeen: Date.now(),
        deviceId: 'test-device',
        relay: { mode: 'AUTO', state: 'ON', reason: 'soil_dry', lastAction: Date.now() },
        buzzer: { muted: false },
        leds: { green: true, red: false },
      };

      expect(['online', 'offline', 'error']).toContain(status.status);
      expect(['AUTO', 'MANUAL']).toContain(status.relay.mode);
      expect(['ON', 'OFF']).toContain(status.relay.state);
    });
  });

  describe('Command', () => {
    it('should have valid command structure', () => {
      const command: Command = {
        id: 'test-123',
        target: 'pump',
        action: 'ON',
        mode: 'MANUAL',
        timestamp: Date.now(),
      };

      expect(['pump', 'buzzer', 'led', 'system']).toContain(command.target);
      expect(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']).toContain(command.action);
      expect(['MANUAL', 'AUTO']).toContain(command.mode);
    });
  });

  describe('CommandResult', () => {
    it('should have valid result structure', () => {
      const result: CommandResult = {
        commandId: 'cmd-123',
        status: 'executed',
        target: 'pump',
        requestedAction: 'ON',
        actualState: 'ON',
        message: 'Command executed successfully',
        timestamp: Date.now(),
      };

      expect(['executed', 'failed', 'pending', 'timeout']).toContain(result.status);
    });
  });

  describe('AISuggestion', () => {
    it('should have valid suggestion structure', () => {
      const suggestion: AISuggestion = {
        id: 'ai-123',
        type: 'irrigation',
        suggestion: 'Start irrigation',
        reason: 'Soil moisture low',
        recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
        status: 'pending',
        requiresApproval: true,
        confidence: 0.92,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      expect(['irrigation', 'environment', 'maintenance', 'anomaly', 'optimization', 'harvest']).toContain(
        suggestion.type
      );
      expect(['pending', 'approved', 'rejected', 'executed', 'expired']).toContain(suggestion.status);
      expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
      expect(suggestion.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('PredictionData', () => {
    it('should have valid prediction structure', () => {
      const predictions: PredictionData = {
        soilMoisture6h: 45,
        gas3h: 200,
        temperature12h: 30,
        suggestions: [
          {
            type: 'irrigation',
            suggestion: 'Water needed',
            reason: 'Low moisture',
            recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
            confidence: 0.85,
          },
        ],
        timestamp: Date.now(),
      };

      expect(predictions.soilMoisture6h).toBeGreaterThanOrEqual(0);
      expect(predictions.soilMoisture6h).toBeLessThanOrEqual(100);
      expect(Array.isArray(predictions.suggestions)).toBe(true);
    });
  });
});
