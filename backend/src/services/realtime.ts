import { getDatabase, isFirebaseEnabled } from './firebase.js';
import { getLogger } from '../utils/logger.js';
import type { SensorData, SystemStatus, Command, CommandResult, AISuggestion, AIPrediction, LocationInfo, SensouraState, RelayState, BuzzerState } from '../models/sensoura.js';
import { aiEngine } from '../ai/engine.js';
import { EventEmitter } from 'events';

const logger = getLogger('realtime');

type StateListener = (state: Partial<SensouraState>) => void;

export type TelemetryPayload = {
  sensorData: SensorData;
  timestamp?: number;
  system?: SystemStatus;
};

export type CommandFeedback = {
  commandId: string;
  status: 'sent' | 'acked' | 'failed';
  timestamp: number;
};

function defaultSystem(): SystemStatus {
  return {
    status: 'online',
    lastSeen: Date.now(),
    deviceId: 'sensoura-esp32-01',
    relay: { mode: 'MANUAL', state: 'OFF', reason: 'manual', lastAction: Date.now() },
    buzzer: { muted: false },
    leds: { green: false, red: false },
  };
}

export function normalizeSensorPayload(raw: any): SensorData {
  if (!raw || typeof raw !== 'object') return raw;
  const pressure = typeof raw.BarometricPressure === 'number'
    ? raw.BarometricPressure
    : (typeof raw.Barometricpressure === 'number'
      ? raw.Barometricpressure
      : (typeof raw.airPressure === 'number' ? raw.airPressure : 1013.25));

  return {
    AirTemp: typeof raw.AirTemp === 'number' ? raw.AirTemp : (typeof raw.temperature === 'number' ? raw.temperature : 0),
    SoilTemp: typeof raw.SoilTemp === 'number' ? raw.SoilTemp : (typeof raw.soilTemperature === 'number' ? raw.soilTemperature : 0),
    AirHumidity: typeof raw.AirHumidity === 'number' ? raw.AirHumidity : (typeof raw.humidity === 'number' ? raw.humidity : 0),
    SoilMoisture: typeof raw.SoilMoisture === 'number' ? raw.SoilMoisture : (typeof raw.soilMoisture === 'number' ? raw.soilMoisture : 0),
    VOC: typeof raw.VOC === 'number' ? raw.VOC : (typeof raw.gas === 'number' ? raw.gas : (typeof raw.voc === 'number' ? raw.voc : 0)),
    Light: typeof raw.Light === 'number' ? raw.Light : (typeof raw.light === 'number' ? raw.light : 0),
    Barometricpressure: pressure,
    BarometricPressure: pressure,
    ...(typeof raw.Altitude === 'number' ? { Altitude: raw.Altitude } : (typeof raw.altitude === 'number' ? { Altitude: raw.altitude } : {})),
    lastUpdate: typeof raw.lastUpdate === 'number' ? raw.lastUpdate : Date.now(),
  };
}

function safeCommandTarget(value: unknown): Command['target'] {
  return (value === 'pump' || value === 'buzzer' || value === 'led' || value === 'system') ? value : 'system';
}

function safeCommandAction(value: unknown): Command['action'] {
  return (value === 'ON' || value === 'OFF' || value === 'MUTE' || value === 'UNMUTE' || value === 'REBOOT' || value === 'CALIBRATE') ? value : 'ON';
}

function safeCommandMode(value: unknown): Command['mode'] {
  return (value === 'AUTO' || value === 'MANUAL') ? value : 'MANUAL';
}

function isSupportedCommand(target: string, action: string): target is Command['target'] {
  if (target === 'pump') return action === 'ON' || action === 'OFF';
  if (target === 'buzzer') return action === 'ON' || action === 'OFF' || action === 'MUTE' || action === 'UNMUTE';
  if (target === 'led') return action === 'ON' || action === 'OFF';
  if (target === 'system') return action === 'REBOOT' || action === 'CALIBRATE';
  return false;
}

export class RealtimeService extends EventEmitter {
  private stateListeners: Map<string, StateListener[]> = new Map();
  private currentState: Partial<SensouraState> = {};
  private unsubscribers: (() => void)[] = [];
  private isListening = false;
  private sdkDataReceived = false;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryEmitter: ((payload: TelemetryPayload) => void) | null = null;
  private commandFeedbackEmitter: ((feedback: CommandFeedback) => void) | null = null;
  private suggestionActionsInProgress = new Set<string>();
  private commandResultsInProgress = new Set<string>();

