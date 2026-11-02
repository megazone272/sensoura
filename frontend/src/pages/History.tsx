import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Database, RefreshCw } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { endpoints } from '@services/api';
import type { SensorData } from '@shared/types';
import { useLanguage } from '@contexts/LanguageContext';
import { safeDate, validTimestamp } from '@services/telemetry';

type SensorKey = Exclude<keyof SensorData, 'lastUpdate'>;
type HistoryPoint = { timestamp: number } & Partial<Record<SensorKey, number>>;
type TimeRange = '1h' | '24h' | '7d' | '30d';
type HistoryResponse = { data?: unknown; count?: number; note?: string };
const rangeDuration: Record<TimeRange, number> = { '1h': 60 * 60_000, '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000, '30d': 30 * 24 * 60 * 60_000 };
const fields: Array<{ key: SensorKey; label: 'sensorAirTemp' | 'sensorSoilTemp' | 'sensorHumidity' | 'sensorMoisture' | 'sensorLight' | 'sensorPressure' | 'sensorVOC'; unit: string; color: string }> = [
  { key: 'AirTemp', label: 'sensorAirTemp', unit: '°C', color: '#ff8b72' },
  { key: 'SoilTemp', label: 'sensorSoilTemp', unit: '°C', color: '#f6a75d' },
  { key: 'AirHumidity', label: 'sensorHumidity', unit: '%', color: '#5bc9e7' },
  { key: 'SoilMoisture', label: 'sensorMoisture', unit: '%', color: '#22d9ba' },
  { key: 'Light', label: 'sensorLight', unit: 'lux', color: '#e8c66a' },
  { key: 'Barometricpressure', label: 'sensorPressure', unit: 'hPa', color: '#9c9bff' },
  { key: 'VOC', label: 'sensorVOC', unit: 'index', color: '#c084fc' },
];

function parseRows(data: unknown): HistoryPoint[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): HistoryPoint[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const timestamp = validTimestamp(record.timestamp ?? record.lastUpdate);
    if (!timestamp) return [];
    const point: HistoryPoint = { timestamp };
    for (const field of fields) {
      const value = record[field.key];
      if (typeof value === 'number' && Number.isFinite(value)) point[field.key] = value;
    }
    return Object.keys(point).length > 1 ? [point] : [];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export function History() {
  const { language, t } = useLanguage();
  const [limit, setLimit] = useState(100);
  const [range, setRange] = useState<TimeRange>('24h');
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<SensorKey>('SoilMoisture');
  const [rows, setRows] = useState<HistoryPoint[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [placeholder, setPlaceholder] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await endpoints.getHistory({ limit });
      const payload = response.data as HistoryResponse;
      const backendNote = typeof payload?.note === 'string' ? payload.note : '';
      const isPlaceholder = /placeholder|not real|generated from the current sensor state/i.test(backendNote);
      setNote(backendNote);
      setPlaceholder(isPlaceholder);
      setRows(isPlaceholder ? [] : parseRows(payload?.data));
    } catch (cause) {
      setRows([]);
      setNote('');
      setPlaceholder(false);
      setError(cause instanceof Error ? cause.message : t('historyError'));
    } finally {
      setLoading(false);
    }
  }, [limit, t]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  const selectedMetric = fields.find((field) => field.key === selected)!;
  const rangeRows = useMemo(() => rows.filter((row) => row.timestamp >= now - rangeDuration[range]), [rows, now, range]);
  const chartRows = useMemo(() => rangeRows.filter((row) => typeof row[selected] === 'number').map((row) => ({
    time: safeDate(row.timestamp)?.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US') ?? '',
    value: row[selected]!,
  })), [rangeRows, selected, language]);
  const noteUnavailable = /persistent|not available in this deployment/i.test(note);

  return (
    <div className="space-y-7">
      <header className="page-heading" data-motion-item>
        <div><p className="eyebrow">DATA ARCHIVE</p><h1>{t('historyTitle')}</h1><p>{t('historySubtitle')}</p></div>
        <button className="btn btn-secondary btn-sm" onClick={() => void loadHistory()} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{t('refresh')}</button>
      </header>

      <section className="panel-card" data-motion-item>
        <div className="history-controls">
          <label className="form-field"><span>{t('metric')}</span><select className="input" value={selected} onChange={(event) => setSelected(event.target.value as SensorKey)}>{fields.map((field) => <option key={field.key} value={field.key}>{t(field.label)}</option>)}</select></label>
          <label className="form-field"><span>{t('timeRange')}</span><select className="input" value={range} onChange={(event) => setRange(event.target.value as TimeRange)}><option value="1h">{t('lastHour')}</option><option value="24h">{t('last24Hours')}</option><option value="7d">{t('last7Days')}</option><option value="30d">{t('last30Days')}</option></select></label>
          <label className="form-field"><span>{t('records')}</span><select className="input" value={limit} onChange={(event) => setLimit(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
          <div className="history-record-count"><Database size={16} /><span>{rangeRows.length} {t('records')}</span></div>
          <p className="microcopy history-range-note">{t('historyWindowNote')}</p>
        </div>

        {loading && <p className="status-banner is-info" role="status">{t('historyLoading')}</p>}
        {error && <p className="status-banner is-danger" role="alert"><AlertCircle size={16} />{t('historyError')} <span className="microcopy">{error}</span></p>}
        {!loading && !error && placeholder && <div className="history-empty-state"><div className="empty-state-icon"><AlertCircle size={21} /></div><p>{t('historyPlaceholder')}</p></div>}
        {!loading && !error && !placeholder && noteUnavailable && <div className="history-empty-state"><div className="empty-state-icon"><Database size={21} /></div><p>{t('historyUnavailable')}</p></div>}
        {!loading && !error && !placeholder && !noteUnavailable && rangeRows.length === 0 && <div className="history-empty-state"><div className="empty-state-icon"><Database size={21} /></div><p>{t('historyEmpty')}</p></div>}

        {!loading && !error && !placeholder && chartRows.length > 0 && <div className="history-chart" role="img" aria-label={`${t(selectedMetric.label)} ${t('historyTitle')}`}>
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartRows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <defs><linearGradient id="historyMetricFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={selectedMetric.color} stopOpacity={0.28} /><stop offset="100%" stopColor={selectedMetric.color} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} minTickGap={40} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={52} />
            <Tooltip contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)' }} />
            <Area type="monotone" dataKey="value" name={`${t(selectedMetric.label)} (${selectedMetric.unit})`} stroke={selectedMetric.color} fill="url(#historyMetricFill)" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>
        </div>}
        {!loading && !error && rangeRows.length > 0 && <p className="microcopy mt-3">{note && !placeholder ? note : ''}</p>}
      </section>
    </div>
  );
}
