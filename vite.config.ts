import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 의존성 사전 번들 스캔은 앱 진입점만 (eval/ 의 three 기반 PoC HTML 제외 — three는 WP0에서 제거)
  optimizeDeps: { entries: ['index.html'] },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});
