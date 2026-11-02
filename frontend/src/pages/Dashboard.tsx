import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowUpRight, Brain, CheckCircle2, Droplets, Gauge, Lightbulb, Thermometer, Waves, Wind } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { useAISuggestions, useConnection, useSensorData, useSensorStore, useSystem } from '@store/sensorStore';
import type { CommandResult, SensorData } from '@shared/types';
import { AnimatedNumber, RevealOnScroll } from '@components/Motion';
import { useLanguage } from '@contexts/LanguageContext';
import { hasControlAccessHint } from '@services/authToken';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';
import { isTelemetryStale, safeDate, validTimestamp } from '@services/telemetry';

type SensorKey = Exclude<keyof SensorData, 'lastUpdate'>;
type MetricConfig = { key: SensorKey; label: 'sensorAirTemp' | 'sensorSoilTemp' | 'sensorHumidity' | 'sensorMoisture' | 'sensorLight' | 'sensorPressure' | 'sensorVOC'; unit: string; icon: typeof Thermometer; color: string; min: number; max: number; digits: number };
const metrics: MetricConfig[] = [
  { key: 'AirTemp', label: 'sensorAirTemp', unit: '°C', icon: Thermometer, color: '#ff8b72', min: -10, max: 50, digits: 1 },
  { key: 'AirHumidity', label: 'sensorHumidity', unit: '%', icon: Wind, color: '#5bc9e7', min: 0, max: 100, digits: 1 },
  { key: 'SoilTemp', label: 'sensorSoilTemp', unit: '°C', icon: Thermometer, color: '#f6a75d', min: -10, max: 50, digits: 1 },
  { key: 'SoilMoisture', label: 'sensorMoisture', unit: '%', icon: Droplets, color: '#22d9ba', min: 0, max: 100, digits: 1 },
  { key: 'VOC', label: 'sensorVOC', unit: 'index', icon: Waves, color: '#c084fc', min: 0, max: 500, digits: 0 },
  { key: 'Light', label: 'sensorLight', unit: 'lux', icon: Lightbulb, color: '#e8c66a', min: 0, max: 2000, digits: 0 },
  { key: 'Barometricpressure', label: 'sensorPressure', unit: 'hPa', icon: Gauge, color: '#9c9bff', min: 900, max: 1100, digits: 1 },
];
type SessionHistory = Partial<Record<SensorKey, number[]>>;
type BackendMode = 'sdk' | 'mock' | 'unknown';

function commandCopy(result: CommandResult | undefined, t: ReturnType<typeof useLanguage>['t']): string {
  if (!result) return t('commandQueued');
  if (result.status === 'executed') return t('commandExecuted');
  if (result.status === 'failed') return result.message || t('commandFailed');
  if (result.status === 'timeout') return t('commandTimeout');
  return t('commandQueued');
}

