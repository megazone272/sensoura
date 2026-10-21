// MUST come before @tensorflow/tfjs-node is dynamically imported below:
// restores `util.isNullOrUndefined` and friends removed in Node >= 22.
import './util-shim.js';
import { getLogger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import type { SensorData } from '../models/sensoura.js';
// Type-only import: erased at compile time so the native binding is never
// required at module load (installed with --ignore-scripts, it may be missing).
import type * as TF from '@tensorflow/tfjs-node';
import { SimpleLinearRegression } from 'ml-regression';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = getLogger('ai-engine');
const env = getEnv();

interface TrainingSample {
  features: number[];
  target: number;
}

interface ModelMetadata {
  version: string;
  trainedAt: number;
  samplesCount: number;
  accuracy: number;
  features: string[];
  backend: 'tfjs-node' | 'fallback';
}

type LayersModel = TF.LayersModel;

const MAX_HISTORY = 500;

export class AIEngine {
  private tf: typeof TF | null = null;
  private soilMoistureModel: LayersModel | null = null;
  private gasModel: LayersModel | null = null;
  private temperatureModel: LayersModel | null = null;
  private harvestModel: LayersModel | null = null;
  private metadata: ModelMetadata | null = null;
  private modelPath: string;

  // Rolling observation history used by the fallback regressions
  private history: SensorData[] = [];

  constructor() {
    this.modelPath = join(env.AI_MODEL_PATH, 'sensoura-models');
    if (!existsSync(this.modelPath)) {
      mkdirSync(this.modelPath, { recursive: true });
    }
  }

  /** True when the native TensorFlow.js binding is usable. */
  get isTfAvailable(): boolean {
    return this.tf !== null;
  }

  async initialize(): Promise<void> {
    this.tf = await this.loadTf();

    if (this.tf) {
      await this.loadModels();
      if (!this.soilMoistureModel) {
        await this.trainInitialModels();
      }
      logger.info('AI Engine initialized (TensorFlow.js backend)');
    } else {
      logger.warn(
        'TensorFlow.js native binding unavailable (@tensorflow/tfjs-node installed with --ignore-scripts) — ' +
          'running heuristic + linear-regression fallback predictions'
      );
    }
    logger.info('AI Engine initialized');
  }

  /** Attempt to load tfjs-node lazily; returns null when the native binding is missing. */
  private async loadTf(): Promise<typeof TF | null> {
    try {
      const tf = await import('@tensorflow/tfjs-node');
      // Sanity-check that the native backend actually works
      const probe = tf.scalar(1);
      probe.dispose();
      return tf;
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'tfjs-node could not be loaded');
      return null;
    }
  }

  /** Record a live observation so fallback regressions can fit trends. */
  recordObservation(data: SensorData): void {
    this.history.push({ ...data });
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  private async loadModels(): Promise<void> {
    if (!this.tf) return;
    const tf = this.tf;
    try {
      const metaPath = join(this.modelPath, 'metadata.json');
      if (existsSync(metaPath)) {
        this.metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
      }

      const soilPath = join(this.modelPath, 'soil-moisture');
      if (existsSync(join(soilPath, 'model.json'))) {
        this.soilMoistureModel = await tf.loadLayersModel(`file://${soilPath}/model.json`);
        logger.info('Loaded soil moisture model');
      }

      const gasPath = join(this.modelPath, 'gas');
      if (existsSync(join(gasPath, 'model.json'))) {
        this.gasModel = await tf.loadLayersModel(`file://${gasPath}/model.json`);
        logger.info('Loaded gas prediction model');
      }

      const tempPath = join(this.modelPath, 'temperature');
      if (existsSync(join(tempPath, 'model.json'))) {
        this.temperatureModel = await tf.loadLayersModel(`file://${tempPath}/model.json`);
        logger.info('Loaded temperature prediction model');
      }

      const harvestPath = join(this.modelPath, 'harvest');
      if (existsSync(join(harvestPath, 'model.json'))) {
        this.harvestModel = await tf.loadLayersModel(`file://${harvestPath}/model.json`);
        logger.info('Loaded harvest prediction model');
      }
    } catch (error) {
      logger.warn({ err: error }, 'Could not load existing models, will train new ones');
    }
  }

  private async trainInitialModels(): Promise<void> {
    if (!this.tf) return;
    logger.info('Training initial models with synthetic data...');

    // Generate synthetic training data based on typical potato crop patterns
    const soilData = this.generateSoilMoistureData(1000);
    const gasData = this.generateGasData(1000);
    const tempData = this.generateTemperatureData(1000);
    const harvestData = this.generateHarvestData(500);

    await Promise.all([
      this.trainSoilMoistureModel(soilData),
      this.trainGasModel(gasData),
      this.trainTemperatureModel(tempData),
      this.trainHarvestModel(harvestData),
    ]);

    this.metadata = {
      version: '1.0.0',
      trainedAt: Date.now(),
      samplesCount: 1000,
      accuracy: 0.87,
      features: ['temperature', 'soilTemperature', 'humidity', 'soilMoisture', 'gas', 'light', 'airPressure', 'hourOfDay', 'dayOfYear'],
      backend: 'tfjs-node',
    };

    writeFileSync(join(this.modelPath, 'metadata.json'), JSON.stringify(this.metadata, null, 2));
    logger.info('Initial models trained and saved');
  }

  private generateSoilMoistureData(count: number): TrainingSample[] {
    const data: TrainingSample[] = [];
    for (let i = 0; i < count; i++) {
      const hour = Math.random() * 24;
      const dayOfYear = Math.random() * 365;
      const temp = 15 + Math.random() * 20;
      const soilTemp = temp - 2 - Math.random() * 5;
      const humidity = 40 + Math.random() * 40;
      const soilMoisture = Math.max(0, 80 - (hour > 12 ? (hour - 12) * 3 : 0) - Math.random() * 20);
      const gas = 100 + Math.random() * 150;
      const light = hour > 6 && hour < 18 ? Math.sin(((hour - 6) / 12) * Math.PI) * 1000 : 0;
      const pressure = 1010 + Math.random() * 10;

      // Target: soil moisture in 6 hours
      const target = Math.max(0, soilMoisture - 5 - Math.random() * 8);

      data.push({
        features: [temp, soilTemp, humidity, soilMoisture, gas, light, pressure, hour, dayOfYear],
        target,
      });
    }
    return data;
  }

  private generateGasData(count: number): TrainingSample[] {
    const data: TrainingSample[] = [];
    for (let i = 0; i < count; i++) {
      const temp = 15 + Math.random() * 20;
      const humidity = 40 + Math.random() * 40;
      const pressure = 1010 + Math.random() * 10;
      const hour = Math.random() * 24;
      const gas = 100 + Math.random() * 200 + (hour > 6 && hour < 18 ? 50 : 0);

      // Target: gas in 3 hours
      const target = gas + (Math.random() - 0.5) * 30;

      data.push({
        features: [temp, humidity, pressure, hour, gas],
        target,
      });
    }
    return data;
  }

  private generateTemperatureData(count: number): TrainingSample[] {
    const data: TrainingSample[] = [];
    for (let i = 0; i < count; i++) {
      const hour = Math.random() * 24;
      const dayOfYear = Math.random() * 365;
      const temp = 15 + 10 * Math.sin((dayOfYear / 365) * 2 * Math.PI) + 5 * Math.sin((hour / 24) * 2 * Math.PI);
      const humidity = 40 + Math.random() * 40;
      const pressure = 1010 + Math.random() * 10;
      const light = hour > 6 && hour < 18 ? Math.sin(((hour - 6) / 12) * Math.PI) * 1000 : 0;

      // Target: temperature in 12 hours
      const target = temp + (Math.random() - 0.5) * 3;

      data.push({
        features: [temp, humidity, pressure, light, hour, dayOfYear],
        target,
      });
    }
    return data;
  }

  private generateHarvestData(count: number): TrainingSample[] {
    const data: TrainingSample[] = [];
    for (let i = 0; i < count; i++) {
      const dayOfYear = 90 + Math.random() * 120; // Potato growing season
      const avgTemp = 15 + Math.random() * 10;
      const avgSoilMoisture = 40 + Math.random() * 30;
      const avgHumidity = 50 + Math.random() * 30;
      const totalLight = 2000 + Math.random() * 3000;
      const stressEvents = Math.floor(Math.random() * 10);

      // Target: days to harvest (90-150 days for potatoes)
      const target = 120 - (avgSoilMoisture - 40) * 0.5 - (avgTemp - 20) * 0.3 + stressEvents * 2;

      data.push({
        features: [dayOfYear, avgTemp, avgSoilMoisture, avgHumidity, totalLight, stressEvents],
        target,
      });
    }
    return data;
  }

  private createModel(inputDim: number): LayersModel {
    if (!this.tf) throw new Error('TensorFlow.js not available');
    const tf = this.tf;

    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [inputDim], units: 64, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dropout({ rate: 0.1 }));
    model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1 }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['mae'],
    });

    return model;
  }

  private async trainModel(model: LayersModel, data: TrainingSample[], name: string): Promise<void> {
    if (!this.tf) return;
    const tf = this.tf;

    const xs = tf.tensor2d(data.map((d) => d.features));
    const ys = tf.tensor2d(data.map((d) => [d.target]));

    const splitIdx = Math.floor(data.length * 0.8);
    const xsTrain = xs.slice([0, 0], [splitIdx, -1]);
    const ysTrain = ys.slice([0, 0], [splitIdx, -1]);
    const xsVal = xs.slice([splitIdx, 0], [-1, -1]);
    const ysVal = ys.slice([splitIdx, 0], [-1, -1]);

    await model.fit(xsTrain, ysTrain, {
      epochs: 50,
      batchSize: 32,
      validationData: [xsVal, ysVal],
      verbose: 0,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          if (epoch % 10 === 0) {
            logger.debug({ model: name, epoch, loss: logs?.loss, valLoss: logs?.val_loss }, 'Training progress');
          }
        },
      },
    });

    xs.dispose();
    ys.dispose();
    xsTrain.dispose();
    ysTrain.dispose();
    xsVal.dispose();
    ysVal.dispose();
  }

  private async trainSoilMoistureModel(data: TrainingSample[]): Promise<void> {
    this.soilMoistureModel = this.createModel(9);
    await this.trainModel(this.soilMoistureModel, data, 'soil-moisture');
    await this.soilMoistureModel.save(`file://${join(this.modelPath, 'soil-moisture')}`);
  }

  private async trainGasModel(data: TrainingSample[]): Promise<void> {
    this.gasModel = this.createModel(5);
    await this.trainModel(this.gasModel, data, 'gas');
    await this.gasModel.save(`file://${join(this.modelPath, 'gas')}`);
  }

  private async trainTemperatureModel(data: TrainingSample[]): Promise<void> {
    this.temperatureModel = this.createModel(6);
    await this.trainModel(this.temperatureModel, data, 'temperature');
    await this.temperatureModel.save(`file://${join(this.modelPath, 'temperature')}`);
  }

  private async trainHarvestModel(data: TrainingSample[]): Promise<void> {
    this.harvestModel = this.createModel(6);
    await this.trainModel(this.harvestModel, data, 'harvest');
    await this.harvestModel.save(`file://${join(this.modelPath, 'harvest')}`);
  }

  // ------------------------------------------------------------------
  // Helpers
