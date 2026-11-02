import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { AlertTriangle, Droplets, Gauge, Power, ShieldCheck } from 'lucide-react';
import { useConnection, useSensorData, useSensorStore, useSystem } from '@store/sensorStore';
import { useLanguage } from '@contexts/LanguageContext';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';
import { hasControlAccessHint } from '@services/authToken';

export function Irrigation() {
  const { connected } = useConnection();
  const system = useSystem();
  const sensorData = useSensorData();
  const sendCommand = useSensorStore((state) => state.sendCommand);
  const commandResults = useSensorStore((state) => state.commandResults);
  const { language, t } = useLanguage();
  const [confirmAction, setConfirmAction] = useState<'ON' | 'OFF' | null>(null);
  const [sending, setSending] = useState(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<'sdk' | 'mock' | 'unknown'>('unknown');
  const visualRef = useRef<HTMLDivElement>(null);
  const verifiedSource = backendMode === 'sdk';
  const relayState = verifiedSource ? system?.relay?.state ?? null : null;
  const relayMode = verifiedSource ? system?.relay?.mode ?? null : null;
  const result = commandId ? commandResults[commandId] : undefined;
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';
  const canControl = hasControlAccessHint();

  useEffect(() => {
    let active = true;
    void getBackendHealth().then((health) => {
      if (!active) return;
      setBackendMode(getBackendMode(health));
    }).catch(() => { if (active) setBackendMode('unknown'); });
    return () => { active = false; };
  }, []);

  useGSAP(() => {
    const visual = visualRef.current;
    if (!visual) return;
    const streams = visual.querySelectorAll<SVGPathElement>('.irrigation-water-stream');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (!connected || relayState !== 'ON' || reduced) {
      gsap.set(streams, { strokeDashoffset: 0, opacity: relayState === 'ON' ? 0.6 : 0.25 });
      return;
    }
    gsap.fromTo(streams, { strokeDashoffset: 24, opacity: 0.35 }, { strokeDashoffset: -24, opacity: 1, duration: 1.4, repeat: -1, ease: 'none', stagger: 0.18 });
  }, { scope: visualRef, dependencies: [connected, relayState], revertOnUpdate: true });

  const submit = async () => {
    if (!confirmAction || !connected || !canControl || sending) return;
    setSending(true);
    setError(null);
    setCommandId(null);
    try {
      const id = await sendCommand({ target: 'pump', action: confirmAction, mode: 'MANUAL' });
      setCommandId(id);
      setConfirmAction(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('commandFailed'));
    } finally {
      setSending(false);
    }
  };

  const resultText = result?.status === 'executed' ? t('commandExecuted')
    : result?.status === 'failed' ? (result.message || t('commandFailed'))
      : result?.status === 'timeout' ? t('commandTimeout')
        : commandId ? t('commandQueued') : null;

  return (
    <div className="space-y-7">
      <header className="page-heading" data-motion-item>
        <div><p className="eyebrow">CONTROL SYSTEMS</p><h1>{t('irrigationTitle')}</h1><p>{t('irrigationSubtitle')}</p></div>
        <span title={t('socketStatus')} aria-label={`${t('socketStatus')}: ${connected ? t('connected') : t('disconnected')}`} className={`sensoura-status-chip ${connected ? 'is-online' : 'is-offline'}`}><span className={`status-dot ${connected ? 'online' : 'offline'}`} />{connected ? t('connected') : t('disconnected')}</span>
      </header>

      {backendMode !== 'sdk' && <div className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? (backendMode === 'mock' ? 'مصدر الحالة الحالي محاكاة محلية؛ لن نعرضه كحالة فعلية للمضخة. الأوامر تظل طلبات وتحتاج تأكيد الجهاز.' : 'تعذر التحقق من مصدر حالة الجهاز؛ الأوامر لا تثبت تشغيل المضخة وتحتاج تأكيدًا من الجهاز.') : (backendMode === 'mock' ? 'The backend is in local mock mode; relay state is hidden. Commands remain requests and need device acknowledgement.' : 'Could not verify the device-state source; a command request does not prove the pump is running.')}</div>}
      {!canControl && <div className="status-banner is-info" role="note">{t('readOnlyNote')}</div>}

      <div className="irrigation-grid">
        <section className="panel-card irrigation-visual-card" data-motion-item>
          <div className="section-heading compact"><div><p className="eyebrow">PUMP RELAY</p><h2>{t('pumpState')}</h2></div><span className={`relay-state-pill ${relayState === 'ON' ? 'is-on' : relayState === 'OFF' ? 'is-off' : 'is-unknown'}`}>{relayState ?? t('unknown')}</span></div>
          <div ref={visualRef} className={`irrigation-illustration ${relayState === 'ON' ? 'is-active' : ''}`}>
            <svg viewBox="0 0 520 230" role="img" aria-label={language === 'ar' ? 'رسم توضيحي لمسار الماء، حركة الماء تظهر فقط عندما يعلن الجهاز تشغيل المضخة' : 'Illustration of water flow; animation runs only when the device reports the pump on'}>
              <defs><linearGradient id="pipeGradient" x1="0" x2="1"><stop offset="0" stopColor="#00d9c0" /><stop offset="1" stopColor="#2fa8ff" /></linearGradient></defs>
              <path d="M40 150 H170 C192 150 195 122 218 122 H300 C323 122 325 150 350 150 H478" fill="none" stroke="var(--border-primary)" strokeWidth="18" strokeLinecap="round" />
              <path className="irrigation-water-stream" d="M40 150 H170 C192 150 195 122 218 122 H300 C323 122 325 150 350 150 H478" fill="none" stroke="url(#pipeGradient)" strokeWidth="7" strokeLinecap="round" strokeDasharray="12 12" />
              <rect x="205" y="82" width="112" height="82" rx="20" fill="var(--bg-secondary)" stroke="var(--border-secondary)" strokeWidth="2" />
              <circle cx="261" cy="123" r="24" fill="var(--bg-tertiary)" stroke="var(--accent-primary)" strokeWidth="2" />
              <path d="M261 108 L272 123 L261 138 L250 123 Z" fill="var(--accent-primary)" />
              <path d="M100 152 C100 174 89 188 89 202 M421 152 C421 174 410 188 410 202" fill="none" stroke="var(--accent-secondary)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="89" cy="206" r="5" fill="var(--accent-secondary)" /><circle cx="410" cy="206" r="5" fill="var(--accent-secondary)" />
              <text x="260" y="57" textAnchor="middle" fill="var(--text-muted)" fontSize="12">{relayState === 'ON' ? (language === 'ar' ? 'الجهاز يبلّغ أن المرحّل يعمل' : 'Device reports relay ON') : (language === 'ar' ? 'الحالة الفعلية من الجهاز' : 'Reported device state')}</text>
            </svg>
          </div>
          <p className="microcopy">{t('safetyNote')}</p>
        </section>

        <section className="panel-card irrigation-control-card" data-motion-item>
          <div className="section-heading compact"><div><p className="eyebrow">MANUAL RELAY</p><h2>{t('sendCommand')}</h2></div><Power size={20} className="text-[var(--accent-primary)]" /></div>
          <div className="irrigation-reading">
            <span className="metric-icon"><Droplets size={17} /></span>
            <div><p>{t('sensorMoisture')}</p><strong>{verifiedSource && typeof sensorData?.SoilMoisture === 'number' ? `${sensorData.SoilMoisture.toLocaleString(locale, { maximumFractionDigits: 1 })}%` : t('unavailable')}</strong></div>
            <Gauge className="irrigation-reading-end" size={18} />
          </div>
          <div className="irrigation-reading">
            <span className="metric-icon"><ShieldCheck size={17} /></span>
            <div><p>{t('manualMode')}</p><strong>{relayMode ?? t('unavailable')}</strong></div>
            <span className="microcopy">{verifiedSource ? system?.relay?.reason ?? t('unknown') : t('unknown')}</span>
          </div>
          <div className="irrigation-actions">
            <button className="btn btn-primary w-full" onClick={() => setConfirmAction('ON')} disabled={!connected || !canControl || sending}>
              <Droplets size={17} />{t('irrigate')}
            </button>
            <button className="btn btn-danger w-full" onClick={() => setConfirmAction('OFF')} disabled={!connected || !canControl || sending}>
              <Power size={17} />{t('stopPump')}
            </button>
          </div>
          {!connected && <p className="status-banner is-warning" role="status"><AlertTriangle size={16} />{t('disconnected')}</p>}
          {error && <p className="status-banner is-danger" role="alert">{error}</p>}
          {commandId && resultText && <div className={`command-feedback ${result?.status === 'failed' || result?.status === 'timeout' ? 'is-danger' : result?.status === 'executed' ? 'is-success' : ''}`} role="status"><span className="mono text-xs">{commandId}</span><span>{resultText}</span></div>}
        </section>
      </div>

      {confirmAction && <div className="confirm-panel" role="alertdialog" aria-modal="false" aria-labelledby="irrigation-confirm-title" data-motion-item>
        <div className="confirm-panel-icon"><AlertTriangle size={19} /></div>
        <div className="confirm-panel-copy"><h3 id="irrigation-confirm-title">{t('confirmAction')}</h3><p>{t(confirmAction === 'ON' ? 'confirmPumpOn' : 'confirmPumpOff')}</p></div>
        <div className="confirm-panel-actions"><button className="btn btn-secondary btn-sm" onClick={() => setConfirmAction(null)} disabled={sending}>{t('cancel')}</button><button className={`btn btn-sm ${confirmAction === 'ON' ? 'btn-primary' : 'btn-danger'}`} onClick={() => void submit()} disabled={sending}>{sending ? t('connecting') : t('sendCommand')}</button></div>
      </div>}
    </div>
  );
}
