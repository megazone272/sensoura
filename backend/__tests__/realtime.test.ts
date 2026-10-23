import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { realtimeService } from '../src/services/realtime.js';
import { isFirebaseEnabled } from '../src/services/firebase.js';

describe('Realtime Service', () => {
  beforeAll(async () => {
    // Ensure mock mode (no Firebase credentials)
    await realtimeService.startListening();
  });

  afterAll(() => {
    realtimeService.stopListening();
  });

  it('should have sensorData', () => {
    const data = realtimeService.getSensorData();
    expect(data).not.toBeNull();
    expect(data.AirTemp).toBeDefined();
    expect(data.AirHumidity).toBeDefined();
  });

  it('should have system status', () => {
    const status = realtimeService.getSystemStatus();
    expect(status).not.toBeNull();
    expect(['online', 'offline', 'error']).toContain(status.status);
  });

  it('should have commands object', () => {
    const commands = realtimeService.getCommands();
    expect(typeof commands).toBe('object');
  });

  it('should send command and get ID', async () => {
    const id = await realtimeService.sendCommand({
      target: 'pump',
      action: 'ON',
      mode: 'MANUAL',
    });
    expect(id).toMatch(/^cmd_/);
    expect(id.length).toBeGreaterThan(10);
  });

  it('should track command results', () => {
    const results = realtimeService.getCommandResults();
    expect(typeof results).toBe('object');
  });

  it('should have AI suggestions', () => {
    const suggestions = realtimeService.getAISuggestions();
    expect(typeof suggestions).toBe('object');
  });

  it('should stop and restart listeners', () => {
    realtimeService.stopListening();
    realtimeService.startListening();
    expect(realtimeService).toBeDefined();
  });
});
