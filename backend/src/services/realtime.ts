import { getDatabase, isFirebaseEnabled, getRestClient } from './firebase.js';
import { getLogger } from '../utils/logger.js';
import type { SensorData, SystemStatus, Command, CommandResult, AISuggestion, SensouraState } from '../models/sensoura.js';
import { aiEngine } from '../ai/engine.js';
import { EventEmitter } from 'events';

const logger = getLogger('realtime');

type StateListener = (state: Partial<SensouraState>) => void;

export class RealtimeService extends EventEmitter {
  private stateListeners: Map<string, StateListener[]> = new Map();
  private currentState: Partial<SensouraState> = {};
  private unsubscribers: (() => void)[] = [];
  private isListening = false;
  private restMode = false;
  private sdkDataReceived = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private mockTimer: ReturnType<typeof setInterval> | null = null;

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
          lastUpdate: Date.now(),
        },
        system: {
          status: 'online',
          lastSeen: Date.now(),
          deviceId: 'sensoura-esp32-01',
          relay: { mode: 'AUTO', state: 'ON', reason: 'soil_dry', lastAction: Date.now() },
          buzzer: { muted: false },
          leds: { green: false, red: true },
        },
        commands: {},
        commandResults: {},
        aiSuggestions: {},
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

    if (isFirebaseEnabled()) {
      const db = getDatabase();
      if (!db) return;

      const paths = ['sensorData', 'system', 'commands', 'commandResults', 'aiSuggestions'];
      for (const path of paths) {
        const ref = db.ref(`/Sensoura/${path}`);
        const unsub = ref.on('value', (snap) => {
          this.sdkDataReceived = true;
          const data = snap.val();
          this.currentState[path as keyof SensouraState] = data;
          if (path === 'sensorData' && data) {
            aiEngine.recordObservation(data as SensorData);
          }
          this.notify(path, data);
        });
        this.unsubscribers.push(() => ref.off('value', unsub));
      }
      logger.info('Firebase real-time listeners attached');

      // Health probe: some networks reject the SDK's persistent websocket
      // channel. If nothing arrives within 12s, fall back to REST polling
      // with the same service-account credentials (verified working).
      setTimeout(() => {
        if (!this.sdkDataReceived && this.isListening && getRestClient()) {
          this.restMode = true;
          logger.warn('Firebase SDK realtime channel silent — switching to REST polling fallback (5s)');
          void this.pollRest();
          this.pollTimer = setInterval(() => void this.pollRest(), 5000);
        }
      }, 12_000);
    } else {
      logger.info('Running in LOCAL MODE — using mock real-time updates');
      this.setupMockData();
    }

    this.emit('ready');
  }

  /** One REST poll of /Sensoura — used when the SDK channel is unavailable. */
  private async pollRest(): Promise<void> {
    const rest = getRestClient();
    if (!rest) return;
    try {
      const data = await rest.get<Partial<SensouraState>>('/Sensoura');
      if (!data) return;
      for (const key of ['sensorData', 'system', 'commands', 'commandResults', 'aiSuggestions'] as const) {
        if (data[key] !== undefined) {
          this.currentState[key] = data[key] as never;
          if (key === 'sensorData' && data.sensorData) {
            aiEngine.recordObservation(data.sensorData);
          }
          this.notify(key, data[key]);
        }
      }
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'Firebase REST poll failed');
    }
  }

  /**
   * Write to Firebase using the SDK channel, racing a 5s timeout; on
   * failure it permanently switches to the REST transport and retries once.
   */
  private async writeFirebase(path: string, value: unknown, merge = false): Promise<void> {
    const rest = getRestClient();

    const writeRest = async () => {
      if (!rest) return;
      if (merge) await rest.update(path, value as Record<string, unknown>);
      else await rest.put(path, value);
    };

    if (this.restMode) {
      await writeRest();
      return;
    }

    const db = getDatabase();
    if (!db) return;

    const ref = db.ref(path);
    const write = merge ? ref.update(value as Record<string, unknown>) : ref.set(value);
    (write as Promise<unknown>).catch(() => undefined); // avoid unhandled rejection on the loser
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SDK write timed out after 5s')), 5000)
    );

    try {
      await Promise.race([write, timeout]);
    } catch (error) {
      logger.warn({ path, err: (error as Error).message }, 'SDK write failed — switching to REST transport');
      this.restMode = true;
      await writeRest();
    }
  }

  stopListening(): void {
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
    this.isListening = false;
    logger.info('Real-time listeners stopped');
  }

  /** True when live data is flowing over the REST fallback transport. */
  isUsingRestFallback(): boolean {
    return this.restMode;
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

  // Mutations
  async sendCommand(command: Omit<Command, 'id' | 'timestamp'>): Promise<string> {
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullCommand: Command = { ...command, id, timestamp: Date.now() };

    if (isFirebaseEnabled()) {
      await this.writeFirebase(`/Sensoura/commands/${id}`, fullCommand);
    } else {
      this.currentState.commands = { ...this.currentState.commands, [id]: fullCommand };
      this.notify('commands', this.currentState.commands);
    }

    logger.info({ commandId: id, ...command }, 'Command sent');
    return id;
  }

  async approveSuggestion(suggestionId: string): Promise<void> {
    const suggestions = this.currentState.aiSuggestions ?? {};
    const suggestion = suggestions[suggestionId];
    if (!suggestion) throw new Error('Suggestion not found');

    suggestion.status = 'approved';
    suggestion.requiresApproval = false;

    // Auto-execute if it's a command
    if (suggestion.recommendedAction.target && suggestion.recommendedAction.action) {
      await this.sendCommand({
        target: suggestion.recommendedAction.target as any,
        action: suggestion.recommendedAction.action as any,
        mode: suggestion.recommendedAction.mode ?? 'MANUAL',
      });
      suggestion.status = 'executed';
    }

    if (isFirebaseEnabled()) {
      await this.writeFirebase(`/Sensoura/aiSuggestions/${suggestionId}`, suggestion, true);
    } else {
      this.notify('aiSuggestions', this.currentState.aiSuggestions);
    }
  }

  async rejectSuggestion(suggestionId: string): Promise<void> {
    const suggestions = this.currentState.aiSuggestions ?? {};
    if (!suggestions[suggestionId]) throw new Error('Suggestion not found');

    suggestions[suggestionId].status = 'rejected';

    if (isFirebaseEnabled()) {
      await this.writeFirebase(`/Sensoura/aiSuggestions/${suggestionId}`, { status: 'rejected' }, true);
    } else {
      this.notify('aiSuggestions', suggestions);
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

  // MQTT Bridge for ESP32
  async publishToDevice(topic: string, payload: any): Promise<void> {
    // Implementation would use MQTT client
    logger.debug({ topic, payload }, 'MQTT publish (stub)');
  }
}

export const realtimeService = new RealtimeService();