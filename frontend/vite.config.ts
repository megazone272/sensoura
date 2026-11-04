
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';

// Serve the dashboard from the domain root.
const base = process.env.VITE_BASE_PATH ?? '/';
const configDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(configDir, './src'),
      '@components': path.resolve(configDir, './src/components'),
      '@contexts': path.resolve(configDir, './src/contexts'),
      '@pages': path.resolve(configDir, './src/pages'),
      '@hooks': path.resolve(configDir, './src/hooks'),
      '@services': path.resolve(configDir, './src/services'),
      '@store': path.resolve(configDir, './src/store'),
      '@shared': path.resolve(configDir, './src/shared'),
      '@styles': path.resolve(configDir, './src/styles'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/ready': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/metrics': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|socket.io-client)[\\/]/.test(id)) return 'vendor';
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'charts';
          if (/[\\/]node_modules[\\/](gsap|@gsap[\\/]react)[\\/]/.test(id)) return 'motion';
          if (/[\\/]node_modules[\\/](date-fns|zustand|clsx)[\\/]/.test(id)) return 'utils';
          return undefined;
        },
      },
    },
  },
});