  constructor() {
    super();
    // Mock simulation is started in startListening() — by then
    // initializeFirebase() has already run, so we know the real transport.
  }

  private setupMockData() {
    if (!isFirebaseEnabled()) {
      if (this.mockTimer) return;
      this.currentState = {
        sensorData: {
          AirTemp: 28.4 + (Math.random() - 0.5) * 2,
          SoilTemp: 22.5 + (Math.random() - 0.5) * 1.5,
          AirHumidity: 65.0 + (Math.random() - 0.5) * 5,
          SoilMoisture: 24.0 + (Math.random() - 0.5) * 3,
          VOC: 185 + Math.floor((Math.random() - 0.5) * 20),
          Light: 720 + Math.floor((Math.random() - 0.5) * 100),
          Barometricpressure: 1013.25 + (Math.random() - 0.5) * 5,
          Altitude: 110.88,
          lastUpdate: Date.now(),
        },
        system: defaultSystem(),
        commands: {},
        commandResults: {},
        aiSuggestions: {},
        aiPredictions: {
          '3001': { type: 'rainfall', predictedValue: 'after 2 days afternoon', confidence: 0.85, predictionTime: 1791867600000 },
          '3002': { type: 'air_temp', predictedValue: 30.0, confidence: 0.9, predictionTime: 1791867600000 },
        },
      };
      // Simulate live sensor updates
      this.mockTimer = setInterval(() => this.simulateSensorUpdate(), 5000);
    }
  }

  private simulateSensorUpdate() {
    const sensorData = this.currentState.sensorData!;
    sensorData.AirTemp += (Math.random() - 0.5) * 0.5;
    sensorData.SoilTemp += (Math.random() - 0.5) * 0.3;
    sensorData.AirHumidity += (Math.random() - 0.5) * 1;
    sensorData.SoilMoisture = Math.max(0, Math.min(100, sensorData.SoilMoisture + (Math.random() - 0.5) * 0.5));
    sensorData.VOC += Math.floor((Math.random() - 0.5) * 5);
    sensorData.Light += Math.floor((Math.random() - 0.5) * 20);
    sensorData.Barometricpressure += (Math.random() - 0.5) * 0.2;
    sensorData.lastUpdate = Date.now();

    aiEngine.recordObservation(sensorData);

    // Auto-generate irrigation suggestion if soil moisture low
    if (sensorData.SoilMoisture < 30 && !this.hasPendingIrrigationSuggestion()) {
      this.addAISuggestion({
        type: 'irrigation',
        suggestion: 'Start irrigation now',
        reason: `Soil moisture at ${sensorData.SoilMoisture.toFixed(1)}% — below 30% threshold`,
        recommendedAction: { target: 'pump', action: 'ON', mode: 'MANUAL' },
        status: 'pending',
        requiresApproval: true,
        confidence: 0.92,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });
    }

    // Auto-generate gas warning
    if (sensorData.VOC > 200 && !this.hasPendingGasSuggestion()) {
      this.addAISuggestion({
        type: 'environment',
        suggestion: 'Check gas sensor readings',
        reason: `Gas level at ${sensorData.VOC} ppm — approaching warning threshold (200 ppm)`,
        recommendedAction: { target: 'gasSensor', action: 'CHECK_SENSOR', mode: null },
        status: 'pending',
        requiresApproval: true,
        confidence: 0.88,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      });
    }

    this.notify('sensorData', sensorData);
  }

  private hasPendingIrrigationSuggestion(): boolean {
    const suggestions = this.currentState.aiSuggestions ?? {};
    return Object.values(suggestions).some(s => s.type === 'irrigation' && s.status === 'pending');
  }

  private hasPendingGasSuggestion(): boolean {
    const suggestions = this.currentState.aiSuggestions ?? {};
    return Object.values(suggestions).some(s => s.type === 'environment' && s.status === 'pending');
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;
    this.isListening = true;
    this.sdkDataReceived = false;

    if (isFirebaseEnabled()) {
      const db = getDatabase();
      if (!db) return;

      const paths = ['sensorData', 'system', 'commands', 'commandResults', 'aiSuggestions', 'aiPredictions', 'location'];
      for (const path of paths) {
        const ref = db.ref(`/Sensoura/${path}`);
        const unsub = ref.on('value', (snap) => {
          this.sdkDataReceived = true;
          const raw = snap.val();
          const data = (path === 'sensorData' && raw) ? normalizeSensorPayload(raw) : raw;
          this.currentState[path as keyof SensouraState] = data;
          if (path === 'sensorData' && data) {
            aiEngine.recordObservation(data as SensorData);
          }
          this.notify(path, data);
        });
        this.unsubscribers.push(() => ref.off('value', unsub));
      }
      logger.info('Firebase real-time listeners attached');
    } else {
      logger.info('Running in LOCAL MODE — using mock real-time updates');
      this.setupMockData();
    }

    this.emit('ready');
  }