export function Dashboard() {
  const sensorData = useSensorData();
  const system = useSystem();
  const { connected, connecting, error } = useConnection();
  const suggestions = useAISuggestions();
  const sendCommand = useSensorStore((state) => state.sendCommand);
  const commandResults = useSensorStore((state) => state.commandResults);
  const { language, t } = useLanguage();
  const [history, setHistory] = useState<SessionHistory>({});
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<BackendMode>('unknown');
  const lastRecorded = useRef<number | null>(null);
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';
  const canControl = hasControlAccessHint();
  const localMock = backendMode === 'mock';
  const verifiedSource = backendMode === 'sdk';
  const displaySensorData = verifiedSource ? sensorData : null;
  const displaySystem = verifiedSource ? system : null;
  const ageMs = displaySensorData ? Date.now() - (validTimestamp(displaySensorData.lastUpdate) ?? 0) : null;
  const live = verifiedSource && connected && displaySystem?.status === 'online' && !!displaySensorData && ageMs !== null && ageMs >= 0 && ageMs <= 120_000;
  const stale = !!displaySensorData && isTelemetryStale(displaySensorData.lastUpdate);
  const latestResult = activeCommandId ? Object.values(commandResults).find((result) => result.commandId === activeCommandId) ?? commandResults[activeCommandId] : undefined;
  const pendingSuggestions = verifiedSource ? Object.values(suggestions).filter((item) => item.status === 'pending' && (validTimestamp(item.expiresAt) ?? 0) > Date.now()) : [];
  const featuredSuggestion = pendingSuggestions[0];
  const heroImage = `${import.meta.env.BASE_URL}sensoura-greenhouse-hero.png`;

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
    setHistory((previous) => {
      const next = { ...previous };
      for (const metric of metrics) {
        const value = sensorData[metric.key];
        if (typeof value === 'number' && Number.isFinite(value)) next[metric.key] = [...(previous[metric.key] ?? []).slice(-29), value];
      }
      return next;
    });
  }, [verifiedSource, connected, sensorData]);

  useEffect(() => { lastRecorded.current = null; setHistory({}); setActiveCommandId(null); }, [system?.deviceId]);

  const chartData = useMemo(() => {
    const length = Math.max(history.AirTemp?.length ?? 0, history.AirHumidity?.length ?? 0, history.SoilMoisture?.length ?? 0);
    return Array.from({ length }, (_, index) => ({ sample: index + 1, air: history.AirTemp?.[index], humidity: history.AirHumidity?.[index], soil: history.SoilMoisture?.[index] }));
  }, [history]);

  const runPumpCommand = async (action: 'ON' | 'OFF') => {
    if (!connected || !canControl || runningAction) return;
    setRunningAction(action); setCommandError(null); setActiveCommandId(null);
    try { setActiveCommandId(await sendCommand({ target: 'pump', action, mode: 'MANUAL' })); }
    catch (cause) { setCommandError(cause instanceof Error ? cause.message : t('commandFailed')); }
    finally { setRunningAction(null); }
  };

  return (
    <div className="dashboard-page space-y-6">
      <section className="dashboard-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(3, 12, 22, .9), rgba(4, 17, 27, .38)), url("${heroImage}")` }} data-motion-item>
        <div className="dashboard-hero-glow" aria-hidden="true" />
        <div className="dashboard-hero-copy"><div className="eyebrow"><Activity size={14} /> SENSOURA · MISSION CONTROL</div><h1>{t('overviewTitle')}</h1><p>{t('overviewSubtitle')}</p>
          <div className="dashboard-hero-meta"><span className={`sensoura-status-chip ${live ? 'is-online' : connecting ? 'is-warning' : 'is-offline'}`}><span className={`status-dot ${live ? 'online' : connecting ? 'warning' : 'offline'}`} />{live ? t('live') : connecting ? t('connecting') : t('offline')}</span><span className="mono text-xs text-white/70">{displaySystem?.deviceId || t('unavailable')}</span></div>
        </div>
        <div className="dashboard-hero-reading" aria-label={t('sensorAirTemp')}><span className="dashboard-orbit dashboard-orbit-one" aria-hidden="true" /><span className="dashboard-orbit dashboard-orbit-two" aria-hidden="true" /><Thermometer className="dashboard-hero-icon" aria-hidden="true" /><div className="dashboard-hero-number"><AnimatedNumber value={displaySensorData?.AirTemp} digits={1} locale={locale} /><span>°C</span></div><p>{t('sensorAirTemp')}</p></div>
        <div className="dashboard-hero-foot"><span>{t('lastUpdate')}</span><span>{safeDate(displaySensorData?.lastUpdate) ? formatDistanceToNow(safeDate(displaySensorData?.lastUpdate)!, { addSuffix: true }) : t('unavailable')}</span></div>
      </section>

      {localMock && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? 'الخادم يعمل بقاعدة محلية ومحاكاة؛ أخفينا القراءات والاقتراحات كي لا تظهر كأنها صادرة عن جهاز حقيقي.' : 'The backend is in local/mock mode. Readings and suggestions are hidden so simulated values are not mistaken for a real device.'}</div>}
      {backendMode === 'unknown' && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? 'تعذر التحقق من مصدر البيانات؛ لن نعرض قراءات قبل تأكيد وضع الخادم.' : 'The data source could not be verified; readings stay hidden until backend mode is confirmed.'}</div>}
      {!displaySensorData && !localMock && backendMode === 'sdk' && <div className="empty-state-card" role="status" data-motion-item><div className="empty-state-icon"><Activity size={21} /></div><div><h2>{connecting ? t('connecting') : t('noTelemetry')}</h2><p>{error || t('connectHint')}</p></div></div>}
      {displaySensorData && stale && <p className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{t('stale')}</p>}
      {error && <p className="status-banner is-danger" role="alert" data-motion-item><AlertTriangle size={16} />{error}</p>}

      <section aria-labelledby="sensor-summary-title"><div className="section-heading" data-motion-item><div><p className="eyebrow">SENSOR ARRAY</p><h2 id="sensor-summary-title">{t('sensorSummary')}</h2></div><Link className="text-link" to="/sensors">{t('navSensors')} <ArrowUpRight size={15} /></Link></div>
        <div className="metric-grid">{metrics.map((metric, index) => <RevealOnScroll key={metric.key} delay={index * 0.025}><SensorCard config={metric} value={displaySensorData?.[metric.key]} points={history[metric.key] ?? []} locale={locale} label={t(metric.label)} /></RevealOnScroll>)}</div>
      </section>

      <div className="dashboard-overview-grid">
        <section className="panel-card" data-motion-item><div className="section-heading compact"><div><p className="eyebrow">REAL-TIME CHARTS</p><h2>{t('sessionTrend')}</h2></div><span className="badge badge-info">{language === 'ar' ? 'الجلسة الحالية' : 'THIS SESSION'}</span></div>
          {chartData.length > 1 ? <><div className="real-time-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" /><XAxis dataKey="sample" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} /><Tooltip contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)' }} /><Line type="monotone" dataKey="air" name={t('sensorAirTemp')} stroke="#5bc9e7" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} /><Line type="monotone" dataKey="humidity" name={t('sensorHumidity')} stroke="#22d9ba" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} /><Line type="monotone" dataKey="soil" name={t('sensorMoisture')} stroke="#f6a75d" strokeWidth={2.2} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div><div className="chart-legend"><span><i style={{ background: '#5bc9e7' }} />{t('sensorAirTemp')} (°C)</span><span><i style={{ background: '#22d9ba' }} />{t('sensorHumidity')} (%)</span><span><i style={{ background: '#f6a75d' }} />{t('sensorMoisture')} (%)</span></div></> : <div className="chart-empty">{t('noTrend')}</div>}
          <p className="microcopy mt-3">{language === 'ar' ? 'المخطط يجمع قراءات وصلت أثناء الجلسة الحالية فقط؛ لا يمثل سجلًا تاريخيًا دائمًا.' : 'This chart contains readings received in this session only; it is not a persistent historical archive.'}</p>
        </section>

        <section className="panel-card dashboard-ai-card" data-motion-item><div className="section-heading compact"><div><p className="eyebrow">AI DECISION SUPPORT</p><h2>{t('aiSuggestions')}</h2></div><span className="ai-card-icon"><Brain size={19} /></span></div>
          <p className="dashboard-ai-count"><AnimatedNumber value={verifiedSource && connected ? pendingSuggestions.length : null} digits={0} locale={locale} /><span>{t('pending')}</span></p>
          {featuredSuggestion ? <div className="dashboard-suggestion-preview"><strong>{featuredSuggestion.suggestion}</strong><p>{featuredSuggestion.reason}</p></div> : <p className="microcopy mt-3">{verifiedSource ? (connected ? t('suggestionEmpty') : t('disconnected')) : language === 'ar' ? 'تظهر الاقتراحات بعد التحقق من بيانات الجهاز الحقيقية.' : 'Suggestions appear after real device data is verified.'}</p>}
          <Link className="btn btn-secondary w-full justify-center mt-4" to="/ai-suggestions">{t('navAI')} <ArrowUpRight size={15} /></Link><p className="microcopy mt-3">{t('climateNote')}</p>
        </section>

        <section className="panel-card dashboard-system-card" data-motion-item><div className="section-heading compact"><div><p className="eyebrow">DEVICE STATUS</p><h2>{t('systemStatus')}</h2></div><span className={`health-orb ${displaySystem?.status === 'online' ? 'is-online' : displaySystem?.status === 'error' ? 'is-danger' : 'is-offline'}`}><CheckCircle2 size={27} /></span></div>
          <p className={`health-summary ${displaySystem?.status === 'online' ? 'is-online' : ''}`}>{displaySystem?.status ? t(displaySystem.status === 'online' ? 'connected' : displaySystem.status === 'offline' ? 'disconnected' : 'deviceError') : t('unknown')}</p>
          <div className="system-summary-grid"><StatusLine label={t('deviceId')} value={displaySystem?.deviceId || t('unavailable')} /><StatusLine label={t('pumpState')} value={displaySystem?.relay?.state ? `${displaySystem.relay.state} · ${displaySystem.relay.mode}` : t('unavailable')} /><StatusLine label={t('buzzer')} value={displaySystem?.buzzer ? (displaySystem.buzzer.muted ? t('mute') : t('unmute')) : t('unavailable')} /><StatusLine label={t('lastUpdate')} value={safeDate(displaySystem?.lastSeen) ? formatDistanceToNow(safeDate(displaySystem?.lastSeen)!, { addSuffix: true }) : t('unavailable')} /></div>
          <Link className="text-link mt-3" to="/health">{t('navHealth')} <ArrowUpRight size={15} /></Link>
        </section>
      </div>

      <div className="dashboard-lower-grid"><section className="panel-card" data-motion-item><div className="section-heading compact"><div><p className="eyebrow">DEVICE CONTROLS</p><h2>{t('quickActions')}</h2></div><Link className="text-link" to="/irrigation">{t('navIrrigation')} <ArrowUpRight size={15} /></Link></div>
        {!canControl && <p className="status-banner is-info" role="note">{t('readOnlyNote')}</p>}
        <div className="action-row"><button className="btn btn-primary" onClick={() => void runPumpCommand('ON')} disabled={!connected || !canControl || runningAction !== null}><Droplets size={16} />{runningAction === 'ON' ? t('connecting') : t('pumpOn')}</button><button className="btn btn-danger" onClick={() => void runPumpCommand('OFF')} disabled={!connected || !canControl || runningAction !== null}><Droplets size={16} />{runningAction === 'OFF' ? t('connecting') : t('pumpOff')}</button><Link className="btn btn-secondary" to="/commands">{t('navCommands')} <ArrowUpRight size={15} /></Link></div>
        {!connected && <p className="microcopy mt-3">{t('disconnected')}</p>}{commandError && <p className="status-banner is-danger mt-3" role="alert">{commandError}</p>}{activeCommandId && <div className={`command-feedback ${latestResult?.status === 'failed' || latestResult?.status === 'timeout' ? 'is-danger' : latestResult?.status === 'executed' ? 'is-success' : ''}`} role="status"><span className="mono text-xs">{activeCommandId}</span><span>{commandCopy(latestResult, t)}</span></div>}<p className="microcopy mt-3">{t('safetyNote')}</p>
      </section><section className="panel-card environmental-note" data-motion-item><div className="ai-card-icon"><Waves size={19} /></div><p className="eyebrow mt-3">ENVIRONMENTAL CONTEXT</p><h2>{t('navClimate')}</h2><p className="microcopy mt-2">{t('climateNote')}</p><Link className="text-link mt-4" to="/climate">{t('navClimate')} <ArrowUpRight size={15} /></Link></section></div>
    </div>
  );
}