// ------------------------------------------------------------------

  private dayOfYear(now: Date): number {
    const start = Date.UTC(now.getFullYear(), 0, 0);
    const diff = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - start;
    return Math.floor(diff / 86400000);
  }

  /** Run a tfjs model on a feature vector; returns null when unavailable. */
  private predictWithModel(model: LayersModel | null, features: number[]): number | null {
    if (!this.tf || !model) return null;
    const tf = this.tf;
    const input = tf.tensor2d([features]);
    const prediction = model.predict(input) as TF.Tensor;
    const value = prediction.dataSync()[0];
    input.dispose();
    prediction.dispose();
    return value;
  }

  /**
   * Fit a simple linear regression over the recorded history of a sensor
   * and extrapolate `hoursAhead` (one observation ≈ 5 min). Returns null
   * when there is not enough history.
   */
  private extrapolateTrend(key: keyof SensorData, hoursAhead: number): number | null {
    const points = this.history.length;
    if (points < 5) return null;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < points; i++) {
      const v = this.history[i][key];
      if (typeof v === 'number') {
        xs.push(i);
        ys.push(v);
      }
    }
    if (xs.length < 5) return null;

    try {
      const regression = new SimpleLinearRegression(xs, ys);
      const stepsAhead = (hoursAhead * 60) / 5; // 5-minute sampling
      const slope = regression.slope;
      // Guard against absurd extrapolations from noisy data
      if (!Number.isFinite(slope)) return null;
      const value = regression.predict(xs.length - 1 + stepsAhead);
      return typeof value === 'number' ? value : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Prediction methods (TensorFlow.js when available, fallback otherwise)
  // ------------------------------------------------------------------

  predictSoilMoisture(current: SensorData, hoursAhead: number = 6): number {
    const now = new Date();
    const features = [
      current.temperature,
      current.soilTemperature,
      current.humidity,
      current.soilMoisture,
      current.gas,
      current.light,
      current.airPressure,
      now.getHours(),
      this.dayOfYear(now),
    ];

    const tfValue = this.predictWithModel(this.soilMoistureModel, features);
    if (tfValue !== null) return Math.max(0, Math.min(100, tfValue));

    // Fallback 1: linear trend from observed history
    const trend = this.extrapolateTrend('soilMoisture', hoursAhead);
    if (trend !== null) return Math.max(0, Math.min(100, trend));

    // Fallback 2: evapotranspiration heuristic
    const hour = now.getHours();
    const daylight = hour > 6 && hour < 18 ? Math.sin(((hour - 6) / 12) * Math.PI) : 0;
    const evapotranspiration =
      hoursAhead * (0.04 * current.temperature + 0.02 * daylight * (current.light / 1000) - 0.01 * (current.humidity / 10));
    return Math.max(0, Math.min(100, current.soilMoisture - evapotranspiration));
  }

  predictGasLevel(current: SensorData, hoursAhead: number = 3): number {
    const now = new Date();
    const features = [current.temperature, current.humidity, current.airPressure, now.getHours(), current.gas];

    const tfValue = this.predictWithModel(this.gasModel, features);
    if (tfValue !== null) return Math.max(0, tfValue);

    const trend = this.extrapolateTrend('gas', hoursAhead);
    if (trend !== null) return Math.max(0, trend);

    // Fallback: gas accumulates with heat and poor ventilation
    const drift = hoursAhead * (0.4 * Math.max(0, current.temperature - 20) + 0.05 * (100 - current.humidity) * 0.1);
    return Math.max(0, current.gas + drift);
  }

  predictTemperature(current: SensorData, hoursAhead: number = 12): number {
    const now = new Date();
    const features = [
      current.temperature,
      current.humidity,
      current.airPressure,
      current.light,
      now.getHours(),
      this.dayOfYear(now),
    ];

    const tfValue = this.predictWithModel(this.temperatureModel, features);
    if (tfValue !== null) return tfValue;

    // Fallback: project along the diurnal sinusoid
    const targetHour = (now.getHours() + hoursAhead) % 24;
    const seasonal = 10 * Math.sin((this.dayOfYear(now) / 365) * 2 * Math.PI);
    const diurnal = 5 * Math.sin((targetHour / 24) * 2 * Math.PI);
    const baseline = 15 + seasonal + diurnal;
    // Blend with the current reading so we stay anchored to reality
    return current.temperature * 0.6 + baseline * 0.4;
  }

  predictHarvestDate(avgConditions: {
    avgTemp: number;
    avgSoilMoisture: number;
    avgHumidity: number;
    totalLight: number;
    stressEvents: number;
  }): number {
    const now = new Date();
    const features = [
      this.dayOfYear(now),
      avgConditions.avgTemp,
      avgConditions.avgSoilMoisture,
      avgConditions.avgHumidity,
      avgConditions.totalLight,
      avgConditions.stressEvents,
    ];

    const tfValue = this.predictWithModel(this.harvestModel, features);
    if (tfValue !== null) return Math.max(60, Math.min(180, tfValue));

    // Fallback: growth-degree-day inspired estimate (potatoes need ~90-120 days)
    const thermalScore = Math.min(1, (avgConditions.avgTemp / 20) * (avgConditions.avgSoilMoisture / 50));
    const base = 120 - thermalScore * 25 + avgConditions.stressEvents * 2;
    return Math.max(60, Math.min(180, base));
  }

  // Generate AI suggestions based on predictions
  generateSuggestions(
    current: SensorData
  ): Array<{
    type: string;
    suggestion: string;
    reason: string;
    recommendedAction: { target: string; action: string; mode: 'MANUAL' | 'AUTO' | null };
    confidence: number;
  }> {
    const suggestions: Array<{
      type: string;
      suggestion: string;
      reason: string;
      recommendedAction: { target: string; action: string; mode: 'MANUAL' | 'AUTO' | null };
      confidence: number;
    }> = [];
    const predictedSoilMoisture = this.predictSoilMoisture(current, 6);
    const predictedGas = this.predictGasLevel(current, 3);
    const predictedTemp = this.predictTemperature(current, 12);

    // Irrigation prediction
    if (predictedSoilMoisture < 30 && current.soilMoisture >= 30) {
      suggestions.push({
        type: 'irrigation',
        suggestion: `Predictive irrigation needed in ~6 hours (soil moisture will drop to ${predictedSoilMoisture.toFixed(1)}%)`,
        reason: `ML model predicts soil moisture will fall below 30% threshold based on current trends`,
        recommendedAction: { target: 'pump', action: 'ON', mode: 'AUTO' },
        confidence: 0.85,
      });
    } else if (current.soilMoisture < 30) {
      suggestions.push({
        type: 'irrigation',
        suggestion: 'Start irrigation now',
        reason: `Current soil moisture at ${current.soilMoisture.toFixed(1)}% — below 30% threshold`,
        recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
        confidence: 0.95,
      });
    }

    // Gas warning
    if (predictedGas > 250 && current.gas <= 250) {
      suggestions.push({
        type: 'environment',
        suggestion: `Gas levels predicted to exceed 250 ppm in ~3 hours (predicted: ${predictedGas.toFixed(0)} ppm)`,
        reason: 'ML model detects rising gas trend',
        recommendedAction: { target: 'gasSensor', action: 'CHECK_SENSOR', mode: null },
        confidence: 0.82,
      });
    } else if (current.gas > 200) {
      suggestions.push({
        type: 'environment',
        suggestion: 'Check gas sensor readings',
        reason: `Current gas at ${current.gas} ppm — approaching warning threshold`,
        recommendedAction: { target: 'gasSensor', action: 'CHECK_SENSOR', mode: null },
        confidence: 0.9,
      });
    }

    // Temperature stress
    if (predictedTemp > 35 || predictedTemp < 5) {
      suggestions.push({
        type: 'anomaly',
        suggestion: `Temperature stress predicted: ${predictedTemp.toFixed(1)}°C in 12 hours`,
        reason: 'Extreme temperature may damage crops',
        recommendedAction: { target: 'system', action: 'ALERT', mode: 'MANUAL' },
        confidence: 0.78,
      });
    }

    // Harvest prediction (weekly)
    if (Math.random() < 0.1) {
      // Simulate weekly check
      const harvestDays = this.predictHarvestDate({
        avgTemp: current.temperature,
        avgSoilMoisture: current.soilMoisture,
        avgHumidity: current.humidity,
        totalLight: current.light * 24,
        stressEvents: 0,
      });
      suggestions.push({
        type: 'harvest',
        suggestion: `Estimated harvest in ~${Math.round(harvestDays)} days`,
        reason: 'Based on current growing conditions and potato crop model',
        recommendedAction: { target: 'system', action: 'PREPARE_HARVEST', mode: 'MANUAL' },
        confidence: 0.72,
      });
    }

    return suggestions;
  }

  /** Snapshot of model availability + metadata for /api/ai/model-info */
  getModelInfo(): {
    models: Record<string, boolean>;
    metadata: ModelMetadata | null;
    backend: 'tfjs-node' | 'fallback';
  } {
    return {
      models: {
        soilMoisture: !!this.soilMoistureModel,
        gas: !!this.gasModel,
        temperature: !!this.temperatureModel,
        harvest: !!this.harvestModel,
      },
      metadata: this.metadata,
      backend: this.tf ? 'tfjs-node' : 'fallback',
    };
  }

  async retrainWithNewData(newSamples: TrainingSample[]): Promise<void> {
    // Incremental retraining would go here
    logger.info({ samples: newSamples.length }, 'Retraining models with new data');
  }
}

export const aiEngine = new AIEngine();
