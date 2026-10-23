import { useSensorData, useSystem, useConnection, useAISuggestions, useSensorStore } from '@store/sensorStore';
import {
  Thermometer,
  Droplets,
  Flame,
  Sun,
  Gauge,
  Wifi,
  Database,
  AlertTriangle,
  Zap,
  Droplet,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { useState, useEffect } from 'react';

interface SensorConfig {
  key: string;
  label: string;
  unit: string;
  icon: typeof Thermometer;
  color: string;
  min: number;
  max: number;
}

const sensorConfig: SensorConfig[] = [
  { key: 'AirTemp', label: 'Air Temp', unit: '°C', icon: Thermometer, color: '#ef4444', min: -10, max: 50 },
  { key: 'SoilTemp', label: 'Soil Temp', unit: '°C', icon: Thermometer, color: '#f97316', min: -10, max: 50 },
  { key: 'AirHumidity', label: 'Humidity', unit: '%', icon: Droplets, color: '#06b6d4', min: 0, max: 100 },
  { key: 'SoilMoisture', label: 'Soil Moisture', unit: '%', icon: Droplet, color: '#22c55e', min: 0, max: 100 },
  { key: 'VOC', label: 'Gas (MQ135)', unit: 'ppm', icon: Flame, color: '#fbbf24', min: 0, max: 500 },
  { key: 'Light', label: 'Light', unit: 'lux', icon: Sun, color: '#fde047', min: 0, max: 100000 },
  { key: 'Barometricpressure', label: 'Pressure', unit: 'hPa', icon: Gauge, color: '#a855f7', min: 900, max: 1100 },
];

function SensorCard({ data, config, history }: { data: any; config: SensorConfig; history: number[] }) {
  const value = data?.[config.key] ?? 0;
  const percentage = Math.max(0, Math.min(100, ((value - config.min) / (config.max - config.min)) * 100));
  const Icon = config.icon;

  return (
    <div className="card glass-hover group relative overflow-hidden">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-[var(--text-muted)] truncate mb-1">
            <Icon className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" style={{ color: config.color }} />
            {config.label}
          </p>
          <p className="text-lg font-bold font-mono text-[var(--text-primary)] whitespace-nowrap">
            {typeof value === 'number' ? value.toFixed(config.key === 'Barometricpressure' ? 2 : 1) : value}
            <span className="text-[11px] font-normal text-[var(--text-muted)] ml-1">{config.unit}</span>
          </p>
        </div>
        <div className="w-14 h-14 relative flex-shrink-0">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="50%"
              cy="50%"
              r="24"
              fill="none"
              stroke="var(--border-primary)"
              strokeWidth="3"
            />
            <circle
              cx="50%"
              cy="50%"
              r="24"
              fill="none"
              stroke={config.color}
              strokeWidth="3"
              strokeDasharray={`${percentage * 1.51} 151`}
              strokeLinecap="round"
              className="transition-all duration-1000"
              style={{ filter: `drop-shadow(0 0 4px ${config.color})` }}
            />
          </svg>
        </div>
      </div>

      {/* Mini chart */}
      {history.length > 1 && (
        <div className="h-20 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history.map((v, i) => ({ value: v, index: i }))}>
              <defs>
                <linearGradient id={`gradient-${config.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={config.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={config.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={config.color}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#gradient-${config.key})`}
              />
              <XAxis axisLine={false} tickLine={false} tick={false} />
              <YAxis axisLine={false} tickLine={false} tick={false} />
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" vertical={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function SystemStatusCard({ system }: { system: any }) {
  if (!system) return null;

  const statusColors: Record<string, string> = {
    online: 'var(--accent-primary)',
    offline: 'var(--text-muted)',
    error: 'var(--accent-danger)',
  };

  const relayColor = system.relay?.state === 'ON' ? 'var(--accent-primary)' : 'var(--text-muted)';
  const buzzerColor = system.buzzer?.muted ? 'var(--text-muted)' : 'var(--accent-warning)';

  return (
    <div className="card glass-hover">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <Database className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
        System Status
      </h3>
      <div className="grid grid-2 gap-4">
        <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Device Status</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="status-dot" style={{ background: statusColors[system.status] }} />
            <span className="font-mono capitalize">{system.status}</span>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Device ID</p>
          <p className="font-mono text-sm mt-1 truncate">{system.deviceId}</p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Relay (Pump)</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="status-dot" style={{ background: relayColor }} />
            <span className="font-mono capitalize">{system.relay?.state}</span>
            <span className="text-xs text-[var(--text-muted)] px-2 py-0.5 rounded bg-[var(--bg-primary)]">
              {system.relay?.mode}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">Reason: {system.relay?.reason}</p>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Buzzer</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="status-dot" style={{ background: buzzerColor }} />
            <span className="font-mono capitalize">{system.buzzer?.muted ? 'Muted' : 'Active'}</span>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] col-span-2">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">LEDs</p>
          <div className="flex items-center gap-4 mt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={system.leds?.green}
                disabled
                className="w-4 h-4 accent-[var(--accent-primary)]"
              />
              <span className="text-sm">Green</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={system.leds?.red}
                disabled
                className="w-4 h-4 accent-[var(--accent-danger)]"
              />
              <span className="text-sm">Red</span>
            </label>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] col-span-2">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Last Seen</p>
          <p className="font-mono text-sm mt-1">
            {system.lastSeen ? formatDistanceToNow(new Date(system.lastSeen), { addSuffix: true }) : 'Unknown'}
          </p>
        </div>
      </div>
    </div>
  );
}

function AIAlerts({ suggestions }: { suggestions: Record<string, any> }) {
  const pending = Object.values(suggestions).filter((s: any) => s.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="card border-[var(--accent-warning)]/30 bg-[var(--accent-warning)]/5">
      <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-[var(--accent-warning)]">
        <AlertTriangle className="w-5 h-5" />
        AI Alerts ({pending.length})
      </h3>
      <div className="space-y-2">
        {pending.map((s: any) => (
          <div key={s.id} className="p-3 rounded-xl bg-[var(--bg-tertiary)] border-l-4 border-[var(--accent-warning)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-medium">{s.suggestion}</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">{s.reason}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="badge badge-warning">{s.type}</span>
                  <span className="badge badge-info">{Math.round(s.confidence * 100)}% confidence</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const sensorData = useSensorData();
  const system = useSystem();
  const aiSuggestions = useAISuggestions();
  const { connected } = useConnection();
  const { sendCommand } = useSensorStore();
  const [history, setHistory] = useState<Record<string, number[]>>({});

  // Store history for mini charts
  useEffect(() => {
    if (!sensorData) return;
    setHistory(prev => {
      const next = { ...prev };
      sensorConfig.forEach(cfg => {
        const key = cfg.key;
        const val = sensorData[key as keyof typeof sensorData] as number;
        if (typeof val === 'number') {
          next[key] = [...(next[key] || []), val].slice(-50);
        }
      });
      return next;
    });
  }, [sensorData]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Mission Control</h1>
          <p className="text-[var(--text-muted)] mt-1">Real-time sensor telemetry & system status</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-tertiary)]">
            <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
            <span className="text-sm font-medium">{connected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
      </div>

      {/* Sensor Grid */}
      <div className="grid grid-4 gap-4">
        {sensorConfig.map(config => (
          <SensorCard
            key={config.key}
            data={sensorData}
            config={config}
            history={history[config.key] || []}
          />
        ))}
      </div>

      {/* System Status & AI Alerts */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SystemStatusCard system={system} />
        </div>
        <div>
          <AIAlerts suggestions={aiSuggestions} />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
          Quick Actions
        </h3>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn btn-primary"
            disabled={!connected}
            onClick={() => sendCommand({ target: 'pump', action: 'ON', mode: 'MANUAL' }).catch(() => undefined)}
          >
            <Droplet className="w-4 h-4" />
            Irrigate Now
          </button>
          <button
            className="btn btn-secondary"
            disabled={!connected}
            onClick={() => sendCommand({ target: 'system', action: 'REBOOT', mode: 'MANUAL' }).catch(() => undefined)}
          >
            <Wifi className="w-4 h-4" />
            Reboot System
          </button>
          <button
            className="btn btn-secondary"
            disabled={!connected}
            onClick={() => sendCommand({ target: 'system', action: 'CALIBRATE', mode: 'MANUAL' }).catch(() => undefined)}
          >
            <Database className="w-4 h-4" />
            Calibrate Sensors
          </button>
          <button
            className="btn btn-danger"
            disabled={!connected}
            onClick={() => sendCommand({ target: 'pump', action: 'OFF', mode: 'MANUAL' }).catch(() => undefined)}
          >
            <AlertTriangle className="w-4 h-4" />
            Emergency Stop
          </button>
        </div>
      </div>
    </div>
  );
}