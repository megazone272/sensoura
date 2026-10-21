import { useState, useEffect } from 'react';
import {
  Terminal,
  Power,
  Volume2,
  VolumeX,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  Square,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useCommands, useCommandResults, useConnection, useSensorStore } from '@store/sensorStore';

export function Commands() {
  const commands = useCommands();
  const commandResults = useCommandResults();
  const { connected } = useConnection();
  const { sendCommand, controlRelay, controlBuzzer } = useSensorStore();

  const [activeTab, setActiveTab] = useState<'pump' | 'buzzer' | 'system'>('pump');
  
  const [lastMessage, setLastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [commandHistory, setCommandHistory] = useState<Array<{
    id: string;
    target: string;
    action: string;
    timestamp: number;
    status: string;
  }>>([]);

  useEffect(() => {
    // Convert commands and results to history
    const entries = Object.entries(commandResults).map(([id, result]) => ({
      id,
      target: result.target,
      action: result.requestedAction,
      timestamp: result.timestamp,
      status: result.status,
    }));
    setCommandHistory(entries.sort((a, b) => b.timestamp - a.timestamp));
  }, [commandResults]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'executed': return <CheckCircle className="w-4 h-4 text-[var(--accent-primary)]" />;
      case 'failed': return <XCircle className="w-4 h-4 text-[var(--accent-danger)]" />;
      case 'pending': return <Clock className="w-4 h-4 text-[var(--accent-warning)]" />;
      default: return <AlertTriangle className="w-4 h-4 text-[var(--text-muted)]" />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Command Center</h1>
        <p className="text-[var(--text-muted)] mt-1">
          Send manual commands to the {connected ? 'connected' : 'offline'} device
        </p>
      </div>

      {/* Command Tabs */}
      <div className="flex gap-2">
        <button
          className={`btn btn-sm ${activeTab === 'pump' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('pump')}
        >
          <Power className="w-4 h-4" />
          Water Pump
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'buzzer' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('buzzer')}
        >
          <Volume2 className="w-4 h-4" />
          Buzzer
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'system' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('system')}
        >
          <Terminal className="w-4 h-4" />
          System
        </button>
      </div>

      {/* Command Actions */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>

          <div className="space-y-4">
            {activeTab === 'pump' && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">Control the water pump relay</p>
                <div className="flex gap-3">
                  <button
                    className="btn btn-primary flex-1"
                    onClick={() => controlRelay('ON', 'manual').then(id => setLastMessage({ text: `Pump ON (${id})`, type: 'success' })).catch(e => setLastMessage({ text: e.message, type: 'error' }))}
                    disabled={!connected}
                  >
                    <Play className="w-4 h-4" />
                    Turn ON
                  </button>
                  <button
                    className="btn btn-secondary flex-1"
                    onClick={() => controlRelay('OFF', 'manual').then(id => setLastMessage({ text: `Pump OFF (${id})`, type: 'success' })).catch(e => setLastMessage({ text: e.message, type: 'error' }))}
                    disabled={!connected}
                  >
                    <Square className="w-4 h-4" />
                    Turn OFF
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'buzzer' && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">Control the buzzer alert</p>
                <div className="flex gap-3">
                  <button
                    className="btn btn-primary flex-1"
                    onClick={() => controlBuzzer('UNMUTE').then(id => setLastMessage({ text: `Buzzer ON (${id})`, type: 'success' })).catch(e => setLastMessage({ text: e.message, type: 'error' }))}
                    disabled={!connected}
                  >
                    <Volume2 className="w-4 h-4" />
                    Unmute
                  </button>
                  <button
                    className="btn btn-secondary flex-1"
                    onClick={() => controlBuzzer('MUTE').then(id => setLastMessage({ text: `Buzzer MUTED (${id})`, type: 'success' })).catch(e => setLastMessage({ text: e.message, type: 'error' }))}
                    disabled={!connected}
                  >
                    <VolumeX className="w-4 h-4" />
                    Mute
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'system' && (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-muted)]">System-level commands</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    className="btn btn-warning"
                    onClick={() => sendCommand({ target: 'system', action: 'REBOOT', mode: 'MANUAL' }).then(id => setLastMessage({ text: `Reboot sent (${id})`, type: 'success' })).catch(e => setLastMessage({ text: e.message, type: 'error' }))}
                    disabled={!connected}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reboot
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => sendCommand({ target: 'system', action: 'CALIBRATE', mode: 'MANUAL' }).then(id => setLastMessage({ text: `Calibration sent (${id})`, type: 'success' })).catch(e => setLastMessage({ text: e.message, type: 'error' }))}
                    disabled={!connected}
                  >
                    <Terminal className="w-4 h-4" />
                    Calibrate
                  </button>
                </div>
              </div>
            )}
          </div>

          {lastMessage && (
            <div className={`mt-4 p-3 rounded-xl ${lastMessage.type === 'success' ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'bg-[var(--accent-danger)]/10 text-[var(--accent-danger)]'}`}>
              <p className="text-sm font-medium">{lastMessage.text}</p>
            </div>
          )}
        </div>

        {/* Command History */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Command History</h3>
          <div className="table-container max-h-96 overflow-y-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Target</th>
                  <th>Action</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {commandHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-[var(--text-muted)] py-8">
                      No commands yet
                    </td>
                  </tr>
                ) : (
                  commandHistory.map(entry => (
                    <tr key={entry.id}>
                      <td className="font-mono text-sm">
                        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                      </td>
                      <td className="capitalize">{entry.target}</td>
                      <td className="font-mono">{entry.action}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(entry.status)}
                          <span className="capitalize">{entry.status}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Commands (from Firebase) */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Recent Commands (Firebase)</h3>
        <div className="grid gap-2">
          {Object.entries(commands).length === 0 ? (
            <p className="text-[var(--text-muted)] text-center py-4">No commands in queue</p>
          ) : (
            Object.entries(commands).map(([id, cmd]) => (
              <div key={id} className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-3">
                  <Terminal className="w-4 h-4 text-[var(--accent-primary)]" />
                  <div>
                    <p className="font-medium capitalize">{cmd.target} - {cmd.action}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatDistanceToNow(new Date(cmd.timestamp), { addSuffix: true })} • {cmd.mode}
                    </p>
                  </div>
                </div>
                <span className="badge badge-info">{cmd.mode}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
