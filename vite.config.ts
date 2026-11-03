import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // 사전 번들링하면 LibreDWG가 import.meta.url 기준으로 찾는 .wasm 경로가 깨진다.
  optimizeDeps: { exclude: ['@mlightcad/libredwg-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', testTimeout: 120_000 },
});
