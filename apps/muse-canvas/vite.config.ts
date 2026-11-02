import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    allowedHosts: true,
  },
  preview: { host: '0.0.0.0', port: 5175, allowedHosts: true },
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.test.{ts,tsx}'],
    css: false,
    testTimeout: 20000,
  },
});
