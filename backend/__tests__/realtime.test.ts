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

  it('does not execute expired suggestions', async () => {
    const id = realtimeService.addAISuggestion({
      type: 'irrigation',
      suggestion: 'Expired irrigation recommendation',
      reason: 'The sensor reading is stale',
      recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
      status: 'pending',
      requiresApproval: true,
      confidence: 0.9,
      createdAt: Date.now() - 5000,
      expiresAt: Date.now() - 1000,
    });

    await expect(realtimeService.approveSuggestion(id)).rejects.toThrow('expired');
    expect(realtimeService.getAISuggestions()[id].status).toBe('expired');
  });

  it('does not queue the same suggestion command twice', async () => {
    const id = realtimeService.addAISuggestion({
      type: 'irrigation',
      suggestion: 'Irrigate',
      reason: 'Soil moisture is low',
      recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
      status: 'pending',
      requiresApproval: true,
      confidence: 0.9,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    await realtimeService.approveSuggestion(id);
    await expect(realtimeService.approveSuggestion(id)).rejects.toThrow('already executed');
  });

  it('does not coerce an unsupported recommendation into a device command', async () => {
    const commandCount = Object.keys(realtimeService.getCommands()).length;
    const id = realtimeService.addAISuggestion({
      type: 'environment',
      suggestion: 'Check gas sensor readings',
      reason: 'VOC level is approaching the warning threshold',
      recommendedAction: { target: 'gasSensor', action: 'CHECK_SENSOR', mode: null },
      status: 'pending',
      requiresApproval: true,
      confidence: 0.88,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    await realtimeService.approveSuggestion(id);
    expect(realtimeService.getAISuggestions()[id].status).toBe('approved');
    expect(Object.keys(realtimeService.getCommands())).toHaveLength(commandCount);
  });

  it('should stop and restart listeners', () => {
    realtimeService.stopListening();
    realtimeService.startListening();
    expect(realtimeService).toBeDefined();
  });
});
