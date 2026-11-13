import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Cloud, Droplets, Gauge, Lightbulb, Thermometer, Waves, Wind } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import { useConnection, useSensorData, useSystem } from '@store/sensorStore';
import type { SensorData } from '@shared/types';
import { AnimatedNumber } from '@components/Motion';
import { useLanguage } from '@contexts/LanguageContext';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';
import { isTelemetryStale, safeDate, validTimestamp } from '@services/telemetry';

type SensorKey = Exclude<keyof SensorData, 'lastUpdate'>;
type ReadingConfig = { key: SensorKey; label: 'sensorAirTemp' | 'sensorSoilTemp' | 'sensorHumidity' | 'sensorMoisture' | 'sensorLight' | 'sensorPressure' | 'sensorVOC'; unit: string; icon: typeof Thermometer; color: string; digits: number };
const readings: ReadingConfig[] = [
  { key: 'AirTemp', label: 'sensorAirTemp', unit: '°C', icon: Thermometer, color: '#ff8b72', digits: 1 },
  { key: 'SoilTemp', label: 'sensorSoilTemp', unit: '°C', icon: Thermometer, color: '#f6a75d', digits: 1 },
  { key: 'AirHumidity', label: 'sensorHumidity', unit: '%', icon: Wind, color: '#5bc9e7', digits: 1 },
  { key: 'SoilMoisture', label: 'sensorMoisture', unit: '%', icon: Droplets, color: '#22d9ba', digits: 1 },
  { key: 'Light', label: 'sensorLight', unit: 'lux', icon: Lightbulb, color: '#e8c66a', digits: 0 },
  { key: 'Barometricpressure', label: 'sensorPressure', unit: 'hPa', icon: Gauge, color: '#9c9bff', digits: 1 },
  { key: 'VOC', label: 'sensorVOC', unit: 'index', icon: Waves, color: '#c084fc', digits: 0 },
];
type SessionSeries = Partial<Record<SensorKey, number[]>>;
type BackendMode = 'sdk' | 'mock' | 'unknown';