  /** Write using the authenticated Firebase Admin SDK; never downgrade transport. */
  private async writeFirebase(path: string, value: unknown, merge = false): Promise<void> {
    const db = getDatabase();
    if (!isFirebaseEnabled() || !db) throw new Error('Firebase Admin Database is unavailable');

    const ref = db.ref(path);
    if (merge) await ref.update(value as Record<string, unknown>);
    else await ref.set(value);
  }

  stopListening(): void {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
    this.isListening = false;
    logger.info('Real-time listeners stopped');
  }

  isRealtimeReady(): boolean {
    return !isFirebaseEnabled() || (this.isListening && this.sdkDataReceived);
  }

  // State access
  getState(): Partial<SensouraState> {
    return { ...this.currentState };
  }

  getSensorData(): SensorData | null {
    return this.currentState.sensorData ?? null;
  }

  getSystemStatus(): SystemStatus | null {
    return this.currentState.system ?? null;
  }

  getCommands(): Record<string, Command> {
    return this.currentState.commands ?? {};
  }

  getCommandResults(): Record<string, CommandResult> {
    return this.currentState.commandResults ?? {};
  }

  getAISuggestions(): Record<string, AISuggestion> {
    return this.currentState.aiSuggestions ?? {};
  }

  getAIPredictions(): Record<string, AIPrediction> {
    return this.currentState.aiPredictions ?? {};
  }

  getLocation(): LocationInfo | null {
    return this.currentState.location ?? null;
  }

  // Mutations
  async sendCommand(command: Omit<Command, 'id' | 'timestamp'>): Promise<string> {
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const deviceId = command.deviceId ?? process.env.DEVICE_ID ?? this.currentState.system?.deviceId ?? defaultSystem().deviceId;
    const fullCommand: Command = { ...command, deviceId, id, timestamp: Date.now() };
    this.currentState.commands = { ...this.currentState.commands, [id]: fullCommand };
    this.notify('commands', this.currentState.commands);

    if (isFirebaseEnabled()) {
      try {
        await this.writeFirebase(`/Sensoura/commands/${id}`, fullCommand);
      } catch (error) {
        const commands = { ...this.currentState.commands };
        delete commands[id];
        this.currentState.commands = commands;
        this.notify('commands', commands);
        throw error;
      }
    }

    logger.info({ commandId: id, target: command.target, action: command.action, mode: command.mode }, 'Command sent');

    const feedback: CommandFeedback = { commandId: id, status: 'sent', timestamp: Date.now() };
    this.emitCommandFeedback(feedback);

    return id;
  }

  async recordCommandResult(commandId: string, result: CommandResult): Promise<void> {
    if (this.currentState.commandResults?.[commandId] || this.commandResultsInProgress.has(commandId)) {
      throw new Error('Command result already reported');
    }
    this.commandResultsInProgress.add(commandId);
    try {
      if (isFirebaseEnabled()) await this.writeFirebase(`/Sensoura/commandResults/${commandId}`, result);
      this.currentState.commandResults = { ...this.currentState.commandResults, [commandId]: result };
      this.notify('commandResults', this.currentState.commandResults);
    } finally {
      this.commandResultsInProgress.delete(commandId);
    }
  }

