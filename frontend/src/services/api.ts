import axios, { AxiosInstance } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sensoura-token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('sensoura-token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// API endpoints
export const endpoints = {
  // State
  getState: () => api.get('/state'),
  getSensorData: () => api.get('/sensor-data'),
  getSystem: () => api.get('/system'),
  getCommands: () => api.get('/commands'),
  getCommandResults: () => api.get('/command-results'),
  getAISuggestions: () => api.get('/ai-suggestions'),

  // Commands
  sendCommand: (command: any) => api.post('/command', command),
  approveSuggestion: (id: string) => api.post(`/ai-suggestions/${id}/approve`),
  rejectSuggestion: (id: string) => api.post(`/ai-suggestions/${id}/reject`),

  // Control
  controlRelay: (state: 'ON' | 'OFF', reason: string) =>
    api.post('/relay', { state, reason }),
  controlBuzzer: (action: 'MUTE' | 'UNMUTE') =>
    api.post('/buzzer', { action }),

  // System
  // NOTE: always send a body — the axios instance defaults to
  // Content-Type: application/json, and Fastify rejects empty JSON bodies (400).
  rebootSystem: () => api.post('/system/reboot', {}),
  calibrateSensors: () => api.post('/system/calibrate', {}),

  // AI
  getPredictions: () => api.get('/ai/predictions'),
  getModelInfo: () => api.get('/ai/model-info'),
  retrainModels: () => api.post('/ai/retrain', {}),

  // History
  getHistory: (params?: { from?: string; to?: string; limit?: number }) =>
    api.get('/history/sensor-data', { params }),

  // Health (these endpoints are NOT under /api prefix)
  health: () => axios.get(`${API_URL}/health`, { timeout: 10000 }),
  ready: () => axios.get(`${API_URL}/ready`, { timeout: 10000 }),
  metrics: () => axios.get(`${API_URL}/metrics`, { timeout: 10000 }),
};

export default api;
