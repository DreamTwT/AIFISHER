import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: '0.0.0.0', port: 5180, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 5180, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['src/test/**/*.test.ts'] },
});
