import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Clock3, Database, RefreshCw, Server, ShieldCheck, Wifi } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { endpoints } from '@services/api';
import { getBackendHealth } from '@services/backendHealth';
import { useConnection, useSystem } from '@store/sensorStore';
import { useLanguage } from '@contexts/LanguageContext';
import { isTelemetryStale, safeDate } from '@services/telemetry';

type HealthInfo = { status?: string; mission?: string; phase?: string; team?: string; timestamp?: number; uptime?: number; firebase?: string; aiBackend?: string };
type ReadinessInfo = { ready?: boolean; services?: { realtime?: boolean; ai?: boolean; socket?: boolean } };
type ModelInfo = { backend?: string; models?: Record<string, boolean>; metadata?: { version?: string; trainedAt?: number; samplesCount?: number; accuracy?: number; backend?: string } | null };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Request failed';
}

export function SystemHealth() {
  const { language, t } = useLanguage();
  const { connected, connecting, error: socketError } = useConnection();
  const system = useSystem();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [readiness, setReadiness] = useState<ReadinessInfo | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  const refresh = useCallback(async () => {
    setLoading(true);
    const [healthResult, readyResult, modelResult] = await Promise.allSettled([
      getBackendHealth(true), endpoints.ready(), endpoints.getModelInfo(),
    ]);

    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value as HealthInfo);
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(errorMessage(healthResult.reason));
    }

    if (readyResult.status === 'fulfilled') {
      setReadiness(readyResult.value.data as ReadinessInfo);
      setReadinessError(null);
    } else {
      const responseData = (readyResult.reason as { response?: { data?: ReadinessInfo } })?.response?.data;
      if (responseData && typeof responseData === 'object') {
        setReadiness(responseData);
        setReadinessError(null);
      } else {
        setReadiness(null);
        setReadinessError(errorMessage(readyResult.reason));
      }
    }

    if (modelResult.status === 'fulfilled') {
      setModel(modelResult.value.data as ModelInfo);
      setModelError(null);
    } else {
      setModel(null);
      setModelError(errorMessage(modelResult.reason));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const uptime = typeof health?.uptime === 'number' && Number.isFinite(health.uptime)
    ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m ${Math.floor(health.uptime % 60)}s`
    : t('unavailable');
  const verifiedDeviceTelemetry = health?.firebase === 'sdk';
  const telemetryDate = safeDate(system?.lastSeen);
  const telemetryStale = verifiedDeviceTelemetry && system ? isTelemetryStale(system.lastSeen) : true;

  return (
    <div className="space-y-7">
      <header className="page-heading" data-motion-item>
        <div><p className="eyebrow">OBSERVABILITY</p><h1>{t('healthTitle')}</h1><p>{t('healthSubtitle')}</p></div>
        <button className="btn btn-secondary btn-sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{t('refresh')}</button>
      </header>

      <div className="health-summary-grid">
        <HealthCard icon={Server} title={t('backendHealth')} status={health?.status === 'ok' ? 'success' : healthError ? 'danger' : 'unknown'} value={health?.status === 'ok' ? t('connected') : healthError ? t('healthUnavailable') : t('loading')} detail={health?.timestamp ? formatDistanceToNow(new Date(health.timestamp), { addSuffix: true }) : healthError ?? ''} />
        <HealthCard icon={ShieldCheck} title={t('readiness')} status={readiness?.ready === true ? 'success' : readiness?.ready === false ? 'warning' : 'unknown'} value={readiness?.ready === true ? t('ready') : readiness?.ready === false ? t('notReady') : readinessError ? t('readinessUnavailable') : t('loading')} detail={readinessError ?? ''} />
        <HealthCard icon={Wifi} title={t('socketStatus')} status={connected ? 'success' : connecting ? 'warning' : 'danger'} value={connected ? t('connected') : connecting ? t('connecting') : t('disconnected')} detail={socketError ?? ''} />
        <HealthCard icon={Clock3} title={t('deviceTelemetry')} status={!verifiedDeviceTelemetry || !system ? 'unknown' : system.status === 'error' ? 'danger' : system.status === 'offline' || telemetryStale ? 'warning' : 'success'} value={!verifiedDeviceTelemetry ? (language === 'ar' ? 'غير متحقق' : 'Unverified') : !system ? t('unavailable') : system.status === 'online' && !telemetryStale ? t('live') : system.status === 'error' ? t('deviceError') : t('stale')} detail={!verifiedDeviceTelemetry ? (language === 'ar' ? 'مصدر الجهاز غير موثق في هذا الوضع' : 'Device source is not verified in this backend mode') : `${system?.deviceId ?? t('unavailable')} · ${telemetryDate ? formatDistanceToNow(telemetryDate, { addSuffix: true }) : t('unavailable')}`} />
      </div>

      {healthError && <div className="status-banner is-danger" role="alert"><AlertTriangle size={16} />{t('healthUnavailable')} <span className="microcopy">{healthError}</span></div>}
      {readinessError && !readiness && <div className="status-banner is-warning" role="status"><AlertTriangle size={16} />{t('readinessUnavailable')} <span className="microcopy">{readinessError}</span></div>}

      <div className="health-detail-grid">
        <section className="panel-card" data-motion-item>
          <div className="section-heading compact"><div><p className="eyebrow">BACKEND</p><h2>{t('backendHealth')}</h2></div><Server size={19} className="text-[var(--accent-primary)]" /></div>
          <div className="system-state-grid">
            <HealthValue label={t('uptime')} value={uptime} />
            <HealthValue label={t('firebaseMode')} value={health?.firebase?.toUpperCase() ?? t('unavailable')} />
            <HealthValue label={t('aiRuntime')} value={(model?.backend ?? health?.aiBackend)?.toUpperCase() ?? t('unavailable')} />
            <HealthValue label={t('deviceId')} value={verifiedDeviceTelemetry ? system?.deviceId ?? t('unavailable') : t('unavailable')} />
          </div>
          {health?.firebase === 'mock' && <p className="status-banner is-warning mt-4" role="status"><Database size={15} />{language === 'ar' ? 'الخادم يستخدم قاعدة محلية تجريبية؛ لا يعني ذلك أن الجهاز متصل.' : 'The backend is using its local mock database; this does not mean the device is connected.'}</p>}
        </section>

        <section className="panel-card" data-motion-item>
          <div className="section-heading compact"><div><p className="eyebrow">AI RUNTIME</p><h2>{t('modelInfo')}</h2></div><Brain size={19} className="text-[var(--accent-primary)]" /></div>
          {modelError ? <p className="status-banner is-warning" role="status"><AlertTriangle size={15} />{modelError}</p> : <div className="system-state-grid">
            <HealthValue label={language === 'ar' ? 'إصدار النموذج' : 'Model version'} value={model?.metadata?.version ?? t('unavailable')} />
            <HealthValue label={language === 'ar' ? 'آخر تدريب' : 'Last training'} value={safeDate(model?.metadata?.trainedAt)?.toLocaleString(locale) ?? t('unavailable')} />
            <HealthValue label={language === 'ar' ? 'عدد العينات' : 'Samples'} value={typeof model?.metadata?.samplesCount === 'number' ? String(model.metadata.samplesCount) : t('unavailable')} />
            <HealthValue label={language === 'ar' ? 'الدقة المسجلة' : 'Reported accuracy'} value={typeof model?.metadata?.accuracy === 'number' && Number.isFinite(model.metadata.accuracy) ? `${(model.metadata.accuracy * 100).toFixed(1)}%` : t('unavailable')} />
          </div>}
          {readiness?.services && <div className="readiness-services">{(['realtime', 'ai', 'socket'] as const).map((service) => <div className="readiness-service" key={service}><span>{service}</span><span className={`badge ${readiness.services?.[service] ? 'badge-success' : 'badge-danger'}`}>{readiness.services?.[service] ? t('ready') : t('notReady')}</span></div>)}</div>}
          {model?.models && <div className="model-pill-row">{Object.entries(model.models).map(([name, trained]) => <span className={`badge ${trained ? 'badge-success' : 'badge-neutral'}`} key={name}>{name}: {trained ? 'TRAINED' : 'FALLBACK'}</span>)}</div>}
        </section>
      </div>
    </div>
  );
}

function HealthCard({ icon: Icon, title, value, detail, status }: { icon: typeof Server; title: string; value: string; detail: string; status: 'success' | 'warning' | 'danger' | 'unknown' }) {
  return <article className={`health-card is-${status}`}><div className="health-card-top"><span className="health-card-icon"><Icon size={18} /></span><CheckCircle2 size={16} className="health-card-check" /></div><p className="health-card-title">{title}</p><strong>{value}</strong>{detail && <span className="health-card-detail">{detail}</span>}</article>;
}

function HealthValue({ label, value }: { label: string; value: string }) {
  return <div className="system-state-card"><span>{label}</span><strong>{value}</strong></div>;
}
