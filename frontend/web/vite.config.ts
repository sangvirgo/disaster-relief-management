import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The main ingress permits the demo Origin http://localhost:8080. Only the local
// development proxy substitutes that Origin; production uses same-origin ingress.
const target = process.env.C48_INGRESS_URL || 'http://127.0.0.1:8080';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/v1': {
        target,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request) => request.setHeader('Origin', target.replace('127.0.0.1', 'localhost')));
        },
      },
    },
  },
});
