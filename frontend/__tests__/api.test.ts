import { describe, it, expect, beforeAll } from 'vitest';
import axios from 'axios';
import { api, endpoints } from '@/services/api';

// The endpoint helpers fire real requests. Without a stubbed adapter they
// reach for http://localhost:3000, fail, and surface as unhandled rejections
// (vitest then exits non-zero even though every assertion passed). The stub
// keeps the calls in-process; the assertions below are unchanged.
beforeAll(() => {
  const adapter = (config: any) =>
    Promise.resolve({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
  api.defaults.adapter = adapter as any;
  axios.defaults.adapter = adapter as any;
});

describe('API Endpoints', () => {
  it('should have all required endpoints defined', () => {
    // Verify endpoints exist and are functions
    expect(typeof endpoints.getState).toBe('function');
    expect(typeof endpoints.getSensorData).toBe('function');
    expect(typeof endpoints.getSystem).toBe('function');
    expect(typeof endpoints.getCommands).toBe('function');
    expect(typeof endpoints.getCommandResults).toBe('function');
    expect(typeof endpoints.getAISuggestions).toBe('function');
    expect(typeof endpoints.sendCommand).toBe('function');
    expect(typeof endpoints.approveSuggestion).toBe('function');
    expect(typeof endpoints.rejectSuggestion).toBe('function');
    expect(typeof endpoints.controlRelay).toBe('function');
    expect(typeof endpoints.controlBuzzer).toBe('function');
    expect(typeof endpoints.rebootSystem).toBe('function');
    expect(typeof endpoints.calibrateSensors).toBe('function');
    expect(typeof endpoints.getPredictions).toBe('function');
    expect(typeof endpoints.getModelInfo).toBe('function');
    expect(typeof endpoints.retrainModels).toBe('function');
    expect(typeof endpoints.getHistory).toBe('function');
    expect(typeof endpoints.health).toBe('function');
    expect(typeof endpoints.ready).toBe('function');
    expect(typeof endpoints.metrics).toBe('function');
  });

  describe('sendCommand', () => {
    it('should accept valid command payload', () => {
      const command = { target: 'pump', action: 'ON', mode: 'MANUAL' };
      // Just verify it doesn't throw
      expect(() => endpoints.sendCommand(command)).not.toThrow();
    });

    it('should accept various target types', () => {
      expect(() => endpoints.sendCommand({ target: 'buzzer', action: 'ON', mode: 'MANUAL' })).not.toThrow();
      expect(() => endpoints.sendCommand({ target: 'led', action: 'ON', mode: 'MANUAL' })).not.toThrow();
      expect(() => endpoints.sendCommand({ target: 'system', action: 'REBOOT', mode: 'MANUAL' })).not.toThrow();
    });
  });

  describe('controlRelay', () => {
    it('should accept ON state', () => {
      expect(() => endpoints.controlRelay('ON', 'manual')).not.toThrow();
    });

    it('should accept OFF state', () => {
      expect(() => endpoints.controlRelay('OFF', 'manual')).not.toThrow();
    });

    it('should accept reason string', () => {
      expect(() => endpoints.controlRelay('ON', 'soil dry')).not.toThrow();
    });
  });

  describe('controlBuzzer', () => {
    it('should accept MUTE action', () => {
      expect(() => endpoints.controlBuzzer('MUTE')).not.toThrow();
    });

    it('should accept UNMUTE action', () => {
      expect(() => endpoints.controlBuzzer('UNMUTE')).not.toThrow();
    });
  });

  describe('suggestion actions', () => {
    it('should accept suggestion ID for approve', () => {
      expect(() => endpoints.approveSuggestion('test-id-123')).not.toThrow();
    });

    it('should accept suggestion ID for reject', () => {
      expect(() => endpoints.rejectSuggestion('test-id-123')).not.toThrow();
    });
  });

  describe('system commands', () => {
    it('should have reboot endpoint', () => {
      expect(() => endpoints.rebootSystem()).not.toThrow();
    });

    it('should have calibrate endpoint', () => {
      expect(() => endpoints.calibrateSensors()).not.toThrow();
    });
  });

  describe('history', () => {
    it('should accept query params', () => {
      expect(() => endpoints.getHistory({ from: '2024-01-01', to: '2024-01-02', limit: 100 })).not.toThrow();
    });

    it('should work without params', () => {
      expect(() => endpoints.getHistory()).not.toThrow();
    });
  });
});
