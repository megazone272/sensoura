import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Power, RotateCcw, Terminal, Volume2, VolumeX, XCircle } from 'lucide-react';
import { trackEvent } from '@services/analytics';
import { hasControlAccessHint } from '@services/authToken';
import { useCommands, useCommandResults, useConnection, useSensorStore } from '@store/sensorStore';
import type { CommandResult } from '@shared/types';
import { useLanguage } from '@contexts/LanguageContext';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';
import { safeDate, validTimestamp } from '@services/telemetry';

type Tab = 'pump' | 'buzzer' | 'system';
type HistoryRow = { id: string; target: string; action: string; timestamp: number | null; status: 'pending' | 'executed' | 'failed' | 'timeout'; result?: CommandResult };

function StatusIcon({ status }: { status: HistoryRow['status'] }) {
  if (status === 'executed') return <CheckCircle2 size={15} className="text-[var(--accent-primary)]" />;
  if (status === 'failed') return <XCircle size={15} className="text-[var(--accent-danger)]" />;
  if (status === 'timeout') return <AlertTriangle size={15} className="text-[var(--accent-danger)]" />;
  return <Clock3 size={15} className="text-[var(--accent-warning)]" />;
}

export function Commands() {
  const commands = useCommands();
  const results = useCommandResults();
  const { connected } = useConnection();
  const { sendCommand, controlRelay, controlBuzzer } = useSensorStore();
  const { language, t } = useLanguage();
  const canControl = hasControlAccessHint();
  const [tab, setTab] = useState<Tab>('pump');
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'REBOOT' | 'CALIBRATE' | null>(null);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendMode, setBackendMode] = useState<'sdk' | 'mock' | 'unknown'>('unknown');
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';
  const activeResult = activeCommandId ? results[activeCommandId] : undefined;

  useEffect(() => {
    let active = true;
    void getBackendHealth().then((health) => {
      if (!active) return;
      setBackendMode(getBackendMode(health));
    }).catch(() => { if (active) setBackendMode('unknown'); });
    return () => { active = false; };
  }, []);

  const rows = useMemo<HistoryRow[]>(() => {
    const resultById = new Map<string, CommandResult>();
    for (const [key, result] of Object.entries(results)) resultById.set(result.commandId || key, result);
    const merged = new Map<string, HistoryRow>();
    for (const [key, command] of Object.entries(commands)) {
      const id = command.id || key;
      const result = resultById.get(id);
      merged.set(id, {
        id,
        target: result?.target || command.target,
        action: result?.requestedAction || command.action,
        timestamp: validTimestamp(result?.timestamp ?? command.timestamp),
        status: result?.status ?? 'pending',
        result,
      });
    }
    for (const [key, result] of Object.entries(results)) {
      const id = result.commandId || key;
      if (!merged.has(id)) merged.set(id, { id, target: result.target, action: result.requestedAction, timestamp: validTimestamp(result.timestamp), status: result.status, result });
    }
    return [...merged.values()].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }, [commands, results]);

  const runCommand = async (target: 'pump' | 'buzzer' | 'system', action: 'ON' | 'OFF' | 'MUTE' | 'UNMUTE' | 'REBOOT' | 'CALIBRATE') => {
    if (!connected || !canControl || busy) return;
    setBusy(true);
    setError(null);
    setActiveCommandId(null);
    try {
      let id: string;
      if (target === 'pump') id = await controlRelay(action as 'ON' | 'OFF', 'manual');
      else if (target === 'buzzer') id = await controlBuzzer(action as 'MUTE' | 'UNMUTE');
      else id = await sendCommand({ target: 'system', action: action as 'REBOOT' | 'CALIBRATE', mode: 'MANUAL' });
      setActiveCommandId(id);
      trackEvent('device_command_sent', { target, action, mode: 'MANUAL' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('commandFailed'));
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const statusText = (status: HistoryRow['status']) => t(status === 'timeout' ? 'commandTimeout' : status);
  const resultMessage = activeResult?.status === 'executed' ? t('commandExecuted')
    : activeResult?.status === 'failed' ? activeResult.message || t('commandFailed')
      : activeResult?.status === 'timeout' ? t('commandTimeout')
        : activeCommandId ? t('commandQueued') : null;

  return (
    <div className="space-y-7">
      <header className="page-heading" data-motion-item><div><p className="eyebrow">DEVICE OPERATIONS</p><h1>{t('commandsTitle')}</h1><p>{t('commandsSubtitle')}</p></div><span title={t('socketStatus')} aria-label={`${t('socketStatus')}: ${connected ? t('connected') : t('disconnected')}`} className={`sensoura-status-chip ${connected ? 'is-online' : 'is-offline'}`}><span className={`status-dot ${connected ? 'online' : 'offline'}`} />{connected ? t('connected') : t('disconnected')}</span></header>
      {backendMode !== 'sdk' && <p className="status-banner is-warning" role="status" data-motion-item><AlertTriangle size={16} />{language === 'ar' ? (backendMode === 'mock' ? 'الخادم المحلي يستخدم قاعدة mock؛ قبول الطلب لا يثبت أن الجهاز نفّذه فعليًا.' : 'لم يتم التحقق من مصدر backend؛ قبول الطلب لا يثبت أن الجهاز نفّذه فعليًا.') : (backendMode === 'mock' ? 'The backend is using a local mock database; an accepted request does not prove physical device execution.' : 'The backend source is unverified; an accepted request does not prove physical device execution.')}</p>}

      <div className="commands-layout">
        <section className="panel-card" data-motion-item>
          <div className="section-heading compact"><div><p className="eyebrow">MANUAL REQUESTS</p><h2>{t('quickActions')}</h2></div><Terminal size={19} className="text-[var(--accent-primary)]" /></div>
          <div className="filter-row" role="tablist" aria-label={t('commandsTitle')}>
            {(['pump', 'buzzer', 'system'] as const).map((name) => <button key={name} role="tab" aria-selected={tab === name} className={`btn btn-sm ${tab === name ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(name)}>{t(name === 'pump' ? 'tabPump' : name === 'buzzer' ? 'tabBuzzer' : 'tabSystem')}</button>)}
          </div>
          {!canControl && <p className="status-banner is-info mb-4" role="note">{t('readOnlyNote')}</p>}
          {tab === 'pump' && <div className="command-action-panel"><p>{t('safetyNote')}</p><div className="action-row"><button className="btn btn-primary" disabled={!connected || !canControl || busy} onClick={() => void runCommand('pump', 'ON')}><Power size={16} />{t('turnOn')}</button><button className="btn btn-danger" disabled={!connected || !canControl || busy} onClick={() => void runCommand('pump', 'OFF')}><Power size={16} />{t('turnOff')}</button></div></div>}
          {tab === 'buzzer' && <div className="command-action-panel"><p>{language === 'ar' ? 'إرسال طلب كتم/إلغاء كتم للجرس المتصل.' : 'Send a mute/unmute request to the connected buzzer.'}</p><div className="action-row"><button className="btn btn-primary" disabled={!connected || !canControl || busy} onClick={() => void runCommand('buzzer', 'UNMUTE')}><Volume2 size={16} />{t('unmute')}</button><button className="btn btn-secondary" disabled={!connected || !canControl || busy} onClick={() => void runCommand('buzzer', 'MUTE')}><VolumeX size={16} />{t('mute')}</button></div></div>}
          {tab === 'system' && <div className="command-action-panel"><p>{language === 'ar' ? 'تتطلب أوامر النظام تأكيدًا؛ قد ينقطع الاتصال مؤقتًا عند إعادة التشغيل.' : 'System requests require confirmation; a reboot may briefly interrupt connectivity.'}</p><div className="action-row"><button className="btn btn-secondary" disabled={!connected || !canControl || busy} onClick={() => setConfirmAction('CALIBRATE')}><Terminal size={16} />{t('calibrate')}</button><button className="btn btn-danger" disabled={!connected || !canControl || busy} onClick={() => setConfirmAction('REBOOT')}><RotateCcw size={16} />{t('reboot')}</button></div></div>}
          {!connected && <p className="status-banner is-warning mt-4" role="status"><AlertTriangle size={15} />{t('disconnected')}</p>}
          {error && <p className="status-banner is-danger mt-4" role="alert">{error}</p>}
          {busy && <p className="status-banner is-info mt-4" role="status"><Loader2 size={15} className="animate-spin" />{t('connecting')}</p>}
          {activeCommandId && resultMessage && <div className={`command-feedback mt-4 ${activeResult?.status === 'failed' || activeResult?.status === 'timeout' ? 'is-danger' : activeResult?.status === 'executed' ? 'is-success' : ''}`} role="status"><span className="mono text-xs">{activeCommandId}</span><span>{resultMessage}</span></div>}
        </section>

        <section className="panel-card" data-motion-item>
          <div className="section-heading compact"><div><p className="eyebrow">REQUEST LOG</p><h2>{t('commandHistory')}</h2></div><span className="badge badge-info">{rows.length}</span></div>
          {rows.length === 0 ? <div className="empty-state-card"><div className="empty-state-icon"><Clock3 size={20} /></div><div><h3>{t('noCommands')}</h3><p>{connected ? t('empty') : t('disconnected')}</p></div></div> : <div className="table-container command-table-wrap"><table className="table command-table"><thead><tr><th>{t('time')}</th><th>{t('target')}</th><th>{t('action')}</th><th>{t('status')}</th><th>{t('commandId')}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{safeDate(row.timestamp)?.toLocaleString(locale) ?? t('unavailable')}</td><td className="capitalize">{row.target}</td><td className="mono">{row.action}</td><td><span className={`command-status is-${row.status}`}><StatusIcon status={row.status} />{statusText(row.status)}</span>{row.result?.message && <small className="command-row-message">{row.result.message}</small>}</td><td className="mono command-id-cell">{row.id}</td></tr>)}</tbody></table></div>}
          <p className="microcopy mt-3">{t('safetyNote')}</p>
        </section>
      </div>

      {confirmAction && <div className="confirm-panel" role="alertdialog" aria-modal="false" aria-labelledby="system-confirm-title" data-motion-item><div className="confirm-panel-icon"><AlertTriangle size={19} /></div><div className="confirm-panel-copy"><h3 id="system-confirm-title">{t('confirmAction')}</h3><p>{t(confirmAction === 'REBOOT' ? 'confirmReboot' : 'confirmCalibrate')}</p></div><div className="confirm-panel-actions"><button className="btn btn-secondary btn-sm" onClick={() => setConfirmAction(null)} disabled={busy}>{t('cancel')}</button><button className="btn btn-danger btn-sm" onClick={() => void runCommand('system', confirmAction)} disabled={busy}>{busy ? t('connecting') : t('sendCommand')}</button></div></div>}
    </div>
  );
}
