import { useEffect, useState, type CSSProperties } from 'react';
import { Droplets, Leaf, Loader2, RefreshCw, Sprout, Sun, TrendingUp, Satellite, Wheat, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@contexts/LanguageContext';
import { endpoints } from '@services/api';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';

type BackendMode = 'sdk' | 'mock' | 'unknown';

interface CropProfile {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string;
  growingSeason: string;
}

interface StrategyMetrics {
  waterConsumptionIndex: number;
  waterSavingsPercentage: number;
  soilHealthScore: number;
  nitrogenBalanceKgHa: number;
  climateRiskResilience: string;
  economicViability: string;
  overallSuitabilityScore: number;
}

interface Strategy {
  id: string;
  nameEn: string;
  nameAr: string;
  tagEn: string;
  tagAr: string;
  theme: string;
  sequence: { season: string; crop: CropProfile }[];
  metrics: StrategyMetrics;
  explanationEn: string;
  explanationAr: string;
  nasaDataContributions: {
    nasaPower: string;
    smap: string;
    gpm: string;
    landsatModis: string;
  };
  fieldTelemetryInsights: string[];
}

interface CropRotationResponse {
  strategies: Strategy[];
  location?: {
    name?: string;
    city?: string;
    country?: string;
    lat?: number;
    lon?: number;
    latitude?: number;
    longitude?: number;
  };
  availableCrops: CropProfile[];
  evaluatedAt: number;
  source: string;
}

const themeColors: Record<string, { bg: string; border: string; accent: string; tag: string }> = {
  baseline: { bg: 'rgba(156,155,255,0.08)', border: '#9c9bff', accent: '#9c9bff', tag: 'rgba(156,155,255,0.18)' },
  water_resilient: { bg: 'rgba(34,217,186,0.08)', border: '#22d9ba', accent: '#22d9ba', tag: 'rgba(34,217,186,0.18)' },
  soil_regeneration: { bg: 'rgba(232,198,106,0.08)', border: '#e8c66a', accent: '#e8c66a', tag: 'rgba(232,198,106,0.18)' },
};

const themeIcons: Record<string, typeof Wheat> = {
  baseline: Wheat,
  water_resilient: Droplets,
  soil_regeneration: Leaf,
};

function MetricBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2, opacity: 0.85 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}{max === 100 ? '%' : ''}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--sensoura-card-bg, rgba(255,255,255,0.06))' }}>
        <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: color, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

function NitrogenBadge({ value, language }: { value: number; language: string }) {
  const isPositive = value > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
      background: isPositive ? 'rgba(34,217,186,0.15)' : 'rgba(255,112,112,0.15)',
      color: isPositive ? '#22d9ba' : '#ff7070',
    }}>
      {isPositive ? '+' : ''}{value} {language === 'ar' ? 'كجم نيتروجين/هكتار' : 'kg N/ha'}
    </span>
  );
}

function ResilienceBadge({ level }: { level: string }) {
  const colors: Record<string, string> = { High: '#22d9ba', Moderate: '#e8c66a', Low: '#ff7070' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: `${colors[level] ?? '#888'}22`, color: colors[level] ?? '#888',
    }}>
      {level}
    </span>
  );
}

