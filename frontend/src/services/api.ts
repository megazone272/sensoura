import axios, { type AxiosInstance } from 'axios';
import type { Command } from '@shared/types';
import { expireAuthSession, getFreshAccessToken } from './authToken';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const isGitHubPages = typeof window !== 'undefined' && window.location.hostname.includes('github.io');

export const api: AxiosInstance = axios.create({
  baseURL: isGitHubPages ? '/api' : `${API_URL}/api`,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(
  async (config) => {
    const token = await getFreshAccessToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      expireAuthSession();
      error.message = 'Authentication required or session expired';
    }
    return Promise.reject(error);
  },
);

type CommandRequest = Omit<Command, 'id' | 'timestamp'>;

export const endpoints = {
  getState: () => api.get('/state'),
  getSensorData: () => api.get('/sensor-data'),
  getSystem: () => api.get('/system'),
  getCommands: () => api.get('/commands'),
  getCommandResults: () => api.get('/command-results'),
  getAISuggestions: () => api.get('/ai-suggestions'),

  sendCommand: (command: CommandRequest) => api.post('/command', command),
  approveSuggestion: (id: string) => api.post(`/ai-suggestions/${encodeURIComponent(id)}/approve`),
  rejectSuggestion: (id: string) => api.post(`/ai-suggestions/${encodeURIComponent(id)}/reject`),

  controlRelay: (state: 'ON' | 'OFF', reason: string) => api.post('/relay', { state, reason }),
  controlBuzzer: (action: 'MUTE' | 'UNMUTE') => api.post('/buzzer', { action }),

  rebootSystem: () => api.post('/system/reboot', {}),
  calibrateSensors: () => api.post('/system/calibrate', {}),

  getPredictions: () => api.get('/ai/predictions'),
  getModelInfo: () => api.get('/ai/model-info'),
  retrainModels: () => api.post('/ai/retrain', {}),

  getCropRotation: () => api.get('/ai/crop-rotation'),
  evaluateCropRotation: (context: { soilType?: string; primaryGoal?: string; currentCropId?: string }) => api.post('/ai/crop-rotation/evaluate', context),

  getHistory: (params?: { from?: string; to?: string; limit?: number }) => api.get('/history/sensor-data', { params }),
  getClimateCurrent: () => api.get('/climate/current'),
  getClimateHistory: (params: { start: string; end: string }) => api.get('/climate/history', { params }),
  getClimateStatus: () => api.get('/climate/status'),

  getEmailStatus: () => api.get('/admin/email/status'),
  verifyEmailSmtp: () => api.get('/admin/email/verify'),
  previewEmail: (params: { template: string; language: 'ar' | 'en' }) => api.get('/admin/email/preview', { params }),
  sendTestEmail: (payload: { recipient: string; template: string; language: 'ar' | 'en' }) => api.post('/admin/email/test', payload),

  health: () => axios.get(`${API_URL}/health`, { timeout: 10000 }),
  ready: () => axios.get(`${API_URL}/ready`, { timeout: 10000 }),
  metrics: () => axios.get(`${API_URL}/metrics`, { timeout: 10000 }),
};

export default api;
