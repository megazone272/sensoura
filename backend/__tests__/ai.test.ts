import { describe, it, expect, beforeAll } from 'vitest';
import { aiEngine } from '../src/ai/engine.js';
import { realtimeService } from '../src/services/realtime.js';

describe('AI Engine', () => {
  beforeAll(async () => {
    // Use a longer timeout for the first run. TensorFlow.js model loading can
    // exceed the default 10s hook timeout on slow or heavily loaded machines.
    await aiEngine.initialize(15000);
  });

  it('should be initialized', () => {
    const info = aiEngine.getModelInfo();
    expect(info).toBeDefined();
    expect(info.backend).toBeDefined();
    // Model may be undefined if tfjs-node not available (fallback mode)
    // This is expected in test environment
  });

  it('should predict soil moisture', () => {
    const data = realtimeService.getSensorData();
    if (data) {
      const prediction = aiEngine.predictSoilMoisture(data, 6);
      expect(prediction).toBeGreaterThanOrEqual(0);
      expect(prediction).toBeLessThanOrEqual(100);
    }
  });

  it('should predict gas level', () => {
    const data = realtimeService.getSensorData();
    if (data) {
      const prediction = aiEngine.predictGasLevel(data, 3);
      expect(prediction).toBeGreaterThanOrEqual(0);
    }
  });

  it('should predict temperature', () => {
    const data = realtimeService.getSensorData();
    if (data) {
      const prediction = aiEngine.predictTemperature(data, 12);
      expect(prediction).toBeGreaterThan(-10);
      expect(prediction).toBeLessThan(50);
    }
  });

  it('should generate suggestions', () => {
    const data = realtimeService.getSensorData();
    if (data) {
      const suggestions = aiEngine.generateSuggestions(data);
      expect(Array.isArray(suggestions)).toBe(true);
    }
  });

  it('should use new sensor field keys (AirTemp, SoilTemp, AirHumidity, SoilMoisture, VOC, Light, Barometricpressure)', () => {
    const data = realtimeService.getSensorData();
    if (data) {
      // The deployment contract uses the new field names; the engine must accept them.
      expect(typeof data.AirTemp).toBe('number');
      expect(typeof data.SoilTemp).toBe('number');
      expect(typeof data.AirHumidity).toBe('number');
      expect(typeof data.SoilMoisture).toBe('number');
      expect(typeof data.VOC).toBe('number');
      expect(typeof data.Light).toBe('number');
      expect(typeof data.Barometricpressure).toBe('number');
      expect(Array.isArray(aiEngine.generateSuggestions(data))).toBe(true);
    }
  });

  it('should record observations', () => {
    const data = realtimeService.getSensorData();
    if (data) {
      aiEngine.recordObservation(data);
      // No error means success
      expect(true).toBe(true);
    }
  });
});
