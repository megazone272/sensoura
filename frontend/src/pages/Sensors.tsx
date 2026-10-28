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
import { useState, useEffect } from 'react';

function SensorCard({
  label,
  value,
  unit,
  icon: Icon,
  lastUpdate,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  icon: React.ComponentType<any>;
  lastUpdate?: number;
}) {
  const formatted =
    value != null && !isNaN(Number(value))
      ? Number(value).toLocaleString(undefined, {
          minimumFractionDigits: unit === 'hPa' ? 1 : 1,
          maximumFractionDigits: unit === 'hPa' ? 1 : 1,
        })
      : '—';

  const lastText = lastUpdate ? formatDistanceToNow(lastUpdate, { addSuffix: true }) : null;

  return (
    <div className="relative overflow-hidden rounded-xl bg-[var(--bg-card)] border border-[var(--border-primary)] p-4 hover:border-[var(--border-secondary)] transition-all duration-200">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-primary)]/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-[var(--accent-primary)]" />
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
          </div>
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{formatted}</span>
        {unit && <span className="text-sm text-[var(--text-muted)]">{unit}</span>}
      </div>
      {lastText && (
        <p className="text-xs text-[var(--text-muted)] mt-2">Updated {lastText}</p>
      )}
    </div>
  );
}

export function Sensors() {
  const sensorData = useSensorData();
  const system = useSystem();
  const { connected } = useConnection();
  useAISuggestions();
  const { sendCommand } = useSensorStore();
  const [, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    if (!sensorData) return;
    setHistory((prev) => {
      const next = { ...prev };
      Object.entries(sensorData).forEach(([key, value]) => {
        if (typeof value === 'number') {
          next[key] = next[key] || [];
          next[key].push(value);
          if (next[key].length > 50) next[key].shift();
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
          <h1 className="text-3xl font-bold tracking-tight">Sensor Readings</h1>
          <p className="text-[var(--text-muted)] mt-1">
            Live telemetry from {system?.deviceId ?? 'the deployed device'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
            <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
            <span className="text-sm font-medium">{connected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => sendCommand({ target: 'system', action: 'REBOOT', mode: 'MANUAL' })}
          >
            <Wifi className="w-4 h-4" />
            Reboot
          </button>
        </div>
      </div>

      {/* Environment */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-[var(--accent-primary)]" />
          Environment
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <SensorCard
            label="Air Temperature"
            value={sensorData?.AirTemp}
            unit="°C"
            icon={Thermometer}
            lastUpdate={sensorData?.lastUpdate}
          />
          <SensorCard
            label="Soil Temperature"
            value={sensorData?.SoilTemp}
            unit="°C"
            icon={Thermometer}
            lastUpdate={sensorData?.lastUpdate}
          />
          <SensorCard
            label="Humidity"
            value={sensorData?.AirHumidity}
            unit="%"
            icon={Droplets}
            lastUpdate={sensorData?.lastUpdate}
          />
          <SensorCard
            label="Light"
            value={sensorData?.Light}
            unit="lux"
            icon={Sun}
            lastUpdate={sensorData?.lastUpdate}
          />
          <SensorCard
            label="Air Pressure"
            value={sensorData?.Barometricpressure}
            unit="hPa"
            icon={Gauge}
            lastUpdate={sensorData?.lastUpdate}
          />
        </div>
      </section>

      {/* Soil & Air Quality */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Droplet className="w-5 h-5 text-[var(--accent-primary)]" />
          Soil & Air Quality
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <SensorCard
            label="Soil Moisture"
            value={sensorData?.SoilMoisture}
            unit="%"
            icon={Droplet}
            lastUpdate={sensorData?.lastUpdate}
          />
          <SensorCard
            label="Gas (VOC)"
            value={sensorData?.VOC}
            unit="VOC Index"
            icon={Flame}
            lastUpdate={sensorData?.lastUpdate}
          />
        </div>
      </section>

      {/* Alerts & System */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[var(--accent-warning)]" />
            Alerts & System Status
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[var(--accent-warning)]/10 border border-[var(--accent-warning)]/30 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[var(--accent-warning)] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">Sensor Alert</p>
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    {system?.status === 'offline'
                      ? 'Device is offline — check power and connectivity.'
                      : system?.status === 'error'
                      ? 'Device reported an error — check sensor wiring and firmware logs.'
                      : 'All sensors reporting within normal ranges.'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    Last seen: {system?.lastSeen ? formatDistanceToNow(system.lastSeen, { addSuffix: true }) : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-primary)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">System Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Device ID</span>
                  <span className="font-mono text-[var(--text-primary)]">{system?.deviceId ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Status</span>
                  <span className="font-medium capitalize text-[var(--text-primary)]">{system?.status ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Pump/Relay</span>
                  <span className="font-mono text-[var(--text-primary)]">
                    {system?.relay?.state ?? 'OFF'} • {system?.relay?.mode ?? 'AUTO'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Buzzer</span>
                  <span className="text-[var(--text-primary)]">{system?.buzzer?.muted ? 'Muted' : 'Active'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-[var(--accent-primary)]" />
            Quick Actions
          </h2>
          <div className="space-y-2">
            <button
              className="btn btn-primary w-full justify-center"
              onClick={() => sendCommand({ target: 'pump', action: 'ON', mode: 'MANUAL' })}
            >
              <Droplets className="w-4 h-4" />
              Irrigate Now
            </button>
            <button
              className="btn btn-secondary w-full justify-center"
              onClick={() => sendCommand({ target: 'pump', action: 'OFF', mode: 'MANUAL' })}
            >
              <AlertTriangle className="w-4 h-4" />
              Emergency Stop
            </button>
            <button
              className="btn btn-secondary w-full justify-center"
              onClick={() => sendCommand({ target: 'buzzer', action: 'MUTE', mode: 'MANUAL' })}
            >
              <Zap className="w-4 h-4" />
              Mute Buzzer
            </button>
            <button
              className="btn btn-secondary w-full justify-center"
              onClick={() => sendCommand({ target: 'system', action: 'CALIBRATE', mode: 'MANUAL' })}
            >
              <Database className="w-4 h-4" />
              Calibrate Sensors
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
