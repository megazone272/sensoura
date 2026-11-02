import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Clock, Droplets, Loader2, Sparkles, TrendingUp, Wind, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useAISuggestions, useConnection, useSensorStore } from '@store/sensorStore';
import type { AISuggestion, PredictionData } from '@shared/types';
import { endpoints } from '@services/api';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';
import { hasControlAccessHint } from '@services/authToken';
import { useLanguage } from '@contexts/LanguageContext';
import { safeDate, validTimestamp } from '@services/telemetry';

const typeIcons = { irrigation: Droplets, environment: Wind, anomaly: AlertTriangle, maintenance: AlertTriangle, optimization: TrendingUp, harvest: Sparkles } as const;
const typeColors = { irrigation: '#22d9ba', environment: '#e8c66a', anomaly: '#ff7070', maintenance: '#f6a75d', optimization: '#5bc9e7', harvest: '#c084fc' } as const;
const supportedTargets = new Set(['pump', 'buzzer', 'led', 'system']);
const supportedActions = new Set(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']);
type BackendMode = 'sdk' | 'mock' | 'unknown';

function isSupportedAction(suggestion: AISuggestion): boolean {
  const action = suggestion.recommendedAction;
  return supportedTargets.has(action.target) && supportedActions.has(action.action) && (action.mode === 'MANUAL' || action.mode === 'AUTO');
}

export function AISuggestions() {
  const storeSuggestions = useAISuggestions();
  const { connected } = useConnection();
  const { language, t } = useLanguage();
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'executed' | 'rejected' | 'expired'>('all');
  const [now, setNow] = useState(Date.now());
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<BackendMode>('unknown');

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setPredictionLoading(true); setPredictionError(null);
    void (async () => {
      try {
        const health = await getBackendHealth();
        const resolvedMode: BackendMode = getBackendMode(health);
        if (active) setBackendMode(resolvedMode);
        if (resolvedMode !== 'sdk') { if (active) setPrediction(null); return; }
        const response = await endpoints.getPredictions();
        if (active) setPrediction(response.data as PredictionData);
      } catch (cause) {
        if (active) { setPrediction(null); setBackendMode('unknown'); setPredictionError(cause instanceof Error ? cause.message : t('suggestionError')); }
      } finally { if (active) setPredictionLoading(false); }
    })();
    return () => { active = false; };
  }, [connected, t]);

  const verifiedSource = backendMode === 'sdk';
  const localMock = backendMode === 'mock';
  const canReview = hasControlAccessHint();
  const entries = useMemo(
    () => verifiedSource ? Object.entries(storeSuggestions) as Array<[string, AISuggestion]> : [],
    [storeSuggestions, verifiedSource],
  );
  const filtered = useMemo(() => entries.filter(([, suggestion]) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return suggestion.status === 'pending' && validTimestamp(suggestion.expiresAt) !== null && suggestion.expiresAt > now;
    return suggestion.status === filter;
  }).sort((a, b) => (validTimestamp(b[1].createdAt) ?? 0) - (validTimestamp(a[1].createdAt) ?? 0)), [entries, filter, now]);
  const pendingCount = entries.filter(([, suggestion]) => suggestion.status === 'pending' && validTimestamp(suggestion.expiresAt) !== null && suggestion.expiresAt > now).length;
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  return <div className="space-y-7">
    <header className="page-heading" data-motion-item><div><p className="eyebrow">AI DECISION SUPPORT</p><h1>{t('navAI')}</h1><p>{t('overviewSubtitle')}</p></div><span title={t('socketStatus')} aria-label={`${t('socketStatus')}: ${connected ? t('connected') : t('disconnected')}`} className={`sensoura-status-chip ${connected ? 'is-online' : 'is-offline'}`}><span className={`status-dot ${connected ? 'online' : 'offline'}`} />{connected ? t('connected') : t('offline')}</span></header>
    {localMock && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? 'تم إخفاء الاقتراحات والتنبؤات لأن backend يعمل ببيانات محاكاة؛ لا توجد تنبؤات حقيقية للعرض.' : 'Predictions and suggestions are hidden because the backend is using mock data; there is no real forecast to display.'}</div>}
    {backendMode === 'unknown' && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? 'تعذر التحقق من مصدر النموذج؛ لن نعرض تقديرات حتى يتأكد مصدر البيانات.' : 'Could not verify model input source; estimates stay hidden until the backend is verified.'}</div>}
    {verifiedSource && !canReview && <div className="status-banner is-info" role="note" data-motion-item>{t('readOnlyNote')}</div>}

    <section className="panel-card" data-motion-item><div className="section-heading compact"><div><p className="eyebrow">MODEL OUTPUT</p><h2>{t('aiEstimateTitle')}</h2></div><Brain size={19} className="text-[var(--accent-primary)]" /></div><p className="microcopy mb-4">{t('aiEstimateNote')}</p>
      {predictionLoading && <p className="status-banner is-info" role="status">{t('loading')}</p>}
      {predictionError && <p className="status-banner is-warning" role="status"><AlertTriangle size={15} />{t('suggestionError')} <span className="microcopy">{predictionError}</span></p>}
      {!predictionLoading && !predictionError && !prediction && <p className="empty-inline">{localMock ? (language === 'ar' ? 'التقديرات ستظهر عندما يستخدم الخادم قراءات فعلية.' : 'Estimates will appear when the backend receives real readings.') : t('predictionUnavailable')}</p>}
      {prediction && verifiedSource && <div className="prediction-grid"><PredictionCard label={t('predictionSoil')} value={prediction.soilMoisture6h} unit="%" locale={locale} /><PredictionCard label={t('predictionGas')} value={prediction.gas3h} unit="VOC" locale={locale} /><PredictionCard label={t('predictionTemperature')} value={prediction.temperature12h} unit="°C" locale={locale} /></div>}
      {prediction?.timestamp && verifiedSource && <p className="microcopy mt-3">{language === 'ar' ? 'وقت إنشاء التقديرات:' : 'Estimate timestamp:'} {safeDate(prediction.timestamp)?.toLocaleString(locale) ?? t('unavailable')}</p>}
    </section>

    <section className="panel-card" data-motion-item><div className="section-heading compact"><div><p className="eyebrow">RECOMMENDATIONS</p><h2>{t('aiSuggestions')}</h2><p className="microcopy mt-1">{pendingCount} {t('pending')} · {entries.length} {language === 'ar' ? 'الإجمالي' : 'total'}</p></div></div>
      <div className="filter-row" role="tablist" aria-label={t('aiSuggestions')}>{(['all', 'pending', 'approved', 'executed', 'rejected', 'expired'] as const).map((tab) => <button key={tab} role="tab" aria-selected={filter === tab} className={`btn btn-sm ${filter === tab ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(tab)}>{t(tab)}{tab === 'pending' && pendingCount > 0 ? ` · ${pendingCount}` : ''}</button>)}</div>
      {filtered.length === 0 ? <div className="empty-state-card"><div className="empty-state-icon"><Brain size={21} /></div><div><h3>{localMock ? (language === 'ar' ? 'لا توجد اقتراحات من بيانات حقيقية' : 'No real-data suggestions yet') : t('suggestionEmpty')}</h3><p>{verifiedSource ? (connected ? t('suggestionWaiting') : t('disconnected')) : language === 'ar' ? 'ستظهر هنا الاقتراحات بعد التحقق من مدخلات الجهاز.' : 'Suggestions will appear after device inputs are verified.'}</p></div></div> : <div className="suggestion-list">{filtered.map(([id, suggestion]) => <SuggestionCard key={id} suggestion={{ ...suggestion, id: suggestion.id ?? id }} now={now} canReview={canReview} />)}</div>}
    </section>
  </div>;
}

function PredictionCard({ label, value, unit, locale }: { label: string; value: number; unit: string; locale: string }) {
  const valid = typeof value === 'number' && Number.isFinite(value);
  return <div className="prediction-card"><span>{label}</span><strong>{valid ? value.toLocaleString(locale, { maximumFractionDigits: 1 }) : '—'}{valid ? ` ${unit}` : ''}</strong></div>;
}

function SuggestionCard({ suggestion, now, canReview }: { suggestion: AISuggestion; now: number; canReview: boolean }) {
  const approveSuggestion = useSensorStore((state) => state.approveSuggestion);
  const rejectSuggestion = useSensorStore((state) => state.rejectSuggestion);
  const { connected } = useConnection();
  const { language, t } = useLanguage();
  const [processing, setProcessing] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const expiry = validTimestamp(suggestion.expiresAt);
  const isExpired = suggestion.status === 'expired' || expiry === null || expiry <= now;
  const isPending = suggestion.status === 'pending' && !isExpired;
  const supported = isSupportedAction(suggestion);
  const Icon = typeIcons[suggestion.type] ?? AlertTriangle;
  const color = typeColors[suggestion.type] ?? '#e8c66a';
  const confidence = typeof suggestion.confidence === 'number' && Number.isFinite(suggestion.confidence) && suggestion.confidence >= 0 && suggestion.confidence <= 1 ? `${Math.round(suggestion.confidence * 100)}%` : null;
  const created = safeDate(suggestion.createdAt);
  const createdLabel = created
    ? formatDistanceToNow(created, language === 'ar' ? { addSuffix: true, locale: ar } : { addSuffix: true })
    : t('unavailable');

  const review = async (choice: 'approved' | 'rejected') => {
    if (!suggestion.id || !connected || !canReview || !isPending || processing || (choice === 'approved' && !supported)) return;
    setProcessing(true); setMessage(null);
    try {
      if (choice === 'approved') await approveSuggestion(suggestion.id); else await rejectSuggestion(suggestion.id);
      setDecision(choice); setMessage(t('reviewAccepted'));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : t('suggestionError')); }
    finally { setProcessing(false); }
  };

  return <article className="suggestion-card" style={{ '--suggestion-color': color } as CSSProperties}>
    <div className="suggestion-card-header"><span className="suggestion-icon"><Icon size={19} /></span><div className="suggestion-copy"><div className="suggestion-title-row"><h3>{suggestion.suggestion}</h3><span className="badge badge-info">{suggestion.type}</span></div><p>{suggestion.reason}</p></div><div className="suggestion-status-column">{confidence && <span className="suggestion-confidence">{confidence} {t('confidence')}</span>}<span className={`badge ${isExpired ? 'badge-neutral' : (decision ?? suggestion.status) === 'rejected' ? 'badge-danger' : (decision ?? suggestion.status) === 'executed' ? 'badge-success' : 'badge-warning'}`}>{t(isExpired ? 'expired' : decision ?? suggestion.status)}</span></div></div>
    <div className="suggestion-recommendation"><span>{language === 'ar' ? 'الإجراء المقترح' : 'Recommended action'}</span><code>{suggestion.recommendedAction.target} → {suggestion.recommendedAction.action}{suggestion.recommendedAction.mode ? ` · ${suggestion.recommendedAction.mode}` : ''}</code></div>
    {!supported && <p className="status-banner is-info mt-3" role="note">{t('adviceOnly')}</p>}
    {isPending && <div className="suggestion-actions"><button className="btn btn-primary btn-sm" onClick={() => void review('approved')} disabled={!connected || !canReview || processing || !supported || !suggestion.id}>{processing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}{t('approved')}</button><button className="btn btn-secondary btn-sm" onClick={() => void review('rejected')} disabled={!connected || !canReview || processing || !suggestion.id}>{processing ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}{t('rejected')}</button></div>}
    {isPending && !connected && <p className="microcopy mt-2">{t('disconnected')}</p>}{message && <p className="microcopy mt-3" role="status">{message}</p>}
    <div className="suggestion-meta"><span><Clock size={13} />{createdLabel}</span>{suggestion.requiresApproval && <span className="badge badge-info">{t('requiresApproval')}</span>}{isExpired && <span>{t('expired')}</span>}</div>
  </article>;
}
