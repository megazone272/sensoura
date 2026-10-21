import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Wifi,
  Database,
  Brain,
  Cpu,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useConnection, useSystem } from '@store/sensorStore';
import { endpoints } from '@services/api';
import { formatDistanceToNow } from 'date-fns';

interface HealthInfo {
  status: string;
  mission: string;
  phase: string;
  team: string;
  timestamp: number;
  uptime: number;
  firebase: string;
}

interface ModelInfo {
  models: Record<string, boolean>;
  metadata: {
    version: string;
    trainedAt: number;
    samplesCount: number;
    accuracy: number;
    backend: string;
  } | null;
  backend: 'tfjs-node' | 'fallback';
}

export function Settings() {
  const { connected, connecting, error } = useConnection();
  const system = useSystem();

  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchInfo = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [healthRes, modelRes] = await Promise.all([
        endpoints.health(),
        endpoints.getModelInfo(),
      ]);
      setHealth(healthRes.data);
      setModelInfo(modelRes.data);
    } catch (e) {
      setFetchError((e as Error).message || 'Failed to fetch backend info');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInfo();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SettingsIcon className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
            Settings
          </h1>
          <p className="text-[var(--text-muted)] mt-1">Mission configuration & system information</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={fetchInfo} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="card border-[var(--accent-danger)]/30 bg-[var(--accent-danger)]/5">
          <p className="text-sm text-[var(--accent-danger)]">Could not reach backend: {fetchError}</p>
        </div>
      )}

      {/* NASA Mission metadata */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Database className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          NASA Competition Mission
        </h3>
        <div className="grid grid-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Mission</p>
            <p className="font-mono font-medium mt-1">{health?.mission ?? 'SENSOURA'}</p>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Phase</p>
            <p className="font-mono font-medium mt-1">{health?.phase ?? 'LUNAR_ANALOG'}</p>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Team ID</p>
            <p className="font-mono font-medium mt-1">{health?.team ?? 'TEAM-MISSION-49'}</p>
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Backend Uptime</p>
            <p className="font-mono font-medium mt-1">
              {health ? `${Math.floor(health.uptime / 60)}m ${Math.floor(health.uptime % 60)}s` : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Connections */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Wifi className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            Connections
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <span className="text-sm">WebSocket (Socket.IO)</span>
              <span className={`badge ${connected ? 'badge-success' : connecting ? 'badge-warning' : 'badge-danger'}`}>
                {connected ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected'}
              </span>
            </div>
            {error && (
              <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
                <p className="text-xs text-[var(--accent-danger)]">{error}</p>
              </div>
            )}
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <span className="text-sm">Firebase RTDB</span>
              <span className={`badge ${health?.firebase === 'sdk' ? 'badge-success' : health?.firebase === 'rest-fallback' ? 'badge-warning' : 'badge-neutral'}`}>
                {health?.firebase ?? 'unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <span className="text-sm">Device</span>
              <span className="font-mono text-xs">{system?.deviceId ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <span className="text-sm">Last telemetry</span>
              <span className="text-xs text-[var(--text-muted)]">
                {system?.lastSeen
                  ? formatDistanceToNow(new Date(system.lastSeen), { addSuffix: true })
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* AI Engine */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            AI Engine
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <span className="text-sm">Backend</span>
              <span className={`badge ${modelInfo?.backend === 'tfjs-node' ? 'badge-success' : 'badge-warning'}`}>
                {modelInfo?.backend ?? '—'}
              </span>
            </div>
            {modelInfo?.metadata && (
              <>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
                  <span className="text-sm">Model version</span>
                  <span className="font-mono text-xs">{modelInfo.metadata.version}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
                  <span className="text-sm">Trained</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatDistanceToNow(new Date(modelInfo.metadata.trainedAt), { addSuffix: true })}
                  </span>
                </div>
              </>
            )}
            <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
              <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">Models</p>
              <div className="flex flex-wrap gap-2">
                {['soilMoisture', 'gas', 'temperature', 'harvest'].map((name) => (
                  <span
                    key={name}
                    className={`badge ${modelInfo?.models?.[name] ? 'badge-success' : 'badge-neutral'}`}
                  >
                    {name}: {modelInfo?.models?.[name] ? 'trained' : 'fallback'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backend endpoints */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          Backend Endpoints
        </h3>
        <div className="grid sm:grid-cols-2 gap-2 font-mono text-sm">
          {[
            ['GET', '/health', 'Health check'],
            ['GET', '/ready', 'Readiness probe'],
            ['GET', '/metrics', 'Prometheus metrics'],
            ['GET', '/api/state', 'Full system state'],
            ['GET', '/api/ai-suggestions', 'AI suggestions'],
            ['GET', '/api/ai/predictions', 'ML predictions'],
            ['POST', '/api/command', 'Send command'],
            ['POST', '/api/relay', 'Relay (pump) control'],
          ].map(([method, path, desc]) => (
            <div key={path} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-tertiary)]">
              <span className={`badge ${method === 'GET' ? 'badge-info' : 'badge-warning'} text-xs`}>{method}</span>
              <span className="truncate">{path}</span>
              <span className="text-xs text-[var(--text-muted)] truncate">({desc})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Firmware */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Cpu className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          Device Firmware
        </h3>
        <p className="text-sm text-[var(--text-muted)] mb-3">
          ESP32-S3 N16R8 firmware lives in the <code className="font-mono">firmware/</code> directory
          (PlatformIO / Arduino). Flash it with:
        </p>
        <pre className="p-3 rounded-xl bg-[var(--bg-tertiary)] font-mono text-xs overflow-x-auto">
{`cd firmware
pio run -t upload --monitor
# or open in VS Code + PlatformIO extension`}
        </pre>
        <a
          className="inline-flex items-center gap-1 mt-3 text-sm text-[var(--accent-primary)] hover:underline"
          href="https://docs.platformio.org/en/latest/core/installation.html"
          target="_blank"
          rel="noreferrer"
        >
          PlatformIO docs <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
