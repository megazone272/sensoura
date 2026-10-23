import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSensorStore } from '@/store/sensorStore';
import type { SensorData, SystemStatus, Command, CommandResult, AISuggestion } from '@/shared/types';

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    connected: true,
    id: 'test-socket-id',
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

describe('SensorStore', () => {
  beforeEach(() => {
    useSensorStore.getState().disconnect();
    vi.clearAllMocks();
  });

  afterEach(() => {
    useSensorStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should have null sensorData', () => {
      const data = useSensorStore.getState().sensorData;
      expect(data).toBeNull();
    });

    it('should have null system', () => {
      const system = useSensorStore.getState().system;
      expect(system).toBeNull();
    });

    it('should have empty commands', () => {
      const commands = useSensorStore.getState().commands;
      expect(commands).toEqual({});
    });

    it('should have empty commandResults', () => {
      const results = useSensorStore.getState().commandResults;
      expect(results).toEqual({});
    });

    it('should have empty aiSuggestions', () => {
      const suggestions = useSensorStore.getState().aiSuggestions;
      expect(suggestions).toEqual({});
    });

    it('should have connected = false before connect', () => {
      const connected = useSensorStore.getState().connected;
      expect(connected).toBe(false);
    });
  });

  describe('connect', () => {
    it('should set connecting true during connection', () => {
      useSensorStore.getState().connect();
      expect(useSensorStore.getState().connecting).toBe(true);
    });

    // Note: Full connection test requires running server
    it.skip('should set connected after connect event', () => {
      // Would need mock server
    });
  });

  describe('actions', () => {
    it('sendCommand should throw when not connected', async () => {
      await expect(
        useSensorStore.getState().sendCommand({
          target: 'pump',
          action: 'ON',
          mode: 'MANUAL',
        })
      ).rejects.toThrow('Not connected');
    });

    it('approveSuggestion should throw when not connected', async () => {
      await expect(useSensorStore.getState().approveSuggestion('test-id')).rejects.toThrow(
        'Not connected'
      );
    });

    it('rejectSuggestion should throw when not connected', async () => {
      await expect(useSensorStore.getState().rejectSuggestion('test-id')).rejects.toThrow(
        'Not connected'
      );
    });

    it('controlRelay should throw when not connected', async () => {
      await expect(useSensorStore.getState().controlRelay('ON', 'test')).rejects.toThrow(
        'Not connected'
      );
    });

    it('controlBuzzer should throw when not connected', async () => {
      await expect(useSensorStore.getState().controlBuzzer('MUTE')).rejects.toThrow('Not connected');
    });
  });

  describe('internal setters', () => {
    it('_setSensorData should update sensorData', () => {
      const data: SensorData = {
        AirTemp: 25,
        SoilTemp: 20,
        AirHumidity: 50,
        SoilMoisture: 40,
        VOC: 100,
        Light: 500,
        Barometricpressure: 1013,
        lastUpdate: Date.now(),
      };

      useSensorStore.getState()._setSensorData(data);
      expect(useSensorStore.getState().sensorData).toEqual(data);
    });

    it('_setSystem should update system', () => {
      const status: SystemStatus = {
        status: 'online',
        lastSeen: Date.now(),
        deviceId: 'test',
        relay: { mode: 'AUTO', state: 'ON', reason: 'test', lastAction: Date.now() },
        buzzer: { muted: false },
        leds: { green: true, red: false },
      };

      useSensorStore.getState()._setSystem(status);
      expect(useSensorStore.getState().system).toEqual(status);
    });

    it('_setCommands should update commands', () => {
      const commands: Record<string, Command> = {
        'cmd-1': {
          id: 'cmd-1',
          target: 'pump',
          action: 'ON',
          mode: 'MANUAL',
          timestamp: Date.now(),
        },
      };

      useSensorStore.getState()._setCommands(commands);
      expect(useSensorStore.getState().commands).toEqual(commands);
    });

    it('_setCommandResults should update commandResults', () => {
      const result: CommandResult = {
        commandId: 'cmd-1',
        status: 'executed',
        target: 'pump',
        requestedAction: 'ON',
        actualState: 'ON',
        message: 'Success',
        timestamp: Date.now(),
      };

      useSensorStore.getState()._setCommandResults({ 'cmd-1': result });
      expect(useSensorStore.getState().commandResults['cmd-1']).toEqual(result);
    });

    it('_setAISuggestions should update aiSuggestions', () => {
      const suggestion: AISuggestion = {
        id: 'ai-1',
        type: 'irrigation',
        suggestion: 'Test suggestion',
        reason: 'Test reason',
        recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
        status: 'pending',
        requiresApproval: true,
        confidence: 0.9,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      useSensorStore.getState()._setAISuggestions({ 'ai-1': suggestion });
      expect(useSensorStore.getState().aiSuggestions['ai-1']).toEqual(suggestion);
    });

    it('_updateCommandResult should add result', () => {
      const result: CommandResult = {
        commandId: 'cmd-new',
        status: 'executed',
        target: 'pump',
        requestedAction: 'ON',
        actualState: 'ON',
        message: 'Success',
        timestamp: Date.now(),
      };

      useSensorStore.getState()._updateCommandResult(result);
      expect(useSensorStore.getState().commandResults['cmd-new']).toEqual(result);
    });

    it('_updateAISuggestion should add suggestion', () => {
      const suggestion: AISuggestion = {
        id: 'ai-new',
        type: 'irrigation',
        suggestion: 'New suggestion',
        reason: 'Test',
        recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
        status: 'pending',
        requiresApproval: true,
        confidence: 0.8,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      useSensorStore.getState()._updateAISuggestion(suggestion);
      expect(useSensorStore.getState().aiSuggestions['ai-new']).toEqual(suggestion);
    });
  });
});