  async approveSuggestion(suggestionId: string): Promise<void> {
    const suggestions = this.currentState.aiSuggestions ?? {};
    const suggestion = suggestions[suggestionId];
    if (!suggestion) throw new Error('Suggestion not found');
    if (suggestion.status !== 'pending') throw new Error(`Suggestion is already ${suggestion.status}`);
    if (this.suggestionActionsInProgress.has(suggestionId)) throw new Error('Suggestion action is already in progress');

    if (suggestion.expiresAt && suggestion.expiresAt <= Date.now()) {
      suggestion.status = 'expired';
      suggestion.requiresApproval = false;
      if (isFirebaseEnabled()) {
        await this.writeFirebase(`/Sensoura/aiSuggestions/${suggestionId}`, suggestion, true);
      } else {
        this.notify('aiSuggestions', suggestions);
      }
      throw new Error('Suggestion has expired');
    }

    this.suggestionActionsInProgress.add(suggestionId);
    try {
      const { target, action, mode } = suggestion.recommendedAction;
      if (target && action && isSupportedCommand(target, action)) {
        await this.sendCommand({
          target: safeCommandTarget(target),
          action: safeCommandAction(action),
          mode: safeCommandMode(mode),
        });
        suggestion.status = 'executed';
      } else {
        // Unsupported recommendations are acknowledged as advice; never coerce
        // them into a different actuator command.
        suggestion.status = 'approved';
      }
      suggestion.requiresApproval = false;

      if (isFirebaseEnabled()) {
        await this.writeFirebase(`/Sensoura/aiSuggestions/${suggestionId}`, suggestion, true);
      } else {
        this.notify('aiSuggestions', suggestions);
      }
    } finally {
      this.suggestionActionsInProgress.delete(suggestionId);
    }
  }

  async rejectSuggestion(suggestionId: string): Promise<void> {
    const suggestions = this.currentState.aiSuggestions ?? {};
    const suggestion = suggestions[suggestionId];
    if (!suggestion) throw new Error('Suggestion not found');
    if (suggestion.status !== 'pending') throw new Error(`Suggestion is already ${suggestion.status}`);
    if (this.suggestionActionsInProgress.has(suggestionId)) throw new Error('Suggestion action is already in progress');

    this.suggestionActionsInProgress.add(suggestionId);
    try {
      if (suggestion.expiresAt && suggestion.expiresAt <= Date.now()) {
        suggestion.status = 'expired';
        suggestion.requiresApproval = false;
        if (isFirebaseEnabled()) {
          await this.writeFirebase(`/Sensoura/aiSuggestions/${suggestionId}`, suggestion, true);
        } else {
          this.notify('aiSuggestions', suggestions);
        }
        throw new Error('Suggestion has expired');
      }

      suggestion.status = 'rejected';
      suggestion.requiresApproval = false;
      if (isFirebaseEnabled()) {
        await this.writeFirebase(`/Sensoura/aiSuggestions/${suggestionId}`, suggestion, true);
      } else {
        this.notify('aiSuggestions', suggestions);
      }
    } finally {
      this.suggestionActionsInProgress.delete(suggestionId);
    }
  }

  addAISuggestion(suggestion: Omit<AISuggestion, 'id'>): string {
    const id = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullSuggestion: AISuggestion = { ...suggestion, id };

    this.currentState.aiSuggestions = { ...this.currentState.aiSuggestions, [id]: fullSuggestion };
    this.notify('aiSuggestions', this.currentState.aiSuggestions);

    if (isFirebaseEnabled()) {
      void this.writeFirebase(`/Sensoura/aiSuggestions/${id}`, fullSuggestion).catch((err) =>
        logger.warn({ err, suggestionId: id }, 'Failed to persist AI suggestion to Firebase')
      );
    }
    return id;
  }

  // Subscription
  subscribe(key: string, listener: StateListener): () => void {
    if (!this.stateListeners.has(key)) this.stateListeners.set(key, []);
    this.stateListeners.get(key)!.push(listener);
    return () => this.unsubscribe(key, listener);
  }

  private unsubscribe(key: string, listener: StateListener): void {
    const entries = this.stateListeners.get(key);
    if (!entries) return;
    const index = entries.indexOf(listener);
    if (index >= 0) entries.splice(index, 1);
  }

  private notify(key: string, data: any): void {
    this.stateListeners.get(key)?.forEach(l => l({ [key]: data }));
    this.emit(key, data);
    this.emit('update', { [key]: data });
  }

  // Socket.IO bridge hooks used by the socket module.
  // These are intentionally narrow wrappers around the real-time service
  // so the socket layer does not reach into internal state.

  handleTelemetry(_authContext: any, payload: TelemetryPayload): void {
    if (!payload?.sensorData) return;
    this.currentState.sensorData = payload.sensorData;
    const existingSystem = this.currentState.system as SystemStatus | undefined;
    if (payload.system) {
      this.currentState.system = payload.system;
    } else if (existingSystem) {
      this.currentState.system = { ...existingSystem, lastSeen: Date.now() };
    } else {
      this.currentState.system = defaultSystem();
    }
    this.notify('sensorData', payload.sensorData);
    if (payload.system) this.notify('system', payload.system);
    aiEngine.recordObservation(payload.sensorData);
    this.emitTelemetry(payload);
  }

