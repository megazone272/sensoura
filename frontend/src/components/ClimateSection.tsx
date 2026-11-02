import { useCallback, useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { endpoints } from '@/services/api';
import type { ClimateHistoryResult, ExternalClimateObservation } from '@shared/types';
import { useLanguage } from '@contexts/LanguageContext';
import { DatePicker } from '@components/DatePicker';

const RANGE_DAYS = 30;

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}
function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RANGE_DAYS - 1));
  return { start: dateKey(start), end: dateKey(now) };
}
function asInputDate(value: string): string { return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; }
function fromInputDate(value: string): string { return value.replace(/-/g, ''); }

export function ClimateSection() {
  const { language, t } = useLanguage();
  const initialRange = defaultRange();
  const [range, setRange] = useState(initialRange);
  const [observations, setObservations] = useState<ExternalClimateObservation[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await endpoints.getClimateHistory(range) as { data: ClimateHistoryResult };
      setObservations(response.data.observations);
      setStale(response.data.cache.stale);
    } catch (requestError) {
      const status = (requestError as { response?: { status?: number } })?.response?.status;
      setError(status === 503
        ? (language === 'ar' ? 'خدمة NASA POWER غير متاحة مؤقتًا. حاول لاحقًا.' : 'NASA POWER is temporarily unavailable. Try again later.')
        : t('error'));
      setObservations([]);
    } finally {
      setLoading(false);
    }
  }, [range, language, t]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const latest = [...observations].reverse().find((item) => item.dataStatus === 'available' || item.dataStatus === 'partially_available' || item.dataStatus === 'stale');
  const rows = observations.filter((item) => item.airTemperatureC !== null || item.relativeHumidityPercent !== null);
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  return (
    <section className="panel-card space-y-4" aria-labelledby="external-climate-heading" data-motion-item>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="eyebrow">NASA POWER · CAIRO</p><h1 id="external-climate-heading">{t('climateTitle')}</h1><p className="mt-1 text-sm text-[var(--text-muted)]">{t('climateDescription')}</p></div>
        <div className="climate-date-filters text-xs text-[var(--text-muted)]">
          <DatePicker label={t('from')} language={language} value={asInputDate(range.start)} max={asInputDate(range.end)} onChange={(value) => setRange((current) => ({ ...current, start: fromInputDate(value) }))} />
          <DatePicker label={t('to')} language={language} value={asInputDate(range.end)} min={asInputDate(range.start)} max={asInputDate(dateKey(new Date()))} onChange={(value) => setRange((current) => ({ ...current, end: fromInputDate(value) }))} />
          <button className="btn btn-secondary btn-sm" onClick={() => void loadHistory()} disabled={loading}>{t('refresh')}</button>
        </div>
      </div>

      {loading && <p role="status" className="status-banner is-info">{t('loading')}</p>}
      {error && <p role="alert" className="status-banner is-danger">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="empty-inline">{t('empty')}</p>}
      {stale && <p role="status" className="status-banner is-warning">{language === 'ar' ? 'تعذر التحديث؛ نعرض بيانات مخزنة مؤقتًا بتاريخ رصدها الأصلي.' : 'Showing cached observations after an upstream error; observation dates remain unchanged.'}</p>}

      {!loading && !error && latest && <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ClimateMetric label={language === 'ar' ? 'حرارة الهواء الخارجي' : 'External air temperature'} value={latest.airTemperatureC} unit="°C" />
        <ClimateMetric label={language === 'ar' ? 'الرطوبة النسبية الخارجية' : 'External relative humidity'} value={latest.relativeHumidityPercent} unit="%" />
        <div className="system-state-card"><span>{language === 'ar' ? 'أحدث رصد متاح' : 'Latest available observation'}</span><strong className="mono">{latest.date}</strong><small>{language === 'ar' ? 'تاريخ جلب البيانات:' : 'Retrieved:'} {new Date(latest.retrievedAt).toLocaleString(locale)}</small><small>Source: NASA POWER</small></div>
      </div>}

      {!loading && !error && rows.length > 0 && <div className="climate-chart" role="img" aria-label={language === 'ar' ? 'مخطط التقديرات اليومية من NASA POWER لحرارة الهواء الخارجي والرطوبة النسبية' : 'Historical daily NASA POWER external air temperature and relative humidity chart'}>
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} minTickGap={24} />
          <YAxis yAxisId="temperature" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit="°C" width={48} />
          <YAxis yAxisId="humidity" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit="%" width={44} />
          <Tooltip contentStyle={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }} labelStyle={{ color: 'var(--text-primary)' }} />
          <Area yAxisId="temperature" type="monotone" dataKey="airTemperatureC" name={language === 'ar' ? 'حرارة الهواء الخارجي (°C)' : 'External air temperature (°C)'} stroke="#fb7185" fill="#fb7185" fillOpacity={0.12} connectNulls={false} isAnimationActive={false} />
          <Area yAxisId="humidity" type="monotone" dataKey="relativeHumidityPercent" name={language === 'ar' ? 'الرطوبة النسبية الخارجية (%)' : 'External relative humidity (%)'} stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.1} connectNulls={false} isAnimationActive={false} />
        </AreaChart></ResponsiveContainer>
      </div>}
      <p className="microcopy">NASA POWER daily T2M (°C) and RH2M (%), AG community, {observations[0]?.latitude.toFixed(4) ?? '30.0444'}° N / {observations[0]?.longitude.toFixed(4) ?? '31.2357'}° E. {language === 'ar' ? 'السياق المناخي من خلية الشبكة ليس قياسًا داخل البيت الزراعي.' : 'Grid-cell climate context is not a greenhouse measurement.'}</p>
    </section>
  );
}

function ClimateMetric({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return <div className="system-state-card"><span>{label}</span><strong className="mono text-2xl">{value === null ? '—' : `${value.toFixed(1)} ${unit}`}</strong>{value === null && <small>Unavailable for this observation date</small>}</div>;
}
