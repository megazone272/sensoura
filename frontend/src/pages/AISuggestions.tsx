import { useState } from 'react';
import {
  Brain,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Droplets,
  Wind,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAISuggestions, useSensorStore, useConnection } from '@store/sensorStore';
import type { AISuggestion } from '@shared/types';

const typeIcons = {
  irrigation: Droplets,
  environment: Wind,
  anomaly: AlertTriangle,
  maintenance: AlertTriangle,
  optimization: TrendingUp,
  harvest: Sparkles,
} as const;

const typeColors = {
  irrigation: '#22c55e',
  environment: '#fbbf24',
  anomaly: '#ef4444',
  maintenance: '#f97316',
  optimization: '#06b6d4',
  harvest: '#a855f7',
} as const;

function SuggestionCard({ suggestion }: { suggestion: AISuggestion }) {
  const { approveSuggestion, rejectSuggestion } = useSensorStore();
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<'approved' | 'rejected' | null>(null);

  const Icon = typeIcons[suggestion.type as keyof typeof typeIcons] || AlertTriangle;
  const color = typeColors[suggestion.type as keyof typeof typeColors] || '#fbbf24';
  const isPending = suggestion.status === 'pending';
  const isExpired = suggestion.expiresAt < Date.now();

  const handleApprove = async () => {
    if (!suggestion.id) return;
    setProcessing(true);
    try {
      await approveSuggestion(suggestion.id);
      setResult('approved');
    } catch (error) {
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!suggestion.id) return;
    setProcessing(true);
    try {
      await rejectSuggestion(suggestion.id);
      setResult('rejected');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className={`card glass-hover border-l-4`} style={{ borderLeftColor: color }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{suggestion.suggestion}</h3>
              <span className="badge" style={{ background: `${color}20`, color }}>
                {suggestion.type}
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)] mt-1">{suggestion.reason}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs font-mono text-[var(--text-muted)]">
            {Math.round(suggestion.confidence * 100)}% confidence
          </span>
          <span className={`badge ${
            result === 'approved' ? 'badge-success' :
            result === 'rejected' ? 'badge-danger' :
            isExpired ? 'badge-neutral' :
            'badge-warning'
          }`}>
            {result || suggestion.status}
          </span>
        </div>
      </div>

      {/* Recommended Action */}
      <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] mb-3">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-1">Recommended Action</p>
        <p className="font-mono text-sm">
          {suggestion.recommendedAction.target} → {suggestion.recommendedAction.action}
          {suggestion.recommendedAction.mode && ` (${suggestion.recommendedAction.mode})`}
        </p>
      </div>

      {/* Actions */}
      {isPending && !isExpired && !result && (
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-primary flex-1"
            onClick={handleApprove}
            disabled={processing}
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Approve
          </button>
          <button
            className="btn btn-sm btn-secondary flex-1"
            onClick={handleReject}
            disabled={processing}
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Reject
          </button>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Created {formatDistanceToNow(new Date(suggestion.createdAt), { addSuffix: true })}
        </span>
        {isExpired && <span className="text-[var(--accent-danger)]">Expired</span>}
        {suggestion.requiresApproval && <span className="badge badge-info">Requires Approval</span>}
      </div>
    </div>
  );
}

export function AISuggestions() {
  const suggestions = useAISuggestions();
  const { connected } = useConnection();
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const allSuggestions = Object.entries(suggestions);
  const filtered = allSuggestions.filter(([_, s]) => {
    if (filter === 'all') return true;
    return s.status === filter;
  });

  const pendingCount = allSuggestions.filter(([_, s]) => s.status === 'pending').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-7 h-7" style={{ color: 'var(--accent-primary)' }} />
            AI Suggestions
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            {pendingCount} pending • {allSuggestions.length} total • {connected ? 'LIVE' : 'OFFLINE'}
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(['all', 'pending', 'approved', 'rejected'] as const).map(tab => (
          <button
            key={tab}
            className={`btn btn-sm ${filter === tab ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === 'pending' && pendingCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[var(--accent-primary)]/20 text-xs">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Suggestions Grid */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <Brain className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
          <p className="text-[var(--text-muted)]">No {filter !== 'all' ? filter : ''} suggestions</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            AI will generate suggestions based on sensor patterns
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(([id, suggestion]) => (
            <SuggestionCard key={id} suggestion={{ ...suggestion, id }} />
          ))}
        </div>
      )}
    </div>
  );
}