  async handleDeviceTelemetry(
    authContext: { authMethod?: string; isDevice?: boolean; deviceId?: string } | undefined,
    payload: { sensorData: SensorData; system: SystemStatus },
  ): Promise<void> {
    if (authContext?.authMethod !== 'device-bearer' || !authContext.isDevice || authContext.deviceId !== payload.system.deviceId) {
      throw new Error('Device identity mismatch');
    }
    if (isFirebaseEnabled()) {
      await Promise.all([
        this.writeFirebase('/Sensoura/sensorData', payload.sensorData),
        this.writeFirebase('/Sensoura/system', payload.system),
      ]);
    }
    this.currentState.sensorData = payload.sensorData;
    this.currentState.system = payload.system;
    this.notify('sensorData', payload.sensorData);
    this.notify('system', payload.system);
    aiEngine.recordObservation(payload.sensorData);
    this.emitTelemetry({ sensorData: payload.sensorData, system: payload.system, timestamp: payload.sensorData.lastUpdate });
  }

  handleCommand(_authContext: any, payload: { target?: string; action?: string; mode?: string }): void {
    const target = payload?.target;
    const action = payload?.action;
    if (!target || !action) return;
    void this.sendCommand({
      target: safeCommandTarget(target),
      action: safeCommandAction(action),
      mode: safeCommandMode(payload?.mode),
    });
  }

  handleRelayUpdate(_authContext: any, payload: { mode?: string; state?: string; reason?: string }): void {
    const currentRelay = (this.currentState.system as SystemStatus | undefined)?.relay;
    const updated: RelayState = {
      mode: payload?.mode ? (payload.mode as RelayState['mode']) : (currentRelay?.mode ?? 'MANUAL'),
      state: payload?.state ? (payload.state as RelayState['state']) : (currentRelay?.state ?? 'OFF'),
      reason: payload?.reason ? (payload.reason as RelayState['reason']) : (currentRelay?.reason ?? 'manual'),
      lastAction: Date.now(),
    };
    const nextSystem: SystemStatus = (this.currentState.system as SystemStatus | undefined)
      ? { ...this.currentState.system as SystemStatus, relay: updated }
      : { ...defaultSystem(), relay: updated };
    this.currentState.system = nextSystem;
    this.notify('system', this.currentState.system);
  }

  handleBuzzer(_authContext: any, payload: { muted?: boolean; duration?: number }): void {
    const buzzer: BuzzerState = { muted: payload?.muted ?? false };
    const nextSystem: SystemStatus = (this.currentState.system as SystemStatus | undefined)
      ? { ...this.currentState.system as SystemStatus, buzzer }
      : { ...defaultSystem(), buzzer };
    this.currentState.system = nextSystem;
    this.notify('system', this.currentState.system);
  }

  handleSuggestionAction(authContext: any, payload: { suggestionId: string }, action: 'approved' | 'rejected'): void {
    if (action === 'approved') {
      void this.approveSuggestion(payload.suggestionId);
    } else {
      void this.rejectSuggestion(payload.suggestionId);
    }
    logger.info({ userId: authContext?.userId, suggestionId: payload.suggestionId, action }, 'Suggestion action received via Socket.IO');
  }

  handleSystemAction(authContext: any, _payload: any, action: 'reboot' | 'calibrate'): void {
    logger.info({ userId: authContext?.userId, action }, 'System action received via Socket.IO');
    const existingSystem = this.currentState.system as SystemStatus | undefined;
    if (existingSystem) {
      this.currentState.system = { ...existingSystem, status: 'online', lastSeen: Date.now() };
      this.notify('system', this.currentState.system);
    }
  }

  onTelemetryUpdate(handler: (payload: TelemetryPayload) => void): () => void {
    this.telemetryEmitter = handler;
    return () => { this.telemetryEmitter = null; };
  }

  private emitTelemetry(payload: TelemetryPayload): void {
    this.telemetryEmitter?.(payload);
  }

  onCommandFeedback(handler: (feedback: CommandFeedback) => void): () => void {
    this.commandFeedbackEmitter = handler;
    return () => { this.commandFeedbackEmitter = null; };
  }

  private emitCommandFeedback(feedback: CommandFeedback): void {
    this.commandFeedbackEmitter?.(feedback);
  }

  // MQTT Bridge for ESP32
  async publishToDevice(topic: string, payload: any): Promise<void> {
    // Implementation would use MQTT client
    logger.debug({ topic, payload }, 'MQTT publish (stub)');
  }
}

export const realtimeService = new RealtimeService();
