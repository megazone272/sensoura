import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';

const configDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
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
});