function SensorCard({ config, value, points, locale, label }: { config: MetricConfig; value: number | undefined; points: number[]; locale: string; label: string }) {
  const Icon = config.icon;
  const percentage = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, ((value - config.min) / (config.max - config.min)) * 100)) : 0;
  const chartData = points.map((reading, index) => ({ index, reading }));
  return <article className="metric-card"><div className="metric-card-top"><div className="metric-label"><span className="metric-icon" style={{ color: config.color, backgroundColor: `${config.color}18` }}><Icon size={17} /></span><span>{label}</span></div><span className="metric-ring" style={{ '--ring-value': `${percentage}%`, '--ring-color': config.color } as CSSProperties} aria-hidden="true" /></div>
    <div className="metric-reading"><AnimatedNumber value={value} digits={config.digits} locale={locale} /><span>{config.unit}</span></div>
    <div className="metric-chart">{points.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id={`fill-${config.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={config.color} stopOpacity={0.3} /><stop offset="100%" stopColor={config.color} stopOpacity={0.02} /></linearGradient></defs><Area type="monotone" dataKey="reading" stroke={config.color} fill={`url(#fill-${config.key})`} strokeWidth={2} isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <p className="metric-chart-empty">—</p>}</div>
    <p className="metric-footnote">{points.length > 1 ? `${points.length} ${locale === 'ar-EG' ? 'قراءة جلسة' : 'session samples'}` : '—'}</p>
  </article>;
}

function StatusLine({ label, value }: { label: string; value: string }) { return <div className="system-summary-line"><span>{label}</span><strong>{value}</strong></div>; }