export function Sensors() {
  const sensorData = useSensorData();
  const system = useSystem();
  const { connected, connecting, error } = useConnection();
  const { language, t } = useLanguage();
  const [series, setSeries] = useState<SessionSeries>({});
  const [backendMode, setBackendMode] = useState<BackendMode>('unknown');
  const lastRecorded = useRef<number | null>(null);
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';
  const verifiedSource = backendMode === 'sdk';
  const displaySensorData = verifiedSource ? sensorData : null;
  const displaySystem = verifiedSource ? system : null;
  const stale = displaySensorData ? isTelemetryStale(displaySensorData.lastUpdate) : false;
  const telemetryTime = safeDate(displaySensorData?.lastUpdate);
  const lastSeen = safeDate(displaySystem?.lastSeen);

  useEffect(() => {
    let active = true;
    void getBackendHealth().then((health) => {
      if (!active) return;
      setBackendMode(getBackendMode(health));
    }).catch(() => { if (active) setBackendMode('unknown'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!verifiedSource || !connected || !sensorData) return;
    const timestamp = validTimestamp(sensorData.lastUpdate);
    if (!timestamp || timestamp === lastRecorded.current) return;
    lastRecorded.current = timestamp;
    setSeries((current) => {
      const next = { ...current };
      for (const item of readings) {
        const value = sensorData[item.key];
        if (typeof value === 'number' && Number.isFinite(value)) next[item.key] = [...(current[item.key] ?? []).slice(-23), value];
      }
      return next;
    });
  }, [verifiedSource, connected, sensorData]);

  useEffect(() => { lastRecorded.current = null; setSeries({}); }, [system?.deviceId]);

  return <div className="space-y-7">
    <header className="page-heading" data-motion-item><div><p className="eyebrow">TELEMETRY</p><h1>{t('navSensors')}</h1><p>{t('overviewSubtitle')}</p></div><span className={`sensoura-status-chip ${connected && verifiedSource && !stale ? 'is-online' : connecting ? 'is-warning' : 'is-offline'}`}><span className={`status-dot ${connected && verifiedSource && !stale ? 'online' : connecting ? 'warning' : 'offline'}`} />{connected && verifiedSource && !stale ? t('live') : connecting ? t('connecting') : t('offline')}</span></header>

    {backendMode === 'mock' && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? 'الخادم المحلي يولّد بيانات محاكاة؛ أخفيناها بدل عرضها كقراءات ESP32.' : 'The local backend produces mock readings; they are hidden rather than presented as ESP32 telemetry.'}</div>}
    {backendMode === 'unknown' && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? 'تعذر التحقق من مصدر البيانات؛ القراءات مخفية.' : 'Could not verify the telemetry source; readings are hidden.'}</div>}
    {error && <div className="status-banner is-danger" role="alert" data-motion-item><AlertTriangle size={16} />{error}</div>}
    {!displaySensorData && backendMode === 'sdk' && <div className="empty-state-card" role="status" data-motion-item><div className="empty-state-icon"><Cloud size={20} /></div><div><h2>{t('noSensorData')}</h2><p>{connecting ? t('connecting') : t('connectHint')}</p></div></div>}
    {displaySensorData && stale && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{t('stale')} · {telemetryTime ? formatDistanceToNow(telemetryTime, { addSuffix: true }) : t('unavailable')}</div>}

    <section data-motion-item><div className="section-heading"><div><p className="eyebrow">ENVIRONMENT</p><h2>{t('sensorSummary')}</h2></div><div className="telemetry-update">{t('lastUpdate')}: {telemetryTime ? formatDistanceToNow(telemetryTime, { addSuffix: true }) : t('unavailable')}</div></div>
      <div className="sensor-reading-grid">{readings.map(({ key, label, unit, icon: Icon, color, digits }) => <article className="sensor-reading-card" key={key}><div className="sensor-reading-heading"><span className="metric-icon" style={{ color, backgroundColor: `${color}18` }}><Icon size={18} /></span><span>{t(label)}</span></div>
        <div className="sensor-reading-value"><AnimatedNumber value={displaySensorData?.[key]} digits={digits} locale={locale} /><span>{unit}</span></div>
        <div className="sensor-sparkline">{(series[key]?.length ?? 0) > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={series[key]!.map((value, index) => ({ index, value }))}><Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.11} strokeWidth={2} isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <span>{displaySensorData ? t('noTrend') : t('unavailable')}</span>}</div>
        <p className="metric-footnote">{(series[key]?.length ?? 0) > 1 ? t('sessionTrend') : t('unavailable')}</p>
      </article>)}</div>
    </section>

    <section className="system-panel" data-motion-item><div className="section-heading"><div><p className="eyebrow">DEVICE STATE</p><h2>{t('systemStatus')}</h2></div><Link className="text-link" to="/irrigation">{t('navIrrigation')} <Activity size={15} /></Link></div>
      <div className="system-state-grid"><StateCard label={t('deviceId')} value={displaySystem?.deviceId || t('unavailable')} mono /><StateCard label={t('systemStatus')} value={displaySystem?.status ? t(displaySystem.status === 'online' ? 'connected' : displaySystem.status === 'offline' ? 'disconnected' : 'deviceError') : t('unknown')} /><StateCard label={t('pumpState')} value={displaySystem?.relay ? `${displaySystem.relay.state} · ${displaySystem.relay.mode}` : t('unavailable')} /><StateCard label={t('buzzer')} value={displaySystem?.buzzer ? (displaySystem.buzzer.muted ? t('mute') : t('unmute')) : t('unavailable')} /><StateCard label={t('ledStatus')} value={displaySystem?.leds ? `Green ${displaySystem.leds.green ? 'ON' : 'OFF'} · Red ${displaySystem.leds.red ? 'ON' : 'OFF'}` : t('unavailable')} /><StateCard label={t('lastUpdate')} value={lastSeen ? formatDistanceToNow(lastSeen, { addSuffix: true }) : t('unavailable')} /></div>
    </section>
  </div>;
}

function StateCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="system-state-card"><span>{label}</span><strong className={mono ? 'mono' : ''}>{value}</strong></div>; }
