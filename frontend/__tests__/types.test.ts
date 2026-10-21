import { describe, it, expect } from 'vitest';
import type {
  SensorData,
  SystemStatus,
  Command,
  CommandResult,
  AISuggestion,
} from '@/shared/types';

describe('Shared Types', () => {
  describe('SensorData', () => {
    it('should validate sensor readings', () => {
      const data: SensorData = {
        temperature: 28.4,
        soilTemperature: 22.5,
        humidity: 65,
        soilMoisture: 24,
        gas: 185,
        light: 720,
        airPressure: 1013.25,
        lastUpdate: Date.now(),
      };

      expect(typeof data.temperature).toBe('number');
      expect(typeof data.humidity).toBe('number');
      expect(data.humidity).toBeGreaterThanOrEqual(0);
      expect(data.humidity).toBeLessThanOrEqual(100);
    });
  });

  describe('SystemStatus', () => {
    it('should have valid status', () => {
      const status: SystemStatus = {
        status: 'online',
        lastSeen: Date.now(),
        deviceId: 'esp32-01',
        relay: { mode: 'AUTO', state: 'ON', reason: 'soil_dry', lastAction: Date.now() },
        buzzer: { muted: false },
        leds: { green: false, red: true },
      };

      expect(['online', 'offline', 'error']).toContain(status.status);
    });
  });

  describe('Command', () => {
    it('should have valid command actions', () => {
      const command: Command = {
        target: 'pump',
        action: 'ON',
        mode: 'MANUAL',
        timestamp: Date.now(),
      };

      expect(['pump', 'buzzer', 'led', 'system']).toContain(command.target);
      expect(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']).toContain(command.action);
    });
  });

  describe('AISuggestion', () => {
    it('should have valid status values', () => {
      const suggestion: AISuggestion = {
        type: 'irrigation',
        suggestion: 'Water plant',
        reason: 'Soil dry',
        recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
        status: 'pending',
        requiresApproval: true,
        confidence: 0.9,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      expect(['pending', 'approved', 'rejected', 'executed', 'expired']).toContain(suggestion.status);
    });
  });
});
