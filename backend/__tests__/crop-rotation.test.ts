import { describe, it, expect } from 'vitest';
import { evaluateCropRotationStrategies, CROPS_DATABASE } from '../src/ai/crop-rotation.js';

describe('Crop Rotation Decision Support Engine (NASA Field Shift)', () => {
  it('should provide complete profiles for core regional crops', () => {
    expect(CROPS_DATABASE.wheat).toBeDefined();
    expect(CROPS_DATABASE.faba_bean).toBeDefined();
    expect(CROPS_DATABASE.egyptian_clover).toBeDefined();
    expect(CROPS_DATABASE.maize).toBeDefined();
    expect(CROPS_DATABASE.sorghum).toBeDefined();
    expect(CROPS_DATABASE.sunflower).toBeDefined();

    expect(CROPS_DATABASE.faba_bean.nitrogenImpactKgHa).toBeGreaterThan(0);
    expect(CROPS_DATABASE.wheat.nitrogenImpactKgHa).toBeLessThan(0);
  });

  it('should evaluate exactly three comparative rotation strategies', () => {
    const strategies = evaluateCropRotationStrategies({
      soilType: 'clay_loam',
      primaryGoal: 'water_saving',
      currentSoilMoisture: 24.0,
      currentAirTemp: 28.4,
    });

    expect(strategies).toHaveLength(3);
    const themes = strategies.map(s => s.theme);
    expect(themes).toContain('baseline');
    expect(themes).toContain('water_resilient');
    expect(themes).toContain('soil_regeneration');
  });

  it('should demonstrate water savings and climate resilience in Strategy 2', () => {
    const strategies = evaluateCropRotationStrategies({
      soilType: 'clay_loam',
      primaryGoal: 'water_saving',
      currentSoilMoisture: 22.0,
    });

    const waterResilient = strategies.find(s => s.theme === 'water_resilient')!;
    expect(waterResilient.metrics.waterSavingsPercentage).toBeGreaterThanOrEqual(30);
    expect(waterResilient.metrics.climateRiskResilience).toBe('High');
    expect(waterResilient.metrics.overallSuitabilityScore).toBeGreaterThanOrEqual(90);
  });

  it('should demonstrate positive nitrogen balance and soil health in Strategy 3', () => {
    const strategies = evaluateCropRotationStrategies({
      soilType: 'clay_loam',
      primaryGoal: 'soil_health',
    });

    const soilRegen = strategies.find(s => s.theme === 'soil_regeneration')!;
    expect(soilRegen.metrics.nitrogenBalanceKgHa).toBeGreaterThan(0);
    expect(soilRegen.metrics.soilHealthScore).toBeGreaterThanOrEqual(90);
    expect(soilRegen.metrics.overallSuitabilityScore).toBeGreaterThanOrEqual(90);
  });

  it('should reference all required NASA Earth observation datasets', () => {
    const strategies = evaluateCropRotationStrategies({
      soilType: 'clay_loam',
      primaryGoal: 'climate_adaptation',
    });

    for (const strat of strategies) {
      expect(strat.nasaDataContributions.nasaPower).toBeDefined();
      expect(strat.nasaDataContributions.smap).toBeDefined();
      expect(strat.nasaDataContributions.gpm).toBeDefined();
      expect(strat.nasaDataContributions.landsatModis).toBeDefined();
    }
  });
});

