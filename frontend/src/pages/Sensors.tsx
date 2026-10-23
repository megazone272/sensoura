import { useState } from 'react';
import {
  Activity,
  Droplets,
  Thermometer,
  Flame,
  Sun,
  Gauge,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { useSensorData, useSystem, useConnection } from '@store/sensorStore';

const sensorConfig = [
  { key: 'AirTemp', label: 'Air Temp', unit: '°C', icon: Thermometer, color: '#ef4444' },
  { key: 'SoilTemp', label: 'Soil Temp', unit: '°C', icon: Thermometer, color: '#f97316' },
  { key: 'AirHumidity', label: 'Humidity', unit: '%', icon: Droplets, color: '#06b6d4' },
  { key: 'SoilMoisture', label: 'Soil Moisture', unit: '%', icon: Droplets, color: '#22c55e' },
  { key: 'VOC', label: 'Gas (MQ135)', unit: 'ppm', icon: Flame, color: '#fbbf24' },
  { key: 'Light', label: 'Light', unit: 'lux', icon: Sun, color: '#fde047' },
  { key: 'Barometricpressure', label: 'Air Pressure', unit: 'hPa', icon: Gauge, color: '#a855f7' },
] as const;

export function Sensors() {
  const sensorData = useSensorData();
  const system = useSystem();
  const { connected } = useConnection();
  const [selectedSensor, setSelectedSensor] = useState<string>(sensorConfig[0].key);

  // Mock historical data generation for the chart
  const generateHistory = (current: number) => {
    if (!current) return [];
    const points = 50;
    const data = [];
    for (let i = points - 1; i >= 0; i--) {
      const noise = (Math.random() - 0.5) * (current * 0.05);
      data.push({
        time: format(new Date(Date.now() - i * 300000), 'HH:mm'),
        value: Math.max(0, current + noise + (i * current * 0.002)),
      });
    }
    return data;
  };

  const currentValue = sensorData?.[selectedSensor as keyof typeof sensorData] as number;
  const chartData = generateHistory(currentValue);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sensors Monitor</h1>
          <p className="text-[var(--text-muted)] mt-1">
            {system?.deviceId} • {connected ? 'LIVE' : 'OFFLINE'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
          <span className="font-medium">
            {sensorData?.lastUpdate
              ? `Updated ${format(new Date(sensorData.lastUpdate), 'HH:mm:ss')}`
              : 'No data'}
          </span>
        </div>
      </div>

      {/* Sensor Tabs */}
      <div className="flex flex-wrap gap-2">
        {sensorConfig.map(sensor => {
          const Icon = sensor.icon;
          const value = sensorData?.[sensor.key as keyof typeof sensorData] as number;
          return (
            <button
              key={sensor.key}
              className={`btn btn-sm ${selectedSensor === sensor.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedSensor(sensor.key)}
            >
              <Icon className="w-4 h-4" style={{ color: selectedSensor === sensor.key ? 'inherit' : sensor.color }} />
              {sensor.label}
              {value !== undefined && (
                <span className="font-mono ml-2 opacity-70">
                  {typeof value === 'number' ? value.toFixed(1) : value}
                  {sensor.unit}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Sensor Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            {sensorConfig.find(s => s.key === selectedSensor)?.label} History
          </h3>
          <span className="text-sm text-[var(--text-muted)]">Last 4 hours</span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <defs>
                <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={sensorConfig.find(s => s.key === selectedSensor)?.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={sensorConfig.find(s => s.key === selectedSensor)?.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
              <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={sensorConfig.find(s => s.key === selectedSensor)?.color}
                strokeWidth={2}
                dot={false}
                fill="url(#lineGradient)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* All Sensor Cards */}
      <div className="grid grid-2 md:grid-cols-4 gap-4">
        {sensorConfig.map(sensor => {
          const Icon = sensor.icon;
          const value = sensorData?.[sensor.key as keyof typeof sensorData] as number;
          return (
            <div
              key={sensor.key}
              className={`card glass-hover cursor-pointer ${selectedSensor === sensor.key ? 'border-[var(--accent-primary)]' : ''}`}
              onClick={() => setSelectedSensor(sensor.key)}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                  <Icon className="w-5 h-5" style={{ color: sensor.color }} />
                </div>
                <div>
                  <p className="text-sm text-[var(--text-muted)]">{sensor.label}</p>
                  <p className="text-2xl font-bold font-mono" style={{ color: sensor.color }}>
                    {typeof value === 'number' ? value.toFixed(sensor.key === 'Barometricpressure' ? 2 : 1) : '--'}
                  </p>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)]">Unit: {sensor.unit}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