export function CropRotation() {
  const { language, t } = useLanguage();
  const isAr = language === 'ar';
  const [data, setData] = useState<CropRotationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setBackendMode] = useState<BackendMode>('unknown');
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);

  // Custom evaluation form
  const [soilType, setSoilType] = useState('clay_loam');
  const [primaryGoal, setPrimaryGoal] = useState('max_yield');
  const [evaluating, setEvaluating] = useState(false);

  const fetchData = async (customContext?: { soilType: string; primaryGoal: string }) => {
    setLoading(true); setError(null);
    try {
      const health = await getBackendHealth();
      const mode: BackendMode = getBackendMode(health);
      setBackendMode(mode);
      if (mode !== 'sdk') { setData(null); setError(isAr ? 'يتطلب اتصال Firebase مباشر' : 'Requires live Firebase connection'); return; }

      const response = customContext
        ? await endpoints.evaluateCropRotation(customContext)
        : await endpoints.getCropRotation();
      setData(response.data as CropRotationResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('cropRotationError'));
    } finally {
      setLoading(false);
      setEvaluating(false);
    }
  };

  useEffect(() => { void fetchData(); }, []);

  const handleEvaluate = () => {
    setEvaluating(true);
    void fetchData({ soilType, primaryGoal });
  };

  const pageStyle: CSSProperties = { padding: '24px 16px', maxWidth: 1200, margin: '0 auto', direction: isAr ? 'rtl' : 'ltr' };
  const headerStyle: CSSProperties = { marginBottom: 24 };
  const titleStyle: CSSProperties = { fontSize: 22, fontWeight: 700, margin: '0 0 4px' };
  const subtitleStyle: CSSProperties = { fontSize: 14, opacity: 0.7, margin: 0, lineHeight: 1.5 };

  const cardStyle = (theme: string): CSSProperties => ({
    background: themeColors[theme]?.bg ?? 'rgba(255,255,255,0.04)',
    border: `1px solid ${themeColors[theme]?.border ?? '#555'}33`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    cursor: 'pointer',
  });

  if (loading && !data) {
    return (
      <div style={{ ...pageStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 12 }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#22d9ba' }} />
        <p style={{ fontSize: 14, opacity: 0.7 }}>{t('cropRotationLoading')}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Sprout size={24} style={{ color: '#22d9ba' }} />
          <h1 style={titleStyle}>{t('cropRotationTitle')}</h1>
          <button onClick={() => void fetchData()} disabled={loading} style={{
            marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13,
          }}>
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            {t('refresh')}
          </button>
        </div>
        <p style={subtitleStyle}>{t('cropRotationSubtitle')}</p>
      </header>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px',
          borderRadius: 10, background: 'rgba(255,112,112,0.08)', border: '1px solid rgba(255,112,112,0.2)',
          marginBottom: 20, fontSize: 14,
        }}>
          <AlertTriangle size={18} style={{ color: '#ff7070', flexShrink: 0 }} />
          <span>{error}</span>
          <button onClick={() => void fetchData()} style={{
            marginInlineStart: 'auto', padding: '4px 12px', borderRadius: 6,
            border: '1px solid rgba(255,112,112,0.3)', background: 'transparent',
            color: '#ff7070', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            {t('tryAgain')}
          </button>
        </div>
      )}

      {/* Evaluation Form */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12,
        marginBottom: 24, padding: 16, borderRadius: 10,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div>
          <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>{t('soilType')}</label>
          <select value={soilType} onChange={e => setSoilType(e.target.value)} style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            background: 'var(--sensoura-card-bg, #1a1a2e)', color: 'inherit',
            border: '1px solid rgba(255,255,255,0.12)', fontSize: 13,
          }}>
            <option value="clay">{t('soilClay')}</option>
            <option value="loam">{t('soilLoam')}</option>
            <option value="sandy">{t('soilSandy')}</option>
            <option value="clay_loam">{t('soilClayLoam')}</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, opacity: 0.7, display: 'block', marginBottom: 4 }}>{t('primaryGoal')}</label>
          <select value={primaryGoal} onChange={e => setPrimaryGoal(e.target.value)} style={{
            width: '100%', padding: '8px 10px', borderRadius: 6,
            background: 'var(--sensoura-card-bg, #1a1a2e)', color: 'inherit',
            border: '1px solid rgba(255,255,255,0.12)', fontSize: 13,
          }}>
            <option value="max_yield">{t('goalMaxYield')}</option>
            <option value="water_saving">{t('goalWaterSaving')}</option>
            <option value="soil_health">{t('goalSoilHealth')}</option>
            <option value="climate_adaptation">{t('goalClimateAdaptation')}</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={handleEvaluate} disabled={evaluating} style={{
            width: '100%', padding: '8px 16px', borderRadius: 8,
            background: 'linear-gradient(135deg, #22d9ba, #5bc9e7)',
            color: '#0d0d1a', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
            opacity: evaluating ? 0.6 : 1,
          }}>
            {evaluating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : t('evaluate')}
          </button>
        </div>
      </div>

      {/* Strategy Cards */}
      {data && data.strategies.map((strategy) => {
        const colors = themeColors[strategy.theme] ?? themeColors.baseline;
        const ThemeIcon = themeIcons[strategy.theme] ?? Sprout;
        const isExpanded = expandedStrategy === strategy.id;
        const isBest = strategy.metrics.overallSuitabilityScore >= Math.max(...data.strategies.map(s => s.metrics.overallSuitabilityScore));

        return (
          <div key={strategy.id} style={cardStyle(strategy.theme)} onClick={() => setExpandedStrategy(isExpanded ? null : strategy.id)}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: colors.tag, flexShrink: 0,
              }}>
                <ThemeIcon size={22} style={{ color: colors.accent }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                    {isAr ? strategy.nameAr : strategy.nameEn}
                  </h3>
                  {isBest && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: 'rgba(34,217,186,0.2)', color: '#22d9ba', textTransform: 'uppercase',
                    }}>
                      ★ {t('recommended')}
                    </span>
                  )}
                  {strategy.theme === 'baseline' && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                      background: colors.tag, color: colors.accent,
                    }}>
                      {t('currentPractice')}
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                  {isAr ? strategy.tagAr : strategy.tagEn}
                </p>
              </div>
              <div style={{
                textAlign: 'center', padding: '4px 12px', borderRadius: 8, background: colors.tag,
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: colors.accent, lineHeight: 1 }}>
                  {strategy.metrics.overallSuitabilityScore}
                </div>
                <div style={{ fontSize: 9, opacity: 0.7, marginTop: 2 }}>{t('overallScore')}</div>
              </div>
            </div>

            {/* Crop Sequence */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)',
            }}>
              {strategy.sequence.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 && <span style={{ fontSize: 16, opacity: 0.4 }}>→</span>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {step.season === 'Winter' ? <Sun size={14} style={{ color: '#5bc9e7' }} /> : <Sun size={14} style={{ color: '#e8c66a' }} />}
                    <span style={{ fontSize: 12 }}>
                      <strong>{step.season === 'Winter' ? t('winterSeason') : t('summerSeason')}: </strong>
                      {isAr ? step.crop.nameAr : step.crop.nameEn}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Key Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 10 }}>
              <MetricBar value={100 - strategy.metrics.waterConsumptionIndex} max={100} color="#5bc9e7" label={`${t('waterSavings')}: ${strategy.metrics.waterSavingsPercentage}%`} />
              <MetricBar value={strategy.metrics.soilHealthScore} max={100} color="#22d9ba" label={t('soilHealth')} />
            </div>

            {/* Bottom chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <NitrogenBadge value={strategy.metrics.nitrogenBalanceKgHa} language={language} />
              <ResilienceBadge level={strategy.metrics.climateRiskResilience} />
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: 'rgba(255,255,255,0.06)', opacity: 0.7,
              }}>
                {t('economicViability')}: {strategy.metrics.economicViability}
              </span>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}33` }} onClick={e => e.stopPropagation()}>
                {/* Explanation */}
                <p style={{ fontSize: 13, lineHeight: 1.7, margin: '0 0 16px', opacity: 0.85 }}>
                  {isAr ? strategy.explanationAr : strategy.explanationEn}
                </p>

                {/* NASA Contributions */}
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Satellite size={14} style={{ color: '#5bc9e7' }} />
                    {t('nasaContributions')}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
                    {Object.entries(strategy.nasaDataContributions).map(([key, value]) => (
                      <div key={key} style={{
                        padding: '8px 12px', borderRadius: 8, fontSize: 12,
                        background: 'rgba(91,201,231,0.06)', border: '1px solid rgba(91,201,231,0.12)',
                      }}>
                        <strong style={{ fontSize: 11, textTransform: 'uppercase', opacity: 0.6 }}>
                          {key === 'nasaPower' ? 'NASA POWER' : key === 'smap' ? 'SMAP' : key === 'gpm' ? 'GPM' : 'Landsat/MODIS'}
                        </strong>
                        <p style={{ margin: '4px 0 0', lineHeight: 1.5, opacity: 0.85 }}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Field Insights */}
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <TrendingUp size={14} style={{ color: '#22d9ba' }} />
                    {t('fieldInsights')}
                  </h4>
                  <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 12, lineHeight: 1.8, opacity: 0.85 }}>
                    {strategy.fieldTelemetryInsights.map((insight, i) => (
                      <li key={i}>{insight}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      {data && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 11, opacity: 0.5, marginTop: 8, flexWrap: 'wrap', gap: 8,
        }}>
          <span>{t('cropRotationSource')}: {data.source}</span>
          <span>{t('cropRotationEvaluatedAt')}: {new Date(data.evaluatedAt).toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>
          <span>
            📍 {data.location?.name ?? (data.location?.city ? `${data.location.city}, ${data.location.country ?? ''}` : 'Cairo, Egypt')} (
            {Number(data.location?.lat ?? data.location?.latitude ?? 30.04).toFixed(2)}°N,{' '}
            {Number(data.location?.lon ?? data.location?.longitude ?? 31.24).toFixed(2)}°E)
          </span>
        </div>
      )}
    </div>
  );
}
